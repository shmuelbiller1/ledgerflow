/**
 * Purchase order rules shared by the screen (PurchaseOrdersView.tsx) and tests: the next order
 * number, and the bill lines an order turns into (BE-11).
 */
import type { Bill, PurchaseOrder, PurchaseOrderItem } from '../types';
import { normalizePoApproval } from './invoiceApproval';
import { formatCurrency } from './utils';

/** What the bill should say: the received quantities when anything was received, else what was ordered. */
export function billLinesFromOrder(po: PurchaseOrder): NonNullable<Bill['splits']> {
  const anyReceived = po.items.some(i => (i.receivedQuantity || 0) > 0);
  return po.items
    .map((item, orderLine) => {
      const qty = anyReceived ? item.receivedQuantity || 0 : item.quantity;
      const detail = qty !== 1 ? ` (${qty} × ${formatCurrency(item.unitPriceCents, po.currency)})` : '';
      // J-08: a stock item's line brings the units received (or ordered) in with the bill
      return {
        amountCents: Math.round(qty * item.unitPriceCents), accountId: item.accountId || '', description: `${po.poNumber}: ${item.description}${detail}`,
        // CB-17: which order line and how many units this bills (what is billed but not yet received)
        orderLine, orderQuantity: qty,
        ...(item.itemId && qty > 0 ? { itemId: item.itemId, quantity: qty } : {}),
      };
    })
    .filter(line => line.amountCents !== 0);
}

/** PO-<year>-<nnn>, one more than the highest number used this year. */
export function nextPoNumber(existing: Pick<PurchaseOrder, 'poNumber'>[], year: string): string {
  const prefix = `PO-${year}-`;
  const highest = existing.reduce((max, po) => {
    const n = po.poNumber?.startsWith(prefix) ? Number(po.poNumber.slice(prefix.length)) : 0;
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  return `${prefix}${String(highest + 1).padStart(3, '0')}`;
}

/** Closed orders: nothing on them changes any more. */
const CLOSED: PurchaseOrder['status'][] = ['received', 'billed', 'cancelled', 'closed'];

/** The expected delivery date can move until the goods are in, the order billed or cancelled. */
export function canMoveDelivery(po: PurchaseOrder): boolean {
  return !CLOSED.includes(po.status) && !po.billId;
}

/** Vendor and lines change only while nothing has been received or billed against the order. */
export function canChangeOrder(po: PurchaseOrder): boolean {
  return canMoveDelivery(po) && !(po.receipts || []).length && !po.items.some(i => (i.receivedQuantity || 0) > 0);
}

/** An order is deleted (not just cancelled) only when nothing was received or billed on it. */
export function canDeleteOrder(po: PurchaseOrder): boolean {
  return !po.billId && !(po.receipts || []).length && po.status !== 'billed';
}

type ItemChange = Partial<Pick<PurchaseOrderItem, 'description' | 'quantity' | 'unitPriceCents'>>;

/** The order's lines and total after one line changed (I-22): the line total and order total follow. */
export function changeOrderItem(po: PurchaseOrder, itemId: string, change: ItemChange): Pick<PurchaseOrder, 'items' | 'totalAmountCents'> {
  return withTotals(po.items.map(item => (item.id === itemId ? { ...item, ...change } : item)));
}

/** The order's lines and total with one line added or removed. */
export function addOrderItem(po: PurchaseOrder, item: Omit<PurchaseOrderItem, 'totalCents'>): Pick<PurchaseOrder, 'items' | 'totalAmountCents'> {
  return withTotals([...po.items, { ...item, totalCents: 0 }]);
}

export function removeOrderItem(po: PurchaseOrder, itemId: string): Pick<PurchaseOrder, 'items' | 'totalAmountCents'> {
  return withTotals(po.items.filter(i => i.id !== itemId));
}

function withTotals(items: PurchaseOrderItem[]): Pick<PurchaseOrder, 'items' | 'totalAmountCents'> {
  const priced = items.map(i => ({ ...i, totalCents: Math.round(i.quantity * i.unitPriceCents) }));
  return { items: priced, totalAmountCents: priced.reduce((sum, i) => sum + i.totalCents, 0) };
}

/** "Same as last order" (I-23): the lines of the vendor's latest order, ready to edit; null when none. */
export function lastOrderLines(orders: PurchaseOrder[], vendorId: string): { poNumber: string; lines: { desc: string; qty: string; unitPrice: string; itemId: string }[] } | null {
  const latest = orders
    .filter(o => o.vendorId === vendorId && o.items.length > 0)
    .sort((a, b) => String(b.issueDate || '').localeCompare(String(a.issueDate || '')) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
  if (!latest) return null;
  return {
    poNumber: latest.poNumber,
    lines: latest.items.map(i => ({ desc: i.description, qty: String(i.quantity), unitPrice: (i.unitPriceCents / 100).toFixed(2), itemId: i.itemId || '' })),
  };
}

/** Vendors the workspace orders from most come first (I-23), then the rest by name. */
export function vendorsByOrders<V extends { id: string; name: string }>(vendors: V[], orders: Pick<PurchaseOrder, 'vendorId'>[]): V[] {
  const uses = new Map<string, number>();
  for (const o of orders) uses.set(o.vendorId, (uses.get(o.vendorId) || 0) + 1);
  return [...vendors].sort((a, b) => (uses.get(b.id) || 0) - (uses.get(a.id) || 0) || a.name.localeCompare(b.name));
}

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

/** The changes that approve or decline a requested order. */
export function orderDecision(approve: boolean, by: string, now: string, reason?: string): Partial<PurchaseOrder> {
  return {
    status: approve ? 'approved' : 'cancelled',
    approvalStatus: approve ? 'approved' : 'rejected',
    approvedBy: by,
    approvedAt: now,
    ...(!approve && reason ? { notes: `Declined: ${reason}` } : {}),
  };
}
