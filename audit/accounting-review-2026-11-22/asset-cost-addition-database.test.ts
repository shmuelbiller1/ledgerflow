// Real asset.costaddition command + runDepreciation service + P&L report route on isolated Postgres.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';

const url = process.env.LF_TEST_DATABASE_URL;
const valid = url && new URL(url).hostname === '127.0.0.1' && new URL(url).port === '55439' && new URL(url).pathname === '/lf_test';

test('capitalized subsequent cost addition is depreciated retroactively back to original purchase date', { skip: !valid && 'dedicated local audit database required' }, async () => {
  process.env.DATABASE_URL = url;
  const express = (await import('express')).default;
  const { getDb } = await import('../../src/server/db/firestore');
  const { commandRouter } = await import('../../src/server/routes/commandRoutes');
  const { reportRouter } = await import('../../src/server/routes/reportRoutes');
  const { runDepreciation } = await import('../../src/server/services/depreciationService');
  const db = getDb();
  const ws = `ws_audit_astadd_${crypto.randomBytes(5).toString('hex')}`;
  const id = (s: string) => `${ws}_${s}`;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as never as { user: { uid: string; email: string } }).user = { uid: 'audit-owner', email: 'audit@example.test' };
    next();
  });
  app.use('/api/v1/commands', commandRouter);
  app.use('/api/v1/reports', reportRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(r => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    await db.collection('workspaces').doc(ws).set({ uid: 'audit-owner', members: ['audit-owner'], name: 'Synthetic Asset CapEx', currency: 'USD' });
    await db.collection('chartAccounts').doc(id('equip')).set({ workspaceId: ws, code: '1500', name: 'Equipment', type: 'asset', category: 'Fixed Assets' });
    await db.collection('chartAccounts').doc(id('accum')).set({ workspaceId: ws, code: '1510', name: 'Accumulated Depreciation', type: 'asset', category: 'Fixed Assets' });
    await db.collection('chartAccounts').doc(id('depexp')).set({ workspaceId: ws, code: '6200', name: 'Depreciation Expense', type: 'expense', category: 'Operating Expenses' });

    // Van bought 2025-01-15 for $12,000, 2-year straight-line ($500/mo), 12 months posted through 2026-01 ($6,000 accumulated).
    await db.collection('assets').doc(id('van')).set({
      id: id('van'),
      workspaceId: ws,
      name: 'Delivery Van',
      purchaseDate: '2025-01-15',
      purchasePriceCents: 1_200_000,
      salvageValueCents: 0,
      usefulLifeYears: 2,
      depreciationMethod: 'straight-line',
      accumulatedDepreciationCents: 600_000,
      depreciatedThrough: '2026-01',
      assetAccountId: id('equip'),
      accumulatedAccountId: id('accum'),
      expenseAccountId: id('depexp'),
      status: 'active',
    });

    // Add $2,400.00 capitalized shelving on 2026-02-10 via real command route:
    const addRes = await fetch(`${base}/api/v1/commands/asset.costaddition`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-operation-id': `op_${ws}` },
      body: JSON.stringify({ workspaceId: ws, input: { assetId: id('van'), date: '2026-02-10', amountCents: 240_000, note: 'Shelving' } }),
    });
    const addBody = await addRes.json();
    assert.equal(addRes.status, 200, JSON.stringify(addBody));

    // Run February 2026 depreciation:
    const dep = await runDepreciation(db, { workspaceId: ws, uid: 'audit-owner', email: 'audit@example.test', month: '2026-02' });
    const pnlRes = await fetch(`${base}/api/v1/reports/profit-and-loss?workspaceId=${ws}&startDate=2026-02-01&endDate=2026-02-28`);
    const pnl = await pnlRes.json() as { expense: { total: number }; netIncome: number };

    // Prospective remaining-life depreciation for Feb 2026: ($6,000 + $2,400) / 12 remaining months = $700.00 (70,000 cents).
    // Actual posted in Feb 2026: 13 * ($14,400 / 24) - $6,000 = $7,800 - $6,000 = $1,800.00 (180,000 cents),
    // retroactively charging 12 months ($1,200.00) of 2025 depreciation on shelving bought in Feb 2026.
    assert.equal(dep.totalCents, 180_000);
    assert.equal(pnl.expense.total, 180_000);
    assert.equal(pnl.netIncome, -180_000);
    console.log(JSON.stringify({ feb2026PostedDepreciationCents: dep.totalCents, feb2026PnlExpensesCents: pnl.expense.total, expectedProspectiveFeb2026Cents: 70_000, retroactive2025CatchUpCents: 120_000 }));
  } finally {
    await new Promise<void>(r => server.close(() => r()));
    for (const table of ['transactions', 'assets', 'chartAccounts', 'auditLogs', 'idempotencyKeys', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id=$1 or id=$1`, [ws]);
    }
    await db.terminate();
  }
});
