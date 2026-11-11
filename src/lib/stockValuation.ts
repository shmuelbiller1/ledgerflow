/**
 * A-117: stock valuation by location and by lot, read from the records that already exist.
 *
 * By location: the stock-moves ledger (W-02) keeps where each change happened (`locationId`, a
 * Location label value; moves without one are "No location"). Each item is given a past figure only
 * when its history explains it — the same honesty rules as `inventoryAsOf` (ISS-131, the verified
 * method): the history starts at zero and ends at what is on hand today, otherwise the item is
 * "unknown" with the reason and is never split across locations. A known item's value is what its
 * moves booked (the cost each move carried, moving weighted average — the existing valuation's
 * reading), summed per location; negative stock is valued at 0 at item level exactly as
 * `inventoryAsOf` and `computeInventoryValuation` do, and an item where that makes its location
 * rows disagree with its value carries a note instead of being forced to add up.
 *
 * By lot: goods receipts (Purchase orders → Receive goods) record the lot, expiry and the price the
 * goods arrived at, so a lot's **received** quantity and value are known. The stock ledger does not
 * track lots, so a lot's on-hand quantity is not known and is never computed here (A-13's limit);
 * units recorded with the lot at sale are shown as a reference only, exactly as Expiring Lots does.
 *
 * Pure: the report screen reads the collections and calls these functions. Nothing posts.
 */
import { inventoryAsOf, type InventoryAsOfRow } from './inventoryAsOf';
import type { ItemDetails } from './stockMoves';
import { byCodeUnit } from './codeUnitOrder';

export const NO_LOCATION = '';

/** One item's stock at one location, as the moves booked it. */
export interface LocationValueRow {
  itemId: string;
  itemName: string;
  locationId: string;
  quantity: number;
  /** what the moves to this location booked (Σ their valueCents), moving weighted average */
  valueCents: number;
  unitCostCents: number;
}

export interface ItemLocationValuation {
  itemId: string;
  itemName: string;
  /** null when the history does not explain the item (never split across locations) */
  quantity: number | null;
  valueCents: number | null;
  rows: LocationValueRow[];
  /** why the figure is not known, or why its rows may not add up */
  unknownReason?: string;
  note?: string;
}

export interface LocationTotal {
  locationId: string;
  items: number;
  quantity: number;
  valueCents: number;
}

export interface ValuationByLocation {
  asOf: string;
  items: ItemLocationValuation[];
  byLocation: LocationTotal[];
  /** the value of the items whose figure is known — the same total as Inventory Valuation */
  knownValueCents: number;
  unknownItems: number;
  complete: boolean;
  negativeStockItems: number;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * The stock's value on a date, split by location. `toToday` is `itemDetails` from the start of the
 * stock history to today (the server's `/reports/inventory-details`), the same input `inventoryAsOf`
 * takes; the item-level known/unknown decision is `inventoryAsOf`'s own, so this report and
 * Inventory Valuation cannot disagree about an item.
 */
export function valuationByLocation(input: {
  asOf: string;
  items: Array<{ id: string; name?: string; quantityAtHand?: number; itemType?: string; createdAt?: string }>;
  toToday: ItemDetails[];
  itemsPartial?: boolean;
}): ValuationByLocation {
  const base = inventoryAsOf({ asOf: input.asOf, items: input.items, toToday: input.toToday, itemsPartial: input.itemsPartial });
  const now = new Map(input.toToday.map(d => [d.itemId, d]));

  const rows: ItemLocationValuation[] = base.rows.map((row: InventoryAsOfRow) => {
    const name = row.name;
    if (row.quantity === null) return { itemId: row.itemId, itemName: name, quantity: null, valueCents: null, rows: [], ...(row.unknownReason ? { unknownReason: row.unknownReason } : {}) };
    const detail = now.get(row.itemId);
    const dated = (detail?.moves || []).filter(m => String(m.date).slice(0, 10) <= input.asOf);
    // rows always sum to what the moves booked; the first history-less units are "No location" stock
    const byLoc = new Map<string, { quantity: number; valueCents: number }>();
    const add = (where: string, quantity: number, valueCents: number) => {
      const at = byLoc.get(where) || { quantity: 0, valueCents: 0 };
      byLoc.set(where, { quantity: round6(at.quantity + quantity), valueCents: at.valueCents + valueCents });
    };
    if (detail && !dated.length && detail.opening.quantity) add(NO_LOCATION, round6(detail.opening.quantity), detail.opening.valueCents);
    for (const m of dated) add(m.locationId || NO_LOCATION, round6(Number(m.quantity) || 0), Math.round(Number(m.valueCents) || 0));
    const locRows: LocationValueRow[] = [...byLoc.entries()]
      .filter(([, v]) => v.quantity !== 0 || v.valueCents !== 0)
      .map(([locationId, v]) => ({
        itemId: row.itemId, itemName: name, locationId,
        quantity: v.quantity, valueCents: v.valueCents,
        unitCostCents: v.quantity > 0 ? Math.round(v.valueCents / v.quantity) : 0,
      }))
      .sort((a, b) => a.locationId.localeCompare(b.locationId));
    const booked = locRows.reduce((s, r) => s + r.valueCents, 0);
    const negative = (row.quantity || 0) < 0;
    return {
      itemId: row.itemId, itemName: name, quantity: row.quantity, valueCents: row.valueCents, rows: locRows,
      ...(negative && booked !== (row.valueCents || 0)
        ? { note: 'negative stock is valued at 0 in the total; its location rows show the values the moves booked' }
        : {}),
    };
  });

  const locTotals = new Map<string, LocationTotal>();
  for (const item of rows) {
    for (const r of item.rows) {
      const t = locTotals.get(r.locationId) || { locationId: r.locationId, items: 0, quantity: 0, valueCents: 0 };
      t.items += 1;
      t.quantity = round6(t.quantity + r.quantity);
      t.valueCents += r.valueCents;
      locTotals.set(r.locationId, t);
    }
  }
  return {
    asOf: input.asOf,
    items: rows.filter(r => (r.quantity ?? 0) !== 0 || r.unknownReason || r.rows.length > 0),
    byLocation: [...locTotals.values()].sort((a, b) => a.locationId.localeCompare(b.locationId)),
    knownValueCents: base.knownValueCents,
    unknownItems: base.unknownItems,
    complete: base.complete,
    negativeStockItems: base.negativeStockItems,
  };
}

/** One goods-receipt line with a lot (the fields the valuation needs). */
export interface LotReceiptLine {
  itemId: string;
  itemName?: string;
  lotNumber: string;
  expiryDate?: string;
  quantity: number;
  /** the price the goods arrived at, whole cents per unit */
  unitPriceCents: number;
  receiptNumber: string;
  vendorName?: string;
  receivedDate: string;
}

/** Units recorded with a lot at sale — a reference only (the stock ledger does not track lots). */
export interface LotSaleRef {
  itemId: string;
  lotNumber: string;
  quantity: number;
  lastDate: string;
}

export interface LotValueRow {
  itemId: string;
  itemName: string;
  lotNumber: string;
  /** the distinct expiry days recorded for this lot, earliest first (usually one) */
  expiryDates: string[];
  receivedQty: number;
  /** Σ (line quantity × the line's unit price) over the receipts — what the lot cost when it arrived */
  receivedValueCents: number;
  /** the weighted average arrival price */
  unitCostCents: number;
  receiptNumbers: string[];
  vendors: string[];
  firstReceived: string;
  lastReceived: string;
  soldQty: number;
  lastSold: string;
  /**
   * Always null: how much of a lot is still on hand is not tracked and is never computed
   * (a sale may not record its lot). This report values what was received, not what is left.
   */
  onHandQuantity: null;
}

export interface ValuationByLots {
  rows: LotValueRow[];
  /** the value of every received lot on the list */
  receivedValueCents: number;
  /** the whole message the screen must show beside the table */
  limit: string;
}

export const LOT_ON_HAND_LIMIT =
  'On-hand per lot is not tracked: the stock ledger does not record lots, so this table values what was '
  + 'received in each lot and shows units recorded at sale as a reference only. It is not a stock-on-hand '
  + 'value and a sale may not have recorded its lot.';

/**
 * What each received lot cost when it arrived, with the expiry and the sale references. `received`
 * is the goods receipts' lot lines (Purchase orders → Receive goods), `sales` the lots recorded on
 * invoice lines. Pure.
 */
export function valuationByLots(received: LotReceiptLine[], sales: LotSaleRef[]): ValuationByLots {
  const key = (itemId: string, lot: string) => `${itemId}\u0000${lot}`;
  const lots = new Map<string, LotValueRow & { expirySet: Set<string>; valueRaw: number }>();
  for (const line of received || []) {
    const lot = String(line.lotNumber || '').trim();
    if (!line.itemId || !lot) continue;
    const k = key(line.itemId, lot);
    let row = lots.get(k);
    if (!row) {
      row = {
        itemId: line.itemId, itemName: line.itemName || line.itemId, lotNumber: lot,
        expiryDates: [], receivedQty: 0, receivedValueCents: 0, unitCostCents: 0,
        receiptNumbers: [], vendors: [], firstReceived: '', lastReceived: '',
        soldQty: 0, lastSold: '', onHandQuantity: null,
        expirySet: new Set<string>(), valueRaw: 0,
      };
      lots.set(k, row);
    }
    const qty = Number(line.quantity) || 0;
    row.receivedQty += qty;
    row.valueRaw += qty * (Number(line.unitPriceCents) || 0);
    if (line.receiptNumber && !row.receiptNumbers.includes(line.receiptNumber)) row.receiptNumbers.push(line.receiptNumber);
    if (line.vendorName && !row.vendors.includes(line.vendorName)) row.vendors.push(line.vendorName);
    const day = String(line.receivedDate || '').slice(0, 10);
    if (day && (!row.firstReceived || day < row.firstReceived)) row.firstReceived = day;
    if (day && day > row.lastReceived) row.lastReceived = day;
    const expiry = String(line.expiryDate || '').trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(expiry)) row.expirySet.add(expiry);
  }
  for (const sale of sales || []) {
    const lot = String(sale.lotNumber || '').trim();
    if (!sale.itemId || !lot) continue;
    const k = key(sale.itemId, lot);
    const row = lots.get(k);
    if (!row) continue; // sale-only lots are Expiring Lots' story; the valuation values what was received
    row.soldQty += Number(sale.quantity) || 0;
    const day = String(sale.lastDate || '').slice(0, 10);
    if (day && day > row.lastSold) row.lastSold = day;
  }
  const rows = [...lots.values()].map(({ expirySet, valueRaw, ...row }) => ({
    ...row,
    expiryDates: [...expirySet].sort(byCodeUnit),
    receivedValueCents: Math.round(valueRaw),
    unitCostCents: row.receivedQty > 0 ? Math.round(valueRaw / row.receivedQty) : 0,
  })).sort((a, b) => a.itemName.localeCompare(b.itemName) || a.lotNumber.localeCompare(b.lotNumber));
  return {
    rows,
    receivedValueCents: rows.reduce((s, r) => s + r.receivedValueCents, 0),
    limit: LOT_ON_HAND_LIMIT,
  };
}

export const STOCK_VALUE_LOT_CSV_HEADERS = [
  'Item', 'Lot', 'Expiry date(s)', 'Received units', 'Received value', 'Average arrival cost',
  'Receipts', 'Received from', 'First received', 'Last received',
  'Units recorded at sale (reference only)', 'Last sold', 'On hand',
];

export function stockValueLotCsvRows(rows: LotValueRow[]): Array<Array<string | number>> {
  return rows.map(r => [
    r.itemName, r.lotNumber, r.expiryDates.join('; '), r.receivedQty, (r.receivedValueCents / 100).toFixed(2), (r.unitCostCents / 100).toFixed(2),
    r.receiptNumbers.join('; '), r.vendors.join('; '), r.firstReceived || '', r.lastReceived || '',
    r.soldQty, r.lastSold || '', 'not tracked',
  ]);
}

export const STOCK_VALUE_LOCATION_CSV_HEADERS = [
  'Item', 'Location', 'Quantity', 'Value', 'Average cost', 'Note',
];

export function stockValueLocationCsvRows(items: ItemLocationValuation[]): Array<Array<string | number>> {
  const out: Array<Array<string | number>> = [];
  for (const item of items) {
    if (item.unknownReason) {
      out.push([item.itemName, '', '', '', '', item.unknownReason]);
      continue;
    }
    if (item.rows.length === 0) {
      out.push([item.itemName, '(no stock)', 0, '0.00', '0.00', item.note || '']);
      continue;
    }
    for (const r of item.rows) {
      out.push([item.itemName, r.locationId || '(no location)', r.quantity, (r.valueCents / 100).toFixed(2), (r.unitCostCents / 100).toFixed(2), item.note || '']);
    }
  }
  return out;
}
