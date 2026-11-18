/**
 * EG-1 step 1 (docs/design/EG-1-repost-engine.md): the repost queue. The dirty mark itself is made by the database,
 * in the same transaction as the stock move (trigger lf_repost_mark on stockMoves,
 * supabase/migrations/20261023010000_repost_queue.sql), so every path that writes stock moves marks it: postings
 * through commitLedgerBulk, stock adjustments, manual cost of goods, revaluations. A move dated before a move
 * already in the item's history marks the item's `stock-cost` row from that date; nothing is marked in the common
 * case, a move with no later ones.
 *
 * Until the migration is applied, the run answers that it is not set up: `repostQueueReady` looks for the table,
 * as stockMovesReady does.
 */
import type { Firestore } from '../db/firestore';

export const STOCK_COST_KIND = 'stock-cost';
/** the metadata type of a repost correction entry (repostService.ts) */
export const REPOST_COGS_TYPE = 'repost-cogs-adjust';
export const REPOST_QUEUE = 'repostQueue';

export const repostQueueId = (workspaceId: string, kind: string, key: string) => `${workspaceId}_${kind}_${key}`;

export interface RepostQueueRow {
  workspaceId: string;
  kind: string;
  key: string;
  fromDate: string;
  cause: string[];
  status: 'dirty' | 'running' | 'clean' | 'blocked';
  blockedBy?: string | null;
  markedAt?: string;
  runId?: string | null;
  lastRunAt?: string | null;
}

let known: { exists: boolean; at: number } | null = null;
let warned = false;

/** Whether the repostQueue table exists (cached; a missing table is looked for again after a minute). */
export async function repostQueueReady(db: Firestore): Promise<boolean> {
  if (db.sandboxId) return db.tablesExist(REPOST_QUEUE);
  if (known && (known.exists || Date.now() - known.at < 60_000)) return known.exists;
  try {
    known = { exists: await db.tablesExist(REPOST_QUEUE), at: Date.now() };
  } catch {
    known = { exists: false, at: Date.now() };
  }
  if (!known.exists && !warned) {
    warned = true;
    console.warn('[repost] the repostQueue table is missing: apply supabase/migrations/20261023010000_repost_queue.sql. Posting still works; backdated changes are not marked for repost until then.');
  }
  return known.exists;
}
