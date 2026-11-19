/**
 * Backorders (W-08): sales orders' item lines still to deliver, oldest order first, against the
 * stock on hand: each line takes what is left of its item's stock, and what it cannot take is short
 * (a backorder), with how many of the item are already ordered from vendors and not received yet.
 * Read-only: nothing is posted or reserved.
 */
import type { Estimate, InventoryItem, PurchaseOrder, Transaction } from '../types';
import { deliveredByLine, deliveryLines } from './deliveries';
import { isOrder } from './salesOrders';

const CLOSED = new Set(['void', 'cancelled', 'declined', 'rejected', 'converted']);
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface BackorderLine {
  orderId: string;
  /** Original order line, even when two lines have the same item and quantity. */
  position: number;
  number: string;
  customerName: string;
  orderedAt: string;
  itemId: string;
  item: string;
  /** still to deliver on this line */
  left: number;
  /** of that, covered by stock on hand (after older orders took theirs) */
  covered: number;
  short: number;
  /** of the item, ordered from vendors and not received yet (all open purchase orders) */
  onOrder: number;
}

export function backorders(orders: Estimate[], entries: Transaction[], items: InventoryItem[], purchaseOrders: PurchaseOrder[]): BackorderLine[] {
  const stock = new Map(items.map(i => [i.id, Math.max(0, Number(i.quantityAtHand) || 0)]));
  const names = new Map(items.map(i => [i.id, i.name]));
  const incoming = new Map<string, number>();
  for (const po of purchaseOrders) {
    if (['received', 'billed', 'closed', 'cancelled', 'draft'].includes(String(po.status))) continue;
    for (const line of po.items || []) {
      if (!line.itemId) continue;
      const left = (Number(line.quantity) || 0) - (Number(line.receivedQuantity) || 0);
      if (left > 0) incoming.set(line.itemId, round2((incoming.get(line.itemId) || 0) + left));
    }
  }
  const open = orders
    .filter(o => isOrder(o) && !CLOSED.has(String(o.status)))
    .sort((a, b) => String(a.orderedAt).localeCompare(String(b.orderedAt)) || String(a.number).localeCompare(String(b.number), undefined, { numeric: true }));
  const rows: BackorderLine[] = [];
  for (const order of open) {
    for (const line of deliveryLines(order, deliveredByLine(entries, order.id))) {
      if (line.left <= 0) continue;
      const available = stock.get(line.itemId) || 0;
      const covered = round2(Math.min(available, line.left));
      stock.set(line.itemId, round2(available - covered));
      rows.push({
        orderId: order.id, position: line.position, number: String(order.number || order.id), customerName: String(order.customerName || ''), orderedAt: String(order.orderedAt || '').slice(0, 10),
        itemId: line.itemId, item: names.get(line.itemId) || line.description, left: line.left, covered, short: round2(line.left - covered), onOrder: incoming.get(line.itemId) || 0,
      });
    }
  }
  return rows;
}

/**
 * A-121: the release list — order lines the stock on hand already covers in full, in the same
 * oldest-first order `backorders` allocated it. A line that is only partly covered is not on the
 * list: releasing part of a line is a delivery decision made on the order itself. The list is
 * computed, not held: nothing is reserved, so a delivery recorded elsewhere can take the stock.
 */
export function releasableLines(rows: BackorderLine[]): BackorderLine[] {
  return rows.filter(r => r.left > 0 && r.short <= 0);
}

/** The orders every line of which can be released today (the whole order can go out). */
export function ordersReadyToRelease(rows: BackorderLine[]): string[] {
  const waiting = new Set(rows.filter(r => r.short > 0).map(r => r.orderId));
  const ready: string[] = [];
  for (const r of rows) {
    if (!waiting.has(r.orderId) && !ready.includes(r.orderId)) ready.push(r.orderId);
  }
  return ready;
}

/** What each item is short in all, with what is on order, most short first. */
export function shortages(rows: BackorderLine[]): Array<{ itemId: string; item: string; short: number; onOrder: number }> {
  const byItem = new Map<string, { itemId: string; item: string; short: number; onOrder: number }>();
  for (const r of rows) {
    if (r.short <= 0) continue;
    const s = byItem.get(r.itemId) || { itemId: r.itemId, item: r.item, short: 0, onOrder: r.onOrder };
    s.short = round2(s.short + r.short);
    byItem.set(r.itemId, s);
  }
  return [...byItem.values()].sort((a, b) => b.short - a.short || a.item.localeCompare(b.item));
}
