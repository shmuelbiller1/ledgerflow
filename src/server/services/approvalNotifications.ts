import type { DocumentData, Firestore } from '../db/firestore';
import type { InvoiceApprovalRecord } from '../../lib/invoiceApproval';
import { formatMoney as formatCurrency } from '../../lib/moneyFormat';
import { notify } from './notificationService';

/**
 * Approval events (S-09): an invoice over the approval limit starts waiting → owners and
 * accountants (the approvers) are told; it is approved or sent back → the people who keep the books
 * are told, with the approver's note. Each event once (keyed by its time). Called after the save
 * commits; notifying never breaks the save.
 */
export type ApprovalEvent = 'requested' | 'approved' | 'rejected';

/** What changed in the invoice's approval record with this save, or null. */
export function approvalEvent(before: InvoiceApprovalRecord | undefined, after: InvoiceApprovalRecord | undefined): ApprovalEvent | null {
  if (!after) return null;
  if (after.state === 'awaiting') return before?.state === 'awaiting' && before.requestedAt === after.requestedAt ? null : 'requested';
  if (after.state === 'approved' || after.state === 'rejected') {
    return before?.state === after.state && before.decidedAt === after.decidedAt ? null : after.state;
  }
  return null;
}

export async function notifyApproval(db: Firestore, input: { workspaceId: string; invoiceId: string; invoice: DocumentData; event: ApprovalEvent; actorUid: string }) {
  const { invoice, event } = input;
  const approval = (invoice.approval || {}) as InvoiceApprovalRecord;
  const number = String(invoice.number || 'an invoice');
  const who = invoice.customerName ? ` for ${String(invoice.customerName)}` : '';
  const amount = typeof invoice.amountCents === 'number' ? ` (${formatCurrency(invoice.amountCents, String(invoice.currency || 'USD'))})` : '';
  const when = event === 'requested' ? approval.requestedAt : approval.decidedAt;
  const note = approval.note ? `: "${String(approval.note).slice(0, 200)}"` : '';
  await notify(db, {
    workspaceId: input.workspaceId,
    kind: event === 'requested' ? 'approval.requested' : 'approval.decided',
    title: event === 'requested' ? `Invoice ${number} waits for approval` : `Invoice ${number} was ${event === 'approved' ? 'approved' : 'sent back'}`,
    message: event === 'requested'
      ? `Invoice ${number}${who}${amount} is over the approval limit and is not sent until an owner or accountant approves it.`
      : event === 'approved' ? `Invoice ${number}${who}${amount} can now be sent${note}.` : `Invoice ${number}${who}${amount} needs changes before it can be sent${note}.`,
    eventKey: `approval:${input.invoiceId}:${event}:${when || ''}`,
    recordId: input.invoiceId,
    actorUid: input.actorUid,
  });
}
