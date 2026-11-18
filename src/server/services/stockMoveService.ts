/**
 * Writes the stock-moves ledger (W-02, src/lib/stockMoves.ts): every service that changes an item's
 * quantity on hand calls this inside the same database transaction, after its reads, so the history
 * and the quantity are written together or not at all. Only the server writes the table
 * (supabase/migrations/20261013060000_stock_moves.sql); members read it.
 *
 * Until that migration is applied to a database, stock changes must keep working as before W-02:
 * `stockMovesReady` (called in each service's read phase) says whether the table is there, and
 * without it nothing is written or read from it and the server says once which migration to apply.
 */
import type { Firestore, Transaction as DbTransaction } from '../db/firestore';
import type { StockMove } from '../../lib/stockMoves';

export type NewStockMove = Omit<StockMove, 'id' | 'seq' | 'createdAt'>;

let known: { exists: boolean; at: number } | null = null;
let inFlight: Promise<boolean> | null = null;
let warned = false;

function recordStockMovesReady(exists: boolean): boolean {
  known = { exists, at: Date.now() };
  if (!exists && !warned) {
    warned = true;
    console.warn('[stock history] the stockMoves table is missing: apply supabase/migrations/20261013060000_stock_moves.sql. Stock changes still work; their history is not kept until then.');
  }
  return exists;
}

/**
 * Whether the `stockMoves` table exists (cached; a missing table is looked for again after a minute).
 * Pass the active `Transaction` when called inside `db.runTransaction` so cold-start probes reuse
 * the checked-out transaction client instead of acquiring a second connection from `db.pool`.
 */
export async function stockMovesReady(db: Firestore, t?: DbTransaction): Promise<boolean> {
  if (db.sandboxId) return (t ?? db).tablesExist('stockMoves');
  if (known && (known.exists || Date.now() - known.at < 60_000)) return known.exists;
  if (t && typeof t.tablesExist === 'function') {
    return recordStockMovesReady(await t.tablesExist('stockMoves'));
  }
  if (inFlight) return inFlight;
  const probe: Promise<boolean> = (async () => {
    try {
      return recordStockMovesReady(await db.tablesExist('stockMoves'));
    } catch {
      return recordStockMovesReady(false);
    }
  })().finally(() => {
    if (inFlight === probe) inFlight = null;
  });
  inFlight = probe;
  return probe;
}

/** @internal Resets cached `stockMoves` readiness state between unit tests. */
export function resetStockMovesReadyForTests(): void {
  known = null;
  inFlight = null;
  warned = false;
}

export function writeStockMoves(db: Firestore, t: DbTransaction, moves: NewStockMove[]): void {
  // A live missing-table flag must not suppress a draft's stock history.
  if (moves.length === 0 || (!db.sandboxId && known?.exists === false)) return;
  const now = new Date().toISOString();
  moves.forEach((move, i) => {
    const ref = db.collection('stockMoves').doc();
    t.set(ref, { ...move, seq: `${now}#${String(i).padStart(5, '0')}`, createdAt: now });
  });
}
