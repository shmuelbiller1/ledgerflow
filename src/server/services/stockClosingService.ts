/**
 * EG-7: the stock closing snapshot (`stockClosings`, supabase/migrations/20261025000000_stock_closings.sql) and the
 * stock invariant checks, on the server. One document per workspace and period end (id `<workspaceId>_<asOf>`),
 * written only here, for a period the workspace has locked: per item and location the quantity, value, move count
 * and a checksum over its moves; the stock total; the Inventory accounts' balance on the same date (balancesAsOf);
 * and the difference. The checks are in src/lib/stockInvariants.ts.
 *
 * Written by `POST /api/v1/inventory/stock-closing` (owners), not inside `/close-year`: that transaction is being
 * reshaped by EG-3 (the period-closing document), and the stock closing reads a different table. A closed period's
 * moves and entries can't change while it stays locked, so taking it right after the close is the same figures.
 */
import type { ChartAccount, Transaction } from '../../types';
import type { Firestore } from '../db/firestore';
import type { StockMove } from '../../lib/stockMoves';
import { resolveAccountRole } from '../../lib/accountUtils';
import { buildStockClosing, checkStockAgainstBooks, closingFreshness, inventoryEntriesChecksum, negativeStockDays, type StockClosing } from '../../lib/stockInvariants';
import { balancesAsOf } from './balanceService';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const stockClosingId = (workspaceId: string, asOf: string) => `${workspaceId}_${asOf}`;

export class StockClosingError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = 'StockClosingError'; }
}

let known: { exists: boolean; at: number } | null = null;
/** Whether the stockClosings table exists (cached; looked for again after a minute when missing). */
export async function stockClosingsReady(db: Firestore): Promise<boolean> {
  if (known && (known.exists || Date.now() - known.at < 60_000)) return known.exists;
  try {
    const result = await db.pool.query(`select to_regclass('public."stockClosings"') is not null as ok`);
    known = { exists: Boolean(result.rows[0]?.ok), at: Date.now() };
  } catch {
    known = { exists: false, at: Date.now() };
  }
  return known.exists;
}

const accountsOf = async (db: Firestore, workspaceId: string) =>
  (await db.collection('chartAccounts').where('workspaceId', '==', workspaceId).get()).docs.map(d => ({ ...d.data(), id: d.id }) as ChartAccount);

/** The Inventory accounts' balance at the end of `date`: balancesAsOf plus the accounts' own opening balances. */
export async function inventoryBalanceAsOf(db: Firestore, workspaceId: string, date: string, accounts?: ChartAccount[]): Promise<number> {
  const chart = accounts || await accountsOf(db, workspaceId);
  const inventory = chart.filter(a => resolveAccountRole(a) === 'inventory');
  const balances = await balancesAsOf(db, workspaceId, date);
  return inventory.reduce((s, a) => s + (balances.accounts[a.id] || 0) + (Number(a.openingBalanceCents) || 0), 0);
}

const entriesThrough = async (db: Firestore, workspaceId: string, asOf: string) =>
  (await db.collection('transactions').where('workspaceId', '==', workspaceId).where('date', '<=', `${asOf}T23:59:59.999Z`).get()).docs.map(d => ({ ...d.data(), id: d.id }) as Transaction);

/** Takes (or takes again) the stock closing at `asOf` (default: the lock date), which must be locked. */
export async function writeStockClosing(db: Firestore, input: { workspaceId: string; asOf?: string; uid: string }): Promise<StockClosing> {
  if (!(await stockClosingsReady(db))) throw new StockClosingError(503, 'Stock closings are not set up in this database yet (apply supabase/migrations/20261025000000_stock_closings.sql).');
  return db.runTransaction(async t => {
    // everything is built inside the callback: a retried attempt starts afresh
    const ws = (await t.get(db.collection('workspaces').doc(input.workspaceId))).data() || {};
    const lockDate = typeof ws.lockDate === 'string' ? ws.lockDate : '';
    const asOf = input.asOf || lockDate;
    if (!asOf || !DATE.test(asOf)) throw new StockClosingError(400, 'Close and lock a period first: a stock closing is taken at a locked period end.');
    if (!lockDate || asOf > lockDate) throw new StockClosingError(409, `The books are not locked through ${asOf}${lockDate ? ` (locked through ${lockDate})` : ''}: close the period first.`);
    // a partial unlock reopens dates in the period: its stock and entries can still change
    const ex = ws.lockException as { fromDate?: string; toDate?: string } | null | undefined;
    if (ex?.fromDate && ex.fromDate <= asOf) throw new StockClosingError(409, `${ex.fromDate}${ex.toDate ? ` to ${ex.toDate}` : ''} is unlocked: lock it again before taking the stock closing of ${asOf}.`);
    // every move, any date: an item's history start comes from its first move written, whatever its date
    const moves = (await t.get(db.collection('stockMoves').where('workspaceId', '==', input.workspaceId))).docs
      .map(d => ({ ...d.data(), id: d.id }) as StockMove);
    const [entries, accounts] = await Promise.all([entriesThrough(db, input.workspaceId, asOf), accountsOf(db, input.workspaceId)]);
    const inventoryBalanceCents = await inventoryBalanceAsOf(db, input.workspaceId, asOf, accounts);
    const booksChecksum = inventoryEntriesChecksum(entries, accounts, asOf);
    const closing = buildStockClosing({ workspaceId: input.workspaceId, asOf, moves, inventoryBalanceCents, booksChecksum, builtBy: input.uid, at: new Date().toISOString() });
    t.set(db.collection('stockClosings').doc(stockClosingId(input.workspaceId, asOf)), { ...closing });
    return closing;
  });
}

export interface StockCheckReport {
  asOf: string;
  closing: (StockClosing & { fresh: boolean; freshness: string; changedItems: string[] }) | null;
  closings: Array<{ asOf: string; builtAt: string }>;
  books: ReturnType<typeof checkStockAgainstBooks>;
  negative: ReturnType<typeof negativeStockDays>;
}

/** The read: the closing at `asOf` (or the newest one), checks (a) and (b) at the date, and (c) on the closing. */
export async function stockCheckReport(db: Firestore, input: { workspaceId: string; asOf?: string; today: string }): Promise<StockCheckReport> {
  const all = (await stockClosingsReady(db))
    ? (await db.collection('stockClosings').where('workspaceId', '==', input.workspaceId).get()).docs.map(d => d.data() as StockClosing).sort((a, b) => b.asOf.localeCompare(a.asOf))
    : [];
  const picked = input.asOf ? all.find(c => c.asOf === input.asOf) || null : all[0] || null;
  const asOf = input.asOf || picked?.asOf || input.today;
  const [movesSnap, accounts] = await Promise.all([
    db.collection('stockMoves').where('workspaceId', '==', input.workspaceId).get(),
    accountsOf(db, input.workspaceId),
  ]);
  const moves = movesSnap.docs.map(d => ({ ...d.data(), id: d.id }) as StockMove);
  // the entries through the later of the date asked and the closing's (the closing's book side is checked too)
  const through = picked && picked.asOf > asOf ? picked.asOf : asOf;
  const entries = await entriesThrough(db, input.workspaceId, through);
  const inventoryBalanceCents = await inventoryBalanceAsOf(db, input.workspaceId, asOf, accounts);
  const freshness = picked ? closingFreshness(picked, moves, inventoryEntriesChecksum(entries, accounts, picked.asOf)) : null;
  return {
    asOf,
    closing: picked && freshness ? { ...picked, fresh: freshness.fresh, freshness: freshness.message, changedItems: freshness.changedItems } : null,
    closings: all.map(c => ({ asOf: c.asOf, builtAt: c.builtAt })),
    books: checkStockAgainstBooks({ asOf, moves, entries, accounts, inventoryBalanceCents }),
    negative: negativeStockDays(moves, asOf),
  };
}
