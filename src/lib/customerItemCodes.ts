/**
 * A-122: Customer-specific item codes.
 *
 * Maps a workspace catalogue item (`InventoryItem`) to each buyer's own part number and optional
 * buyer description, stored durably in `InventoryItem.metadata.customerItemCodes`. Supports instant
 * reverse lookup when a purchase order from a customer names only the buyer's part number, and flags
 * ambiguous mappings where one customer has been assigned the same part number on two different items.
 * Pure helpers only; never mutates stock, pricing, or posted invoices.
 */
import type { Customer, InventoryItem } from '../types';

export interface CustomerItemCodeEntry {
  customerId: string;
  customerCode: string;
  customerDescription?: string;
  updatedAt?: string;
}

export interface CustomerItemCodeRow extends CustomerItemCodeEntry {
  itemId: string;
  itemName: string;
  internalSku: string;
  customerName: string;
  duplicateForCustomer: boolean;
}

export function customerItemCodesFromItem(item: Pick<InventoryItem, 'metadata'>): CustomerItemCodeEntry[] {
  const raw = item.metadata?.customerItemCodes;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: CustomerItemCodeEntry[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const obj = r as Record<string, unknown>;
    const customerId = String(obj.customerId || '').trim();
    const customerCode = String(obj.customerCode || '').trim().slice(0, 80);
    if (!customerId || !customerCode || seen.has(customerId)) continue;
    seen.add(customerId);
    const desc = typeof obj.customerDescription === 'string' ? obj.customerDescription.trim().slice(0, 160) : '';
    out.push({
      customerId,
      customerCode,
      ...(desc ? { customerDescription: desc } : {}),
      ...(typeof obj.updatedAt === 'string' ? { updatedAt: obj.updatedAt } : {}),
    });
  }
  return out;
}

export function upsertCustomerItemCode(
  existing: CustomerItemCodeEntry[],
  entry: CustomerItemCodeEntry,
): CustomerItemCodeEntry[] {
  const code = entry.customerCode.trim().slice(0, 80);
  const filtered = existing.filter(e => e.customerId !== entry.customerId);
  if (!code) return filtered;
  return [
    ...filtered,
    {
      customerId: entry.customerId,
      customerCode: code,
      ...(entry.customerDescription?.trim() ? { customerDescription: entry.customerDescription.trim().slice(0, 160) } : {}),
      updatedAt: entry.updatedAt || new Date().toISOString(),
    },
  ];
}

export function buildCustomerItemCodeRows(
  items: InventoryItem[],
  customers: Customer[],
): CustomerItemCodeRow[] {
  const customerMap = new Map((customers || []).map(c => [c.id, c.name]));
  const counts = new Map<string, number>();

  for (const item of items || []) {
    for (const c of customerItemCodesFromItem(item)) {
      const k = `${c.customerId}|${c.customerCode.toLowerCase()}`;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }

  const rows: CustomerItemCodeRow[] = [];
  for (const item of items || []) {
    for (const c of customerItemCodesFromItem(item)) {
      const k = `${c.customerId}|${c.customerCode.toLowerCase()}`;
      rows.push({
        ...c,
        itemId: item.id,
        itemName: item.name,
        internalSku: item.sku || '',
        customerName: customerMap.get(c.customerId) || c.customerId,
        duplicateForCustomer: (counts.get(k) || 0) > 1,
      });
    }
  }

  return rows.sort((a, b) =>
    a.customerName.localeCompare(b.customerName)
    || a.customerCode.localeCompare(b.customerCode)
    || a.itemName.localeCompare(b.itemName));
}

export const CUSTOMER_ITEM_CODES_CSV_HEADERS = [
  'Customer', 'Customer part code', 'Customer description', 'Internal item', 'Internal SKU', 'Duplicate warning',
];

export function customerItemCodesCsvRows(rows: CustomerItemCodeRow[]): string[][] {
  return rows.map(r => [
    r.customerName,
    r.customerCode,
    r.customerDescription || '',
    r.itemName,
    r.internalSku,
    r.duplicateForCustomer ? 'duplicate code for customer' : '',
  ]);
}
