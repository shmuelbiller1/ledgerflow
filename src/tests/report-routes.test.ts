/**
 * Server report routes against the database (GET /api/v1/reports/aging and /budget-vs-actual).
 * Fixed: aging ignored deposits, foreign currency and approved bills; budget-vs-actual read
 * `accountId`, which budgets don't have (they keep `targetId`), and summed raw line amounts.
 * AUD-10: P&L, balance sheet, trial balance, cash flow and general ledger say where they come from
 * (`provenance`): the server reads every entry; a P&L or balance sheet from the 60-second cache says when.
 * Runs when LF_TEST_DATABASE_URL is set.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Firestore } from '../server/db/pgFirestore';

const url = process.env.LF_TEST_DATABASE_URL;

describe('Report routes', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const suffix = crypto.randomBytes(4).toString('hex');
  const ws = `ws_rep_${suffix}`;
  const id = (name: string) => `${ws}_${name}`;
  let server: Server;
  let base = '';
  let db: Firestore;

  const get = async (path: string) => {
    const res = await fetch(`${base}/api/v1/reports${path}`, { headers: { 'x-test-uid': 'owner-1' } });
    return { status: res.status, body: await res.json() as Record<string, unknown> & Array<Record<string, unknown>> };
  };

  before(async () => {
    process.env.DATABASE_URL = url;
    const express = (await import('express')).default;
    const { reportRouter } = await import('../server/routes/reportRoutes');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({ uid: 'owner-1', name: 'Reports', currency: 'USD', members: ['owner-1'] });
    const set = (collection: string, name: string, fields: Record<string, unknown>) => db.collection(collection).doc(id(name)).set({ workspaceId: ws, ...fields });
    // receivables: 1000 with a 300 deposit and 200 paid → 500 owed, not due yet; EUR 100 at 1.1 → 110 overdue
    await set('invoices', 'i1', { customerId: 'c', amountCents: 1000, depositCents: 300, amountPaidCents: 200, status: 'partially_paid', dueDate: '2099-01-01' });
    await set('invoices', 'i2', { customerId: 'c', amountCents: 100, exchangeRate: 1.1, currency: 'EUR', status: 'sent', dueDate: '2000-01-01' });
    await set('invoices', 'i3', { customerId: 'c', amountCents: 999, status: 'draft', dueDate: '2000-01-01' });
    await set('invoices', 'i4', { customerId: 'c', amountCents: 999, status: 'cancelled', dueDate: '2000-01-01' });
    // payables: an approved bill is owed
    await set('bills', 'b1', { vendorId: 'v', amountCents: 700, status: 'approved', dueDate: '2099-01-01' });
    // budget for an account named by id, and one by name; spending in EUR at 1.1
    await set('chartAccounts', 'rent', { name: 'Rent', type: 'expense', code: '6100' });
    await set('chartAccounts', 'bank', { name: 'Checking', type: 'asset', code: '1000' });
    await set('budgets', 'bud1', { targetId: id('rent'), targetType: 'account', period: 'monthly', amountCents: 2000 });
    await set('budgets', 'bud2', { targetId: 'Rent', targetType: 'account', period: 'monthly', amountCents: 1000 });
    await set('transactions', 't1', {
      date: '2026-05-10', status: 'completed', exchangeRate: 1.1, description: 'May rent',
      lines: [{ accountId: id('rent'), amountCents: 1000 }, { accountId: id('bank'), amountCents: -1000 }],
    });
    await set('transactions', 't2', {
      date: '2026-05-11', status: 'draft', description: 'Draft rent',
      lines: [{ accountId: id('rent'), amountCents: 5000 }, { accountId: id('bank'), amountCents: -5000 }],
    });

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string } }).user = { uid: String(req.header('x-test-uid')) }; next(); });
    app.use('/api/v1/reports', reportRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    for (const table of ['invoices', 'bills', 'budgets', 'transactions', 'chartAccounts', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]);
    }
    await db.terminate();
  });

  test('receivables aging: deposit and payments taken off, base currency, drafts and cancelled left out', async () => {
    const { status, body } = await get(`/aging?workspaceId=${ws}&type=ar`);
    assert.equal(status, 200);
    assert.equal(body.current, 500);
    assert.equal(body['90+'], 110);
    assert.equal(body.total, 610);
  });

  test('payables aging counts approved bills', async () => {
    const { body } = await get(`/aging?workspaceId=${ws}&type=ap`);
    assert.equal(body.current, 700);
    assert.equal(body.total, 700);
  });

  test('budget vs actual finds the account by id or name and uses posted entries in the base currency', async () => {
    const { status, body } = await get(`/budget-vs-actual?workspaceId=${ws}&month=2026-05`);
    assert.equal(status, 200);
    const rows = body as unknown as Array<{ accountName: string; budget: number; actual: number; variance: number }>;
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.accountName, 'Rent');
      assert.equal(row.actual, 1100);
    }
    assert.deepEqual(rows.map(r => r.variance).sort((a, b) => a - b), [-100, 900]);
  });

  // AUD-10: report routes cache by URL; each test reads its own URL (`_read`)
  test('P&L: fresh answer is complete with no cache time; the repeat within a minute is the cached one and says when', async () => {
    const path = `/profit-and-loss?workspaceId=${ws}&startDate=2026-05-01&endDate=2026-05-31&_read=aud10-pl`;
    const before = Date.now();
    const first = await get(path);
    assert.equal(first.status, 200);
    // posted May rent 1000 at 1.1 = 1100; the draft is left out
    assert.equal((first.body.expense as { total: number }).total, 1100);
    assert.equal(first.body.netIncome, -1100);
    assert.deepEqual(first.body.provenance, { source: 'server', completeness: 'complete' });
    // a new posted entry of 400 inside the minute: the cached answer still says 1100, and when it was worked out
    await db.collection('transactions').doc(id('t3')).set({ workspaceId: ws, date: '2026-05-12', status: 'completed', description: 'More rent',
      lines: [{ accountId: id('rent'), amountCents: 400 }, { accountId: id('bank'), amountCents: -400 }] });
    try {
      const second = await get(path);
      assert.equal((second.body.expense as { total: number }).total, 1100);
      const p = second.body.provenance as { source: string; completeness: string; cachedAt: string };
      assert.equal(p.source, 'server');
      assert.equal(p.completeness, 'complete');
      const at = Date.parse(p.cachedAt);
      assert.ok(at >= before - 1000 && at <= Date.now(), `cachedAt ${p.cachedAt} is when the first answer was worked out`);
      const { provenance: _a, ...figures1 } = first.body; const { provenance: _b, ...figures2 } = second.body;
      assert.deepEqual(figures2, figures1, 'the cache changes no figure');
      // a new URL reads again: 1100 + 400 = 1500, fresh
      const third = await get(`${path}-2`);
      assert.equal((third.body.expense as { total: number }).total, 1500);
      assert.deepEqual(third.body.provenance, { source: 'server', completeness: 'complete' });
    } finally {
      await db.collection('transactions').doc(id('t3')).delete();
    }
  });

  test('P&L: someone removed from the workspace is refused, even while the figures are cached (AF-015)', async () => {
    const path = `/profit-and-loss?workspaceId=${ws}&startDate=2026-05-01&endDate=2026-05-31&_read=af015`;
    const as = (uid: string) => fetch(`${base}/api/v1/reports${path}`, { headers: { 'x-test-uid': uid } });
    await db.collection('workspaces').doc(ws).update({ members: ['owner-1', 'member-2'] });
    try {
      assert.equal((await as('member-2')).status, 200, 'a member reads it, and it is cached');
      await db.collection('workspaces').doc(ws).update({ members: ['owner-1'] });
      assert.equal((await as('member-2')).status, 403, 'the cached answer is not served once membership is gone');
    } finally {
      await db.collection('workspaces').doc(ws).update({ members: ['owner-1'] });
    }
  });

  test('balance sheet: fresh then cached, same figures (bank -1100)', async () => {
    const path = `/balance-sheet?workspaceId=${ws}&endDate=2026-05-31&_read=aud10-bs`;
    const first = await get(path);
    assert.equal(first.status, 200);
    assert.equal((first.body.assets as Record<string, number>)[id('bank')], -1100);
    assert.deepEqual(first.body.provenance, { source: 'server', completeness: 'complete' });
    const second = await get(path);
    assert.equal((second.body.assets as Record<string, number>)[id('bank')], -1100);
    assert.equal(typeof (second.body.provenance as { cachedAt?: string }).cachedAt, 'string');
  });

  test('trial balance, cash flow and general ledger are never cached: complete, no cache time, even repeated', async () => {
    for (const path of [`/trial-balance?workspaceId=${ws}&asOfDate=2026-05-31&_read=aud10`, `/cash-flow?workspaceId=${ws}&startDate=2026-05-01&endDate=2026-05-31&_read=aud10`,
      `/general-ledger?workspaceId=${ws}&startDate=2026-05-01&endDate=2026-05-31&_read=aud10`]) {
      for (let i = 0; i < 2; i++) {
        const { status, body } = await get(path);
        assert.equal(status, 200, path);
        assert.deepEqual(body.provenance, { source: 'server', completeness: 'complete' }, path);
      }
    }
    const tb = await get(`/trial-balance?workspaceId=${ws}&asOfDate=2026-05-31&_read=aud10-figures`);
    assert.equal(tb.body.totalDebit, 1100);
    assert.equal(tb.body.totalCredit, 1100);
  });
});
