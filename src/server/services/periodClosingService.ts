/**
 * EG-3: the period-closing document (docs/design/EG-3-period-closing.md,
 * supabase/migrations/20261024000000_period_closings.sql).
 *
 * One immutable record per workspace, year end and version, written by `/close-year` (with the lock) in the same
 * serializable transaction that moves the lock date and writes the L-123 snapshot, from the same entries. The
 * year-end rule stays (CA-07): no closing entry is posted. The transfer to retained earnings is recorded as figures
 * only; the balance sheet keeps carrying past profit as the sum of every income and expense entry.
 *
 * Reopening the year (the lock moved back before the year end) marks the current version superseded, in the
 * reopen's own transaction; the next close writes the next version. Nothing else ever changes a document.
 */
import type { ChartAccount, Transaction } from '../../types';
import type { Firestore, Transaction as DbTransaction } from '../db/firestore';
import { computeBalanceSheet, computeProfitAndLoss } from '../reports/computeReports';
import { snapshotId, type PeriodBalances } from './balanceService';

export const PERIOD_CLOSINGS = 'periodClosings';

export interface ClosingLine { accountId: string; name: string; code?: string; cents: number }

export interface PeriodClosing {
  workspaceId: string;
  yearStart: string;
  yearEnd: string;
  version: number;
  status: 'current' | 'superseded';
  profitAndLoss: {
    income: { total: number; accounts: ClosingLine[] };
    cogs: { total: number; accounts: ClosingLine[] };
    expense: { total: number; accounts: ClosingLine[] };
    grossProfit: number;
    netIncome: number;
  };
  /** CA-07: figures only, no entry posted. Before + transfer = after = the balance sheet's retained earnings. */
  retainedEarnings: { before: number; transfer: number; after: number; entryPosted: false };
  balanceSheet: { totalAssets: number; totalLiabilities: number; totalEquity: number; retainedEarnings: number; totalClaims: number; isBalanced: boolean };
  snapshot: { id: string; checksum: string; entryCount: number };
  lockDate: string;
  closedByUid: string;
  closedBy: string;
  closedAt: string;
  /** where the close checklist and the close package of the year's last month are */
  links: { closeChecklist: { tab: 'month-end-close'; month: string }; closePackage: { tab: 'month-end-close'; month: string; file: string } };
  supersededAt?: string;
  supersededBy?: string;
  supersededReason?: string;
}

export const closingId = (workspaceId: string, yearEnd: string, version: number) => `${workspaceId}_${yearEnd}_v${version}`;

let known: { exists: boolean; at: number } | null = null;
let warned = false;

function recordPeriodClosingsReady(exists: boolean): boolean {
  known = { exists, at: Date.now() };
  if (!exists && !warned) {
    warned = true;
    console.warn('[period-closings] the periodClosings table is missing: apply 20261024000000_period_closings.sql');
  }
  return exists;
}

/** Whether the migration is applied (a database without it closes the year as before, without the document). */
export async function periodClosingsReady(db: Firestore, tx?: DbTransaction): Promise<boolean> {
  // Reuse the command transaction's connection; a separate pool query can deadlock when PG_POOL_MAX=1.
  if (tx && typeof tx.tablesExist === 'function') {
    return recordPeriodClosingsReady(await tx.tablesExist('periodClosings'));
  }
  if (known && (known.exists || Date.now() - known.at < 60_000)) return known.exists;
  try {
    const result = await db.pool.query(`select to_regclass('public."periodClosings"') is not null as ok`);
    return recordPeriodClosingsReady(Boolean(result.rows[0]?.ok));
  } catch {
    return recordPeriodClosingsReady(false);
  }
}

/** @internal Resets cached periodClosings readiness state between unit tests. */
export function resetPeriodClosingsReadyForTests(): void {
  known = null;
  warned = false;
}

const lines = (group: Record<string, { name: string; code?: string; balance: number }>): ClosingLine[] =>
  Object.entries(group).filter(([, a]) => a.balance !== 0)
    .map(([accountId, a]) => ({ accountId, name: a.name, ...(a.code ? { code: a.code } : {}), cents: a.balance }))
    .sort((a, b) => (a.code || a.name).localeCompare(b.code || b.name));

/** The document's figures, from the entries the close read (pure: the version and who closed it are given). */
export function buildClosing(input: {
  workspaceId: string; yearStart: string; yearEnd: string; version: number; accounts: ChartAccount[]; entries: Transaction[];
  snapshot: PeriodBalances; uid: string; email?: string; at: string;
}): PeriodClosing {
  const { workspaceId, yearStart, yearEnd, accounts, entries } = input;
  const pl = computeProfitAndLoss(accounts, entries, yearStart, yearEnd);
  const bs = computeBalanceSheet(accounts, entries, yearEnd);
  const month = yearEnd.slice(0, 7);
  return {
    workspaceId, yearStart, yearEnd, version: input.version, status: 'current',
    profitAndLoss: {
      income: { total: pl.income.total, accounts: lines(pl.income.accounts) },
      cogs: { total: pl.cogs.total, accounts: lines(pl.cogs.accounts) },
      expense: { total: pl.expense.total, accounts: lines(pl.expense.accounts) },
      grossProfit: pl.grossProfit, netIncome: pl.netIncome,
    },
    retainedEarnings: { before: bs.netIncome - pl.netIncome, transfer: pl.netIncome, after: bs.netIncome, entryPosted: false },
    balanceSheet: {
      totalAssets: bs.totalAssets, totalLiabilities: bs.totalLiabilities, totalEquity: bs.totalEquity,
      retainedEarnings: bs.netIncome, totalClaims: bs.totalClaims, isBalanced: bs.isBalanced,
    },
    snapshot: { id: snapshotId(workspaceId, yearEnd), checksum: input.snapshot.checksum, entryCount: input.snapshot.entryCount },
    lockDate: yearEnd, closedByUid: input.uid, closedBy: input.email || input.uid, closedAt: input.at,
    links: { closeChecklist: { tab: 'month-end-close', month }, closePackage: { tab: 'month-end-close', month, file: `Close_Package_${month}.xlsx` } },
  };
}

type Stored = Array<{ id: string; data: PeriodClosing }>;

/** Inside a transaction, before any write (the database reads first, then writes): the workspace's documents. */
export async function readClosings(db: Firestore, t: DbTransaction, workspaceId: string): Promise<Stored> {
  const snap = await t.get(db.collection(PERIOD_CLOSINGS).where('workspaceId', '==', workspaceId));
  return snap.docs.map(d => ({ id: d.id, data: d.data() as PeriodClosing }));
}

/** Inside the close-year transaction, after readClosings: the next version for this year end (any version still current is superseded first). */
export function writeClosing(db: Firestore, t: DbTransaction, stored: Stored, input: Omit<Parameters<typeof buildClosing>[0], 'version'>): PeriodClosing {
  const mine = stored.filter(c => c.data.yearEnd === input.yearEnd);
  for (const c of mine.filter(c => c.data.status === 'current')) {
    t.update(db.collection(PERIOD_CLOSINGS).doc(c.id), { status: 'superseded', supersededAt: input.at, supersededBy: input.email || input.uid, supersededReason: 'Closed again', updatedAt: input.at });
  }
  const version = mine.reduce((n, c) => Math.max(n, Number(c.data.version) || 0), 0) + 1;
  const closing = buildClosing({ ...input, version });
  t.set(db.collection(PERIOD_CLOSINGS).doc(closingId(input.workspaceId, input.yearEnd, version)), { ...closing });
  return closing;
}

/** Inside a reopen's transaction, before its writes: every current document whose year end is now after the lock is superseded. */
export async function supersedeClosings(db: Firestore, t: DbTransaction, input: { workspaceId: string; lockDate: string | null; by: string; reason: string; at: string }): Promise<number> {
  if (!(await periodClosingsReady(db, t))) return 0;
  const open = (await readClosings(db, t, input.workspaceId)).filter(c => c.data.status === 'current' && c.data.yearEnd > (input.lockDate || ''));
  for (const c of open) {
    t.update(db.collection(PERIOD_CLOSINGS).doc(c.id), { status: 'superseded', supersededAt: input.at, supersededBy: input.by, supersededReason: input.reason, updatedAt: input.at });
  }
  return open.length;
}

/** Every version, newest year end first, then newest version first. */
export async function listClosings(db: Firestore, workspaceId: string): Promise<Array<PeriodClosing & { id: string }>> {
  if (!(await periodClosingsReady(db))) return [];
  const snap = await db.collection(PERIOD_CLOSINGS).where('workspaceId', '==', workspaceId).get();
  return snap.docs.map(d => ({ ...(d.data() as PeriodClosing), id: d.id }))
    .sort((a, b) => b.yearEnd.localeCompare(a.yearEnd) || b.version - a.version);
}
