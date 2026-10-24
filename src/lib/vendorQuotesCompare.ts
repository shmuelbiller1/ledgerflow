/**
 * A-119: Vendor quotes compare — compare quoted prices, minimum order quantities, lead times,
 * and validity dates from multiple suppliers per catalogue item, alongside each supplier's most
 * recent issued bill unit cost.
 *
 * Stored durably on `InventoryItem.metadata.vendorQuotes` (browser writes allowed on `inventory`,
 * where only `quantityAtHand` is server-immutable). Currencies are NEVER converted or mixed:
 * lowest-price comparison runs strictly inside each quote's own currency. Whole cents throughout.
 */
import type { Bill, InventoryItem } from '../types';

export interface VendorQuoteEntry {
  id: string;
  vendorId: string;
  vendorName: string;
  unitPriceCents: number;
  currency: string;
  minOrderQty: number;
  leadDays?: number;
  validUntil?: string;
  notes?: string;
  updatedAt?: string;
}

export interface LastBillReference {
  billNumber: string;
  date: string;
  unitCostCents: number;
  currency: string;
}

export interface ComparedVendorQuote extends VendorQuoteEntry {
  itemId: string;
  itemName: string;
  sku: string;
  expired: boolean;
  /** Lowest non-expired quote for this (itemId, currency) group */
  lowestInCurrency: boolean;
  /** Spread above lowest valid quote in the same currency; null when expired or no valid quote */
  deltaFromLowestCents: number | null;
  lastBill?: LastBillReference;
}

export function vendorQuotesFromItem(item: Pick<InventoryItem, 'metadata'>): VendorQuoteEntry[] {
  const raw = item.metadata?.vendorQuotes;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((q): q is Record<string, unknown> => Boolean(q && typeof q === 'object'))
    .map(q => ({
      id: String(q.id || ''),
      vendorId: String(q.vendorId || ''),
      vendorName: String(q.vendorName || '').trim(),
      unitPriceCents: Math.round(Number(q.unitPriceCents) || 0),
      currency: String(q.currency || 'USD').trim().toUpperCase(),
      minOrderQty: Math.max(1, Number(q.minOrderQty) || 1),
      ...(Number.isFinite(Number(q.leadDays)) && Number(q.leadDays) >= 0 ? { leadDays: Math.round(Number(q.leadDays)) } : {}),
      ...(typeof q.validUntil === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.validUntil) ? { validUntil: q.validUntil } : {}),
      ...(typeof q.notes === 'string' && q.notes.trim() ? { notes: q.notes.trim().slice(0, 240) } : {}),
      ...(typeof q.updatedAt === 'string' ? { updatedAt: q.updatedAt } : {}),
    }))
    .filter(q => q.id && q.vendorId && q.vendorName && q.unitPriceCents > 0);
}

export function vendorQuoteProblem(input: {
  vendorId?: string;
  unitPriceCents?: number;
  minOrderQty?: number;
  leadDays?: number;
  validUntil?: string;
}): string | null {
  if (!input.vendorId?.trim()) return 'Choose a vendor.';
  const price = Math.round(Number(input.unitPriceCents) || 0);
  if (price <= 0) return 'Enter a quoted unit price above zero.';
  if (input.minOrderQty !== undefined && (!(Number(input.minOrderQty) > 0) || !Number.isFinite(Number(input.minOrderQty)))) {
    return 'Minimum order quantity must be above zero.';
  }
  if (input.leadDays !== undefined && (!Number.isFinite(Number(input.leadDays)) || Number(input.leadDays) < 0)) {
    return 'Lead time in days cannot be negative.';
  }
  if (input.validUntil && !/^\d{4}-\d{2}-\d{2}$/.test(input.validUntil)) {
    return 'Valid-until date must be YYYY-MM-DD.';
  }
  return null;
}

const UNISSUED_BILL = new Set(['draft', 'void', 'cancelled', 'rejected']);

function latestBillCostIndex(bills: Bill[], defaultCurrency: string): Map<string, LastBillReference> {
  const index = new Map<string, LastBillReference>();
  for (const bill of bills || []) {
    if (UNISSUED_BILL.has(String(bill.status))) continue;
    const day = String(bill.date || bill.issueDate || '').slice(0, 10);
    const ccy = String(bill.currency || defaultCurrency || 'USD').toUpperCase();
    for (const split of bill.splits || []) {
      const qty = Number(split.quantity) || 0;
      const amt = Math.round(Number(split.amountCents) || 0);
      if (!split.itemId || !bill.vendorId || qty <= 0 || amt <= 0) continue;
      const key = `${split.itemId}|${bill.vendorId}|${ccy}`;
      const prev = index.get(key);
      if (!prev || day >= prev.date) {
        index.set(key, {
          billNumber: String(bill.number || bill.id),
          date: day,
          unitCostCents: Math.round(amt / qty),
          currency: ccy,
        });
      }
    }
  }
  return index;
}

export function compareVendorQuotes(input: {
  items: InventoryItem[];
  bills: Bill[];
  asOfDate: string;
  defaultCurrency?: string;
}): ComparedVendorQuote[] {
  const { items, bills, asOfDate, defaultCurrency = 'USD' } = input;
  const billCosts = latestBillCostIndex(bills, defaultCurrency);
  const rawRows: ComparedVendorQuote[] = [];

  for (const item of items || []) {
    for (const q of vendorQuotesFromItem(item)) {
      const expired = Boolean(q.validUntil && q.validUntil < asOfDate);
      rawRows.push({
        ...q,
        itemId: item.id,
        itemName: item.name,
        sku: item.sku || '',
        expired,
        lowestInCurrency: false,
        deltaFromLowestCents: null,
        lastBill: billCosts.get(`${item.id}|${q.vendorId}|${q.currency}`),
      });
    }
  }

  const minByItemCurrency = new Map<string, number>();
  for (const row of rawRows) {
    if (row.expired) continue;
    const gk = `${row.itemId}|${row.currency}`;
    const prev = minByItemCurrency.get(gk);
    if (prev === undefined || row.unitPriceCents < prev) {
      minByItemCurrency.set(gk, row.unitPriceCents);
    }
  }

  return rawRows
    .map(row => {
      const min = minByItemCurrency.get(`${row.itemId}|${row.currency}`);
      if (row.expired || min === undefined) return row;
      return {
        ...row,
        lowestInCurrency: row.unitPriceCents === min,
        deltaFromLowestCents: row.unitPriceCents - min,
      };
    })
    .sort((a, b) =>
      a.itemName.localeCompare(b.itemName)
      || a.currency.localeCompare(b.currency)
      || Number(a.expired) - Number(b.expired)
      || a.unitPriceCents - b.unitPriceCents
      || a.vendorName.localeCompare(b.vendorName));
}

export const VENDOR_QUOTES_CSV_HEADERS = [
  'Item', 'SKU', 'Vendor', 'Currency', 'Quoted unit price (minor units)',
  'Best in currency', 'Spread vs lowest (minor units)', 'MOQ', 'Lead days',
  'Valid until', 'Expired', 'Last billed unit cost (minor units)', 'Last bill', 'Notes',
];

export function vendorQuotesCsvRows(rows: ComparedVendorQuote[]): Array<Array<string | number>> {
  return rows.map(r => [
    r.itemName,
    r.sku,
    r.vendorName,
    r.currency,
    r.unitPriceCents,
    r.lowestInCurrency ? 'yes' : 'no',
    r.deltaFromLowestCents ?? '',
    r.minOrderQty,
    r.leadDays ?? '',
    r.validUntil || '',
    r.expired ? 'yes' : 'no',
    r.lastBill ? r.lastBill.unitCostCents : '',
    r.lastBill ? r.lastBill.billNumber : '',
    r.notes || '',
  ]);
}
