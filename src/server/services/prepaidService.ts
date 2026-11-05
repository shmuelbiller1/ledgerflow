import { minorUnitRate } from '../../lib/currencyMinorUnits';
import type { DocumentData, Firestore, Transaction } from '../db/firestore';
import { ledgerCreate } from './ledgerDoor';
import { FieldValue } from '../db/firestore';
import { TransactionValidator } from '../../kernel/validation/TransactionValidator';
import { resolveAccountRole } from '../../lib/accountUtils';
import { assertPostingOpen, workspaceRole } from '../../lib/periodLock';
import { deferredRevenueAccount, prepaidAccount, spreadPlan, spreadProblem } from '../../lib/prepaidSchedule';
import { formatMoney as formatCurrency } from '../../lib/moneyFormat';
import type { ChartAccount } from '../../types';
import { writeServerAuditLog } from './auditLogService';

/**
 * Spreading a document over the months it covers, in one database transaction each:
 * - a bill's cost (prepaid expenses, K-17): on the bill's date DR Prepaid / CR the expense, then at
 *   each month end DR the expense / CR Prepaid for that month's share;
 * - an invoice's income (revenue recognition, K-16): on the invoice's date DR the income / CR Deferred
 *   Revenue, then at each month end DR Deferred Revenue / CR the income for that month's share.
 * Shares are whole cents, the remainder last (src/lib/prepaidSchedule.ts). The document's own posting
 * is not touched, and the entries are tagged `spreadOfBillId` / `spreadOfInvoiceId` (not `billId` /
 * `invoiceId`) so re-posting the document doesn't reverse them. The document records the schedule, so
 * it can't be spread twice; undoing it voids every entry of the schedule, and is refused once one of
 * them is in a closed period. Writers only.
 */

export class PrepaidError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'PrepaidError';
  }
}

const WRITERS = ['owner', 'accountant', 'bookkeeper'];
const NOT_POSTED = new Set(['draft', 'void', 'cancelled', 'rejected']);

export type SpreadKind = 'bill' | 'invoice';

const SIDES = {
  bill: {
    collection: 'bills', field: 'prepaidSchedule', party: 'vendorName', tag: 'spreadOfBillId', role: 'expense' as const, holdRole: 'asset' as const,
    // the amount waits in an asset: it goes there first (+), and back to the expense each month
    holdSign: 1, firstType: 'prepaid-spread', shareType: 'prepaid-recognition', heading: 'Prepaid', action: 'BILL_EXPENSE_SPREAD',
    noAccount: 'Choose the expense account to spread',
    noHold: 'Choose the Prepaid Expenses account (or add an asset account named "Prepaid Expenses")',
    hold: (accounts: ChartAccount[], mappings?: Record<string, string | undefined>) => prepaidAccount(accounts, mappings),
  },
  invoice: {
    collection: 'invoices', field: 'revenueSchedule', party: 'customerName', tag: 'spreadOfInvoiceId', role: 'revenue' as const, holdRole: 'liability' as const,
    // the income waits in a liability until it is earned
    holdSign: -1, firstType: 'deferred-revenue', shareType: 'revenue-recognition', heading: 'Deferred revenue', action: 'INVOICE_REVENUE_SPREAD',
    noAccount: 'Choose the income account to spread',
    noHold: 'Choose the Deferred Revenue account (or add a liability account named "Deferred Revenue")',
    hold: (accounts: ChartAccount[], mappings?: Record<string, string | undefined>) => deferredRevenueAccount(accounts, mappings),
  },
};

interface DocInput { workspaceId: string; uid: string; email?: string; documentId: string }

async function prepare(db: Firestore, t: Transaction, kind: SpreadKind, input: DocInput) {
  const workspace = (await t.get(db.collection('workspaces').doc(input.workspaceId))).data();
  if (!workspace) throw new PrepaidError(404, 'Workspace not found');
  if (!WRITERS.includes(workspaceRole(workspace, input.uid))) throw new PrepaidError(403, `Only owners, accountants and bookkeepers spread ${kind === 'bill' ? 'expenses' : 'income'}`);
  const ref = db.collection(SIDES[kind].collection).doc(input.documentId);
  const docData = (await t.get(ref)).data();
  if (!docData || docData.workspaceId !== input.workspaceId) throw new PrepaidError(404, `${kind === 'bill' ? 'Bill' : 'Invoice'} not found`);
  return { workspace, ref, docData };
}

function lockCheck(date: string, workspace: DocumentData, uid: string) {
  try {
    assertPostingOpen(date, workspace, uid);
  } catch (err) {
    throw new PrepaidError(409, err instanceof Error ? err.message : String(err));
  }
}

export async function spreadDocument(db: Firestore, kind: SpreadKind, input: DocInput & {
  /** the expense (bill) or income (invoice) account */
  accountId: string;
  /** Prepaid Expenses (bill) or Deferred Revenue (invoice); found by itself when not given */
  holdAccountId?: string;
  amountCents: number;
  months: number;
  startMonth?: string;
}) {
  const side = SIDES[kind];
  return db.runTransaction(async (t) => {
    const { workspace, ref, docData } = await prepare(db, t, kind, input);
    if (NOT_POSTED.has(String(docData.status))) throw new PrepaidError(409, `The ${kind} is ${docData.status}; only a posted ${kind} can be spread`);
    if (docData[side.field]?.id) throw new PrepaidError(409, `This ${kind} is already spread over months`);
    const date = String(docData.date || docData.issueDate || '').slice(0, 10);
    const rate = typeof docData.exchangeRate === 'number' && docData.exchangeRate > 0 ? docData.exchangeRate : 1;
    // BM-04: the document's minor units → the books'
    const docBaseCents = Math.round((Number(docData.amountCents) || 0) * minorUnitRate(rate, String(docData.currency || workspace.currency || 'USD'), String(workspace.currency || 'USD')));
    const spread = { date, amountCents: input.amountCents, months: input.months, startMonth: input.startMonth || date.slice(0, 7) };
    const problem = spreadProblem(spread, docBaseCents, kind);
    if (problem) throw new PrepaidError(400, problem);

    const accounts = (await t.get(db.collection('chartAccounts').where('workspaceId', '==', input.workspaceId))).docs.map(d => ({ ...d.data(), id: d.id }) as ChartAccount);
    const account = accounts.find(a => a.id === input.accountId);
    if (!account || resolveAccountRole(account) !== side.role) throw new PrepaidError(400, side.noAccount);
    const hold = input.holdAccountId
      ? accounts.find(a => a.id === input.holdAccountId && resolveAccountRole(a) === side.holdRole)
      : side.hold(accounts, workspace.defaultAccountMappings);
    if (!hold) throw new PrepaidError(400, side.noHold);

    const plan = spreadPlan(spread);
    for (const d of [date, ...plan.map(p => p.date)]) lockCheck(d, workspace, input.uid);

    const scheduleId = db.collection('transactions').doc().id;
    const label = `${kind} ${docData.number || input.documentId}${docData[side.party] ? ` (${docData[side.party]})` : ''}`;
    const base = { workspaceId: input.workspaceId, uid: input.uid, currency: workspace.currency || 'USD', exchangeRate: 1, status: 'completed', type: 'actual' };
    const context = { workspaceId: input.workspaceId, user: { uid: input.uid }, wsData: workspace };
    // into the holding account (first) or out of it (each month); the debit line first
    const move = (amountCents: number, description: string, intoHold: boolean) => {
      const holdCents = (intoHold ? 1 : -1) * side.holdSign * amountCents;
      const lines = [
        { accountId: hold.id, accountName: hold.name, amountCents: holdCents, description },
        { accountId: account.id, accountName: account.name, amountCents: -holdCents, description },
      ];
      return lines[0].amountCents > 0 ? lines : [lines[1], lines[0]];
    };
    const entries: DocumentData[] = [];
    try {
      const description = `${side.heading}: ${label}, spread over ${input.months} months`;
      entries.push(await TransactionValidator.validateAndPrepare({
        ...base, id: db.collection('transactions').doc().id, date, description, totalAmountCents: input.amountCents,
        // not `billId` / `invoiceId`: re-posting the document reverses every entry carrying that, and these are not its own
        metadata: { type: side.firstType, [side.tag]: input.documentId, prepaidScheduleId: scheduleId },
        lines: move(input.amountCents, description, true),
      }, context, undefined, t));
      for (const p of plan) {
        const share = `${side.heading} ${label}: month ${p.installment} of ${input.months}`;
        entries.push(await TransactionValidator.validateAndPrepare({
          ...base, id: db.collection('transactions').doc().id, date: p.date, description: share, totalAmountCents: p.amountCents,
          // scheduled: dated ahead on purpose (the data check doesn't flag it)
          metadata: { type: side.shareType, [side.tag]: input.documentId, prepaidScheduleId: scheduleId, installment: p.installment, installments: input.months, scheduled: true },
          lines: move(p.amountCents, share, false),
        }, context, undefined, t));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/Period Locked/i.test(message)) throw new PrepaidError(409, message);
      throw err;
    }

    for (const e of entries) ledgerCreate(t, db.collection('transactions').doc(String(e.id)), { ...e, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    const schedule = {
      id: scheduleId, amountCents: input.amountCents, months: input.months, startMonth: spread.startMonth,
      ...(kind === 'bill' ? { expenseAccountId: account.id, prepaidAccountId: hold.id } : { revenueAccountId: account.id, deferredAccountId: hold.id }),
      transactionIds: entries.map(e => String(e.id)), createdAt: new Date().toISOString(),
    };
    t.update(ref, { [side.field]: schedule, updatedAt: new Date().toISOString() });
    await writeServerAuditLog({
      workspaceId: input.workspaceId, uid: input.uid, email: input.email, action: side.action, entityType: kind, entityId: input.documentId,
      details: { description: `Spread ${formatCurrency(input.amountCents, workspace.currency || 'USD')} of ${label} over ${input.months} months from ${spread.startMonth}`, scheduleId },
    }, { db, tx: t });
    return { [`${kind}Id`]: input.documentId, schedule, entries: plan };
  });
}

export async function undoSpread(db: Firestore, kind: SpreadKind, input: DocInput) {
  const side = SIDES[kind];
  return db.runTransaction(async (t) => {
    const { workspace, ref, docData } = await prepare(db, t, kind, input);
    const schedule = docData[side.field];
    if (!schedule?.id) throw new PrepaidError(409, `This ${kind} is not spread over months`);
    const refs = (schedule.transactionIds as string[] || []).map(id => db.collection('transactions').doc(id));
    const entries = refs.length ? await t.getAll(...refs) : [];
    const live = entries.filter(snap => {
      const e = snap.data();
      return e && e.workspaceId === input.workspaceId && e.metadata?.prepaidScheduleId === schedule.id && e.status !== 'void';
    });
    for (const snap of live) lockCheck(String(snap.data()?.date || ''), workspace, input.uid);
    const now = new Date().toISOString();
    for (const snap of live) t.update(snap.ref, { status: 'void', voidedReason: 'Spread over months undone', updatedAt: now });
    t.update(ref, { [side.field]: FieldValue.delete(), updatedAt: now });
    await writeServerAuditLog({
      workspaceId: input.workspaceId, uid: input.uid, email: input.email, action: `${side.action}_UNDONE`, entityType: kind, entityId: input.documentId,
      details: { description: `Undid the spread of ${kind} ${docData.number || input.documentId}`, scheduleId: schedule.id },
    }, { db, tx: t });
    return { [`${kind}Id`]: input.documentId, voided: live.length };
  });
}

/** K-17 */
export const spreadBillExpense = (db: Firestore, input: Omit<DocInput, 'documentId'> & { billId: string; expenseAccountId: string; prepaidAccountId?: string; amountCents: number; months: number; startMonth?: string }) =>
  spreadDocument(db, 'bill', { ...input, documentId: input.billId, accountId: input.expenseAccountId, holdAccountId: input.prepaidAccountId });
export const undoBillSpread = (db: Firestore, input: Omit<DocInput, 'documentId'> & { billId: string }) => undoSpread(db, 'bill', { ...input, documentId: input.billId });

/** K-16 */
export const spreadInvoiceRevenue = (db: Firestore, input: Omit<DocInput, 'documentId'> & { invoiceId: string; revenueAccountId: string; deferredAccountId?: string; amountCents: number; months: number; startMonth?: string }) =>
  spreadDocument(db, 'invoice', { ...input, documentId: input.invoiceId, accountId: input.revenueAccountId, holdAccountId: input.deferredAccountId });
export const undoInvoiceSpread = (db: Firestore, input: Omit<DocInput, 'documentId'> & { invoiceId: string }) => undoSpread(db, 'invoice', { ...input, documentId: input.invoiceId });
