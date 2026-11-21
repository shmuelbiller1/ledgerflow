import type { DocumentData } from '../db/firestore';
import { workspaceRole } from '../../lib/periodLock';
import { approverCount } from '../../lib/twoPersonRule';
import { approvesInPlace } from '../../lib/approvalDelegation';
import { billBookCents, billLimitCents, type BillApprovalRecord } from '../../lib/billApproval';
import { ApprovalRefused } from './invoiceApprovalGuard';

export const BILL_APPROVER_REFUSAL = 'Only owners and accountants approve or reject a bill over the approval limit';
export const BILL_SECOND_PERSON_REFUSAL = 'Someone else approves a bill you entered';

/**
 * Bill approval on the server (G-19, #893). Every bill the server saves passes here, so the limit is
 * not only a screen. It looks only at saves that would leave the bill 'approved' (or 'rejected' out of
 * a hold) when it was not before, and only when the bill is over the workspace's limit in book currency:
 * - a person who may not approve: deciding a held bill is refused; a new bill is held as 'pending';
 * - an approver deciding a held bill they did not enter: approved (or rejected), with who and when;
 * - an approver deciding a held bill they entered: refused, unless they are the only approver;
 * - an approver saving a bill straight to approved: held for someone else, unless they are the
 *   only approver (then approved and marked self-approved).
 * Raising a held bill's amount while approving it counts as a new submission. The record lives in
 * `metadata.approval`; who and when come from the server, never from the request.
 */
export function serverBillApproval(existing: DocumentData | undefined, incoming: DocumentData, workspace: DocumentData, uid: string, now: string): { status?: string; metadata?: Record<string, unknown> } {
  const merged = { ...(existing || {}), ...incoming };
  const status = String(merged.status || '');
  const before = String(existing?.status || '');
  const entering = status === 'pending' && before !== 'pending';
  if (status === before || (!entering && status !== 'approved' && !(status === 'rejected' && before === 'pending'))) return {};
  const book = String(workspace.currency || 'USD');
  const limit = billLimitCents(workspace.invoiceApproval);
  const amount = billBookCents(merged, book);
  if (amount <= limit) return {};

  const meta = { ...((existing?.metadata as Record<string, unknown>) || {}), ...((incoming.metadata as Record<string, unknown>) || {}) };
  const prior = (existing?.metadata as { approval?: BillApprovalRecord } | undefined)?.approval;
  const role = workspaceRole(workspace, uid);
  const approver = role === 'owner' || role === 'accountant' || Boolean(approvesInPlace(workspace, uid, now.slice(0, 10)));
  const soleApprover = approverCount(workspace) <= 1;
  const held = before === 'pending' && amount <= billBookCents(existing || {}, book);
  const hold = (): { status: string; metadata: Record<string, unknown> } => ({
    status: 'pending',
    metadata: { ...meta, approval: { state: 'awaiting', thresholdCents: limit, requestedBy: uid, requestedAt: now } satisfies BillApprovalRecord },
  });

  // whoever puts a bill over the limit into review is who entered it, for the second-person check
  if (entering) return { metadata: hold().metadata };
  if (!held) {
    if (status === 'rejected') throw new ApprovalRefused(BILL_APPROVER_REFUSAL);
    if (!approver || !soleApprover) return hold();
    return { metadata: { ...meta, approval: { state: 'approved', thresholdCents: limit, requestedBy: uid, requestedAt: now, decidedBy: uid, decidedAt: now, selfApproved: true } satisfies BillApprovalRecord } };
  }
  if (!approver) throw new ApprovalRefused(BILL_APPROVER_REFUSAL);
  const enteredBy = prior?.requestedBy || (existing?.createdBy as string | undefined) || (existing?.uid as string | undefined);
  const own = Boolean(enteredBy) && enteredBy === uid;
  if (own && !soleApprover && status === 'approved') throw new ApprovalRefused(BILL_SECOND_PERSON_REFUSAL);
  const record: BillApprovalRecord = {
    state: status === 'approved' ? 'approved' : 'rejected',
    thresholdCents: limit,
    ...(prior?.requestedBy ? { requestedBy: prior.requestedBy, requestedAt: prior.requestedAt } : {}),
    decidedBy: uid,
    decidedAt: now,
    ...(own && status === 'approved' ? { selfApproved: true } : {}),
  };
  return { metadata: { ...meta, approval: record } };
}
