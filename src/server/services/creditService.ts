import { FieldValue } from '../db/firestore';
import { ledgerCreate } from './ledgerDoor';
import type { DocumentData, Firestore } from '../db/firestore';
import { calculateAmountDue, settledStatus } from '../../lib/documentMath';
import { resolveAccountRole } from '../../lib/accountUtils';
import { TransactionValidator } from '../../kernel/validation/TransactionValidator';
import type { ChartAccount } from '../../types';
import { lockMessage, postingLock } from '../../lib/periodLock';
import { formatTzDate } from '../../lib/calendarDate';
import { createHash } from 'crypto';
import { deriveScopedOperationKey } from '../utils/idempotency';
import { ALLOCATION_OPERATIONS, AllocationError, allocationId, allocationLedgerReady, assertApplicationDate, baseFigures, recordAllocation, type AllocationSide, type NewAllocation } from './allocationLedger';

/**
 * Customer credit notes and vendor credits after they are issued:
 * - apply: settle an open invoice (bill) with the credit. Issuing the credit already reduced receivables
 *   (payables); applying links the two documents and, only when the credit's rate differs from the document's,
 *   posts a small `credit-application-fx` entry (EG-2).
 * - refund: pay the credit out (customer) or receive it back (vendor): DR A/R, CR Cash
 *   (customer) or DR Cash, CR A/P (vendor), and lower what is left on the credit.
 * Each runs in one database transaction.
 * EG-2 step 2: each application is a `credit` payment-ledger row (source = the credit, dated the application
 * date, cleared at the document's rate and settled at the credit's). When the row's realized FX is not zero, a
 * `credit-application-fx` entry in the same transaction moves it between the control account (A/R or A/P) and the
 * exchange gain/loss account, so the control account clears to the document's booked base; the row's
 * `transactionId` / `fxLineIndex` point at it. Its id derives from the row id, so a retry cannot post it twice.
 * An applied credit can't be voided (creditPosting.ts), so there is no undo path to reverse it yet.
 */

export class CreditError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'CreditError';
  }
}

export type CreditKind = 'customer' | 'vendor';

const SIDES = {
  customer: { credits: 'creditNotes', documents: 'invoices', party: 'customerId', control: 'ar', label: 'Credit note', documentLabel: 'invoice', side: 'receivable', sourceType: 'creditNote', documentType: 'invoice' },
  vendor: { credits: 'vendorCredits', documents: 'bills', party: 'vendorId', control: 'ap', label: 'Vendor credit', documentLabel: 'bill', side: 'payable', sourceType: 'vendorCredit', documentType: 'bill' },
} as const;

const USABLE_CREDIT = new Set(['open', 'partially_applied']);
const CLOSED_DOCUMENT = new Set(['draft', 'void', 'cancelled', 'rejected']);

function positiveCents(amountCents: unknown): number {
  if (typeof amountCents !== 'number' || !Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new CreditError(400, 'Amount must be a positive whole number of cents.');
  }
  return amountCents;
}

function remainingOf(credit: DocumentData): number {
  return typeof credit.remainingCents === 'number' ? credit.remainingCents : credit.amountCents || 0;
}

const rateOf = (r: DocumentData, baseCurrency: string) =>
  String(r.currency || baseCurrency) === baseCurrency ? 1 : (typeof r.exchangeRate === 'number' && r.exchangeRate > 0 ? r.exchangeRate : 1);

const todayIn = (workspace: DocumentData) => formatTzDate(new Date(), typeof workspace.timezone === 'string' ? workspace.timezone : 'UTC');

type CreditRowArgs = {
  workspaceId: string; workspace: DocumentData; creditId: string; credit: DocumentData; documentId: string; document: DocumentData;
  amountCents: number; dueCents: number; date: string; operationId: string; uid: string;
};

/** The `credit` row of one application (EG-2), before it is staged. */
function creditRowOf(kind: CreditKind, a: CreditRowArgs): NewAllocation {
  const side = SIDES[kind];
  const baseCurrency = String(a.workspace.currency || 'USD');
  const currency = String(a.document.currency || baseCurrency);
  const documentRate = rateOf(a.document, baseCurrency);
  const settlementRate = rateOf(a.credit, baseCurrency);
  return {
    workspaceId: a.workspaceId, side: side.side as AllocationSide, partyId: (a.document[side.party] as string) || null,
    documentType: side.documentType, documentId: a.documentId, kind: 'credit', sourceType: side.sourceType, sourceId: a.creditId,
    operationId: a.operationId, date: a.date, amountCents: a.amountCents, currency, documentRate, settlementRate,
    ...baseFigures(side.side as AllocationSide, a.amountCents, currency, baseCurrency, documentRate, settlementRate),
    transactionId: null, fxLineIndex: null, createdBy: a.uid,
  };
}

type Accounts = Array<ChartAccount & { id: string }>;
type Reads = { get: (q: never) => Promise<{ docs: Array<{ id: string; data: () => DocumentData }> }> };

/** The workspace's chart, read inside the transaction (before any write), only when an entry is needed. */
async function chartOf(db: Firestore, t: Reads, workspaceId: string): Promise<Accounts> {
  const snap = await t.get(db.collection('chartAccounts').where('workspaceId', '==', workspaceId) as never);
  return snap.docs.map(d => ({ ...(d.data() as ChartAccount), id: d.id }));
}

/**
 * The `credit-application-fx` entry of one row with realized FX, in base currency. Accounts and signs as payment FX
 * (paymentService): the control account is the document's (else the workspace mapping, else the chart's first with
 * that role), the FX account the first exchange gain/loss account. With fx side-normalized (gain > 0): the control
 * line is +fx (debit A/R by a gain; credit A/P by a loss), the FX line −fx (a gain is a credit, a loss a debit).
 */
function creditFxEntry(db: Firestore, kind: CreditKind, row: NewAllocation, a: CreditRowArgs, accounts: Accounts) {
  const side = SIDES[kind];
  const fx = row.realizedFxCents;
  const documentControl = a.document[kind === 'customer' ? 'arAccountId' : 'apAccountId'];
  const mappedId = a.workspace.defaultAccountMappings?.[side.control];
  const control = accounts.find(x => x.id === documentControl && !x.isArchived) || accounts.find(x => x.id === mappedId) || accounts.find(x => !x.isArchived && resolveAccountRole(x) === side.control);
  if (!control) throw new CreditError(400, `Add an ${side.control === 'ar' ? 'Accounts Receivable' : 'Accounts Payable'} account first`);
  const fxAccount = accounts.find(x => !x.isArchived && (resolveAccountRole(x) === 'fx_rounding' || /exchange|fx/i.test(String(x.name || ''))) && ['income', 'expense', 'revenue'].includes(String(x.type).toLowerCase()));
  if (!fxAccount) throw new CreditError(400, 'Add an exchange gain/loss account (category "Rounding Differences") before applying a credit at a different rate');
  const allocation = allocationId(row.kind, row.operationId, row.sourceId, row.documentId);
  const label = `${side.label} ${a.credit.number || a.creditId} applied to ${side.documentLabel} ${a.document.number || a.documentId}`;
  const gain = fx > 0;
  const lines = [
    { accountId: control.id, accountName: control.name, amountCents: fx, description: label },
    { accountId: fxAccount.id, accountName: fxAccount.name, amountCents: -fx, description: `Realized exchange ${gain ? 'gain' : 'loss'}: ${label}` },
  ];
  const ref = db.collection('transactions').doc(`cafx-${allocation}`);
  return {
    ref, fxLineIndex: 1,
    entry: {
      id: ref.id, uid: a.uid, workspaceId: a.workspaceId, date: a.date, description: `Exchange difference: ${label}`,
      totalAmountCents: Math.abs(fx), currency: String(a.workspace.currency || 'USD'), exchangeRate: 1, status: 'completed', type: 'actual',
      createdAt: new Date().toISOString(),
      metadata: {
        type: 'credit-application-fx', allocationId: allocation, creditId: a.creditId, creditKind: kind, documentId: a.documentId,
        documentType: side.documentType, [side.party]: a.document[side.party] || null, realizedFxCents: fx,
        documentCurrency: row.currency, documentAmountCents: row.amountCents, documentExchangeRate: row.documentRate, creditExchangeRate: row.settlementRate,
      },
      lines,
    },
  };
}

/** Stages the `credit` row and, when its FX is not zero, its `credit-application-fx` entry (EG-2). */
function stageCreditRow(db: Firestore, t: Parameters<typeof recordAllocation>[1] & Parameters<typeof ledgerCreate>[0], kind: CreditKind, a: CreditRowArgs, accounts: Accounts | null): string | null {
  const row = creditRowOf(kind, a);
  let transactionId: string | null = null;
  if (row.realizedFxCents !== 0) {
    if (!accounts) throw new Error('credit-application-fx: the chart was not read');
    const fx = creditFxEntry(db, kind, row, a, accounts);
    ledgerCreate(t, fx.ref, fx.entry);
    transactionId = fx.ref.id;
    row.transactionId = transactionId;
    row.fxLineIndex = fx.fxLineIndex;
  }
  recordAllocation(db, t, row, { dueCents: a.dueCents });
  return transactionId;
}

function creditStatus(remaining: number): 'applied' | 'partially_applied' {
  return remaining === 0 ? 'applied' : 'partially_applied';
}

export interface ApplyCreditInput {
  workspaceId: string;
  kind: CreditKind;
  creditId: string;
  documentId: string;
  amountCents: number;
  /** who applies it (the payment-ledger row's createdBy) */
  uid?: string;
  /** the application date (EG-2), default today in the workspace's timezone */
  date?: string;
  /** the client's idempotency key: a retry with the same key writes nothing */
  operationId?: string;
}

export async function applyCredit(db: Firestore, input: ApplyCreditInput) {
  const side = SIDES[input.kind];
  const amountCents = positiveCents(input.amountCents);
  const creditRef = db.collection(side.credits).doc(input.creditId);
  const documentRef = db.collection(side.documents).doc(input.documentId);
  const workspaceRef = db.collection('workspaces').doc(input.workspaceId);
  if (input.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new CreditError(400, 'Date must be YYYY-MM-DD');
  const ledgerReady = await allocationLedgerReady(db);
  const requestHash = createHash('sha256').update(JSON.stringify({ kind: input.kind, creditId: input.creditId, documentId: input.documentId, amountCents, date: input.date || null })).digest('hex');

  return db.runTransaction(async (t) => {
    const operationRef = ledgerReady && input.operationId ? db.collection(ALLOCATION_OPERATIONS).doc(deriveScopedOperationKey(input.workspaceId, 'CREDIT_APPLY', `${input.creditId}:${input.operationId}`)) : null;
    const [creditSnap, documentSnap, workspaceSnap, operationSnap] = await t.getAll(creditRef, documentRef, workspaceRef, ...(operationRef ? [operationRef] : []));
    if (operationSnap?.exists) {
      const previous = operationSnap.data() || {};
      if (previous.requestHash !== requestHash || previous.actor !== (input.uid || null)) throw new CreditError(409, 'Idempotency key reused for a different application or actor');
      return { ...(previous.result as { creditRemainingCents: number; documentAmountDueCents: number }), replayed: true };
    }
    const credit = creditSnap.data();
    const document = documentSnap.data();
    const workspace = workspaceSnap.data() || {};
    if (!credit || credit.workspaceId !== input.workspaceId) throw new CreditError(404, `${side.label} not found`);
    if (!document || document.workspaceId !== input.workspaceId) throw new CreditError(404, `The ${side.documentLabel} was not found`);
    if (!USABLE_CREDIT.has(credit.status)) throw new CreditError(409, `${side.label} is ${credit.status}; nothing left to apply`);
    if (CLOSED_DOCUMENT.has(document.status)) throw new CreditError(409, `A ${document.status} ${side.documentLabel} can't be settled`);
    if (credit[side.party] !== document[side.party]) throw new CreditError(400, `The ${side.documentLabel} belongs to a different ${input.kind}`);
    if ((credit.currency || 'USD') !== (document.currency || 'USD')) throw new CreditError(400, 'The credit and the document are in different currencies');

    const remaining = remainingOf(credit);
    const due = calculateAmountDue(document);
    if (due === 0) throw new CreditError(409, `The ${side.documentLabel} is already paid`);
    if (amountCents > remaining) throw new CreditError(400, `Only ${remaining} cents are left on this credit`);
    if (amountCents > due) throw new CreditError(400, `Only ${due} cents are due on this ${side.documentLabel}`);
    const date = input.date || todayIn(workspace);
    // the application is dated: a closed period refuses it as it refuses a posting (soft close: owners/accountants only)
    const lock = postingLock(date, workspace, input.uid || '');
    if (lock) throw new CreditError(409, lockMessage(date, lock));
    if (ledgerReady) {
      try {
        assertApplicationDate(date, credit.date, document.date || document.issueDate, `the ${side.documentLabel}`);
      } catch (err) {
        throw new CreditError(err instanceof AllocationError ? err.status : 409, (err instanceof Error ? err.message : String(err)).replace("the payment's date", "the credit's date"));
      }
    }

    const operationId = ledgerReady ? input.operationId || db.collection(ALLOCATION_OPERATIONS).doc().id : '';
    const rowArgs: CreditRowArgs = {
      workspaceId: input.workspaceId, workspace, creditId: input.creditId, credit, documentId: input.documentId, document,
      amountCents, dueCents: due, date, operationId, uid: input.uid || 'system',
    };
    // the chart is read only when an FX entry is due, and before any write
    const accounts = ledgerReady && creditRowOf(input.kind, rowArgs).realizedFxCents !== 0 ? await chartOf(db, t, input.workspaceId) : null;

    const newRemaining = remaining - amountCents;
    const newPaid = (document.amountPaidCents || 0) + amountCents;
    const now = new Date().toISOString();
    t.update(creditRef, { remainingCents: newRemaining, status: creditStatus(newRemaining), updatedAt: now });
    t.update(documentRef, {
      amountPaidCents: newPaid,
      settledByRecordsCents: (document.settledByRecordsCents || 0) + amountCents,
      status: settledStatus(document, newPaid),
      updatedAt: now,
    });
    const result: { creditRemainingCents: number; documentAmountDueCents: number; fxTransactionId?: string } = { creditRemainingCents: newRemaining, documentAmountDueCents: due - amountCents };
    if (ledgerReady) {
      const fxTransactionId = stageCreditRow(db, t, input.kind, rowArgs, accounts);
      if (fxTransactionId) result.fxTransactionId = fxTransactionId;
      if (operationRef) t.set(operationRef, { id: operationRef.id, workspaceId: input.workspaceId, actor: input.uid || null, operationType: 'CREDIT_APPLY', creditId: input.creditId, requestHash, result, createdAt: now });
    }
    return result;
  });
}

export interface CreditApplication { creditId: string; documentId: string; amountCents: number }
type Row = DocumentData & {
  id: string; status?: string; currency?: string; date?: string; dueDate?: string; createdAt?: string;
  amountCents?: number; amountPaidCents?: number; depositCents?: number; settledByRecordsCents?: number;
};

const byOldest = (dateOf: (r: Row) => unknown) => (a: Row, b: Row) =>
  String(dateOf(a) || '').localeCompare(String(dateOf(b) || '')) || a.id.localeCompare(b.id);

/**
 * Apply credits automatically (BE-06), pure: each open credit, oldest first, goes to the open
 * invoices (bills) of the same customer (vendor) and currency, the one due first first, until the
 * credit or what is due runs out. Drafts, voided and paid documents get nothing.
 */
export function planCreditApplications(kind: CreditKind, credits: Row[], documents: Row[]): CreditApplication[] {
  const party = SIDES[kind].party;
  const open = documents.filter(d => !CLOSED_DOCUMENT.has(String(d.status)) && calculateAmountDue(d) > 0).sort(byOldest(d => d.dueDate || d.date));
  const dueLeft = new Map(open.map(d => [d.id, calculateAmountDue(d)]));
  const out: CreditApplication[] = [];
  for (const credit of credits.filter(c => USABLE_CREDIT.has(String(c.status)) && remainingOf(c) > 0).sort(byOldest(c => c.date || c.createdAt))) {
    let left = remainingOf(credit);
    for (const doc of open) {
      if (left === 0) break;
      const due = dueLeft.get(doc.id) || 0;
      if (due === 0 || !credit[party] || doc[party] !== credit[party] || (doc.currency || 'USD') !== (credit.currency || 'USD')) continue;
      const amountCents = Math.min(left, due);
      out.push({ creditId: credit.id, documentId: doc.id, amountCents });
      left -= amountCents;
      dueLeft.set(doc.id, due - amountCents);
    }
  }
  return out;
}

/** Applies every open credit it can (of one customer/vendor, or all), in one database transaction. */
export async function autoApplyCredits(db: Firestore, input: { workspaceId: string; kind: CreditKind; partyId?: string; uid?: string }) {
  const side = SIDES[input.kind];
  const ledgerReady = await allocationLedgerReady(db);
  return db.runTransaction(async (t) => {
    const workspace = (await t.get(db.collection('workspaces').doc(input.workspaceId))).data() || {};
    let creditQuery = db.collection(side.credits).where('workspaceId', '==', input.workspaceId);
    if (input.partyId) creditQuery = creditQuery.where(side.party, '==', input.partyId);
    const credits: Row[] = (await t.get(creditQuery)).docs.map(d => ({ ...d.data(), id: d.id }) as Row)
      .filter(c => USABLE_CREDIT.has(String(c.status)) && remainingOf(c) > 0);
    const parties = [...new Set(credits.map(c => String(c[side.party] || '')).filter(Boolean))];
    const documents: Row[] = [];
    for (const partyId of parties) {
      const snap = await t.get(db.collection(side.documents).where('workspaceId', '==', input.workspaceId).where(side.party, '==', partyId));
      documents.push(...snap.docs.map(d => ({ ...d.data(), id: d.id }) as Row));
    }
    // EG-2: dated today; an application dated before its credit or document is left for later (not refused:
    // the rest of the plan still applies)
    const date = todayIn(workspace);
    const lock = postingLock(date, workspace, input.uid || '');
    if (lock) throw new CreditError(409, lockMessage(date, lock));
    // a bill without `date` is dated by `issueDate`, as on the manual path
    const datable = (r: Row) => { const d = r.date || r.issueDate; return !d || String(d).slice(0, 10) <= date; };
    const applications = planCreditApplications(input.kind, ledgerReady ? credits.filter(c => datable(c)) : credits, ledgerReady ? documents.filter(d => datable(d)) : documents);
    // EG-2: the rows and their FX entries, worked out before any write (the chart is read only when one is due)
    const operationId = db.collection(ALLOCATION_OPERATIONS).doc().id;
    const rowArgs: CreditRowArgs[] = [];
    if (ledgerReady) {
      const dueLeft = new Map(documents.map(d => [d.id, calculateAmountDue(d)]));
      for (const a of applications) {
        const due = dueLeft.get(a.documentId) || 0;
        rowArgs.push({
          workspaceId: input.workspaceId, workspace, creditId: a.creditId, credit: credits.find(c => c.id === a.creditId)!,
          documentId: a.documentId, document: documents.find(d => d.id === a.documentId)!, amountCents: a.amountCents, dueCents: due,
          date, operationId, uid: input.uid || 'system',
        });
        dueLeft.set(a.documentId, due - a.amountCents);
      }
    }
    const accounts = rowArgs.some(r => creditRowOf(input.kind, r).realizedFxCents !== 0) ? await chartOf(db, t, input.workspaceId) : null;
    const now = new Date().toISOString();
    const creditUsed = new Map<string, number>();
    const documentPaid = new Map<string, number>();
    for (const a of applications) {
      creditUsed.set(a.creditId, (creditUsed.get(a.creditId) || 0) + a.amountCents);
      documentPaid.set(a.documentId, (documentPaid.get(a.documentId) || 0) + a.amountCents);
    }
    for (const [id, used] of creditUsed) {
      const remaining = remainingOf(credits.find(c => c.id === id)!) - used;
      t.update(db.collection(side.credits).doc(id), { remainingCents: remaining, status: creditStatus(remaining), updatedAt: now });
    }
    for (const [id, paid] of documentPaid) {
      const document = documents.find(d => d.id === id)!;
      const newPaid = (document.amountPaidCents || 0) + paid;
      t.update(db.collection(side.documents).doc(id), {
        amountPaidCents: newPaid,
        settledByRecordsCents: (document.settledByRecordsCents || 0) + paid,
        status: settledStatus(document, newPaid),
        updatedAt: now,
      });
    }
    // one operation per request; two credits to one invoice are two rows (sourceId differs)
    const fxTransactionIds = rowArgs.map(r => stageCreditRow(db, t, input.kind, r, accounts)).filter((x): x is string => Boolean(x));
    return { applications, totalCents: applications.reduce((sum, a) => sum + a.amountCents, 0), fxTransactionIds };
  });
}

export interface RefundCreditInput {
  workspaceId: string;
  uid: string;
  kind: CreditKind;
  creditId: string;
  amountCents: number;
  cashAccountId: string;
  date?: string;
  memo?: string;
}

export async function refundCredit(db: Firestore, input: RefundCreditInput) {
  const side = SIDES[input.kind];
  const amountCents = positiveCents(input.amountCents);
  if (input.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new CreditError(400, 'Date must be YYYY-MM-DD');
  const workspaceRef = db.collection('workspaces').doc(input.workspaceId);
  const creditRef = db.collection(side.credits).doc(input.creditId);
  const cashRef = db.collection('chartAccounts').doc(input.cashAccountId);

  return db.runTransaction(async (t) => {
    const [workspaceSnap, creditSnap, cashSnap] = await t.getAll(workspaceRef, creditRef, cashRef);
    const workspace = workspaceSnap.data();
    const credit = creditSnap.data();
    const cash = cashSnap.data() as ChartAccount | undefined;
    if (!workspace) throw new CreditError(404, 'Workspace not found');
    if (!credit || credit.workspaceId !== input.workspaceId) throw new CreditError(404, `${side.label} not found`);
    if (!cash || cash.workspaceId !== input.workspaceId || resolveAccountRole(cash) !== 'cash') {
      throw new CreditError(400, 'Choose a cash or bank account of this workspace');
    }
    const refundDate = input.date || todayIn(workspace);
    const lock = postingLock(refundDate, workspace, input.uid);
    if (lock) throw new CreditError(400, lockMessage(refundDate, lock));
    if (!USABLE_CREDIT.has(credit.status)) throw new CreditError(409, `${side.label} is ${credit.status}; nothing left to refund`);
    const remaining = remainingOf(credit);
    if (amountCents > remaining) throw new CreditError(400, `Only ${remaining} cents are left on this credit`);

    // Receivables / payables account: the workspace mapping, else the chart's first account with that role
    const accountsSnap = await t.get(db.collection('chartAccounts').where('workspaceId', '==', input.workspaceId));
    const accounts = accountsSnap.docs.map(d => ({ ...(d.data() as ChartAccount), id: d.id }));
    const mappedId = workspace.defaultAccountMappings?.[side.control];
    const control = accounts.find(a => a.id === mappedId) || accounts.find(a => resolveAccountRole(a) === side.control);
    if (!control) throw new CreditError(400, `Add an ${side.control === 'ar' ? 'Accounts Receivable' : 'Accounts Payable'} account first`);

    const description = `${side.label} ${credit.number || input.creditId} refund${input.memo ? `: ${input.memo}` : ''}`;
    const controlLine = { accountId: control.id, accountName: control.name, description };
    const cashLine = { accountId: cash.id || input.cashAccountId, accountName: cash.name, description };
    const lines = input.kind === 'customer'
      ? [{ ...controlLine, amountCents }, { ...cashLine, amountCents: -amountCents }]
      : [{ ...cashLine, amountCents }, { ...controlLine, amountCents: -amountCents }];
    const ledgerTx = await TransactionValidator.validateAndPrepare({
      id: db.collection('transactions').doc().id,
      workspaceId: input.workspaceId,
      uid: input.uid,
      date: refundDate,
      description,
      totalAmountCents: amountCents,
      currency: credit.currency || workspace.currency || 'USD',
      exchangeRate: credit.exchangeRate || 1,
      status: 'completed',
      type: 'actual',
      metadata: { type: 'credit-refund', refundOfCreditId: input.creditId, creditKind: input.kind, [side.party]: credit[side.party] },
      lines,
    }, { workspaceId: input.workspaceId, user: { uid: input.uid }, wsData: workspace }, undefined, t);

    const newRemaining = remaining - amountCents;
    ledgerCreate(t, db.collection('transactions').doc(ledgerTx.id), { ...ledgerTx, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    // refundedCents: statements and balance summaries count a credit less what was paid back (L-160)
    t.update(creditRef, { remainingCents: newRemaining, refundedCents: (credit.refundedCents || 0) + amountCents, status: creditStatus(newRemaining), updatedAt: new Date().toISOString() });
    return { transactionId: ledgerTx.id, creditRemainingCents: newRemaining };
  });
}
