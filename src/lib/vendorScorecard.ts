/**
 * A-47: vendor scorecard. Read-only figures per vendor, computed from the purchase orders, their
 * goods receipts, the bills and the vendor credits the books already hold:
 *
 * - on-time delivery: of the orders with an expected delivery date and a receipt, the share whose
 *   first receipt came on or before that date. Days late are the first receipt less the expected
 *   date, for the late ones only. No orders with dates: the rate is undefined (null), never 100%.
 * - price changes per item: each item's unit cost (line amount ÷ units, whole cents) in the order
 *   of the bills' dates. Prices are compared only inside one currency; a change is a unit cost that
 *   differs from the previous purchase of that item from that vendor.
 * - returns: vendor credits that send stock back, with the units and the value taken off stock.
 *
 * Amounts are integer minor units in each bill's own currency; currencies are never added together.
 * Nothing here posts, edits a document or changes how a bill or credit is calculated.
 */
import type { Bill, PurchaseOrder, VendorCredit, Vendor } from '../types';
import { byCodeUnit } from './codeUnitOrder';

export interface VendorPriceChange {
  itemId: string;
  currency: string;
  firstUnitCents: number;
  lastUnitCents: number;
  /** how many times the unit cost moved between two purchases */
  changes: number;
  /** last against first, in percent to two decimals; undefined when the first unit cost is zero */
  changePercent?: number;
}

export interface VendorScorecardRow {
  vendorId: string;
  vendorName: string;
  orders: { withDates: number; onTime: number; late: number; onTimeRate: number | null; averageDaysLate: number | null };
  priceChanges: VendorPriceChange[];
  priceChangeCount: number;
  returns: { credits: number; units: number; cents: number };
}

export interface VendorScorecardInput {
  vendors: Array<Pick<Vendor, 'id' | 'name'>>;
  orders: Array<Pick<PurchaseOrder, 'vendorId' | 'expectedDeliveryDate' | 'issueDate' | 'status' | 'receipts'>>;
  bills: Array<Pick<Bill, 'vendorId' | 'date' | 'currency' | 'splits'>>;
  credits: Array<Pick<VendorCredit, 'vendorId' | 'date' | 'status' | 'amountCents' | 'returnedGoods' | 'currency'>>;
  /** inclusive window on the document dates (YYYY-MM-DD); omitted sides are open */
  from?: string;
  to?: string;
  homeCurrency?: string;
}

/** Days since 1970-01-01 for a YYYY-MM-DD date, by integer arithmetic (no clock, no time zone). */
function dayNumber(iso: string): number {
  const y = +iso.slice(0, 4);
  const m = +iso.slice(5, 7);
  const d = +iso.slice(8, 10);
  const year = m <= 2 ? y - 1 : y;
  const era = Math.floor(year / 400);
  const yearOfEra = year - era * 400;
  const dayOfYear = Math.floor((153 * ((m + 9) % 12) + 2) / 5) + d - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}
const daysBetween = (from: string, to: string) => dayNumber(to) - dayNumber(from);
const dayOf = (value: unknown) => (typeof value === 'string' ? value.slice(0, 10) : '');
const inWindow = (date: string, from?: string, to?: string) => !!date && (!from || date >= from) && (!to || date <= to);

/** Whole-cent unit cost of a bill line; undefined when the line has no units. */
export function unitCostCents(amountCents: number, quantity: number): number | undefined {
  if (!Number.isFinite(amountCents) || !Number.isFinite(quantity) || quantity <= 0) return undefined;
  return Math.round(amountCents / quantity);
}

/** Price changes of one vendor, from its bills in date order. */
function priceChangesFor(bills: VendorScorecardInput['bills'], homeCurrency: string, from?: string, to?: string): VendorPriceChange[] {
  const dated = bills
    .map(bill => ({ bill, date: dayOf(bill.date) }))
    .filter(({ date }) => inWindow(date, from, to))
    .sort((a, b) => a.date.localeCompare(b.date));
  const seen = new Map<string, { itemId: string; currency: string; first: number; last: number; changes: number }>();
  for (const { bill } of dated) {
    const currency = bill.currency || homeCurrency;
    for (const split of bill.splits || []) {
      if (!split.itemId) continue;
      const unit = unitCostCents(split.amountCents, split.quantity ?? 0);
      if (unit === undefined) continue;
      const key = `${currency}\u0000${split.itemId}`;
      const row = seen.get(key);
      if (!row) {
        seen.set(key, { itemId: split.itemId, currency, first: unit, last: unit, changes: 0 });
      } else {
        if (unit !== row.last) row.changes += 1;
        row.last = unit;
      }
    }
  }
  return [...seen.values()]
    .sort((a, b) => a.itemId.localeCompare(b.itemId) || a.currency.localeCompare(b.currency))
    .map(row => ({
      itemId: row.itemId,
      currency: row.currency,
      firstUnitCents: row.first,
      lastUnitCents: row.last,
      changes: row.changes,
      ...(row.first > 0 ? { changePercent: Math.round(((row.last - row.first) / row.first) * 10000) / 100 } : {}),
    }));
}

/** The scorecard for every vendor (vendors with no activity in the window are included, empty). */
export function vendorScorecard(input: VendorScorecardInput): VendorScorecardRow[] {
  const home = input.homeCurrency || 'USD';
  return input.vendors.map(vendor => {
    const orders = input.orders.filter(po => po.vendorId === vendor.id && po.status !== 'cancelled' && po.status !== 'draft');
    let withDates = 0;
    let onTime = 0;
    let lateDays = 0;
    let late = 0;
    for (const po of orders) {
      const expected = dayOf(po.expectedDeliveryDate);
      const receipts = (po.receipts || []).map(r => dayOf(r.receivedDate)).filter(Boolean).sort(byCodeUnit);
      if (!expected || !receipts.length) continue;
      const firstReceipt = receipts[0];
      if (!inWindow(firstReceipt, input.from, input.to) && !inWindow(expected, input.from, input.to)) continue;
      withDates += 1;
      if (firstReceipt <= expected) {
        onTime += 1;
      } else {
        late += 1;
        lateDays += daysBetween(expected, firstReceipt);
      }
    }
    const credits = input.credits.filter(c => c.vendorId === vendor.id && c.status !== 'void' && c.status !== 'draft' && inWindow(dayOf(c.date), input.from, input.to));
    const returned = credits.filter(c => (c.returnedGoods || []).length > 0);
    const priceChanges = priceChangesFor(input.bills.filter(b => b.vendorId === vendor.id), home, input.from, input.to);
    return {
      vendorId: vendor.id,
      vendorName: vendor.name,
      orders: {
        withDates,
        onTime,
        late,
        onTimeRate: withDates ? Math.round((onTime / withDates) * 10000) / 100 : null,
        averageDaysLate: late ? Math.round((lateDays / late) * 10) / 10 : null,
      },
      priceChanges,
      priceChangeCount: priceChanges.reduce((sum, p) => sum + p.changes, 0),
      returns: {
        credits: returned.length,
        units: returned.reduce((sum, c) => sum + (c.returnedGoods || []).reduce((n, l) => n + (Number(l.quantity) || 0), 0), 0),
        cents: returned.reduce((sum, c) => sum + (Number(c.amountCents) || 0), 0),
      },
    };
  });
}

export const VENDOR_SCORECARD_CSV_HEADERS = [
  'Vendor', 'Orders with dates', 'On time', 'Late', 'On-time rate (%)', 'Average days late',
  'Item', 'Currency', 'First unit cost (minor units)', 'Last unit cost (minor units)', 'Price changes', 'Change (%)',
  'Return credits', 'Units returned', 'Returned value (minor units)',
];

/** One CSV row per vendor and item price line; a vendor with no price lines gets one row. */
export function vendorScorecardCsvRows(rows: VendorScorecardRow[]): Array<Array<string | number>> {
  return rows.flatMap(row => {
    const head = [
      row.vendorName, row.orders.withDates, row.orders.onTime, row.orders.late,
      row.orders.onTimeRate ?? '', row.orders.averageDaysLate ?? '',
    ];
    const tail = [row.returns.credits, row.returns.units, row.returns.cents];
    if (!row.priceChanges.length) return [[...head, '', '', '', '', '', '', ...tail]];
    return row.priceChanges.map(p => [
      ...head, p.itemId, p.currency, p.firstUnitCents, p.lastUnitCents, p.changes, p.changePercent ?? '', ...tail,
    ]);
  });
}
