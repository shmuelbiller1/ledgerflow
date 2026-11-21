/**
 * Purchase-order approval rules (K-23, A-120), kept free of browser code so the server (record.save, #921) and the
 * screen use the very same functions. `src/lib/purchaseOrders.ts` re-exports them for the screen.
 */
import type { PurchaseOrder } from '../types';
import { normalizePoApproval } from './invoiceApproval';

/**
 * Purchase requisitions & amount thresholds (K-23, A-120):
 * - When no PO threshold is enabled on the workspace, K-23 applies unchanged: a bookkeeper's order
 *   waits in 'pending_approval' until an owner or accountant approves it.
 * - When a PO approval threshold `poThresholdCents > 0` is enabled (A-120):
 *   - Orders in the workspace currency at or below `poThresholdCents` go through without waiting
 *     (so routine small purchases are not held up).
 *   - Orders strictly above `poThresholdCents` (or in a foreign currency where no rate is guessed)
 *     wait for another approver unless saved by the workspace owner.
 */
export function orderNeedsApproval(role: string): boolean {
  return role === 'bookkeeper';
}

export function poOrderNeedsApproval(
  role: string,
  options?: {
    totalAmountCents?: number;
    settings?: unknown;
    currency?: string;
    workspaceCurrency?: string;
  },
): boolean {
  const poRule = normalizePoApproval(options?.settings);
  if (!poRule.enabled) {
    return orderNeedsApproval(role);
  }
  if (role === 'owner') return false;
  const foreignCurrency = Boolean(
    options?.currency && options?.workspaceCurrency && options.currency !== options.workspaceCurrency,
  );
  if (foreignCurrency) return true;
  const amount = Math.round(Number(options?.totalAmountCents) || 0);
  return amount > poRule.thresholdCents;
}

export function awaitingApproval(po: Pick<PurchaseOrder, 'status'>): boolean {
  return po.status === 'pending_approval';
}

/** Why this person can't approve or decline the request, or null. */
export function orderDecisionProblem(po: Pick<PurchaseOrder, 'status' | 'uid'>, role: string, uid: string): string | null {
  if (!awaitingApproval(po)) return 'Not waiting for approval';
  if (role !== 'owner' && role !== 'accountant') return 'Waiting for an owner or accountant';
  if (po.uid === uid && role !== 'owner') return 'Someone else must approve your own request';
  return null;
}
