import { byCodeUnit } from './codeUnitOrder';
/**
 * A-113: lots with expiry dates. Lots arrive on goods receipts (GoodsReceiptItem.lotNumber with
 * lotExpiryDate); invoice lines may also record the lot a sale came from. This module groups what
 * was received by lot, says how many days each lot has left, and flags expired and expiring lots.
 *
 * What it does NOT say: how many of a lot are still on hand. The stock-moves ledger does not track
 * lots, so a received lot minus its recorded sales is not a reliable on-hand figure (a sale may
 * not record its lot). Sales with a lot are shown as a reference only. Pure.
 */

export interface ReceivedLot {
  itemId: string;
  itemName?: string;
  lotNumber: string;
  /** the expiry day (YYYY-MM-DD) the receipt recorded; empty when none */
  expiryDate?: string;
  /** units received with this lot on this receipt line */
  quantity: number;
  receiptNumber: string;
  /** the day the goods arrived (YYYY-MM-DD) */
  receivedDate: string;
  vendorName?: string;
}

export interface SaleLotRef {
  itemId: string;
  lotNumber: string;
  /** units recorded with this lot at sale */
  quantity: number;
  lastDate: string;
}

export type LotExpiryStatus = 'expired' | 'expiring' | 'ok' | 'no-date' | 'sale-only';

export interface ExpiringLotRow {
  itemId: string;
  itemName: string;
  lotNumber: string;
  /** the distinct expiry days recorded for this lot, earliest first (usually one) */
  expiryDates: string[];
  /** whole days from today to the earliest recorded expiry; null when no date and for sale-only rows */
  daysLeft: number | null;
  status: LotExpiryStatus;
  receivedQty: number;
  receiptNumbers: string[];
  receivedFrom: string[];
  firstReceived: string;
  lastReceived: string;
  /** units recorded with this lot at sale: a reference, never subtracted (on-hand per lot is not tracked) */
  soldQty: number;
  lastSold: string;
}

/** Days from 0000-03-01 to a civil date: pure calendar math, no time object and no zone. */
function daysFromCivil(y: number, m: number, d: number): number {
  const adjusted = m <= 2 ? y - 1 : y;
  const era = Math.floor(adjusted / 400);
  const yearOfEra = adjusted - era * 400;
  const monthOfYear = m <= 2 ? m + 9 : m - 3;
  const dayOfYear = Math.floor((153 * monthOfYear + 2) / 5) + d - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra;
}

/** Whole days from `from` to `to`, both YYYY-MM-DD (date-only math, no time zones). */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return daysFromCivil(ty, tm, td) - daysFromCivil(fy, fm, fd);
}

const STATUS_ORDER: Record<LotExpiryStatus, number> = { expired: 0, expiring: 1, ok: 2, 'no-date': 3, 'sale-only': 4 };

/**
 * One row per received lot (item + lot), plus lots recorded at sale with no receipt record.
 * A lot with several recorded expiry days is judged by the earliest (the conservative one) and
 * carries every distinct day. Expired rows come first, then by days left; lots without a date and
 * sale-only lots come last.
 */
export function expiringLotRows(
  received: ReceivedLot[],
  sales: SaleLotRef[],
  today: string,
  warnWithinDays: number,
): ExpiringLotRow[] {
  const warn = Math.max(0, Math.floor(Number(warnWithinDays) || 0));
  const lots = new Map<string, ExpiringLotRow & { expirySet: Set<string> }>();
  const key = (itemId: string, lot: string) => `${itemId}\u0000${lot}`;
  for (const line of received || []) {
    const lot = String(line.lotNumber || '').trim();
    if (!line.itemId || !lot) continue;
    const k = key(line.itemId, lot);
    let row = lots.get(k);
    if (!row) {
      row = {
        itemId: line.itemId, itemName: line.itemName || line.itemId, lotNumber: lot,
        expiryDates: [], daysLeft: null, status: 'no-date',
        receivedQty: 0, receiptNumbers: [], receivedFrom: [],
        firstReceived: '', lastReceived: '', soldQty: 0, lastSold: '',
        expirySet: new Set<string>(),
      };
      lots.set(k, row);
    }
    row.receivedQty += Number(line.quantity) || 0;
    if (line.receiptNumber && !row.receiptNumbers.includes(line.receiptNumber)) row.receiptNumbers.push(line.receiptNumber);
    if (line.vendorName && !row.receivedFrom.includes(line.vendorName)) row.receivedFrom.push(line.vendorName);
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
    let row = lots.get(k);
    if (!row) {
      row = {
        itemId: sale.itemId, itemName: sale.itemId, lotNumber: lot,
        expiryDates: [], daysLeft: null, status: 'sale-only',
        receivedQty: 0, receiptNumbers: [], receivedFrom: [],
        firstReceived: '', lastReceived: '', soldQty: 0, lastSold: '',
        expirySet: new Set<string>(),
      };
      lots.set(k, row);
    }
    row.soldQty += Number(sale.quantity) || 0;
    const day = String(sale.lastDate || '').slice(0, 10);
    if (day && day > row.lastSold) row.lastSold = day;
  }
  const rows = [...lots.values()].map(({ expirySet, ...row }) => {
    const dates = [...expirySet].sort(byCodeUnit);
    row.expiryDates = dates;
    if (row.status === 'sale-only') return row;
    if (dates.length === 0) {
      row.status = 'no-date';
      return row;
    }
    const daysLeft = daysBetween(today, dates[0]);
    row.daysLeft = daysLeft;
    row.status = daysLeft < 0 ? 'expired' : daysLeft <= warn ? 'expiring' : 'ok';
    return row;
  });
  return rows.sort((a, b) =>
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    || (a.daysLeft ?? Number.MAX_SAFE_INTEGER) - (b.daysLeft ?? Number.MAX_SAFE_INTEGER)
    || a.itemName.localeCompare(b.itemName) || a.lotNumber.localeCompare(b.lotNumber));
}

export const EXPIRING_LOTS_CSV_HEADERS = [
  'Item', 'Lot', 'Status', 'Days left', 'Expiry date(s)', 'Received units',
  'Receipts', 'Received from', 'First received', 'Last received',
  'Units recorded at sale (reference only)', 'Last sold',
];

export function expiringLotsCsvRows(rows: ExpiringLotRow[]): Array<Array<string | number>> {
  return rows.map(r => [
    r.itemName, r.lotNumber, r.status, r.daysLeft ?? '', r.expiryDates.join('; '), r.receivedQty,
    r.receiptNumbers.join('; '), r.receivedFrom.join('; '), r.firstReceived || '', r.lastReceived || '',
    r.soldQty, r.lastSold || '',
  ]);
}
