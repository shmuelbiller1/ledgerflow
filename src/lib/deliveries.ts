/**
 * Deliveries (BF-08 step 2, M-12): goods leaving apart from the invoice. A workspace chooses when
 * stock leaves (`goodsLeaveWith` on the workspace, set by an owner on Inventory):
 * - "invoice" (the default, simple books): the invoice ships the goods; invoicing an item lowers
 *   stock and books its cost, as before;
 * - "delivery": a delivery from an order ships them. Each delivery lowers stock and books the cost
 *   of the units that left, once (a retry with the same delivery id changes nothing), and undoing it
 *   puts them back. Invoices then move no stock and book no cost; a deposit never does.
 *
 * Each delivered order line is one cost-of-goods-sold entry (metadata.type 'delivery-cogs-auto',
 * the order, its line, the delivery, the item, the units). How much of a line is delivered is read
 * from those entries in force, so there is no running total that could disagree with the books.
 * The server does the posting (src/server/services/deliveryService.ts).
 */
import type { Estimate, Transaction } from '../types';
import { isPostable } from './txFilters';

export const DELIVERY_COGS_TYPE = 'delivery-cogs-auto';
/** goods that came back after a delivery: stock in, cost of goods taken back at what the delivery booked */
export const DELIVERY_RETURN_TYPE = 'delivery-return-auto';

export type GoodsLeaveWith = 'invoice' | 'delivery';

/** When stock leaves in this workspace (anything but "delivery" is the invoice). */
export const goodsLeaveWith = (ws: { goodsLeaveWith?: unknown } | null | undefined): GoodsLeaveWith =>
  ws?.goodsLeaveWith === 'delivery' ? 'delivery' : 'invoice';

export const DELIVERY_ID = /^dlv_[a-z0-9]{8,40}$/;
export const RETURN_ID = /^ret_[a-z0-9]{8,40}$/;

/** A new delivery id (the client makes it, so a retried request is recognised). */
export function newDeliveryId(): string {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  return `dlv_${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`;
}

/** A new id for goods coming back (the same retried request is recognised). */
export function newReturnId(): string {
  return newDeliveryId().replace(/^dlv_/, 'ret_');
}

/** The id of a delivery's entry for one order line: the same request always makes the same ids. */
export const deliveryEntryId = (deliveryId: string, position: number) => `${deliveryId}_${position}`;

/** One delivery, from its entries in force. */
export interface Delivery {
  deliveryId: string;
  date: string;
  /** units by order line */
  lines: Array<{ position: number; itemId: string; quantity: number; entryId: string }>;
  locationId?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The delivery entries in force for an order (not voided, not reversed, not themselves reversals). */
export function liveDeliveryEntries(entries: Transaction[], orderId: string, type: string = DELIVERY_COGS_TYPE): Transaction[] {
  const mine = entries.filter(e => e.metadata?.type === type && e.metadata?.orderId === orderId);
  const reversed = new Set(entries.map(e => e.metadata?.reversesTxId).filter(Boolean));
  return mine.filter(e => isPostable(e) && !e.metadata?.isReversal && !e.reversalEventId && !reversed.has(e.id));
}

/** Units delivered so far and kept by the customer (less what came back), by order line. */
export function deliveredByLine(entries: Transaction[], orderId: string): Map<number, number> {
  const delivered = new Map<number, number>();
  const add = (e: Transaction, sign: number) => {
    const position = Number(e.metadata?.orderLine);
    delivered.set(position, round2((delivered.get(position) || 0) + sign * (Number(e.metadata?.quantity) || 0)));
  };
  for (const e of liveDeliveryEntries(entries, orderId)) add(e, 1);
  for (const e of liveDeliveryEntries(entries, orderId, DELIVERY_RETURN_TYPE)) add(e, -1);
  return delivered;
}

/** The cost per unit the deliveries of each order line booked (what a return takes back). */
export function deliveredUnitCost(entries: Transaction[], orderId: string): Map<number, number> {
  const totals = new Map<number, { cents: number; units: number }>();
  for (const e of liveDeliveryEntries(entries, orderId)) {
    const position = Number(e.metadata?.orderLine);
    const t = totals.get(position) || { cents: 0, units: 0 };
    t.cents += Math.abs(Number(e.totalAmountCents) || 0);
    t.units += Number(e.metadata?.quantity) || 0;
    totals.set(position, t);
  }
  return new Map([...totals].map(([p, t]) => [p, t.units > 0 ? t.cents / t.units : 0]));
}

/** Why these units can't come back now, or null: never more than was delivered and kept. */
export function returnProblem(lines: DeliveryLine[], quantities: Array<{ position: number; quantity: number }>): string | null {
  const back = quantities.filter(q => q.quantity !== 0);
  if (back.length === 0) return 'Enter how many of each item came back';
  for (const q of back) {
    const line = lines.find(l => l.position === q.position);
    if (!line) return 'Only item lines of this order come back';
    if (!Number.isFinite(q.quantity) || q.quantity < 0) return `${line.description || 'A line'}: enter a number of units above zero`;
    if (round2(q.quantity) !== q.quantity) return `${line.description || 'A line'}: two decimals at most`;
    if (q.quantity > line.delivered) return `${line.description || 'A line'}: only ${line.delivered} were delivered`;
  }
  return null;
}

/** The order's deliveries in force, oldest first. */
export function orderDeliveries(entries: Transaction[], orderId: string): Delivery[] {
  const byId = new Map<string, Delivery>();
  for (const e of liveDeliveryEntries(entries, orderId)) {
    const id = String(e.metadata?.deliveryId || e.id);
    const d = byId.get(id) || { deliveryId: id, date: String(e.date || '').slice(0, 10), lines: [], ...(e.metadata?.locationId ? { locationId: String(e.metadata.locationId) } : {}) };
    d.lines.push({ position: Number(e.metadata?.orderLine), itemId: String(e.metadata?.inventoryItemId || ''), quantity: Number(e.metadata?.quantity) || 0, entryId: e.id });
    byId.set(id, d);
  }
  return [...byId.values()].sort((a, b) => a.date.localeCompare(b.date) || a.deliveryId.localeCompare(b.deliveryId));
}

/** Each item line of an order: ordered, delivered, and left to deliver. */
export interface DeliveryLine {
  position: number;
  description: string;
  itemId: string;
  ordered: number;
  delivered: number;
  left: number;
}

export function deliveryLines(order: Pick<Estimate, 'lines'>, delivered: Map<number, number>): DeliveryLine[] {
  return (order.lines || []).flatMap((line, position) => {
    // W-08: drop-ship lines are bought by the vendor and shipped direct; they are not deliverable
    if (line.dropShip || !line.itemId) return [];
    const ordered = Number(line.quantity) || 0;
    const done = delivered.get(position) || 0;
    return [{ position, description: line.description || '', itemId: line.itemId, ordered, delivered: done, left: Math.max(0, round2(ordered - done)) }];
  });
}

/** Why these quantities can't be delivered now, or null. */
export function deliveryProblem(lines: DeliveryLine[], quantities: Array<{ position: number; quantity: number }>): string | null {
  const sending = quantities.filter(q => q.quantity !== 0);
  if (sending.length === 0) return 'Enter how many of each item leave now';
  const seen = new Set<number>();
  for (const q of sending) {
    const line = lines.find(l => l.position === q.position);
    if (!line) return 'Deliver only the item lines of this order';
    if (seen.has(q.position)) return `${line.description || 'A line'} is listed twice`;
    seen.add(q.position);
    if (!Number.isFinite(q.quantity) || q.quantity < 0) return `${line.description || 'A line'}: enter a number of units above zero`;
    if (round2(q.quantity) !== q.quantity) return `${line.description || 'A line'}: two decimals at most`;
    if (q.quantity > line.left) return `${line.description || 'A line'}: only ${line.left} left to deliver of ${line.ordered}`;
  }
  return null;
}
