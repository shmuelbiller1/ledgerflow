/**
 * Money guards for `record.save` / `record.delete` (#822). The browser-role triggers (`lf_asset_accounting_guard`,
 * `lf_inventory_cost_guard`) do not fire for server writes, so the generic record commands repeat their rules here:
 * a field the ledger owns changes only through the command that posts it.
 */
import { HttpError } from '../auth/requestUser';

type Row = Record<string, unknown>;

const ASSET_SERVER_KEYS = [
  'accumulatedDepreciationCents', 'depreciatedThrough', 'lastDepreciationTransactionId', 'disposedOn',
  'disposalProceedsCents', 'disposalGainLossCents', 'disposalTransactionId', 'partialDisposals', 'transfers', 'placedInService',
] as const;
const INVENTORY_STOCK_KEYS = ['quantityAtHand', 'quantityOnHand', 'unitCostCents', 'averageCostCents'] as const;
const LOCKED_ESTIMATE = new Set(['accepted', 'converted', 'invoiced']);

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const empty = (v: unknown) => v == null || v === '' || v === 0 || (Array.isArray(v) && v.length === 0);
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0)) || 0;
const refused = (message: string, field?: string) =>
  Object.assign(new HttpError(message, 409), { code: 'CONFLICT', ...(field ? { field } : {}) });

export const assetHasAccounting = (r: Row) =>
  num(r.accumulatedDepreciationCents) > 0 || r.status === 'disposed'
  || ASSET_SERVER_KEYS.some((k) => k !== 'accumulatedDepreciationCents' && !empty(r[k]));

/** Throws when the merged row changes something only a ledger command may change. */
export function guardPlainRecordSave(collection: string, existing: Row | undefined, merged: Row): void {
  if (collection === 'assets') {
    for (const k of ASSET_SERVER_KEYS) {
      if (existing ? !same(existing[k], merged[k]) : !empty(merged[k])) {
        throw refused(`The asset field "${k}" changes only through depreciation, disposal or transfer.`, k);
      }
    }
    const was = existing?.status, now = merged.status;
    if (was !== now && (now === 'disposed' || was === 'disposed' || was === 'in_progress')) {
      throw refused('An asset changes to or from disposed only through the disposal command.', 'status');
    }
  } else if (collection === 'inventory') {
    const stocked = existing && (num(existing.quantityAtHand) !== 0 || num(existing.quantityOnHand) !== 0);
    if (stocked) {
      for (const k of INVENTORY_STOCK_KEYS) {
        if (!same(existing[k], merged[k])) throw refused(`"${k}" of an item with stock on hand changes only through a stock move or a revaluation.`, k);
      }
    }
  } else if (collection === 'estimates') {
    if (existing && LOCKED_ESTIMATE.has(String(existing.status ?? ''))) {
      throw refused('An accepted or converted estimate cannot be edited; make a new revision.', 'status');
    }
  } else if (collection === 'purchaseOrders') {
    const st = String(existing?.status ?? '');
    if (existing && (st === 'received' || st === 'closed' || st === 'partially_received')) {
      throw refused('A purchase order that has received goods cannot be edited.', 'status');
    }
  } else if (collection === 'taxRates') {
    const rate = merged.rate;
    if (rate !== undefined && (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 100)) {
      throw Object.assign(new HttpError('A tax rate must be a number from 0 to 100.', 400), { code: 'INVALID_INPUT', field: 'rate' });
    }
  }
}

/** Throws when deleting the row would orphan postings or stock. */
export function guardPlainRecordDelete(collection: string, record: Row): void {
  if (collection === 'assets' && assetHasAccounting(record)) {
    throw refused('An asset with depreciation, a disposal, a transfer or a placed-in-service entry cannot be deleted; dispose of it instead.');
  }
  if (collection === 'inventory' && (num(record.quantityAtHand) !== 0 || num(record.quantityOnHand) !== 0)) {
    throw refused('An item with stock on hand cannot be deleted; move the stock out first.');
  }
  if (collection === 'purchaseOrders' && ['received', 'partially_received', 'closed'].includes(String(record.status ?? ''))) {
    throw refused('A purchase order that has received goods cannot be deleted.');
  }
}
