import type { DocumentData } from '../db/firestore';
import { workspaceRole } from '../../lib/periodLock';
import { approvesInPlace } from '../../lib/approvalDelegation';
import { billBookCents, billLimitCents, type BillApprovalRecord } from '../../lib/billApproval';
import { ApprovalRefused } from './invoiceApprovalGuard';

export const BILL_APPROVER_REFUSAL = 'Only owners and accountants approve or reject a bill over the approval limit';
export const BILL_SECOND_PERSON_REFUSAL = 'Someone else approves a bill you entered';

/**
 * Bill approval on the server (G-19, #893). Every bill the server saves passes here, so the limit is
 * not only a screen. It looks only at saves that would leave the bill 'approved' (or 'rejected' out of
 * a hold) or any other approved/owed status when it was not before, or that raise a live bill's
 * amount past what was decided, and only when the bill is over the workspace's limit in book currency:
 * - a person who may not approve: deciding a held bill is refused; a new bill is held as 'pending';
 * - an approver deciding a held bill they did not enter: approved (or rejected), with who and when;
 * - an approver deciding a held bill they entered: refused, unless they are the only approver;
 * - an approver saving a bill straight to approved: held for someone else, unless they are the
 *   only approver (then approved and marked self-approved).
 * Raising a held bill's amount while approving it counts as a new submission. The record lives in
 * `metadata.approval`; who and when come from the server, never from the request.
 */
const mayApproveBillFor = (workspace: DocumentData, uid: string, now: string) =>
  ['owner', 'accountant'].includes(workspaceRole(workspace, uid)) || Boolean(approvesInPlace(workspace, uid, now.slice(0, 10)));

/** Statuses that mean the bill was approved and is owed (or paid): reaching one is an approval. */
const LIVE = new Set(['approved', 'unpaid', 'partially_paid', 'paid', 'overdue']);

export function serverBillApproval(existing: DocumentData | undefined, incoming: DocumentData, workspace: DocumentData, uid: string, now: string): { status?: string; metadata?: Record<string, unknown> } {
  const merged = { ...(existing || {}), ...incoming };
  const status = String(merged.status || '');
  const before = String(existing?.status || '');
  const entering = status === 'pending' && before !== 'pending';
  const approving = LIVE.has(status) && !LIVE.has(before);
  const book = String(workspace.currency || 'USD');
  const limit = billLimitCents(workspace.invoiceApproval);
  const amount = billBookCents(merged, book);
  // a live bill whose amount grows over the limit and past what was decided is a new submission
  const grown = amount > limit && amount > billBookCents(existing || {}, book);
  const raised = LIVE.has(status) && LIVE.has(before) && grown;
  // raising a held bill while keeping it held: whoever raised it is now the one who asked
  const reHeld = status === 'pending' && before === 'pending' && grown;
  if (!raised && !reHeld && (status === before || (!entering && !approving && !(status === 'rejected' && before === 'pending')))) return {};
  if (amount <= limit) return {};

  const meta = { ...((existing?.metadata as Record<string, unknown>) || {}), ...((incoming.metadata as Record<string, unknown>) || {}) };
  const prior = (existing?.metadata as { approval?: BillApprovalRecord } | undefined)?.approval;
  const approver = mayApproveBillFor(workspace, uid, now);
  const people = new Set([...(Array.isArray(workspace.members) ? workspace.members.map(String) : []), ...(workspace.uid ? [String(workspace.uid)] : [])]);
  // delegates count: someone approving in an owner's place is a second person who can decide
  const soleApprover = [...people].filter(who => mayApproveBillFor(workspace, who, now)).length <= 1;
  // an expense claim waiting for a decision (kept as a draft, #908) is held too: its decision was
  // already checked by assertClaimDecision, and the person who submitted it is who asked
  const claim = (existing?.metadata as { expenseClaim?: { state?: string; submittedBy?: string; submittedAt?: string } } | undefined)?.expenseClaim;
  const claimHeld = claim?.state === 'submitted';
  const held = (before === 'pending' || claimHeld) && amount <= billBookCents(existing || {}, book);
  const hold = (): { status: string; metadata: Record<string, unknown> } => ({
    status: 'pending',
    metadata: { ...meta, approval: { state: 'awaiting', thresholdCents: limit, requestedBy: uid, requestedAt: now } satisfies BillApprovalRecord },
  });

  // whoever puts a bill over the limit into review is who entered it, for the second-person check
  if (entering || reHeld) return { metadata: hold().metadata };
  if (!held) {
    if (status === 'rejected') throw new ApprovalRefused(BILL_APPROVER_REFUSAL);
    if (!approver || !soleApprover) return hold();
    return { metadata: { ...meta, approval: { state: 'approved', thresholdCents: limit, requestedBy: uid, requestedAt: now, decidedBy: uid, decidedAt: now, selfApproved: true } satisfies BillApprovalRecord } };
  }
  if (!approver) throw new ApprovalRefused(BILL_APPROVER_REFUSAL);
  const enteredBy = (claimHeld ? claim?.submittedBy : undefined) || prior?.requestedBy || (existing?.createdBy as string | undefined) || (existing?.uid as string | undefined);
  const own = Boolean(enteredBy) && enteredBy === uid;
  if (own && !soleApprover && status !== 'rejected') throw new ApprovalRefused(BILL_SECOND_PERSON_REFUSAL);
  const record: BillApprovalRecord = {
    state: status === 'rejected' ? 'rejected' : 'approved',
    thresholdCents: limit,
    ...(claimHeld && claim?.submittedBy ? { requestedBy: claim.submittedBy, requestedAt: claim.submittedAt } : prior?.requestedBy ? { requestedBy: prior.requestedBy, requestedAt: prior.requestedAt } : {}),
    decidedBy: uid,
    decidedAt: now,
    ...(own && status !== 'rejected' ? { selfApproved: true } : {}),
  };
  return { metadata: { ...meta, approval: record } };
}
