import type { Firestore } from '../db/firestore';
import { runDataChecks, type CheckContext } from '../../lib/dataChecks';
import { healthSummary, newSeriousProblems, problemNotice, type LedgerHealth } from '../../lib/ledgerHealth';
import { formatCurrency, formatTzDate } from '../../lib/utils';
import { reconciliationDrift, type ReconciliationRecord } from '../../lib/reconciliationDrift';
import { unusualEntries } from '../../lib/unusualEntries';
import type { ChartAccount, Transaction } from '../../types';
import { logger } from '../utils/logger';
import { notify } from './notificationService';

/**
 * Ledger health monitor (CA-32), part of the daily job: runs the Data Health checks on each
 * workspace whose books changed since its last check (anything added, changed or deleted; or not
 * checked for a week), keeps the
 * result on the workspace (`ledgerHealth`, server-only), and notifies the owner and accountants of
 * serious problems that are new since the last check. Bounded by time so the daily job always
 * finishes; workspaces checked longest ago go first, the rest the next night.
 */
const SOURCES = {
  transactions: { table: 'transactions', cap: 20000 },
  accounts: { table: 'chartAccounts', cap: 2000 },
  invoices: { table: 'invoices', cap: 10000 },
  bills: { table: 'bills', cap: 10000 },
  recurring: { table: 'recurring', cap: 1000 },
  inventory: { table: 'inventory', cap: 5000 },
  bankLines: { table: 'bankLines', cap: 10000 },
  // CB-23: each payment has its entry
  payments: { table: 'payments', cap: 20000 },
  reconciliations: { table: 'reconciliations', cap: 1000 },
  // W-02: the stock history, checked against each item's quantity
  stockMoves: { table: 'stockMoves', cap: 50000 },
  // EG-7: the stock closings, checked against the moves they cover
  stockClosings: { table: 'stockClosings', cap: 200 },
  // EG-10: the payment ledger, checked against each document's amount paid
  allocations: { table: 'paymentAllocations', cap: 50000 },
} as const;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * What the checks read, in one string that changes when anything is added, changed or deleted: how
 * many rows and when the newest change was. Equal to the last check's: nothing to check again.
 */
async function booksFingerprint(db: Firestore, workspaceId: string): Promise<string> {
  // a table whose migration is not applied yet is left out (reads of it return nothing)
  const existing = await db.tables();
  const parts = Object.values(SOURCES).filter(s => existing.has(s.table)).map(s => `select count(*) as n, max(updated_at) as at from public."${s.table}" where workspace_id = $1`);
  const { rows } = await db.pool.query(`select sum(n)::bigint as n, max(at) as at from (${parts.join(' union all ')}) changes`, [workspaceId]);
  const at = rows[0]?.at as Date | null;
  return `${rows[0]?.n || 0}:${at ? new Date(at).toISOString() : ''}`;
}

/** Runs the checks on one workspace, keeps the result and tells about new serious problems. */
export async function checkLedgerHealth(db: Firestore, workspaceId: string, now = new Date()): Promise<{ problems: number; newProblems: number } | null> {
  const wsRef = db.collection('workspaces').doc(workspaceId);
  const ws = (await wsRef.get()).data();
  if (!ws || ws.deletedAt) return null;
  const fingerprint = await booksFingerprint(db, workspaceId);
  const loaded = await Promise.all(Object.entries(SOURCES).map(async ([key, s]) => {
    const snap = await db.collection(s.table).where('workspaceId', '==', workspaceId).limit(s.cap).get();
    return [key, snap.docs.map(d => ({ ...d.data(), id: d.id }))] as const;
  }));
  const data = Object.fromEntries(loaded) as unknown as Omit<CheckContext, 'today' | 'baseCurrency'>;
  // EG-7: a source read up to its cap is partial: the checks over it say so instead of comparing
  data.truncated = loaded.filter(([key, rows]) => rows.length >= SOURCES[key as keyof typeof SOURCES].cap).map(([key]) => key);
  const today = formatTzDate(now, typeof ws.timezone === 'string' ? ws.timezone : 'UTC');
  const findings = runDataChecks({ ...data, today, baseCurrency: String(ws.currency || 'USD'), dimensions: Array.isArray(ws.dimensions) ? ws.dimensions : undefined });
  const fresh = newSeriousProblems(findings, ws.ledgerHealth as LedgerHealth | undefined);
  // S-07: a reconciled period whose books moved since (the difference to the statement is kept per reconciliation)
  const kept = ((ws.ledgerHealth as LedgerHealth | undefined)?.reconciled || {}) as Record<string, number>;
  const { baselines, drifted } = reconciliationDrift(data.accounts as ChartAccount[], data.transactions as Transaction[],
    (data as unknown as { reconciliations: ReconciliationRecord[] }).reconciliations || [], kept);
  const summary = { ...healthSummary(findings, now.toISOString(), fingerprint), reconciled: baselines };
  await wsRef.update({ ledgerHealth: summary });
  const currency = String(ws.currency || 'USD');
  for (const d of drifted) {
    await notify(db, {
      workspaceId, kind: 'reconciliation.discrepancy', title: `${d.account.name} no longer matches its reconciled statement`,
      message: `On ${d.statementDate} the books now differ from the statement by ${formatCurrency(d.nowCents, currency)} (it was ${formatCurrency(d.thenCents, currency)} when reconciled): an entry on or before that date was added, changed, voided or deleted.`,
      eventKey: `recon-drift:${d.reconciliationId}:${d.thenCents}:${d.nowCents}`, workspace: ws,
    });
  }
  if (fresh.length) {
    const notice = problemNotice(fresh);
    await notify(db, {
      workspaceId, kind: 'health.problem', title: notice.title, message: notice.message,
      eventKey: `health:${today}:${fresh.map(f => f.id).sort().join(',').slice(0, 150)}`, workspace: ws,
    });
  }
  // S-17: entries of the last two weeks far bigger than their account usually sees (once per entry)
  for (const u of unusualEntries(data.transactions as Transaction[], data.accounts as ChartAccount[], today)) {
    await notify(db, {
      workspaceId, kind: 'transaction.unusual', title: `An unusual entry on ${u.account.name}`,
      message: `${formatCurrency(u.amountCents, currency)} on ${String(u.transaction.date).slice(0, 10)}${u.transaction.description ? ` ("${String(u.transaction.description).slice(0, 80)}")` : ''}; it usually sees about ${formatCurrency(u.usualCents, currency)}. Check it is right.`,
      eventKey: `unusual:${u.transaction.id}`, recordId: u.transaction.id, workspace: ws,
    });
  }
  return { problems: findings.length, newProblems: fresh.length };
}

/** The nightly run: workspaces whose books changed since their last check, oldest check first. */
export async function runLedgerHealthMonitor(
  db: Firestore,
  opts: { now?: Date; budgetMs?: number; workspaceIds?: string[] } = {},
): Promise<{ checked: number; notified: number; left: number }> {
  const { now = new Date(), budgetMs = 60_000 } = opts;
  const started = Date.now();
  const workspaces = opts.workspaceIds
    ? { docs: (await Promise.all(opts.workspaceIds.map(id => db.collection('workspaces').doc(id).get()))).filter(d => d.exists) }
    : await db.collection('workspaces').get();
  const due: Array<{ id: string; checkedAt: string }> = [];
  for (const doc of workspaces.docs) {
    const ws = doc.data();
    if (!ws || ws.deletedAt) continue;
    const last = ws.ledgerHealth as LedgerHealth | undefined;
    const checkedAt = String(last?.checkedAt || '');
    // checked within the week and nothing added, changed or deleted since: nothing to do
    if (checkedAt && now.getTime() - new Date(checkedAt).getTime() < WEEK_MS && last?.fingerprint === await booksFingerprint(db, doc.id)) continue;
    due.push({ id: doc.id, checkedAt });
  }
  due.sort((a, b) => a.checkedAt.localeCompare(b.checkedAt));
  let checked = 0;
  let notified = 0;
  for (const { id } of due) {
    if (Date.now() - started > budgetMs) break;
    try {
      const result = await checkLedgerHealth(db, id, now);
      if (result) { checked++; if (result.newProblems) notified++; }
    } catch (err) {
      logger.warn('ledger health check failed', { workspaceId: id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { checked, notified, left: due.length - checked };
}

export async function runDailyLedgerHealth() {
  const { getDb } = await import('../db/firestore');
  return runLedgerHealthMonitor(getDb());
}
