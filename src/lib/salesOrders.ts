/**
 * Sales orders (K-04): an estimate the customer said yes to becomes an order, and the order is
 * invoiced in one go or in parts (a percentage, an amount, or the rest). How much is invoiced is
 * read from the invoices made from it (`metadata.convertedFromEstimateId`, voided ones not
 * counted), so there is no second running total that could disagree with the invoices.
 *
 * BF-08 step 1: an order whose lines name stock items is invoiced by quantity. Each invoice line
 * then carries the item and the units, so the invoice lowers stock and books the cost of exactly
 * those units, and two parts never book the same units twice. A percentage or an amount of such an
 * order is refused: a share cut by amount says nothing about how many units left, and copying the
 * item onto it would book the wrong cost. Money before delivery is a deposit (Deposit on the order).
 */
import type { Estimate, Invoice } from '../types';
import { convertEstimateToInvoice } from './estimateConverter';

export type OrderPart =
  | { mode: 'rest' }
  | { mode: 'percent'; percent: number }
  | { mode: 'amount'; cents: number }
  /** how many of each order line to invoice now, by line (BF-08) */
  | { mode: 'quantities'; quantities: number[] };

/** One order line: what it is for, what is invoiced of it so far, and what is left. */
export interface OrderLineProgress {
  /** where the line is on the order (0 for the first) */
  position: number;
  description: string;
  itemId?: string;
  /** W-08: the units are bought and shipped straight to the customer; the invoice carries no item */
  dropShip?: boolean;
  quantity: number;
  unitPriceCents: number;
  amountCents: number;
  invoicedQuantity: number;
  invoicedCents: number;
  leftQuantity: number;
  leftCents: number;
}

export const ITEM_ORDER_BY_QUANTITY =
  'This order has stock items: invoice it by quantity, so stock and cost move with what is invoiced. To take money before delivery, use Deposit.';

export type OrderStage = 'quote' | 'declined' | 'expired' | 'order' | 'partly invoiced' | 'invoiced';

export interface OrderProgress {
  totalCents: number;
  invoicedCents: number;
  leftCents: number;
  /** the invoices made from it, oldest first (voided and cancelled ones left out) */
  invoices: Invoice[];
}

const NOT_COUNTED = new Set(['void', 'cancelled']);

export const isOrder = (est: Pick<Estimate, 'orderedAt'>) => Boolean(est.orderedAt);

/** What has been invoiced from an estimate or order so far, and what is left. */
export function orderProgress(est: Estimate, invoices: Invoice[]): OrderProgress {
  const made = invoices
    .filter(inv => inv.metadata?.convertedFromEstimateId === est.id && !NOT_COUNTED.has(String(inv.status)))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  const totalCents = Math.round(Number(est.amountCents) || 0);
  const invoicedCents = made.reduce((sum, inv) => sum + Math.round(Number(inv.amountCents) || 0), 0);
  return { totalCents, invoicedCents, leftCents: Math.max(0, totalCents - invoicedCents), invoices: made };
}

/** Where an estimate stands, in the words the list shows. */
export function orderStage(est: Estimate, progress: OrderProgress): OrderStage {
  if (est.status === 'declined') return 'declined';
  if (!isOrder(est)) return est.status === 'converted' ? 'invoiced' : est.status === 'expired' ? 'expired' : 'quote';
  if (progress.totalCents > 0 && progress.invoicedCents >= progress.totalCents) return 'invoiced';
  return progress.invoicedCents > 0 ? 'partly invoiced' : 'order';
}

/** The amount a part stands for, in cents (`est` is needed for a part by quantity). */
export function partCents(part: OrderPart, progress: OrderProgress, est?: Estimate): number {
  if (part.mode === 'quantities') {
    if (!est) return 0;
    return orderLineProgress(est, progress).reduce((sum, line) => sum + (part.quantities[line.position] > 0 ? quantityCents(line, part.quantities[line.position]) : 0), 0);
  }
  if (part.mode === 'rest') return progress.leftCents;
  if (part.mode === 'percent') return Math.round(progress.totalCents * part.percent / 100);
  return Math.round(part.cents);
}

/** Why this part can't be invoiced, or null (`est` is needed for an order with stock items). */
export function partProblem(part: OrderPart, progress: OrderProgress, est?: Estimate): string | null {
  if (progress.leftCents <= 0) return 'Nothing is left to invoice on this order';
  if (est && hasItemLines(est) && (part.mode === 'percent' || part.mode === 'amount')) return ITEM_ORDER_BY_QUANTITY;
  if (part.mode === 'quantities') {
    if (!est) return 'Choose the order';
    const lines = orderLineProgress(est, progress);
    for (const line of lines) {
      const q = part.quantities[line.position] ?? 0;
      const name = line.description || `line ${line.position + 1}`;
      if (!Number.isFinite(q) || q < 0 || hundredths(q) !== q) return `Enter how many of ${name}, with two decimals at most`;
      if (q > line.leftQuantity) return `Only ${line.leftQuantity} of ${name} ${line.leftQuantity === 1 ? 'is' : 'are'} left to invoice`;
    }
    if (!lines.some(l => (part.quantities[l.position] ?? 0) > 0)) return 'Enter how many to invoice';
  }
  if (part.mode === 'percent' && !(Number.isFinite(part.percent) && part.percent > 0 && part.percent <= 100)) return 'Enter a percentage between 0 and 100';
  if (part.mode === 'amount' && !(Number.isFinite(part.cents) && part.cents > 0)) return 'Enter an amount above zero';
  const cents = partCents(part, progress, est);
  if (cents <= 0) return 'Enter an amount above zero';
  if (cents > progress.leftCents) return 'That is more than is left to invoice';
  return null;
}

function orderLines(est: Estimate): Estimate['lines'] {
  return est.lines?.length
    ? est.lines
    : [{ description: `Estimate ${est.number || ''}`.trim(), quantity: 1, unitPriceCents: est.amountCents, amountCents: est.amountCents }];
}

const lineCents = (l: Estimate['lines'][number]) => Math.round(Number(l.amountCents) || (l.quantity || 1) * (l.unitPriceCents || 0));
const hundredths = (n: number) => Math.round(n * 100) / 100;

/** Whether any line of the order names a stock item (then it is invoiced by quantity). */
export const hasItemLines = (est: Pick<Estimate, 'lines'>) => (est.lines || []).some(l => Boolean(l.itemId));

/** Each order line's progress, read from the lines of the invoices made from the order. */
export function orderLineProgress(est: Estimate, progress: OrderProgress): OrderLineProgress[] {
  return orderLines(est).map((line, position) => {
    let invoicedQuantity = 0;
    let invoicedCents = 0;
    for (const inv of progress.invoices) {
      for (const item of inv.items || []) {
        if (item.metadata?.orderLine !== position) continue;
        invoicedQuantity += Number(item.quantity) || 0;
        invoicedCents += Math.round(Number(item.amountCents) || 0);
      }
    }
    const quantity = Number(line.quantity) || 1;
    const amountCents = lineCents(line);
    return {
      position,
      description: line.description || '',
      ...(line.itemId ? { itemId: line.itemId } : {}),
      ...(line.dropShip ? { dropShip: true } : {}),
      quantity,
      unitPriceCents: Math.round(Number(line.unitPriceCents) || amountCents / quantity),
      amountCents,
      invoicedQuantity: hundredths(invoicedQuantity),
      invoicedCents,
      leftQuantity: Math.max(0, hundredths(quantity - invoicedQuantity)),
      leftCents: Math.max(0, amountCents - invoicedCents),
    };
  });
}

/** An order with stock items invoices "the rest" as every line's quantity that is left. */
export function resolvePart(part: OrderPart, est: Estimate, progress: OrderProgress): OrderPart {
  if (part.mode !== 'rest' || !hasItemLines(est)) return part;
  return { mode: 'quantities', quantities: orderLineProgress(est, progress).map(l => l.leftQuantity) };
}

/** What `quantity` units of a line cost: the line's exact remainder when they are all that is left. */
const quantityCents = (line: OrderLineProgress, quantity: number) =>
  quantity >= line.leftQuantity ? line.leftCents : Math.round(quantity * line.unitPriceCents);

/** Each line's share once `cumulative` of the order is invoiced: proportional, whole cents, the remainder on the last line. */
function allocate(amounts: number[], total: number, cumulative: number): number[] {
  if (total <= 0 || cumulative >= total) return amounts.slice();
  const shares = amounts.map(a => Math.round(a * cumulative / total));
  shares[shares.length - 1] = cumulative - shares.slice(0, -1).reduce((s, x) => s + x, 0);
  return shares;
}

/**
 * The draft invoice for one part of an order (without id, uid and workspace, which saving sets).
 * Each order line gets its share of the part, so once everything is invoiced every line has been
 * invoiced exactly; a line invoiced whole keeps its quantity and price.
 */
export function orderPartInvoice(est: Estimate, progress: OrderProgress, cents: number, label: string, part?: OrderPart): Omit<Invoice, 'id' | 'uid' | 'workspaceId'> {
  const number = progress.invoices.length + 1;
  const { id: _id, uid: _uid, workspaceId: _ws, ...base } = convertEstimateToInvoice(est);
  const metadata = { convertedFromEstimateId: est.id, convertedFromEstimateNumber: est.number || est.id, salesOrderPart: number };
  if (part?.mode === 'quantities') {
    // by quantity (BF-08): each line keeps its item, its units and its price — except a drop-ship line
    // (W-08): its units never come into stock, so the invoice carries no item and posts no cost
    const items = orderLineProgress(est, progress).flatMap(line => {
      const quantity = part.quantities[line.position] ?? 0;
      if (!(quantity > 0)) return [];
      return [{
        id: `${est.id}-${number}-${line.position}`,
        ...(line.itemId && !line.dropShip ? { itemId: line.itemId } : {}),
        description: line.description,
        quantity,
        rateCents: line.unitPriceCents,
        amountCents: quantityCents(line, quantity),
        // no account picked: posting uses the workspace's income account
        accountId: '',
        metadata: { orderLine: line.position },
      }];
    });
    return { ...base, amountCents: items.reduce((s, i) => s + i.amountCents, 0), items, metadata };
  }
  const lines = orderLines(est);
  const amounts = lines.map(lineCents);
  const before = allocate(amounts, progress.totalCents, progress.invoicedCents);
  const after = allocate(amounts, progress.totalCents, progress.invoicedCents + cents);
  const items = lines.map((line, i) => {
    const share = after[i] - before[i];
    const whole = share === amounts[i] && before[i] === 0;
    return {
      id: `${est.id}-${number}-${i}`,
      description: whole ? line.description || '' : `${line.description || 'Order line'} (${label})`,
      quantity: whole ? line.quantity || 1 : 1,
      rateCents: whole ? line.unitPriceCents || 0 : share,
      amountCents: share,
      // no account picked: posting uses the workspace's income account
      accountId: '',
      metadata: { orderLine: i },
    };
  }).filter(item => item.amountCents !== 0);
  return { ...base, amountCents: cents, items, metadata };
}

/** The words on a part's lines: "40% of order EST-0012" or "part 2 of order EST-0012". */
export function partLabel(part: OrderPart, est: Estimate, progress: OrderProgress): string {
  const order = `order ${est.number || ''}`.trim();
  if (part.mode === 'quantities') return `part ${progress.invoices.length + 1} of ${order}`;
  if (part.mode === 'percent') return `${part.percent}% of ${order}`;
  if (part.mode === 'rest' && progress.invoices.length > 0) return `rest of ${order}`;
  return `part ${progress.invoices.length + 1} of ${order}`;
}
