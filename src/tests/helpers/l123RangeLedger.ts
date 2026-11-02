/**
 * The hand-worked ledger of the L-123 step 4 range-report tests (4a top lines, 4d expense categories) and the database
 * harness that serves GET /api/v1/balances/<path> over it. Year Y = this year; amounts in cents.
 *   E1 Y-01-05  Rent +900 / Cash −900          E5 Y-03-01  Cash +800 / Sales −800
 *   E2 Y-01-12  Cash +1,500 / Sales −1,500     E6 Y-03-15  Fuel +200 / Cash −200
 *   E3 Y-02-03  Fuel +300 / Cash −300          E7 Y-04-02  Cash +300 / Fuel −300, a reversal of E3
 *   E4 Y-02-10  Rent +700 / Cash −700
 * The loaded list (capped) is the newest four, E4…E7: oldest loaded day Y-02-10.
 */
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { workspaceYearMonth } from '../../lib/utils';
import type { ChartAccount, Transaction, TransactionLine } from '../../types';
import type { Firestore } from '../../server/db/pgFirestore';

export const Y = workspaceYearMonth().year;
export const from = `${Y}-01-01`, to = `${Y}-12-31`;
export const OWNER = 'owner-1';

export const chart = (ws: string): ChartAccount[] => [
  { id: `${ws}_cash`, workspaceId: ws, uid: OWNER, code: '1000', name: 'Cash', type: 'asset', category: 'Cash' } as ChartAccount,
  { id: `${ws}_sales`, workspaceId: ws, uid: OWNER, code: '4000', name: 'Sales', type: 'income', category: 'Sales' } as ChartAccount,
  { id: `${ws}_rent`, workspaceId: ws, uid: OWNER, code: '6000', name: 'Rent', type: 'expense', category: 'Rent' } as ChartAccount,
  { id: `${ws}_fuel`, workspaceId: ws, uid: OWNER, code: '6100', name: 'Fuel', type: 'expense', category: 'Fuel' } as ChartAccount,
];

const LINES: Array<[string, Array<[string, number]>]> = [
  ['01-05', [['rent', 900], ['cash', -900]]],
  ['01-12', [['cash', 1500], ['sales', -1500]]],
  ['02-03', [['fuel', 300], ['cash', -300]]],
  ['02-10', [['rent', 700], ['cash', -700]]],
  ['03-01', [['cash', 800], ['sales', -800]]],
  ['03-15', [['fuel', 200], ['cash', -200]]],
  ['04-02', [['cash', 300], ['fuel', -300]]],
];

/** The seven entries; `lineExtra(k, account)` adds fields to entry k's line on that account (e.g. its own category). */
export const entries = (ws: string, lineExtra: (k: number, account: string) => Partial<TransactionLine> = () => ({})): Transaction[] =>
  LINES.map(([day, lines], k) => ({
    id: `${ws}_e${k + 1}`, workspaceId: ws, uid: OWNER, date: `${Y}-${day}`, description: `E${k + 1}`,
    totalAmountCents: Math.max(...lines.map(([, c]) => Math.abs(c))), currency: 'USD', status: 'completed', type: 'journal',
    ...(k === 6 ? { metadata: { isReversal: true, reversesTxId: `${ws}_e3` } } : {}),
    lines: lines.map(([a, amountCents]) => ({ accountId: `${ws}_${a}`, amountCents, ...lineExtra(k, a) })),
  }) as Transaction);

export const loadedOf = (all: Transaction[]) => all.slice(3);

/**
 * Serves the balance routes over `rows` in the test database (LF_TEST_DATABASE_URL), for `before`/`after`. `get(path,
 * query, uid)` answers status and body.
 */
export function balanceRouteHarness(url: string | undefined, name: string, rows: (ws: string) => { accounts: ChartAccount[]; entries: Transaction[] }) {
  const ws = `ws_${name}_${crypto.randomBytes(4).toString('hex')}`;
  const realFetch = globalThis.fetch;
  let db: Firestore;
  let server: Server;
  let base = '';
  return {
    ws,
    async start() {
      process.env.DATABASE_URL = url;
      const express = (await import('express')).default;
      const { getDb } = await import('../../server/db/firestore');
      db = getDb();
      const app = express();
      app.use((req, _res, next) => { (req as unknown as { user: { uid: string } }).user = { uid: String(req.header('x-test-uid')) }; next(); });
      app.use('/api/v1/balances', (await import('../../server/routes/balanceRoutes')).balanceRouter);
      server = app.listen(0);
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const data = rows(ws);
      await db.collection('workspaces').doc(ws).set({ uid: OWNER, name, currency: 'USD', timezone: 'UTC', members: [OWNER] });
      await db.pool.query(`insert into public."chartAccounts" (id, data) select a->>'id', a from jsonb_array_elements($1::jsonb) a`, [JSON.stringify(data.accounts)]);
      await db.pool.query(`insert into public.transactions (id, data) select t->>'id', t from jsonb_array_elements($1::jsonb) t`, [JSON.stringify(data.entries)]);
    },
    async stop() {
      server?.close();
      for (const table of ['transactions', 'chartAccounts', 'workspaces']) {
        await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]).catch(() => {});
      }
      const { getSupabase } = await import('../../lib/db/client');
      getSupabase().realtime.disconnect();
      await getSupabase().auth.dispose();
      await db.terminate();
    },
    async get<B>(path: string, q: Record<string, string>, uid = OWNER): Promise<{ status: number; body: B }> {
      const res = await realFetch(`${base}/api/v1/balances/${path}?${new URLSearchParams(q)}`, { headers: { 'x-test-uid': uid } });
      return { status: res.status, body: await res.json() as B };
    },
  };
}
