/**
 * A-140: Aged inventory by lot (report).
 *
 * Groups received goods-receipt lots (`PurchaseOrder.receipts[].items[]` carrying `lotNumber`) by
 * `(itemId, lotNumber, currency)`, calculates exact timezone-free civil days in stock from the
 * earliest receipt date up to `asOfDate`, assigns standard aging buckets (`0–30`, `31–60`, `61–90`,
 * `91–180`, `181+ days`), values received units strictly in the purchase order's own currency
 * (never mixing currencies), attaches lot expiry status, and shows any recorded sale lot references
 * alongside without pretending `stockMoves` tracks per-lot depletion. Pure.
 */
import type { InventoryItem, Invoice, PurchaseOrder } from '../types';
import { daysBetween } from './expiringLots';

export const LOT_AGE_BUCKETS = [
  { key: '0_30', label: '0–30 days', minDays: 0, maxDays: 30 },
  { key: '31_60', label: '31–60 days', minDays: 31, maxDays: 60 },
  { key: '61_90', label: '61–90 days', minDays: 61, maxDays: 90 },
  { key: '91_180', label: '91–180 days', minDays: 91, maxDays: 180 },
  { key: '181_plus', label: '181+ days', minDays: 181, maxDays: Number.POSITIVE_INFINITY },
] as const;

export type LotAgeBucketKey = typeof LOT_AGE_BUCKETS[number]['key'];

export interface AgedLotRow {
  itemId: string;
  itemName: string;
  lotNumber: string;
  currency: string;
  firstReceivedDate: string;
  ageDays: number;
  bucket: LotAgeBucketKey;
  receivedQty: number;
  receivedValueCents: number;
  receiptNumbers: string[];
  vendorNames: string[];
  expiryDate?: string;
  expired: boolean;
  /** Recorded lot references on issued sales invoices (informational only; never subtracted from receivedQty) */
  recordedSoldQty: number;
}

export function bucketForLotAge(ageDays: number): LotAgeBucketKey {
  if (ageDays <= 30) return '0_30';
  if (ageDays <= 60) return '31_60';
  if (ageDays <= 90) return '61_90';
  if (ageDays <= 180) return '91_180';
  return '181_plus';
}

const UNISSUED_INV = new Set(['draft', 'void', 'cancelled', 'rejected']);

export function computeAgedInventoryByLot(input: {
  purchaseOrders: PurchaseOrder[];
  items?: InventoryItem[];
  invoices?: Invoice[];
  asOfDate: string;
  defaultCurrency?: string;
}): AgedLotRow[] {
  const { purchaseOrders, items = [], invoices = [], asOfDate, defaultCurrency = 'USD' } = input;
  const itemNames = new Map(items.map(i => [i.id, i.name]));
  const soldByItemLot = new Map<string, number>();

  for (const inv of invoices) {
    if (UNISSUED_INV.has(String(inv.status))) continue;
    const day = String(inv.date || '').slice(0, 10);
    if (day && day > asOfDate) continue;
    for (const line of inv.items || []) {
      const lot = String((line as { lotNumber?: string }).lotNumber || '').trim();
      if (!line.itemId || !lot) continue;
      const k = `${line.itemId}|${lot}`;
      soldByItemLot.set(k, (soldByItemLot.get(k) || 0) + (Number(line.quantity) || 0));
    }
  }

  type Accum = Omit<AgedLotRow, 'ageDays' | 'bucket' | 'expired' | 'recordedSoldQty'>;
  const map = new Map<string, Accum>();

  for (const po of purchaseOrders || []) {
    if (po.status === 'cancelled') continue;
    const itemByPoLine = new Map((po.items || []).map(li => [li.id, li]));
    const ccy = String(po.currency || defaultCurrency || 'USD').toUpperCase();
    for (const gr of po.receipts || []) {
      const rDay = String(gr.receivedDate || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(rDay) || rDay > asOfDate) continue;
      for (const line of gr.items || []) {
        if (line.condition === 'rejected') continue;
        const lot = String(line.lotNumber || '').trim();
        const poLine = itemByPoLine.get(line.poItemId);
        const itemId = poLine?.itemId || line.poItemId;
        const qty = Number(line.quantityReceived) || 0;
        if (!lot || !itemId || !(qty > 0)) continue;
        const key = `${itemId}|${lot}|${ccy}`;
        let row = map.get(key);
        if (!row) {
          row = {
            itemId,
            itemName: itemNames.get(itemId) || poLine?.description || line.description || itemId,
            lotNumber: lot,
            currency: ccy,
            firstReceivedDate: rDay,
            receivedQty: 0,
            receivedValueCents: 0,
            receiptNumbers: [],
            vendorNames: [],
          };
          map.set(key, row);
        }
        if (rDay < row.firstReceivedDate) row.firstReceivedDate = rDay;
        row.receivedQty += qty;
        row.receivedValueCents += Math.round(qty * (Number(line.unitPriceCents) || 0));
        if (gr.receiptNumber && !row.receiptNumbers.includes(gr.receiptNumber)) row.receiptNumbers.push(gr.receiptNumber);
        const vName = gr.vendorName || po.vendorName;
        if (vName && !row.vendorNames.includes(vName)) row.vendorNames.push(vName);
        if (line.lotExpiryDate && /^\d{4}-\d{2}-\d{2}$/.test(line.lotExpiryDate)) {
          if (!row.expiryDate || line.lotExpiryDate < row.expiryDate) row.expiryDate = line.lotExpiryDate;
        }
      }
    }
  }

  return [...map.values()]
    .map(r => {
      const ageDays = Math.max(0, daysBetween(r.firstReceivedDate, asOfDate));
      return {
        ...r,
        ageDays,
        bucket: bucketForLotAge(ageDays),
        expired: Boolean(r.expiryDate && r.expiryDate < asOfDate),
        recordedSoldQty: soldByItemLot.get(`${r.itemId}|${r.lotNumber}`) || 0,
      };
    })
    .sort((a, b) => b.ageDays - a.ageDays || a.itemName.localeCompare(b.itemName) || a.lotNumber.localeCompare(b.lotNumber));
}

export const AGED_INVENTORY_BY_LOT_CSV_HEADERS = [
  'Item', 'Lot', 'First received', 'Age (days)', 'Age bucket', 'Currency',
  'Received units', 'Received value (minor units)', 'Expiry date', 'Expired',
  'Recorded sold units (reference)', 'Receipts', 'Vendors',
];

export function agedInventoryByLotCsvRows(rows: AgedLotRow[]): Array<Array<string | number>> {
  return rows.map(r => [
    r.itemName,
    r.lotNumber,
    r.firstReceivedDate,
    r.ageDays,
    LOT_AGE_BUCKETS.find(b => b.key === r.bucket)?.label || r.bucket,
    r.currency,
    r.receivedQty,
    r.receivedValueCents,
    r.expiryDate || '',
    r.expired ? 'yes' : 'no',
    r.recordedSoldQty,
    r.receiptNumbers.join('; '),
    r.vendorNames.join('; '),
  ]);
}
