/**
 * EG-2 step 4: voiding a payment on the server (POST /api/v1/payments/:id/void). Split out of paymentService.
 */
import { formatTzDate } from '../../lib/calendarDate';
import { settledStatus } from '../../lib/documentMath';
import { assertPostingOpen, postingLock, workspaceRole } from '../../lib/periodLock';
import type { DocumentReference, Firestore } from '../db/firestore';
import { ledgerCreate, ledgerMark } from './ledgerDoor';
import { writeServerAuditLog } from './auditLogService';
import { allocationLedgerReady, liveStoredRowsOfSource, reverseAllocation } from './allocationLedger';
import { PaymentApplyError } from './paymentService';

type StoredEntry = {
  id: string; date?: string; status?: string; reversalEventId?: string; description?: string; currency?: string; exchangeRate?: number;
  totalAmountCents?: number; lines: Array<Record<string, unknown>>; metadata?: { type?: string; isReversal?: boolean; reversesTxId?: string; reversedTransactionId?: string };
};
const REVERSIBLE_TYPES = new Set(['payment-posting', 'standalone-payment', 'payment-application']);
/** Issued, paid and overdue documents: their status follows what is paid. Any other (draft, void, cancelled, rejected…) stays. */
const ISSUED_STATUSES = new Set(['sent', 'pending', 'approved', 'unpaid', 'partially_paid', 'paid', 'overdue']);
/** TransactionSchema: lines.max(100) */
export const MAX_ENTRY_LINES = 100;

/**
 * Splits an entry's lines into chunks of at most `max` lines that each balance: lines are grouped by their labels
 * (spreadLabels makes each label's slice balance), groups that do not balance on their own are merged into one,
 * and the groups are packed greedily. A balanced group longer than `max` cannot be split and throws.
 */
export function balancedChunks<L extends { amountCents: number; dimensions?: unknown }>(lines: L[], max: number): L[][] {
  if (lines.length <= max) return [lines];
  const key = (l: L) => JSON.stringify(Object.entries((l.dimensions as Record<string, string> | undefined) || {}).sort(([a], [b]) => a.localeCompare(b)));
  const groups = new Map<string, L[]>();
  for (const l of lines) groups.set(key(l), [...(groups.get(key(l)) || []), l]);
  const sum = (ls: L[]) => ls.reduce((s, l) => s + l.amountCents, 0);
  const balanced = [...groups.values()].filter(g => sum(g) === 0);
  const rest = [...groups.values()].filter(g => sum(g) !== 0).flat();
  const units = rest.length ? [...balanced, rest] : balanced;
  const chunks: L[][] = [];
  for (const unit of units) {
    if (unit.length > max) throw new Error(`a balanced group of ${unit.length} lines is longer than ${max}`);
    const last = chunks[chunks.length - 1];
    if (last && last.length + unit.length <= max) last.push(...unit);
    else chunks.push([...unit]);
  }
  return chunks;
}
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const laterOf = (a: string, b: string) => (a > b ? a : b);

/**
 * EG-2 step 4: void a payment on the server, in one database transaction. Its GL entries (the payment posting,
 * with any realized FX line, and every `payment-application` entry of it) get reversing entries, each dated
 * max(void date, the entry's date); each live payment-ledger row of it gets a `reversal` row through
 * allocationLedger (nothing deleted); each document's amountPaidCents / settledByRecordsCents go down by what
 * this payment put on it and its status is re-derived; the payment is `void` with nothing unapplied.
 * The void date defaults to the payment's date while open, else today (postingCore's reversalDate rule); a
 * void date in a locked period is refused (409). A payment in a bank deposit is refused (409). Voiding a
 * void payment posts nothing and returns the first result (`replayed: true`).
 */
export async function voidPayment(db: Firestore, input: { workspaceId: string; uid: string; paymentId: string; date?: string; reason?: string }) {
  const ledgerReady = await allocationLedgerReady(db);
  return db.runTransaction(async (tx) => {
    const { workspaceId, uid, paymentId } = input;
    const wsSnap = await tx.get(db.collection('workspaces').doc(workspaceId));
    if (!wsSnap.exists) throw new PaymentApplyError(404, 'Workspace not found');
    const wsData = wsSnap.data() || {};
    if (!['owner', 'accountant', 'bookkeeper'].includes(workspaceRole(wsData, uid))) throw new PaymentApplyError(403, 'Only owners, accountants and bookkeepers void payments');
    const paymentRef = db.collection('payments').doc(paymentId);
    const payment = (await tx.get(paymentRef)).data();
    if (!payment || payment.workspaceId !== workspaceId) throw new PaymentApplyError(404, 'Payment not found');
    if (payment.status === 'void') {
      // a retry: nothing more is posted
      return { ...(payment.voidResult as Record<string, unknown> || { paymentId, transactionIds: [], reversedAllocationIds: [], documents: [] }), replayed: true } as VoidPaymentResult & { replayed: boolean };
    }
    if (payment.depositTransactionId) throw new PaymentApplyError(409, 'The payment is in a bank deposit; undo the deposit first');

    const paymentDate = String(payment.date || payment.paymentDate || '').slice(0, 10);
    const today = formatTzDate(new Date(), typeof wsData.timezone === 'string' ? wsData.timezone : 'UTC');
    const date = input.date || (paymentDate && !postingLock(paymentDate, wsData as never, uid) ? paymentDate : today);
    if (!DAY.test(date)) throw new PaymentApplyError(400, 'Date must be YYYY-MM-DD');
    if (paymentDate && date < paymentDate) throw new PaymentApplyError(409, `The void date ${date} is before the payment's date ${paymentDate}`);
    try {
      assertPostingOpen(date, wsData as never, uid);
    } catch (err) {
      throw new PaymentApplyError(409, err instanceof Error ? err.message : String(err));
    }

    // reads, all before any write: the payment's entries, its rows, its documents
    const entries = (await tx.get(db.collection('transactions').where('workspaceId', '==', workspaceId).where('metadata.paymentId', '==', paymentId))).docs
      .map(d => ({ ...d.data(), id: d.id }) as StoredEntry);
    const reversedIds = new Set(entries.filter(e => e.metadata?.isReversal || e.metadata?.reversesTxId).map(e => String(e.metadata?.reversesTxId || e.metadata?.reversedTransactionId)));
    const toReverse = entries
      // payment-posting (this service), standalone-payment (the browser's postPaymentLedger), payment-application
      .filter(e => REVERSIBLE_TYPES.has(String(e.metadata?.type)) || (!e.metadata?.type && !e.metadata?.isReversal))
      .filter(e => !e.metadata?.isReversal && !e.metadata?.reversesTxId && !e.reversalEventId && !reversedIds.has(String(e.id)) && e.status !== 'void')
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)));
    const rows = ledgerReady ? await liveStoredRowsOfSource(db, tx, workspaceId, 'payment', paymentId) : [];

    const received = payment.direction === 'received';
    const perDoc = new Map<string, { documentType: 'invoice' | 'bill'; cents: number }>();
    for (const a of (payment.allocations || []) as Array<{ documentId: string; documentType: 'invoice' | 'bill'; amountCents: number }>) {
      const prev = perDoc.get(a.documentId);
      perDoc.set(a.documentId, { documentType: a.documentType, cents: (prev?.cents || 0) + (Number(a.amountCents) || 0) });
    }
    const docUpdates: Array<{ ref: DocumentReference; updates: Record<string, unknown>; documentId: string; amountPaidCents: number; status: string }> = [];
    for (const [documentId, { documentType, cents }] of perDoc) {
      const ref = db.collection(documentType === 'invoice' ? 'invoices' : 'bills').doc(documentId);
      const doc = (await tx.get(ref)).data();
      if (!doc || doc.workspaceId !== workspaceId) continue; // a deleted document: nothing to restore
      const paid = Math.max(0, (Number(doc.amountPaidCents) || 0) - cents);
      const overdue = doc.dueDate && String(doc.dueDate).slice(0, 10) < today;
      // a document that is not issued (void, draft, cancelled, rejected…) keeps its status: only the settled amounts go
      const status = !ISSUED_STATUSES.has(String(doc.status)) ? String(doc.status)
        : paid > 0 ? settledStatus(doc, paid)
        : overdue ? 'overdue' : documentType === 'invoice' ? 'sent' : 'approved';
      docUpdates.push({ ref, documentId, amountPaidCents: paid, status, updates: {
        amountPaidCents: paid,
        settledByRecordsCents: Math.max(0, (Number(doc.settledByRecordsCents) || 0) - cents),
        status,
        updatedAt: new Date().toISOString(),
      } });
    }

    const reason = String(input.reason || '').trim().slice(0, 300);
    const { TransactionValidator } = await import('../../kernel/validation/TransactionValidator');
    // one reversing entry per original, or several balanced chunks of ≤ MAX_ENTRY_LINES lines when it is longer
    const reversals: Array<{ original: StoredEntry; chunks: Array<Record<string, unknown>> }> = [];
    for (const e of toReverse) {
      const description = `Void of payment ${payment.number || paymentId}${reason ? `: ${reason}` : ''}`;
      const negated = (e.lines || []).map(l => ({ ...l, amountCents: -(Number(l.amountCents) || 0), description: `Reversal: ${l.description || e.description || ''}` }));
      let parts: Array<typeof negated>;
      try {
        parts = balancedChunks(negated, MAX_ENTRY_LINES);
      } catch (err) {
        throw new PaymentApplyError(409, `Entry ${e.id} cannot be reversed: ${err instanceof Error ? err.message : String(err)}`);
      }
      const chunks: Array<Record<string, unknown>> = [];
      for (const [i, lines] of parts.entries()) {
        const prepared = await TransactionValidator.validateAndPrepare(
          {
            id: db.collection('transactions').doc().id, workspaceId, uid, date: laterOf(date, String(e.date || date).slice(0, 10)), description,
            currency: e.currency || wsData.currency || 'USD', exchangeRate: e.exchangeRate || 1, status: 'completed', type: 'actual',
            metadata: { paymentId, type: 'payment-reversal', reversesTxId: e.id, isReversal: true, reversesType: e.metadata?.type || null, ...(parts.length > 1 ? { part: i + 1, parts: parts.length } : {}) },
            lines,
          },
          { workspaceId, user: { uid }, wsData }, undefined, tx,
        ).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          if (/Period Locked/i.test(message)) throw new PaymentApplyError(409, message);
          throw err;
        }) as unknown as Record<string, unknown>;
        chunks.push(prepared);
      }
      reversals.push({ original: e, chunks });
    }

    // writes
    const now = new Date().toISOString();
    for (const { original, chunks } of reversals) {
      for (const r of chunks) ledgerCreate(tx, db.collection('transactions').doc(String(r.id)), { ...r, createdAt: now, updatedAt: now });
      // the original points at its first reversing entry (the others carry reversesTxId and part/parts)
      ledgerMark(tx, db.collection('transactions').doc(String(original.id)), { reversalEventId: chunks[0].id, updatedAt: now });
    }
    const reversalOf = new Map(reversals.map(r => [String(r.original.id), String(r.chunks[0].id)]));
    const main = reversals.find(r => ['payment-posting', 'standalone-payment'].includes(String(r.original.metadata?.type))) || reversals[0];
    const reversedAllocationIds = rows.map(row => reverseAllocation(db, tx, row, date, {
      createdBy: uid,
      transactionId: reversalOf.get(String(row.data.transactionId)) || (main ? String(main.chunks[0].id) : null),
      reason: reason || 'payment voided',
    }));
    for (const u of docUpdates) tx.update(u.ref, u.updates);
    const result: VoidPaymentResult = {
      paymentId, date, transactionIds: reversals.flatMap(r => r.chunks.map(c => String(c.id))), reversedAllocationIds,
      documents: docUpdates.map(u => ({ documentId: u.documentId, amountPaidCents: u.amountPaidCents, status: u.status })),
    };
    tx.update(paymentRef, { status: 'void', unappliedCents: 0, voidedAt: now, voidDate: date, voidReason: reason || null, voidedBy: uid, voidResult: result, updatedAt: now });
    await writeServerAuditLog({
      workspaceId, uid, action: 'PAYMENT_VOIDED', entityType: 'payment', entityId: paymentId,
      details: { description: `Payment ${payment.number || paymentId} voided on ${date}${received ? '' : ' (payment made)'}`, transactionIds: result.transactionIds, documents: result.documents },
    }, { db, tx });
    return { ...result, replayed: false };
  });
}

export interface VoidPaymentResult {
  paymentId: string;
  date?: string;
  transactionIds: string[];
  reversedAllocationIds: string[];
  documents: Array<{ documentId: string; amountPaidCents: number; status: string }>;
}
