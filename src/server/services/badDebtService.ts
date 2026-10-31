import { minorUnitRate } from '../../lib/currencyMinorUnits';
import type { DocumentData, Firestore, Transaction } from '../db/firestore';
import { ledgerCreate, ledgerMark } from './ledgerDoor';
import { FieldValue } from '../db/firestore';
import { TransactionValidator } from '../../kernel/validation/TransactionValidator';
import { resolveAccountRole } from '../../lib/accountUtils';
import { calculateAmountDue } from '../../lib/documentMath';
import { workspaceRole } from '../../lib/periodLock';
import { formatTzDate } from '../../lib/calendarDate';
import type { ChartAccount } from '../../types';
import { writeServerAuditLog } from './auditLogService';
import { allocationLedgerReady, liveStoredRowsOf, recordAllocation, reverseAllocation } from './allocationLedger';

/**
 * Bad debt (K-19). Writing off an invoice posts DR Bad Debt Expense, CR Accounts Receivable for
 * what is still due (in the base currency, at the invoice's rate) and settles the invoice with it:
 * the sale stays in the reports (it was earned), the receivable goes, and the invoice shows as
 * written off. If the customer pays after all, the write-off is reversed (DR receivables,
 * CR bad debt) and the invoice is open again, ready for the payment. Owner/accountant only; each
 * is one database transaction with the ledger entry, and in the audit log.
 * EG-2 step 2: a write-off is a `write_off` payment-ledger row (source = the write-off entry, at the invoice's
 * rate, base = the entry's amount, no FX); the reversal is a `reversal` row of it, never a delete.
 */

export class BadDebtError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'BadDebtError';
  }
}

const ADMIN_ROLES = ['owner', 'accountant'];
const CLOSED = new Set(['draft', 'void', 'cancelled', 'rejected', 'paid']);
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

interface Input {
  workspaceId: string;
  uid: string;
  email?: string;
  invoiceId: string;
  date?: string;
  reason?: string;
}

async function prepare(db: Firestore, t: Transaction, input: Input) {
  const workspace = (await t.get(db.collection('workspaces').doc(input.workspaceId))).data();
  if (!workspace) throw new BadDebtError(404, 'Workspace not found');
  if (!ADMIN_ROLES.includes(workspaceRole(workspace, input.uid))) throw new BadDebtError(403, 'Only owners and accountants write off bad debt');
  const ref = db.collection('invoices').doc(input.invoiceId);
  const invoice = (await t.get(ref)).data();
  if (!invoice || invoice.workspaceId !== input.workspaceId) throw new BadDebtError(404, 'Invoice not found');
  const date = input.date || formatTzDate(new Date(), typeof workspace.timezone === 'string' ? workspace.timezone : 'UTC');
  if (!DAY.test(date)) throw new BadDebtError(400, 'Date must be YYYY-MM-DD');
  const accounts = (await t.get(db.collection('chartAccounts').where('workspaceId', '==', input.workspaceId))).docs.map(d => ({ ...d.data(), id: d.id }) as ChartAccount);
  return { workspace, ref, invoice, date, accounts };
}

function receivablesAccount(invoice: DocumentData, workspace: DocumentData, accounts: ChartAccount[]) {
  const byId = new Map(accounts.map(a => [a.id, a]));
  const mapped = byId.get(String(invoice.arAccountId || '')) || byId.get(String(workspace.defaultAccountMappings?.ar || ''));
  const ar = mapped || accounts.find(a => resolveAccountRole(a) === 'ar' && !a.isArchived);
  if (!ar) throw new BadDebtError(400, 'Add an Accounts Receivable account first');
  return ar;
}

async function post(db: Firestore, t: Transaction, input: Input, workspace: DocumentData, tx: DocumentData) {
  try {
    return await TransactionValidator.validateAndPrepare(
      { id: db.collection('transactions').doc().id, workspaceId: input.workspaceId, uid: input.uid, currency: workspace.currency || 'USD', exchangeRate: 1, status: 'completed', type: 'actual', ...tx },
      { workspaceId: input.workspaceId, user: { uid: input.uid }, wsData: workspace }, undefined, t,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/Period Locked/i.test(message)) throw new BadDebtError(409, message);
    throw err;
  }
}

export async function writeOffInvoice(db: Firestore, input: Input & { badDebtAccountId?: string }) {
  const ledgerReady = await allocationLedgerReady(db);
  return db.runTransaction(async (t) => {
    const { workspace, ref, invoice, date, accounts } = await prepare(db, t, input);
    if (CLOSED.has(String(invoice.status))) throw new BadDebtError(409, `The invoice is ${invoice.status}; only open invoices can be written off`);
    const dueCents = calculateAmountDue(invoice);
    if (dueCents <= 0) throw new BadDebtError(409, 'Nothing is left to write off');
    const rate = typeof invoice.exchangeRate === 'number' && invoice.exchangeRate > 0 ? invoice.exchangeRate : 1;
    // BM-04: the invoice's minor units → the books'
    const baseCents = Math.round(dueCents * minorUnitRate(rate, String(invoice.currency || workspace.currency || 'USD'), String(workspace.currency || 'USD')));

    const ar = receivablesAccount(invoice, workspace, accounts);
    const chosen = input.badDebtAccountId ? accounts.find(a => a.id === input.badDebtAccountId) : undefined;
    if (input.badDebtAccountId && (!chosen || resolveAccountRole(chosen) !== 'expense')) throw new BadDebtError(400, 'Choose an expense account for the bad debt');
    const badDebt = chosen || accounts.find(a => resolveAccountRole(a) === 'expense' && /bad debt|uncollectible|doubtful/i.test(a.name) && !a.isArchived);
    if (!badDebt) throw new BadDebtError(400, 'Choose the bad debt expense account (or add a "Bad Debt Expense" account)');

    const reason = String(input.reason || '').trim().slice(0, 300);
    const label = invoice.number || input.invoiceId;
    const description = `Bad debt: invoice ${label}${invoice.customerName ? ` (${invoice.customerName})` : ''}${reason ? `: ${reason}` : ''}`;
    const ledgerTx = await post(db, t, input, workspace, {
      date, description, totalAmountCents: baseCents,
      metadata: { type: 'invoice-bad-debt-writeoff', invoiceId: input.invoiceId, customerId: invoice.customerId || null, documentCents: dueCents },
      lines: [
        { accountId: badDebt.id, accountName: badDebt.name, amountCents: baseCents, description },
        { accountId: ar.id, accountName: ar.name, amountCents: -baseCents, description },
      ],
    });

    ledgerCreate(t, db.collection('transactions').doc(ledgerTx.id), { ...ledgerTx, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    const now = new Date().toISOString();
    t.update(ref, {
      status: 'paid',
      amountPaidCents: (Number(invoice.amountPaidCents) || 0) + dueCents,
      // posted by its own entry: re-posting the invoice must not post it as cash (documentMath)
      settledByRecordsCents: (Number(invoice.settledByRecordsCents) || 0) + dueCents,
      writtenOffCents: dueCents,
      writeOffTransactionId: ledgerTx.id,
      writeOffReason: reason || null,
      writtenOffAt: date,
      updatedAt: now,
    });
    if (ledgerReady) {
      const currency = String(invoice.currency || workspace.currency || 'USD');
      recordAllocation(db, t, {
        workspaceId: input.workspaceId, side: 'receivable', partyId: invoice.customerId || null, documentType: 'invoice', documentId: input.invoiceId,
        kind: 'write_off', sourceType: 'writeOff', sourceId: ledgerTx.id, operationId: ledgerTx.id, date,
        amountCents: dueCents, currency, documentRate: rate, settlementRate: rate,
        // the entry's own figure: cleared = settled = what left A/R
        baseClearedCents: baseCents, baseSettledCents: baseCents, realizedFxCents: 0,
        transactionId: ledgerTx.id, fxLineIndex: null, createdBy: input.uid,
      }, { dueCents });
    }
    await writeServerAuditLog({
      workspaceId: input.workspaceId, uid: input.uid, email: input.email, action: 'INVOICE_WRITTEN_OFF', entityType: 'invoice', entityId: input.invoiceId,
      details: { description, amountCents: dueCents, baseCents, transactionId: ledgerTx.id },
    }, { db, tx: t });
    return { invoiceId: input.invoiceId, transactionId: ledgerTx.id, writtenOffCents: dueCents, baseCents };
  });
}

export async function reverseWriteOff(db: Firestore, input: Input) {
  const ledgerReady = await allocationLedgerReady(db);
  return db.runTransaction(async (t) => {
    const { workspace, ref, invoice, date } = await prepare(db, t, input);
    const writtenOff = Number(invoice.writtenOffCents) || 0;
    if (!writtenOff || !invoice.writeOffTransactionId) throw new BadDebtError(409, 'This invoice is not written off');
    const original = (await t.get(db.collection('transactions').doc(String(invoice.writeOffTransactionId)))).data();
    if (!original || original.workspaceId !== input.workspaceId) throw new BadDebtError(409, 'The write-off entry was not found');
    // the write-off's live row (none for one made before the payment ledger): read before any write
    const rows = ledgerReady
      ? (await liveStoredRowsOf(db, t, input.workspaceId, input.invoiceId)).filter(r => r.data.kind === 'write_off' && r.data.sourceId === invoice.writeOffTransactionId)
      : [];

    const reason = String(input.reason || '').trim().slice(0, 300);
    const description = `Bad debt recovered: invoice ${invoice.number || input.invoiceId}${reason ? `: ${reason}` : ''}`;
    const lines = (original.lines as Array<{ accountId: string; accountName?: string; amountCents: number }>).map(l => ({ accountId: l.accountId, accountName: l.accountName, amountCents: -l.amountCents, description }));
    const ledgerTx = await post(db, t, input, workspace, {
      date, description, totalAmountCents: Number(original.totalAmountCents) || 0,
      metadata: { type: 'invoice-bad-debt-recovery', invoiceId: input.invoiceId, reversesTxId: invoice.writeOffTransactionId },
      lines,
    });

    ledgerCreate(t, db.collection('transactions').doc(ledgerTx.id), { ...ledgerTx, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    ledgerMark(t, db.collection('transactions').doc(String(invoice.writeOffTransactionId)), { reversalEventId: ledgerTx.id, updatedAt: new Date().toISOString() });
    const paid = Math.max(0, (Number(invoice.amountPaidCents) || 0) - writtenOff);
    const today = formatTzDate(new Date(), typeof workspace.timezone === 'string' ? workspace.timezone : 'UTC');
    t.update(ref, {
      status: paid > 0 ? 'partially_paid' : invoice.dueDate && String(invoice.dueDate) < today ? 'overdue' : 'sent',
      amountPaidCents: paid,
      settledByRecordsCents: Math.max(0, (Number(invoice.settledByRecordsCents) || 0) - writtenOff),
      writtenOffCents: 0,
      writeOffTransactionId: null,
      writeOffReversalTransactionId: ledgerTx.id,
      updatedAt: new Date().toISOString(),
    });
    for (const row of rows) reverseAllocation(db, t, row, date, { createdBy: input.uid, transactionId: ledgerTx.id, reason: reason || 'write-off reversed' });
    await writeServerAuditLog({
      workspaceId: input.workspaceId, uid: input.uid, email: input.email, action: 'INVOICE_WRITE_OFF_REVERSED', entityType: 'invoice', entityId: input.invoiceId,
      details: { description, amountCents: writtenOff, transactionId: ledgerTx.id },
    }, { db, tx: t });
    return { invoiceId: input.invoiceId, transactionId: ledgerTx.id, reopenedCents: writtenOff };
  });
}
