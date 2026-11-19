import { AGE_BUCKETS, STOCK_MOVE_LABEL, type ItemDetails, type StockAge } from './stockMoves';
import type { TimeEntry } from './timeEntries';

// Validate the fields the reports actually consume. A truncated/malformed row is not a
// zero-quantity movement, an empty month or an exportable financial result.
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string';
const day = (v: unknown) => text(v) && /^\d{4}-\d{2}-\d{2}$/.test(v);
const balance = (v: unknown) => record(v) && Number.isFinite(v.quantity) && Number.isSafeInteger(v.valueCents);
const item = (v: Record<string, unknown>) => text(v.itemId) && v.itemId.length > 0 && text(v.itemName);

export function isItemDetails(v: unknown): v is ItemDetails {
  return record(v) && item(v) && balance(v.opening) && balance(v.closing) && Number.isFinite(v.received) && Number.isFinite(v.issued)
    && Array.isArray(v.moves) && v.moves.every((m: unknown) => record(m) && text(m.key) && day(m.date)
      && text(m.kind) && Object.hasOwn(STOCK_MOVE_LABEL, m.kind) && Number.isFinite(m.quantity) && Number.isFinite(m.quantityAfter)
      && Number.isSafeInteger(m.valueCents) && (m.transactionId == null || text(m.transactionId)));
}

export function isStockAge(v: unknown): v is StockAge {
  if (!record(v) || !item(v) || !balance(v)) return false;
  const buckets = v.buckets;
  return record(buckets) && AGE_BUCKETS.every(b => Number.isFinite(buckets[b.key])) && Number.isFinite(v.unknownAge)
    && (v.lastSold === null || day(v.lastSold)) && (v.daysSinceSold === null || Number.isSafeInteger(v.daysSinceSold));
}

export function isReportTimeEntry(v: unknown): v is TimeEntry {
  return record(v) && text(v.workspaceId) && text(v.person) && (v.projectId == null || text(v.projectId)) && day(v.date)
    && Number.isSafeInteger(v.minutes) && typeof v.billable === 'boolean' && text(v.status)
    && ['open', 'submitted', 'approved', 'invoiced'].includes(v.status);
}
