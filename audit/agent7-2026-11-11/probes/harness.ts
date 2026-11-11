/**
 * Agent #7 audit harness (review-only). Boots the app's REAL routers in-process against the disposable local test
 * database (LF_TEST_DATABASE_URL — never a real one), with a stand-in for sign-in that names the caller, exactly as
 * the repository's own database tests do (src/tests/w3w4-gold.test.ts, l94-step2-document-post.test.ts).
 * Everything a probe reports is read back from the database or from the app's own report routes.
 */
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { isPostable, lineAmount } from '../../../src/lib/txFilters';
import type { Transaction } from '../../../src/types';

export const DB_URL = process.env.LF_TEST_DATABASE_URL;
export type Db = import('../../../src/server/db/pgFirestore').Firestore;

export interface Books {
  ws: string;
  db: Db;
  base: string;
  OWNER: string;
  BOOKKEEPER: string;
  VIEWER: string;
  acct: Record<string, string>;
  send(uid: string, method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any
  entries(): Promise<Array<Transaction & { id: string }>>;
  /** every account's balance in the home currency, from the posted entries (what reports read: lineAmount) */
  balances(): Promise<Record<string, number>>;
  /** entries that count and do not balance, in their own currency or in the home currency */
  unbalanced(): Promise<Array<{ id: string; own: number; home: number; type: unknown }>>;
  /** the app's own Data Health checks (lib/dataChecks.ts), fed as the nightly monitor feeds them (ledgerHealthService.ts) */
  dataHealth(today?: string): Promise<Array<{ checkId: string; severity: string; title: string }>>;
  /**
   * Runs SQL as a signed-in browser session of `uid`: the `authenticated` database role with the user's claims, exactly
   * as supabase/tests/rls.test.sql does. This is what the Supabase client in the browser can send (PostgREST / lf_* RPC).
   */
  asBrowser(uid: string, sql: string, params?: unknown[]): Promise<{ ok: boolean; error?: string; rows?: unknown[] }>;
  close(): Promise<void>;
}

const CHART: Array<{ key: string; name: string; type: string; category?: string; code: string; role?: string }> = [
  { key: 'bank', name: 'Bank', type: 'asset', category: 'Cash', code: '1000' },
  { key: 'ar', name: 'Accounts Receivable', type: 'asset', category: 'Receivables', code: '1100' },
  { key: 'vatin', name: 'VAT Receivable', type: 'asset', category: 'Tax', code: '1300' },
  { key: 'ap', name: 'Accounts Payable', type: 'liability', category: 'Payables', code: '2000' },
  { key: 'vat', name: 'VAT Payable', type: 'liability', category: 'Tax', code: '2200' },
  { key: 'deposits', name: 'Customer Deposits', type: 'liability', category: 'Deposits', code: '2300' },
  { key: 'obe', name: 'Opening Balance Equity', type: 'equity', code: '3900' },
  { key: 'sales', name: 'Sales', type: 'income', code: '4000' },
  { key: 'sales2', name: 'Service Income', type: 'income', code: '4100' },
  { key: 'supplies', name: 'Office Supplies', type: 'expense', code: '6000' },
  { key: 'fx', name: 'Exchange gain or loss', type: 'expense', category: 'Rounding Differences', code: '7900' },
];

export async function openBooks(label: string, currency = 'USD'): Promise<Books> {
  if (!DB_URL) throw new Error('LF_TEST_DATABASE_URL not set');
  if (/supabase\.(co|com)/.test(DB_URL)) throw new Error('Refusing to run audit probes against a hosted database');
  process.env.DATABASE_URL = DB_URL;
  const ws = `ws_a7_${label}_${crypto.randomBytes(4).toString('hex')}`;
  const OWNER = `owner-${ws}`, BOOKKEEPER = `bookkeeper-${ws}`, VIEWER = `viewer-${ws}`;
  const db = (await import('../../../src/server/db/firestore')).getDb() as unknown as Db;
  const acct: Record<string, string> = {};
  for (const a of CHART) {
    acct[a.key] = `${ws}_${a.key}`;
    const { key: _key, ...rest } = a; void _key;
    await db.collection('chartAccounts').doc(acct[a.key]).set({ ...rest, id: acct[a.key], workspaceId: ws } as never);
  }
  await db.collection('workspaces').doc(ws).set({
    id: ws, uid: OWNER, name: `Agent 7 audit ${label}`, currency, timezone: 'UTC',
    members: [OWNER, BOOKKEEPER, VIEWER], roles: { [OWNER]: 'owner', [BOOKKEEPER]: 'bookkeeper', [VIEWER]: 'viewer' },
    defaultAccountMappings: { ar: acct.ar, ap: acct.ap, revenue: acct.sales, tax: acct.vat },
  } as never);

  const express = (await import('express')).default;
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use((req, _res, next) => { (req as unknown as { user: unknown }).user = { uid: String(req.header('x-test-uid')), email: `${req.header('x-test-uid')}@audit.test` }; req.body ??= {}; next(); });
  // the same mount points as server.ts
  app.use('/api/v1/workspaces', (await import('../../../src/server/routes/workspaceRoutes')).workspaceRouter);
  app.use('/api/v1/transactions', (await import('../../../src/server/routes/transactionRoutes')).transactionRouter);
  app.use('/api/v1/documents', (await import('../../../src/server/routes/documentRoutes')).documentRouter);
  app.use('/api/v1/payments', (await import('../../../src/server/routes/paymentRoutes')).paymentRouter);
  app.use('/api/v1/reports', (await import('../../../src/server/routes/reportRoutes')).reportRouter);
  const server: Server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const send: Books['send'] = async (uid, method, path, body, headers = {}) => {
    const res = await fetch(`${base}${path}`, {
      method, headers: { 'content-type': 'application/json', 'x-test-uid': uid, ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: parsed };
  };
  const entries: Books['entries'] = async () => (await db.collection('transactions').where('workspaceId', '==', ws).get()).docs
    .map(d => ({ ...(d.data() as Transaction), id: d.id }));
  const balances: Books['balances'] = async () => {
    const out: Record<string, number> = {};
    for (const t of (await entries()).filter(e => isPostable(e))) for (const l of t.lines || []) out[l.accountId] = (out[l.accountId] || 0) + lineAmount(l, t);
    return out;
  };
  const unbalanced: Books['unbalanced'] = async () => (await entries()).filter(e => isPostable(e)).map(t => ({
    id: t.id, type: t.metadata?.type ?? t.type,
    own: (t.lines || []).reduce((s, l) => s + (l.amountCents || 0), 0),
    home: (t.lines || []).reduce((s, l) => s + lineAmount(l, t), 0),
  })).filter(x => x.own !== 0 || x.home !== 0);

  const dataHealth: Books['dataHealth'] = async (today = '2026-12-31') => {
    const { runDataChecks } = await import('../../../src/lib/dataChecks');
    const sources: Record<string, string> = { transactions: 'transactions', accounts: 'chartAccounts', invoices: 'invoices', bills: 'bills', recurring: 'recurring',
      inventory: 'inventory', bankLines: 'bankLines', payments: 'payments', reconciliations: 'reconciliations', stockMoves: 'stockMoves', stockClosings: 'stockClosings', allocations: 'paymentAllocations' };
    const data: Record<string, unknown> = {};
    for (const [key, table] of Object.entries(sources)) data[key] = (await db.collection(table).where('workspaceId', '==', ws).get()).docs.map(d => ({ ...d.data(), id: d.id }));
    const findings = runDataChecks({ ...data, truncated: [], today, baseCurrency: currency } as unknown as Parameters<typeof runDataChecks>[0]);
    return findings.map(f => ({ checkId: f.checkId, severity: f.severity, title: f.title }));
  };
  const asBrowser: Books['asBrowser'] = async (uid, sql, params = []) => {
    const client = await db.pool.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'authenticated', sub: uid, email: `${uid}@audit.test` })]);
      await client.query('set local role authenticated');
      const result = await client.query(sql, params);
      await client.query('commit');
      return { ok: true, rows: result.rows };
    } catch (err) {
      await client.query('rollback').catch(() => {});
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      client.release();
    }
  };

  const close = async () => {
    server.close();
    const tables = (await db.pool.query(`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'workspace_id'`)).rows.map(r => r.table_name as string);
    for (const table of tables) await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]).catch(() => {});
    await db.pool.query(`delete from public."workspaces" where id = $1`, [ws]).catch(() => {});
  };
  return { ws, db, base, OWNER, BOOKKEEPER, VIEWER, acct, send, entries, balances, unbalanced, dataHealth, asBrowser, close };
}

export const money = (cents: number) => `${cents < 0 ? '-' : ''}${(Math.abs(cents) / 100).toFixed(2)}`;
export const named = (b: Books, balances: Record<string, number>) => Object.fromEntries(Object.entries(balances).filter(([, v]) => v !== 0).map(([id, v]) => [id.replace(`${b.ws}_`, ''), v]));
