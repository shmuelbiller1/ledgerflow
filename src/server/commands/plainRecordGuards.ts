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
const LOCKED_ESTIMATE = new Set(['accepted', 'converted', 'invoiced']);
const ESTIMATE_DEAL_KEYS = ['status', 'items', 'lines', 'subtotalCents', 'taxCents', 'discountCents', 'totalCents', 'customerId', 'currency'] as const;
const RECEIVED_PO = new Set(['partially_received', 'received', 'billed', 'closed']);
/** the order a received purchase order may still move in: more receipts, then the bill, then closing */
const PO_STEP: Record<string, number> = { partially_received: 1, received: 2, billed: 3, closed: 4 };
const PO_TERMS_KEYS = ['vendorId', 'currency', 'subtotalCents', 'taxCents', 'totalCents'] as const;

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
    // quantity is always the stock moves' (a create starts at zero); cost is free until there is stock to value
    for (const k of ['quantityAtHand', 'quantityOnHand'] as const) {
      if (existing ? !same(existing[k], merged[k]) : num(merged[k]) !== 0) {
        throw refused(`"${k}" changes only through a stock move or a count.`, k);
      }
    }
    if (existing && (num(existing.quantityAtHand) !== 0 || num(existing.quantityOnHand) !== 0)) {
      for (const k of ['unitCostCents', 'averageCostCents'] as const) {
        if (!same(existing[k], merged[k])) throw refused(`"${k}" of an item with stock on hand changes only through a revaluation.`, k);
      }
    }
  } else if (collection === 'estimates') {
    // an accepted quote is a sales order: shipments and notes still land on it, the deal itself does not change
    if (existing && LOCKED_ESTIMATE.has(String(existing.status ?? ''))) {
      for (const k of ESTIMATE_DEAL_KEYS) {
        if (!same(existing[k], merged[k])) throw refused('An accepted or converted estimate cannot be edited; make a new revision.', k);
      }
    }
  } else if (collection === 'purchaseOrders') {
    if (existing && RECEIVED_PO.has(String(existing.status ?? ''))) guardReceivedPurchaseOrder(existing, merged);
  } else if (collection === 'taxRates') {
    const rate = merged.rate;
    if (rate !== undefined && (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 100)) {
      throw Object.assign(new HttpError('A tax rate must be a number from 0 to 100.', 400), { code: 'INVALID_INPUT', field: 'rate' });
    }
  }
}

type PoLine = { id?: unknown; quantity?: unknown; unitCostCents?: unknown; unitPriceCents?: unknown; receivedQuantity?: unknown };

/** After goods arrive, a purchase order may take more receipts, its bill and its close, but its terms are fixed. */
function guardReceivedPurchaseOrder(existing: Row, merged: Row): void {
  const from = PO_STEP[String(existing.status)] ?? 0;
  const to = PO_STEP[String(merged.status ?? '')] ?? -1;
  if (to < from) throw refused('A purchase order that has received goods cannot go back to an earlier status.', 'status');
  for (const k of PO_TERMS_KEYS) {
    if (!same(existing[k], merged[k])) throw refused('A purchase order that has received goods cannot have its terms edited.', k);
  }
  const before = Array.isArray(existing.items) ? existing.items as PoLine[] : [];
  const after = Array.isArray(merged.items) ? merged.items as PoLine[] : [];
  const linesChanged = before.length !== after.length || before.some((line, i) => {
    const next = after[i];
    const { receivedQuantity: was, ...terms } = line;
    const { receivedQuantity: now, ...nextTerms } = next ?? {};
    return !same(terms, nextTerms) || num(now) < num(was);
  });
  if (linesChanged) throw refused('A purchase order that has received goods can only record further receipts on its lines.', 'items');
}

/** Throws when deleting the row would orphan postings or stock. */
export function guardPlainRecordDelete(collection: string, record: Row): void {
  if (collection === 'assets' && assetHasAccounting(record)) {
    throw refused('An asset with depreciation, a disposal, a transfer or a placed-in-service entry cannot be deleted; dispose of it instead.');
  }
  if (collection === 'inventory' && (num(record.quantityAtHand) !== 0 || num(record.quantityOnHand) !== 0)) {
    throw refused('An item with stock on hand cannot be deleted; move the stock out first.');
  }
  if (collection === 'purchaseOrders' && RECEIVED_PO.has(String(record.status ?? ''))) {
    throw refused('A purchase order that has received goods cannot be deleted.');
  }
}
