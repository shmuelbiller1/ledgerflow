// Real document post route + revenue spread route + P&L/balance-sheet routes on isolated Postgres.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';

const url = process.env.LF_TEST_DATABASE_URL;
const valid = url && new URL(url).hostname === '127.0.0.1' && new URL(url).port === '55439' && new URL(url).pathname === '/lf_test';

test('editing a spread invoice reduces invoice revenue below the active deferral schedule', { skip: !valid && 'dedicated local audit database required' }, async () => {
  process.env.DATABASE_URL = url;
  const express = (await import('express')).default;
  const { getDb } = await import('../../src/server/db/firestore');
  const { documentPostRouter } = await import('../../src/server/routes/documentPostRoutes');
  const { revenueSpreadRouter } = await import('../../src/server/routes/prepaidRoutes');
  const { reportRouter } = await import('../../src/server/routes/reportRoutes');
  const db = getDb();
  const ws = `ws_audit_spredit_${crypto.randomBytes(5).toString('hex')}`;
  const id = (s: string) => `${ws}_${s}`;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as never as { user: { uid: string; email: string } }).user = { uid: 'audit-owner', email: 'audit@example.test' };
    next();
  });
  app.use('/api/v1/documents', documentPostRouter);
  app.use('/api/v1/workspaces/:workspaceId/invoices', revenueSpreadRouter);
  app.use('/api/v1/reports', reportRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(r => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    await db.collection('workspaces').doc(ws).set({ uid: 'audit-owner', members: ['audit-owner'], name: 'Synthetic Spread Edit', currency: 'USD', timezone: 'UTC' });
    for (const [key, name, type, category] of [
      ['ar', 'Accounts Receivable', 'asset', 'Receivables'],
      ['cash', 'Cash', 'asset', 'Cash'],
      ['sales', 'Sales', 'revenue', 'Revenue'],
      ['deferred', 'Deferred Revenue', 'liability', 'Current Liabilities'],
    ]) {
      await db.collection('chartAccounts').doc(id(key)).set({ workspaceId: ws, name, type, category });
    }

    async function call(path: string, body?: unknown) {
      const res = await fetch(`${base}${path}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
      const data = await res.json();
      assert.equal(res.status, 200, JSON.stringify(data));
      return data;
    }

    // 1. Create $1,200 invoice on 2026-02-01 and spread over Mar-May ($400/mo)
    await call(`/api/v1/documents/invoices/${id('inv')}/post`, {
      workspaceId: ws, action: 'create',
      data: {
        id: id('inv'), workspaceId: ws, customerId: 'cust', customerName: 'Acme Corp', number: 'INV-1',
        date: '2026-02-01', dueDate: '2026-03-01', status: 'sent', currency: 'USD', amountCents: 120_000, taxAmountCents: 0,
        items: [{ id: 'l1', description: 'Annual plan', quantity: 1, rateCents: 120_000, amountCents: 120_000, accountId: id('sales') }],
      },
    });
    await call(`/api/v1/workspaces/${ws}/invoices/${id('inv')}/spread`, {
      revenueAccountId: id('sales'), deferredAccountId: id('deferred'), amountCents: 120_000, months: 3, startMonth: '2026-03',
    });

    // 2. Edit the invoice down to $300 while the $1,200 revenue schedule is still active
    await call(`/api/v1/documents/invoices/${id('inv')}/post`, {
      workspaceId: ws, action: 'update',
      data: {
        id: id('inv'), workspaceId: ws, customerId: 'cust', customerName: 'Acme Corp', number: 'INV-1',
        date: '2026-02-01', dueDate: '2026-03-01', status: 'sent', currency: 'USD', amountCents: 30_000, taxAmountCents: 0,
        items: [{ id: 'l1', description: 'Reduced plan', quantity: 1, rateCents: 30_000, amountCents: 30_000, accountId: id('sales') }],
      },
    });

    const febPl = await call(`/api/v1/reports/profit-and-loss?workspaceId=${ws}&startDate=2026-02-01&endDate=2026-02-28`);
    const febBs = await call(`/api/v1/reports/balance-sheet?workspaceId=${ws}&asOfDate=2026-02-28`);
    const marPl = await call(`/api/v1/reports/profit-and-loss?workspaceId=${ws}&startDate=2026-03-01&endDate=2026-03-31`);

    // Feb P&L income is $300 - $1,200 = -$900 (-90,000 cents), while Feb BS carries $300 A/R against $1,200 Deferred Revenue!
    assert.equal(febPl.income.total, -90_000);
    assert.equal(febBs.totalAssets, 30_000);
    assert.equal(marPl.income.total, 40_000);
    console.log(JSON.stringify({ editedInvoiceCents: 30_000, activeDeferredScheduleCents: 120_000, febIncomeCents: febPl.income.total, febAssetsCents: febBs.totalAssets, marIncomeCents: marPl.income.total }));
  } finally {
    await new Promise<void>(r => server.close(() => r()));
    for (const table of ['transactions', 'invoices', 'chartAccounts', 'auditLogs', 'idempotencyKeys', 'numberingSeries', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id=$1 or id=$1`, [ws]);
    }
    await db.terminate();
  }
});
