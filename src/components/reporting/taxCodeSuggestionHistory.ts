import type { Bill, Invoice } from '../../types';
import type { TaxHistoryRow } from '../../lib/tax/taxSuggestions';

/** Build history rows from invoices and bills for suggestion learning. */
export function historyFromDocuments(
  invoices: readonly Pick<Invoice, 'id' | 'workspaceId' | 'date' | 'dueDate' | 'taxCodeId' | 'customerId' | 'items'>[],
  bills: readonly Pick<Bill, 'id' | 'workspaceId' | 'date' | 'dueDate' | 'taxCodeId' | 'vendorId' | 'splits'>[],
  workspaceId: string | null,
): Array<TaxHistoryRow & { sourceKey: string }> {
  const rows: Array<TaxHistoryRow & { sourceKey: string }> = [];
  for (const inv of invoices) {
    if (workspaceId && inv.workspaceId !== workspaceId) continue;
    const date = (inv.date || inv.dueDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    // Use first item's itemId if present, else no item
    const itemId = inv.items?.[0]?.itemId;
    // Entity from dimensions not stored at doc level in this MVP: leave undefined unless metadata has it
    // We keep entity undefined for general history; specific entity queries still work via fallback.
    const entity = undefined;
    if (inv.taxCodeId) rows.push({ sourceKey: `invoice:${inv.id}`, date, taxCodeId: inv.taxCodeId, contactId: inv.customerId, itemId, entity });
  }
  for (const bill of bills) {
    if (workspaceId && bill.workspaceId !== workspaceId) continue;
    const date = (bill.date || bill.dueDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const itemId = bill.splits?.[0]?.itemId;
    const entity = undefined;
    if (bill.taxCodeId) rows.push({ sourceKey: `bill:${bill.id}`, date, taxCodeId: bill.taxCodeId, contactId: bill.vendorId, itemId, entity });
  }
  // Sort by date ascending for weight calculation stability
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

