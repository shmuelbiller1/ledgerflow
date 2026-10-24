import { getIdToken } from '../firebase';

export interface StockMove {
  itemId: string;
  name: string;
  before: number;
  after: number;
  valueCents: number;
  unitCostCents: number;
}

export interface StockResult {
  status: 'ok';
  /** The ledger entry, or null when nothing had a value (a count of items with no cost). */
  transactionId: string | null;
  valueCents: number;
  items: StockMove[];
  newQuantity?: number;
}

interface StockAccounts {
  workspaceId: string;
  inventoryAccountId: string;
  offsetAccountId: string;
  reason?: string;
  date?: string;
  /** W-01: where the change happened (a Location label value) */
  locationId?: string;
}

export interface AdjustStockBody extends StockAccounts {
  itemId: string;
  /** Positive adds stock, negative removes it. */
  quantityChange: number;
  type: 'purchase' | 'opening' | 'adjustment';
  /** A purchase's cost per unit; the item's average cost is recalculated. */
  unitCostCents?: number;
}

export interface CountStockBody extends StockAccounts {
  counts: Array<{ itemId: string; counted: number }>;
}

async function postStock(path: string, body: object): Promise<StockResult> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getIdToken()}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'The stock change was not saved');
  return data as StockResult;
}

/** Adds or removes stock of one item; the server posts the entry and changes the quantity together. */
export const adjustStockRequest = (body: AdjustStockBody) => postStock('/api/v1/inventory/adjust', body);

/** Records counted quantities; differences go to the offset (variance) account in one entry. */
export const countStockRequest = (body: CountStockBody) => postStock('/api/v1/inventory/count', body);

export interface RevalueStockBody {
  workspaceId: string;
  itemId: string;
  newUnitCostCents: number;
  inventoryAccountId: string;
  offsetAccountId: string;
  reason: string;
  /** one per revaluation, kept for retries: the server applies it once */
  requestId: string;
  date?: string;
}

export interface RevalueStockResult {
  status: 'ok';
  transactionId: string | null;
  quantity: number;
  oldUnitCostCents: number;
  newUnitCostCents: number;
  valueCents: number;
  replayed: boolean;
}

/** ISS-130: revalues one item's stock on hand to a new cost; the server posts the difference and changes the cost together. */
export async function revalueStockRequest(body: RevalueStockBody): Promise<RevalueStockResult> {
  const res = await fetch('/api/v1/inventory/revalue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getIdToken()}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'The revaluation was not saved');
  return data as RevalueStockResult;
}

/** EG-6: what a landed cost posts (or, with dryRun, would post); the server's LandedCostResult. */
export interface LandedCostPostResult {
  entryId: string;
  date: string;
  movedToOpenDay: boolean;
  chargeCents: number;
  lines: Array<{ key: string; itemName: string; quantity: number; allocatedCents: number; inventoryCents: number; cogsCents: number; unitCostBeforeCents: number; unitCostAfterCents: number }>;
  entryLines: Array<{ accountId: string; accountName?: string; amountCents: number; description: string }>;
  posted: boolean;
  replayed: boolean;
  dryRun: boolean;
  planHash: string;
}

/** A refusal from the server, with the new plan when what would post changed since the review (409). */
export class LandedCostRequestError extends Error {
  constructor(message: string, readonly plan?: LandedCostPostResult) {
    super(message);
  }
}

/** EG-6: previews (dryRun) or posts a landed cost; the same body twice posts once. */
export async function landedCostRequest(body: Record<string, unknown>): Promise<LandedCostPostResult> {
  const res = await fetch('/api/v1/inventory/landed-cost', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getIdToken()}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new LandedCostRequestError(data.error || 'The landed cost was not posted', data.plan);
  return data as LandedCostPostResult;
}

/** EG-6: undoes a landed cost (its entry and its stock moves together). */
export async function undoLandedCostRequest(workspaceId: string, entryId: string): Promise<{ entryId: string; undoEntryId: string; date: string; replayed: boolean }> {
  const res = await fetch(`/api/v1/inventory/landed-cost/${encodeURIComponent(entryId)}/undo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getIdToken()}` },
    body: JSON.stringify({ workspaceId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'The landed cost was not undone');
  return data;
}
