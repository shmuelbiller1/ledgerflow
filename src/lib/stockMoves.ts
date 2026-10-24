/**
 * The stock-moves ledger (W-02): one record for every change to an item's quantity on hand, kept by
 * the server with the change itself (src/server/services/stockMoveService.ts). It says what moved,
 * when, why (a sale, its reversal, a purchase, opening stock, an adjustment, a count), at what cost,
 * and which entry and document it belongs to. Each record keeps the quantity before and after, so
 * the history explains the item's quantity on hand; `stockHistoryProblem` says when it does not.
 * Pure: the Stock history window and the nightly check read it.
 */

export type StockMoveKind = 'sale' | 'sale-reversal' | 'return' | 'return-reversal' | 'purchase' | 'purchase-reversal' | 'purchase-return' | 'purchase-return-reversal' | 'opening' | 'adjustment' | 'count' | 'manual-cogs' | 'transfer-out' | 'transfer-in' | 'revaluation' | 'cost-repost' | 'landed-cost';

export interface StockMove {
  id?: string;
  workspaceId: string;
  itemId: string;
  itemName?: string;
  /** the day of the change (the entry's date) */
  date: string;
  kind: StockMoveKind;
  /** units added (positive) or taken out (negative) */
  quantity: number;
  quantityBefore: number;
  quantityAfter: number;
  unitCostCents: number;
  /** the value that moved, signed like the quantity (whole cents) */
  valueCents: number;
  transactionId?: string | null;
  documentType?: 'invoice' | 'credit-note' | 'adjustment' | 'import' | 'delivery' | 'bill' | 'vendor-credit';
  documentId?: string;
  /** the order the moves happened in: the time written, then the place in that write */
  seq: string;
  /** W-01: where the units are (a Location label value); none = no location */
  locationId?: string;
  /** DIM-2 phase 2: the line of the document the units came in on (a bill's line) or went back from (a vendor credit's bill line) */
  documentLine?: number;
  /** DIM-2 phase 2: the vendor on a purchase or a return to the vendor, as the entry named it */
  vendorId?: string;
  /** DIM-2 phase 2: for units sent back to a vendor, the bill they came in on */
  sourceBillId?: string;
  /** DIM-2 phase 3: the customer the units went to (or came back from), as the entry named it */
  customerId?: string;
  /** DIM-2 phase 3: the invoice line the units were sold on (or returned against) */
  documentLineId?: string;
  /** DIM-2 phase 3: where the units went in the books: the sold line's labels (project, property, …), not its location */
  labels?: Record<string, string>;
  /** EG-1 review: the database's insert order (a sequence set by a trigger); none on moves written before it */
  dbSeq?: number;
  /** EG-1: for a cost-repost move, the sale's entry whose cost it corrects */
  correctsTxId?: string;
  /** DIM-2 phase 3: why stock was adjusted, as the person wrote it */
  purpose?: string;
  uid: string;
  createdAt: string;
}

export const STOCK_MOVE_LABEL: Record<StockMoveKind, string> = {
  sale: 'Sold',
  'sale-reversal': 'Sale undone',
  return: 'Returned by the customer',
  'return-reversal': 'Return undone',
  purchase: 'Bought',
  'purchase-reversal': 'Purchase undone',
  'purchase-return': 'Sent back to the vendor',
  'purchase-return-reversal': 'Sending back undone',
  opening: 'Opening stock',
  adjustment: 'Adjusted',
  count: 'Counted',
  'manual-cogs': 'Cost of goods sold recorded',
  'transfer-out': 'Moved out',
  'transfer-in': 'Moved in',
  // ISS-130: the cost of stock on hand changed, with its entry; no units move (quantity 0, the value change)
  revaluation: 'Revalued',
  // EG-1: a sale's cost corrected after a backdated purchase; no units move (quantity 0, the value change)
  'cost-repost': 'Cost corrected (repost)',
  // EG-6: freight, duty… landed on received goods (or its undo); no units move (quantity 0, the value change)
  'landed-cost': 'Landed cost added',
};

/** W-01: the stock with no location (made before locations were used, or never placed). */
export const NO_LOCATION = '';

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** The moves of one item in the order they happened. */
export function orderedMoves(moves: StockMove[]): StockMove[] {
  return [...moves].sort((a, b) => String(a.seq).localeCompare(String(b.seq)));
}

/**
 * The replay order (review): by date, then the database's own insert order (`dbSeq`, from the sequence set by the
 * stockMoves trigger of migration 20261023010000; moves written before it have none and come first), then the
 * writer's `seq`, then the id, so the order is total and the same on every run.
 */
export function compareMoves(a: Pick<StockMove, 'date' | 'seq'> & { id?: string; dbSeq?: unknown }, b: typeof a): number {
  const seqOf = (m: typeof a) => (Number.isSafeInteger(Number(m.dbSeq)) && m.dbSeq !== undefined && m.dbSeq !== null ? Number(m.dbSeq) : -1);
  return String(a.date).slice(0, 10).localeCompare(String(b.date).slice(0, 10)) || seqOf(a) - seqOf(b)
    || String(a.seq).localeCompare(String(b.seq)) || String(a.id || '').localeCompare(String(b.id || ''));
}

/**
 * EG-1 (review finding 7): one item's moves in date order (ties: the order written), with the quantity before and
 * after each derived from the quantities moved, starting where the history starts. A move written after later-dated
 * ones (a backdated bill) keeps, as stored, the quantity of the moment it was written; the derived quantities are
 * those of its date, so "as of" a day reads the stock of that day.
 */
export function datedMoves(moves: StockMove[]): StockMove[] {
  const bySeq = orderedMoves(moves);
  let at = round6(Number(bySeq[0]?.quantityBefore) || 0);
  return [...bySeq].sort(compareMoves)
    .map(m => {
      const before = at;
      at = round6(at + (Number(m.quantity) || 0));
      return { ...m, quantityBefore: before, quantityAfter: at };
    });
}

/**
 * Why the history does not explain the item's quantity, or null: a move that does not start where
 * the one before ended, or a last move that does not end at the quantity on hand. Items without a
 * history (made before W-02, or never moved) have nothing to explain.
 */
export function stockHistoryProblem(item: { name?: string; quantityAtHand?: number }, moves: StockMove[]): string | null {
  const ordered = orderedMoves(moves);
  if (ordered.length === 0) return null;
  for (let i = 1; i < ordered.length; i += 1) {
    if (round6(ordered[i].quantityBefore) !== round6(ordered[i - 1].quantityAfter)) {
      return `${item.name || 'This item'}: a change on ${ordered[i].date} starts at ${ordered[i].quantityBefore}, but the one before it ended at ${ordered[i - 1].quantityAfter}`;
    }
  }
  const last = ordered[ordered.length - 1];
  const onHand = Number(item.quantityAtHand) || 0;
  if (round6(last.quantityAfter) !== round6(onHand)) {
    return `${item.name || 'This item'}: ${onHand} on hand, but its history ends at ${last.quantityAfter}`;
  }
  return null;
}

/**
 * W-01: how many units are at each location, from the history. Stock the history starts with (from
 * before it was kept) and moves without a location count as "no location". The total is the item's
 * quantity on hand when the history explains it.
 */
export function stockByLocation(moves: StockMove[]): Map<string, number> {
  const ordered = orderedMoves(moves);
  const at = new Map<string, number>();
  if (ordered.length === 0) return at;
  const add = (where: string, n: number) => at.set(where, round6((at.get(where) || 0) + n));
  if (ordered[0].quantityBefore) add(NO_LOCATION, ordered[0].quantityBefore);
  for (const m of ordered) add(m.locationId || NO_LOCATION, m.quantity);
  for (const [where, n] of at) if (n === 0) at.delete(where);
  return at;
}

/** Why units can't be moved between locations, or null. */
export function transferProblem(input: { quantity: number; from: string; to: string }, at: Map<string, number>): string | null {
  if (input.from === input.to) return 'Choose two different locations';
  if (!Number.isFinite(input.quantity) || input.quantity <= 0 || round6(input.quantity) !== input.quantity) return 'Enter how many to move (more than zero)';
  const there = at.get(input.from) || 0;
  if (input.quantity > there) return `Only ${there} ${input.from ? `at ${input.from}` : 'without a location'}`;
  return null;
}

/** J-10: one item's movements in a period, between its opening and closing quantity and value. */
export interface ItemDetails {
  itemId: string;
  itemName: string;
  opening: { quantity: number; valueCents: number };
  moves: Array<Pick<StockMove, 'date' | 'kind' | 'quantity' | 'quantityAfter' | 'valueCents' | 'unitCostCents' | 'transactionId' | 'documentType' | 'documentId' | 'locationId' | 'documentLine' | 'vendorId' | 'sourceBillId' | 'customerId' | 'documentLineId' | 'labels' | 'purpose'> & { key: string; /** the day the move was written (its createdAt), when kept: the history's real start */ writtenOn?: string }>;
  received: number;
  issued: number;
  closing: { quantity: number; valueCents: number };
}

/**
 * Inventory item details (J-10) from the stock-moves ledger: for each item with stock or a movement
 * in the period, its opening quantity and value (everything before the start), every movement in
 * the period in the order it happened, what came in and went out, and its closing quantity and value.
 * The closing quantity is the last movement's quantity after, so it agrees with Stock history.
 */
export function itemDetails(moves: StockMove[], startDate: string, endDate: string): ItemDetails[] {
  const byItem = new Map<string, StockMove[]>();
  for (const m of moves) byItem.set(m.itemId, [...(byItem.get(m.itemId) || []), m]);
  const out: ItemDetails[] = [];
  for (const [itemId, list] of byItem) {
    const ordered = datedMoves(list).filter(m => String(m.date).slice(0, 10) <= endDate);
    const before = ordered.filter(m => String(m.date).slice(0, 10) < startDate);
    const within = ordered.filter(m => String(m.date).slice(0, 10) >= startDate);
    const value = (ms: StockMove[]) => ms.reduce((s, m) => s + (Number(m.valueCents) || 0), 0);
    const opening = { quantity: before.length ? round6(Number(before[before.length - 1].quantityAfter) || 0) : 0, valueCents: value(before) };
    if (within.length === 0 && opening.quantity === 0 && opening.valueCents === 0) continue;
    const last = ordered[ordered.length - 1];
    out.push({
      itemId,
      itemName: String(list.find(m => m.itemName)?.itemName || itemId),
      opening,
      moves: within.map((m, i) => ({
        key: m.id || `${m.seq}-${i}`, date: String(m.date).slice(0, 10), kind: m.kind, quantity: m.quantity, quantityAfter: m.quantityAfter, valueCents: m.valueCents, unitCostCents: m.unitCostCents,
        ...(m.transactionId ? { transactionId: m.transactionId } : {}), ...(m.documentType ? { documentType: m.documentType } : {}), ...(m.documentId ? { documentId: m.documentId } : {}),
        ...(m.locationId ? { locationId: m.locationId } : {}),
        // DIM-2 phases 2-3: where the units came from and went, when the move keeps it
        ...(m.documentLine !== undefined ? { documentLine: m.documentLine } : {}), ...(m.vendorId ? { vendorId: m.vendorId } : {}), ...(m.sourceBillId ? { sourceBillId: m.sourceBillId } : {}),
        ...(m.customerId ? { customerId: m.customerId } : {}), ...(m.documentLineId ? { documentLineId: m.documentLineId } : {}), ...(m.labels ? { labels: m.labels } : {}), ...(m.purpose ? { purpose: m.purpose } : {}),
        ...(/^\d{4}-\d{2}-\d{2}/.test(String(m.createdAt || '')) ? { writtenOn: String(m.createdAt).slice(0, 10) } : {}),
      })),
      received: round6(within.filter(m => m.quantity > 0).reduce((s, m) => s + m.quantity, 0)),
      issued: round6(-within.filter(m => m.quantity < 0).reduce((s, m) => s + m.quantity, 0)) || 0,
      closing: { quantity: round6(Number(last?.quantityAfter) || 0), valueCents: value(ordered) },
    });
  }
  return out.sort((a, b) => a.itemName.localeCompare(b.itemName));
}

/** J-08: what was bought of each item in the period (purchases on bills or on Inventory, less those undone). */
export function purchasesByItem(items: ItemDetails[]): Array<{ itemId: string; itemName: string; quantity: number; valueCents: number; averageCents: number }> {
  return items.map(item => {
    const bought = item.moves.filter(m => m.kind === 'purchase' || m.kind === 'purchase-reversal');
    const quantity = round6(bought.reduce((s, m) => s + m.quantity, 0));
    const valueCents = bought.reduce((s, m) => s + m.valueCents, 0);
    return { itemId: item.itemId, itemName: item.itemName, quantity, valueCents, averageCents: quantity > 0 ? Math.round(valueCents / quantity) : 0 };
  }).filter(p => p.quantity !== 0 || p.valueCents !== 0);
}

/** W-09: the age buckets of stock on hand, in days since the units came in */
export const AGE_BUCKETS = [
  { key: 'd30', label: '0–30 days', upTo: 30 },
  { key: 'd90', label: '31–90 days', upTo: 90 },
  { key: 'd180', label: '91–180 days', upTo: 180 },
  { key: 'd365', label: '181–365 days', upTo: 365 },
  { key: 'older', label: 'Over a year', upTo: Infinity },
] as const;
export type AgeBucket = typeof AGE_BUCKETS[number]['key'];

export interface StockAge {
  itemId: string;
  itemName: string;
  quantity: number;
  valueCents: number;
  /** units on hand by how long ago they came in (first in, first out) */
  buckets: Record<AgeBucket, number>;
  /** units on hand the history does not say the arrival of (stock from before it began) */
  unknownAge: number;
  /** the oldest units' age in days */
  oldestDays: number | null;
  lastSold: string | null;
  daysSinceSold: number | null;
}

const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * W-09 stock aging from the stock-moves ledger, as of a day: the units on hand are taken to be the
 * last ones in (first in, first out), so each item's stock is split by how long ago those units came
 * in. A purchase undone takes back the latest units; moves between locations don't change the age.
 * Units the history can't place (stock from before it began) are said apart. With the last sale and
 * how long ago, for slow-moving stock. The value is the item's value then, shared by units.
 */
export function stockAging(moves: StockMove[], asOf: string): StockAge[] {
  const byItem = new Map<string, StockMove[]>();
  for (const m of moves) byItem.set(m.itemId, [...(byItem.get(m.itemId) || []), m]);
  const out: StockAge[] = [];
  for (const [itemId, list] of byItem) {
    // the quantities of the day, from the whole history (a move written later but dated earlier counts on its date)
    const ordered = datedMoves(list).filter(m => String(m.date).slice(0, 10) <= asOf);
    if (ordered.length === 0) continue;
    const quantity = round6(Number(ordered[ordered.length - 1]?.quantityAfter) || 0);
    if (quantity <= 0) continue;
    const layers: Array<{ date: string; units: number }> = [];
    const take = (units: number, newestFirst: boolean) => {
      let left = units;
      while (left > 1e-9 && layers.length) {
        const layer = newestFirst ? layers[layers.length - 1] : layers[0];
        const used = Math.min(layer.units, left);
        layer.units = round6(layer.units - used);
        left = round6(left - used);
        if (layer.units <= 1e-9) { if (newestFirst) layers.pop(); else layers.shift(); }
      }
    };
    for (const m of ordered) {
      if (m.kind === 'transfer-in' || m.kind === 'transfer-out' || !m.quantity) continue;
      if (m.quantity > 0) layers.push({ date: String(m.date).slice(0, 10), units: m.quantity });
      else take(-m.quantity, m.kind === 'purchase-reversal');
    }
    const known = round6(Math.min(quantity, layers.reduce((s, l) => s + l.units, 0)));
    // the units on hand are the latest in: keep only that many, newest first
    const buckets = Object.fromEntries(AGE_BUCKETS.map(b => [b.key, 0])) as Record<AgeBucket, number>;
    let need = known;
    let oldestDays: number | null = null;
    for (let i = layers.length - 1; i >= 0 && need > 1e-9; i--) {
      const units = Math.min(layers[i].units, need);
      need = round6(need - units);
      const age = Math.max(0, days(layers[i].date, asOf));
      oldestDays = age;
      const bucket = AGE_BUCKETS.find(b => age <= b.upTo)!.key;
      buckets[bucket] = round6(buckets[bucket] + units);
    }
    const sales = ordered.filter(m => m.kind === 'sale');
    const lastSold = sales.length ? String(sales[sales.length - 1].date).slice(0, 10) : null;
    out.push({
      itemId, itemName: String(list.find(m => m.itemName)?.itemName || itemId), quantity,
      valueCents: ordered.reduce((s, m) => s + (Number(m.valueCents) || 0), 0),
      buckets, unknownAge: round6(quantity - known), oldestDays: round6(quantity - known) > 0 ? null : oldestDays,
      lastSold, daysSinceSold: lastSold ? days(lastSold, asOf) : null,
    });
  }
  return out.sort((a, b) => (b.oldestDays ?? Infinity) - (a.oldestDays ?? Infinity) || a.itemName.localeCompare(b.itemName));
}
