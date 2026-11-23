/**
 * Audit RP-06 (reporting review, 22 Nov 2026), as an acceptance test: the report database query
 * must not drop timestamped entries dated on the inclusive end date. The audit worked case: two
 * balanced $100 revenue journals, one dated '2026-05-31' and one dated '2026-05-31T12:00:00Z'.
 * Both belong to the May 31 business date, so the /profit-and-loss route must return $200 of
 * May revenue, not $100. The route runs against synthetic isolated Postgres with a test-injected
 * identity; the timestamped entry is seeded directly (legacy-format data), as in the audit.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';

const url = process.env.LF_TEST_DATABASE_URL;
const valid = !!url && new URL(url).hostname === '127.0.0.1' && new URL(url).port === '55439' && new URL(url).pathname === '/lf_test';

describe('audit RP-06: report queries include timestamped entries on the end date', { skip: !valid && 'dedicated local audit database required' }, () => {
  test('the May P&L includes the timestamped journal on 2026-05-31', async () => {
    process.env.DATABASE_URL = url;
    const { getDb } = await import('../server/db/firestore');
    const { reportRouter } = await import('../server/routes/reportRoutes');
    const db = getDb();
    const ws = `ws_audit_rp06_${crypto.randomBytes(5).toString('hex')}`;
    const id = (s: string) => `${ws}_${s}`;
    let server: ReturnType<typeof import('http').createServer> | undefined;

    try {
      await db.collection('workspaces').doc(ws).set({ uid: 'audit-owner', members: ['audit-owner'], name: 'Synthetic timestamps', currency: 'USD', timezone: 'UTC' });
      for (const [key, name, type, category, role] of [['sales', 'Sales', 'revenue', 'Revenue', ''], ['cash', 'Cash', 'asset', 'Cash', 'cash']]) {
        await db.collection('chartAccounts').doc(id(key)).set({ workspaceId: ws, name, type, category, ...(role ? { role } : {}) });
      }
      // two balanced $100 revenue journals: one date-only, one a timestamped legacy-format entry
      // dated the same business day
      for (const [key, date] of [['a', '2026-05-31'], ['b', '2026-05-31T12:00:00Z']] as const) {
        await db.collection('transactions').doc(id(`tx_${key}`)).set({
          id: id(`tx_${key}`), workspaceId: ws, uid: 'audit-owner', date, status: 'completed', type: 'actual',
          currency: 'USD', exchangeRate: 1, description: `Revenue ${key}`,
          lines: [{ accountId: id('cash'), amountCents: 10000 }, { accountId: id('sales'), amountCents: -10000 }],
        });
      }
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => { (req as never as { user: { uid: string } }).user = { uid: 'audit-owner' }; next(); });
      app.use('/api/v1/reports', reportRouter);
      server = app.listen(0, '127.0.0.1');
      await new Promise<void>(r => server!.once('listening', r));
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

      const res = await fetch(`${base}/api/v1/reports/profit-and-loss?workspaceId=${ws}&startDate=2026-05-01&endDate=2026-05-31&_read=${Date.now()}`);
      const data = await res.json() as { income: { total: number }; expense: { total: number }; netIncome: number };
      assert.equal(res.status, 200, JSON.stringify(data));
      assert.equal(data.income.total, 20000, 'both May 31 journals count: the timestamped one must not be dropped by the end-date query');
      assert.equal(data.netIncome, 20000);
      console.log(JSON.stringify({ income: data.income.total, netIncome: data.netIncome }));
    } finally {
      if (server) { const srv = server; await new Promise<void>(r => srv.close(() => r())).catch(() => {}); }
      for (const table of ['transactions', 'chartAccounts', 'auditLogs', 'workspaces']) {
        await db.pool.query(`delete from public."${table}" where workspace_id=$1 or id=$1`, [ws]).catch(() => {});
      }
    }
  });
});
