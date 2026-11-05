import { FieldValue } from '../db/firestore';
import { ledgerCreate, ledgerMark } from './ledgerDoor';
import type { DocumentData, Firestore, Transaction as DbTransaction } from '../db/firestore';
import { TransactionValidator } from '../../kernel/validation/TransactionValidator';
import { isIncomeAccount, resolveAccountRole } from '../../lib/accountUtils';
import { formatMoney as formatCurrency } from '../../lib/moneyFormat';
import { formatTzDate } from '../../lib/calendarDate';
import {
  planFxRevaluation, revaluationDateProblem, reversalLines, REVALUATION_SIDES, revaluationReversalDate, revaluationSummary,
  type RevaluableDocument, type RevaluationDetail, type RevaluationLine, type RevaluationPlan, type RevaluationSkip,
} from '../../lib/fxRevaluation';
import { writeServerAuditLog } from './auditLogService';
import { FxService } from './FxService';
import { workspaceRole } from '../../lib/periodLock';
import type { ChartAccount } from '../../types';

/**
 * Month-end currency revaluation (R-07): the open foreign-currency invoices and bills are worth a
 * different amount in the workspace's currency today than when they were booked, and a balance sheet
 * may need that number. This posts one entry — the receivables and payables move to today's value and
 * an unrealized FX gain/loss account takes the other side — together with its reversal the next day,
 * so the documents keep their own rates and the ledger after tomorrow reads exactly what they say.
 *
 * The rules it is built on (all of them are the reason the old run was switched off, L-187):
 * - only owners and accountants run it, and nothing is posted in a closed or locked period;
 * - today's rates come from the exchange service and are never invented; for a past month-end the
 *   caller must supply a positive rate for every open foreign currency, so today's rate is never
 *   mistaken for yesterday's; a missing rate stops the run;
 * - only the open balance of a document in a foreign currency is touched, with the same two rules the
 *   aging uses (`calculateAmountDue` and `toBaseCents`), so this entry and the A/R report agree;
 * - no account is created here. The gain/loss account must exist in the chart of accounts;
 * - one run per date: the same date cannot be revalued twice (the message says where it is).
 *
 * The arithmetic and every skip rule are in `src/lib/fxRevaluation.ts`, where they are tested.
 */

export class FxRevaluationError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'FxRevaluationError';
  }
}

const ADMIN_ROLES = ['owner', 'accountant'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** The account the difference goes to; found by its name, never by a hardcoded id. */
const FX_ACCOUNT_NAME = /unrealized.*fx|fx.*(gain|loss)|foreign exchange|exchange (gain|loss)|revaluation/i;

export interface RevaluationInput {
  workspaceId: string;
  user: { uid: string; email?: string; admin?: boolean };
  /** today uses live rates; a past month-end uses only rates the caller enters for that day */
  date?: string;
  /** show what would be posted and post nothing */
  dryRun?: boolean;
  /** rates the caller already has (currency → the workspace's currency); the rest are fetched */
  rates?: Record<string, number>;
}

export interface RevaluationResult {
  date: string;
  reversalDate: string;
  baseCurrency: string;
  posted: boolean;
  transactionId: string | null;
  reversalTransactionId: string | null;
  netGainCents: number;
  debitTotalCents: number;
  documentCount: number;
  currencies: string[];
  lines: RevaluationLine[];
  details: RevaluationDetail[];
  skipped: RevaluationSkip[];
  unpriced: string[];
  summary: string;
}

/**
 * The account an open balance sits in: A/R for a customer, A/P for a vendor. The document's own
 * choice first, then the workspace's mapping, then the chart by role — never a hardcoded id, and
 * nothing is created here.
 */
function ledgerAccountFor(accounts: ChartAccount[], side: 'customer' | 'vendor', preferredId?: string, mappingId?: string) {
  const byId = new Map(accounts.map(a => [a.id, a]));
  const chosen = (preferredId ? byId.get(preferredId) : undefined) || (mappingId ? byId.get(mappingId) : undefined);
  if (chosen) return chosen;
  return accounts.find(a => !a.isArchived && resolveAccountRole(a) === (side === 'customer' ? 'ar' : 'ap'));
}

async function ratesFor(currencies: string[], base: string, given?: Record<string, number>): Promise<Record<string, number | undefined>> {
  const out: Record<string, number | undefined> = {};
  await Promise.all(currencies.map(async (currency) => {
    const provided = given?.[currency];
    if (typeof provided === 'number' && Number.isFinite(provided) && provided > 0) {
      out[currency] = provided;
      return;
    }
    try {
      out[currency] = await FxService.getRate(currency, base);
    } catch {
      out[currency] = undefined; // never a made-up rate (L-187)
    }
  }));
  return out;
}

function toRevaluable(
  rows: Array<DocumentData>,
  side: 'customer' | 'vendor',
  base: string,
  accounts: ChartAccount[],
  mapping: { ar?: string; ap?: string },
): RevaluableDocument[] {
  return rows
    .filter(row => {
      const currency = String(row.currency || '').trim().toUpperCase();
      return Boolean(currency) && currency !== base;
    })
    .map((row) => {
      const account = ledgerAccountFor(
        accounts, side,
        side === 'customer' ? String(row.arAccountId || '') || undefined : undefined,
        side === 'customer' ? mapping.ar : mapping.ap,
      );
      return {
        id: String(row.id),
        side,
        number: row.number ? String(row.number) : undefined,
        partyName: side === 'customer' ? row.customerName || undefined : row.vendorName || undefined,
        currency: String(row.currency).toUpperCase(),
        exchangeRate: typeof row.exchangeRate === 'number' ? row.exchangeRate : undefined,
        amountCents: Number(row.amountCents) || 0,
        amountPaidCents: Number(row.amountPaidCents) || 0,
        depositCents: Number(row.depositCents) || 0,
        status: String(row.status || ''),
        accountId: account?.id,
        accountName: account?.name,
        accountCurrency: account?.currency,
      };
    });
}

async function postEntry(
  db: Firestore,
  t: DbTransaction,
  input: RevaluationInput,
  workspace: DocumentData,
  tx: DocumentData,
): Promise<DocumentData> {
  try {
    return await TransactionValidator.validateAndPrepare(
      {
        id: db.collection('transactions').doc().id,
        workspaceId: input.workspaceId,
        uid: input.user.uid,
        currency: workspace.currency || 'USD',
        // the lines are already in the workspace's currency: a rate on the entry would convert twice
        exchangeRate: 1,
        type: 'journal',
        status: 'completed',
        ...tx,
      },
      { workspaceId: input.workspaceId, user: { uid: input.user.uid, admin: input.user.admin }, wsData: workspace }, undefined, t,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/Period Locked/i.test(message)) throw new FxRevaluationError(409, `${message} Revaluation posts nothing in a closed period.`);
    throw new FxRevaluationError(400, message);
  }
}

function result(date: string, reversalDate: string, base: string, plan: RevaluationPlan, posted: boolean, transactionId: string | null, reversalTransactionId: string | null, rateDate?: string): RevaluationResult {
  const money = (cents: number) => formatCurrency(cents, base);
  return {
    date, reversalDate, baseCurrency: base, posted, transactionId, reversalTransactionId,
    netGainCents: plan.netGainCents, debitTotalCents: plan.debitTotalCents,
    documentCount: plan.documentCount, currencies: plan.currencies,
    lines: plan.lines, details: plan.details, skipped: plan.skipped, unpriced: plan.unpriced,
    summary: revaluationSummary(plan, money, rateDate),
  };
}

/** Preview or post the revaluation, in the same call: `dryRun` posts nothing and changes nothing. */
export async function revaluateForeignBalances(db: Firestore, input: RevaluationInput): Promise<RevaluationResult> {
  return db.runTransaction(async (t) => {
    const workspace = (await t.get(db.collection('workspaces').doc(input.workspaceId))).data();
    if (!workspace) throw new FxRevaluationError(404, 'Workspace not found');
    if (!ADMIN_ROLES.includes(workspaceRole(workspace, input.user.uid))) {
      throw new FxRevaluationError(403, 'Only owners and accountants run the currency revaluation');
    }
    const base = String(workspace.currency || 'USD').toUpperCase();
    const today = formatTzDate(new Date(), typeof workspace.timezone === 'string' ? workspace.timezone : 'UTC');
    const date = input.date || today;
    const dateProblem = revaluationDateProblem(date, today);
    if (dateProblem) throw new FxRevaluationError(400, dateProblem);
    const historical = date < today;
    const rateDate = historical ? date : undefined;
    const reversalDate = revaluationReversalDate(date);

    const accounts = (await t.get(db.collection('chartAccounts').where('workspaceId', '==', input.workspaceId)))
      .docs.map(d => ({ ...d.data(), id: d.id }) as ChartAccount);
    const gainLoss = accounts.find(a => !a.isArchived && (isIncomeAccount(a) || a.type === 'expense') && FX_ACCOUNT_NAME.test(String(a.name || '')));
    if (!gainLoss) {
      throw new FxRevaluationError(400, 'Add an "Unrealized FX Gain/Loss" account (income or expense) in the chart of accounts first — the difference has to go somewhere.');
    }

    const mapping = { ar: String(workspace.defaultAccountMappings?.ar || '') || undefined, ap: String(workspace.defaultAccountMappings?.ap || '') || undefined };
    const openDocs = async (collection: string) => (await t.get(db.collection(collection).where('workspaceId', '==', input.workspaceId)))
      .docs.map(d => ({ ...d.data(), id: d.id }) as DocumentData);
    const docs = [
      ...toRevaluable(await openDocs('invoices'), 'customer', base, accounts, mapping),
      ...toRevaluable(await openDocs('bills'), 'vendor', base, accounts, mapping),
    ];

    // Only what is still open is anybody's business here: a paid bill with no A/P account is not a
    // reason to refuse the run, and a rate for its currency need not be fetched for it.
    const open = docs.filter(d => REVALUATION_SIDES[d.side].open({ status: d.status }));
    const noAccount = open.filter(d => !d.accountId);
    if (noAccount.length > 0) {
      const sides = [...new Set(noAccount.map(d => d.side === 'customer' ? 'an Accounts Receivable' : 'an Accounts Payable'))].join(' and ');
      throw new FxRevaluationError(400, `${noAccount.length} ${noAccount.length === 1 ? 'document has' : 'documents have'} no ${sides} account to move, and revaluation will not guess one. Set it up in the chart of accounts first.`);
    }

    const currencies = [...new Set(open.map(d => String(d.currency || '').toUpperCase()).filter(c => c && c !== base))].sort();
    const rates: Record<string, number | undefined> = historical
      ? Object.fromEntries(currencies.map(currency => {
        const rate = input.rates?.[currency];
        return [currency, typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? rate : undefined];
      }))
      : await ratesFor(currencies, base, input.rates);
    const plan = planFxRevaluation(docs, currency => rates[String(currency).toUpperCase()], { id: gainLoss.id, name: String(gainLoss.name) }, base, rateDate);

    if (plan.unpriced.length > 0) {
      if (historical && input.dryRun) return result(date, reversalDate, base, plan, false, null, null, rateDate);
      if (historical) {
        const list = plan.unpriced.join(' and ');
        throw new FxRevaluationError(400, `Enter the ${list} rate${plan.unpriced.length === 1 ? '' : 's'} for ${date}. Nothing was posted.`);
      }
      const list = plan.unpriced.join(' and ');
      throw new FxRevaluationError(503, `The ${list} rate is not available from the exchange service right now, and a revaluation cannot leave a currency out. Nothing was posted — try again in a little while.`);
    }
    if (plan.lines.length === 0) return result(date, reversalDate, base, plan, false, null, null, rateDate);

    const sameDay = (await t.get(db.collection('transactions')
      .where('workspaceId', '==', input.workspaceId)
      .where('date', 'in', [date, reversalDate]))).docs
      .map(d => d.data() as DocumentData);
    if (sameDay.some(tx => tx.metadata?.type === 'fx-revaluation' && tx.metadata?.revaluationDate === date)) {
      throw new FxRevaluationError(409, `A revaluation for ${date} is already in the books and reverses on ${reversalDate}. Undo it first if you mean to run ${date} again.`);
    }
    if (input.dryRun) return result(date, reversalDate, base, plan, false, null, null, rateDate);

    const description = `Currency revaluation at ${date} (${plan.currencies.join(', ')})`;
    // Both ids first: the entry is to be pointed at by its reversal and the reversal at it, and the
    // pair is written together so a half-posted revaluation cannot exist.
    const entryId = db.collection('transactions').doc().id;
    const reversalId = db.collection('transactions').doc().id;
    const entry = await postEntry(db, t, input, workspace, {
      id: entryId,
      date,
      description,
      totalAmountCents: plan.debitTotalCents,
      lines: plan.lines.map(l => ({ ...l })),
      // not `reversalEventId`: that word means "somebody undid this", and the reversal below is only
      // scheduled — it is dated tomorrow and has not taken effect. Undoing it early sets the field.
      metadata: {
        type: 'fx-revaluation',
        revaluationDate: date,
        reversalDate,
        reversalTransactionId: reversalId,
        currencies: plan.currencies,
        documents: plan.details.map(d => ({ id: d.id, side: d.side, currency: d.currency, deltaCents: d.deltaCents })),
      },
    });
    const reversal = await postEntry(db, t, input, workspace, {
      id: reversalId,
      date: reversalDate,
      description: `Reversal of ${description}`,
      totalAmountCents: plan.debitTotalCents,
      metadata: { type: 'fx-revaluation-reversal', revaluationDate: date, reversesTxId: entryId, isReversal: true, scheduledFor: reversalDate },
      lines: reversalLines(plan.lines),
    });

    const now = new Date().toISOString();
    ledgerCreate(t, db.collection('transactions').doc(String(entry.id)), { ...entry, createdAt: FieldValue.serverTimestamp(), updatedAt: now });
    ledgerCreate(t, db.collection('transactions').doc(String(reversal.id)), { ...reversal, createdAt: FieldValue.serverTimestamp(), updatedAt: now });
    await writeServerAuditLog({
      workspaceId: input.workspaceId, uid: input.user.uid, email: input.user.email,
      action: 'FX_REVALUATION_POSTED', entityType: 'workspace', entityId: input.workspaceId,
      details: {
        description: `${description}: ${plan.documentCount} ${plan.documentCount === 1 ? 'document' : 'documents'}, reverses ${reversalDate}`,
        date, reversalDate, currencies: plan.currencies, documentCount: plan.documentCount,
        netGainCents: plan.netGainCents, transactionId: entry.id, reversalTransactionId: reversal.id,
      },
    }, { db, tx: t });

    return result(date, reversalDate, base, plan, true, String(entry.id), String(reversal.id), rateDate);
  });
}

/**
 * Undo a revaluation by posting its mirror today and voiding the paired next-day reversal in the
 * same transaction. Refuses unless both entries still agree and it has not already been undone.
 */
export async function undoRevaluation(db: Firestore, input: { workspaceId: string; user: RevaluationInput['user']; date: string }): Promise<{ transactionId: string; reversesTxId: string }> {
  const date = String(input.date || '');
  if (!DAY.test(date)) throw new FxRevaluationError(400, 'Date must be YYYY-MM-DD');
  return db.runTransaction(async (t) => {
    const workspace = (await t.get(db.collection('workspaces').doc(input.workspaceId))).data();
    if (!workspace) throw new FxRevaluationError(404, 'Workspace not found');
    if (!ADMIN_ROLES.includes(workspaceRole(workspace, input.user.uid))) {
      throw new FxRevaluationError(403, 'Only owners and accountants undo a currency revaluation');
    }
    const found = (await t.get(db.collection('transactions')
      .where('workspaceId', '==', input.workspaceId)
      .where('date', '==', date))).docs
      .map(d => ({ ...d.data(), id: d.id }) as DocumentData)
      .find(tx => tx.metadata?.type === 'fx-revaluation' && String(tx.metadata?.revaluationDate || '') === date);
    if (!found) throw new FxRevaluationError(404, `No revaluation for ${date} was found`);
    if (found.reversalEventId) throw new FxRevaluationError(409, `The revaluation for ${date} is already reversed`);
    const scheduledId = String(found.metadata?.reversalTransactionId || '');
    if (!scheduledId) throw new FxRevaluationError(409, `The revaluation for ${date} has no scheduled reversal, so it cannot be safely undone.`);
    const scheduled = db.collection('transactions').doc(scheduledId);
    const scheduledData = (await t.get(scheduled)).data();
    if (!scheduledData
      || scheduledData.workspaceId !== input.workspaceId
      || scheduledData.metadata?.type !== 'fx-revaluation-reversal'
      || String(scheduledData.metadata?.reversesTxId || '') !== String(found.id)
      || scheduledData.status !== 'completed') {
      throw new FxRevaluationError(409, `The scheduled reversal for ${date} is missing or no longer active, so nothing was undone.`);
    }

    const today = formatTzDate(new Date(), typeof workspace.timezone === 'string' ? workspace.timezone : 'UTC');
    const lines = reversalLines(((found.lines as Array<{ accountId: string; accountName?: string; amountCents: number; description?: string }>) || []).map(l => ({
      accountId: l.accountId,
      accountName: String(l.accountName || ''),
      amountCents: Number(l.amountCents || 0),
      description: String(l.description || ''),
    }))).map(l => ({ ...l, description: `Undone early: revaluation of ${date}` }));
    const reversal = await postEntry(db, t, { ...input, date: today }, workspace, {
      date: today,
      description: `Reversal of currency revaluation at ${date}`,
      totalAmountCents: Number(found.totalAmountCents) || 0,
      metadata: { type: 'fx-revaluation-reversal', revaluationDate: date, reversesTxId: found.id, isReversal: true },
      lines,
    });
    const now = new Date().toISOString();
    ledgerCreate(t, db.collection('transactions').doc(String(reversal.id)), { ...reversal, createdAt: FieldValue.serverTimestamp(), updatedAt: now });
    ledgerMark(t, db.collection('transactions').doc(String(found.id)), { reversalEventId: reversal.id, updatedAt: now });
    // The active scheduled entry was checked above and is voided in the same transaction as this
    // mirror. It stays in the audit trail; isPostable drops it so it cannot reverse the entry twice.
    t.update(scheduled, { status: 'void', voidedReason: `Undone early, with an entry dated ${today}`, updatedAt: now });
    await writeServerAuditLog({
      workspaceId: input.workspaceId, uid: input.user.uid, email: input.user.email,
      action: 'FX_REVALUATION_UNDONE', entityType: 'workspace', entityId: input.workspaceId,
      details: {
        description: `Reversal of the revaluation of ${date}`, revaluationDate: date,
        transactionId: found.id, reversalTransactionId: reversal.id,
        scheduledReversalVoided: Boolean(found.metadata?.reversalTransactionId),
      },
    }, { db, tx: t });
    return { transactionId: String(reversal.id), reversesTxId: String(found.id) };
  });
}
