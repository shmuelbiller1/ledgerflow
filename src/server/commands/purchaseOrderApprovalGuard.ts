import { HttpError } from '../auth/requestUser';
import { orderDecisionProblem, poOrderNeedsApproval } from '../../lib/purchaseOrderApproval';

type Row = Record<string, unknown>;

/** Statuses that mean the order was approved (and may be receiving, billed or closed). */
const LIVE_PO = new Set(['approved', 'partially_received', 'received', 'billed', 'closed']);
const APPROVAL_KEYS = ['approvalStatus', 'approvedBy', 'approvedAt', 'requestedBy'] as const;

const refused = (message: string) => Object.assign(new HttpError(message, 403), { code: 'FORBIDDEN', field: 'status' });

/** The order's total: the larger of its stated total and the sum of its lines, so an understated total cannot slip under the limit. */
export function purchaseOrderTotalCents(order: Row): number {
  const lines = Array.isArray(order.items) ? order.items as Array<{ totalCents?: unknown; quantity?: unknown; unitPriceCents?: unknown; unitCostCents?: unknown }> : [];
  const fromLines = lines.reduce((sum, l) => {
    // the larger of the stated line total and quantity × unit price: the bill is built from the latter
    const stated = Number(l.totalCents);
    const q = Number(l.quantity) || 0;
    const p = Number(l.unitPriceCents ?? l.unitCostCents) || 0;
    return sum + Math.max(0, Number.isFinite(stated) ? Math.round(stated) : 0, Math.round(q * p));
  }, 0);
  return Math.max(Math.round(Number(order.totalAmountCents) || 0), fromLines);
}

/**
 * Purchase-order approval on the server (#921, after #893 did bills). The screen already decides with
 * `poOrderNeedsApproval` and `orderDecisionProblem` (K-23, A-120); every save through `record.save` now gets the
 * same answer, so a bookkeeper or an API caller cannot commit an order the rule holds:
 * - a new order (or a draft) that would go live is held as `pending_approval` when the rule says it needs approval;
 *   one asked to start already receiving goods is refused instead;
 * - an order waiting for approval goes live only through an owner or accountant, never the person who asked
 *   (unless an owner), and is declined (cancelled) only by such an approver or by the person who asked;
 * - an approved order whose total grows past what the rule lets this person commit goes back for approval;
 * - who approved and when are the server's: the request's own `approvalStatus`/`approvedBy`/`approvedAt` are
 *   replaced by the stored values (or by the decision this save makes).
 */
export function guardPurchaseOrderApproval(existing: Row | undefined, merged: Row, who: { role: string; uid: string; workspace: Row; now: string }): void {
  for (const k of APPROVAL_KEYS) {
    if (existing && existing[k] !== undefined) merged[k] = existing[k];
    else delete merged[k];
  }
  const status = String(merged.status ?? '');
  const before = String(existing?.status ?? '');
  const needs = () => poOrderNeedsApproval(who.role, {
    totalAmountCents: purchaseOrderTotalCents(merged),
    settings: who.workspace.invoiceApproval,
    currency: typeof merged.currency === 'string' ? merged.currency : undefined,
    workspaceCurrency: String(who.workspace.currency || 'USD'),
  });
  const hold = () => { merged.status = 'pending_approval'; merged.approvalStatus = 'pending'; merged.approvedBy = null; merged.approvedAt = null; merged.requestedBy = who.uid; };
  // a missing currency is the workspace's own, as poOrderNeedsApproval reads it
  const bookCurrency = String(who.workspace.currency || 'USD');
  // more exposure than what was decided or asked: a larger total, or another currency
  const grew = () => purchaseOrderTotalCents(merged) > purchaseOrderTotalCents(existing || {})
    || String(merged.currency || bookCurrency) !== String(existing?.currency || bookCurrency);
  const stamp = (state: 'approved' | 'rejected') => { merged.approvalStatus = state; merged.approvedBy = who.uid; merged.approvedAt = who.now; };

  if (before === 'pending_approval' && status !== 'pending_approval') {
    if (LIVE_PO.has(status)) {
      // the person whose save put it in review (a raise counts), not only whoever first made the order
      const requester = String(existing?.requestedBy ?? existing?.uid ?? '');
      const problem = orderDecisionProblem({ status: 'pending_approval', uid: requester }, who.role, who.uid);
      if (problem) throw refused(problem);
      if (grew()) throw refused('Approve the order as it was asked for; change its lines first and ask again');
      stamp('approved');
      return;
    }
    // any other way out of review (declined, or taken back to a draft) is for an approver or the person who asked
    const approver = who.role === 'owner' || who.role === 'accountant';
    if (!approver && String(existing?.requestedBy ?? existing?.uid ?? '') !== who.uid) throw refused('Waiting for an owner or accountant');
    if (status === 'cancelled') stamp('rejected');
    return;
  }
  // a held order raised (or moved to another currency) while it waits: whoever raised it is now the one asking
  if (before === 'pending_approval' && status === 'pending_approval') {
    if (grew()) merged.requestedBy = who.uid;
    return;
  }
  if (LIVE_PO.has(status) && !LIVE_PO.has(before)) {
    if (!needs()) { stamp('approved'); return; }
    if (status !== 'approved') throw refused('This order waits for approval before goods are received');
    hold();
    return;
  }
  if (LIVE_PO.has(status) && LIVE_PO.has(before) && grew() && needs()) {
    if (status !== 'approved') throw refused('This order waits for approval before goods are received');
    hold();
  }
}
