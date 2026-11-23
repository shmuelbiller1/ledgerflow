/**
 * FA-01: a capitalized subsequent cost depreciates prospectively over the life remaining on the
 * month it was capitalized — never a retroactive catch-up to the purchase date — and cost
 * additions on disposed assets are refused.
 * Audit scenario (PR #1002, `asset-cost-addition-database.test.ts`) with the assertions inverted
 * to the correct accounting result.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { startAuditApp, cleanupAuditWorkspace, auditDbValid, type ChartAcc } from './helpers/auditTestApp';

const assetAccounts: ChartAcc[] = [
  { key: 'equip', name: 'Equipment', type: 'asset', category: 'Fixed Assets' },
  { key: 'accum', name: 'Accumulated Depreciation', type: 'asset', category: 'Fixed Assets' },
  { key: 'depexp', name: 'Depreciation Expense', type: 'expense', category: 'Operating Expenses' },
];

async function commandRoutes(): Promise<Array<[string, unknown]>> {
  const { commandRouter } = await import('../server/routes/commandRoutes');
  return [['/api/v1/commands', commandRouter]];
}

async function commandReportRoutes(): Promise<Array<[string, unknown]>> {
  const { commandRouter } = await import('../server/routes/commandRoutes');
  const { reportRouter } = await import('../server/routes/reportRoutes');
  return [['/api/v1/commands', commandRouter], ['/api/v1/reports', reportRouter]];
}

test('a cost addition is depreciated prospectively over the remaining life, not retroactively', { skip: !auditDbValid && 'dedicated local audit database required' }, async () => {
  const app = await startAuditApp('astadd', assetAccounts, await commandReportRoutes());
  try {
    // Van bought 2025-01-15 for $12,000, 2-year straight-line ($500/mo), 12 months posted through 2026-01 ($6,000 accumulated).
    await app.db.collection('assets').doc(app.id('van')).set({
      id: app.id('van'),
      workspaceId: app.ws,
      name: 'Delivery Van',
      purchaseDate: '2025-01-15',
      purchasePriceCents: 1_200_000,
      salvageValueCents: 0,
      usefulLifeYears: 2,
      depreciationMethod: 'straight-line',
      accumulatedDepreciationCents: 600_000,
      depreciatedThrough: '2026-01',
      assetAccountId: app.id('equip'),
      accumulatedAccountId: app.id('accum'),
      expenseAccountId: app.id('depexp'),
      status: 'active',
    });

    // Add $2,400.00 capitalized shelving on 2026-02-10 via the real command route
    const addRes = await fetch(`${app.base}/api/v1/commands/asset.costaddition`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-operation-id': `op_${app.ws}` },
      body: JSON.stringify({ workspaceId: app.ws, input: { assetId: app.id('van'), date: '2026-02-10', amountCents: 240_000, note: 'Shelving' } }),
    });
    const addBody = await addRes.json();
    assert.equal(addRes.status, 200, JSON.stringify(addBody));

    // Run February 2026 depreciation: prospective remaining-life only
    const { runDepreciation } = await import('../server/services/depreciationService');
    const dep = await runDepreciation(app.db, { workspaceId: app.ws, uid: 'audit-owner', email: 'audit@example.test', month: '2026-02' });
    // $500 (original, 12 months left) + $2,400 / 12 remaining months = $700.00 — no 2025 catch-up
    assert.equal(dep.totalCents, 70_000, 'Feb 2026 posts prospective depreciation only');
    const pnlRes = await fetch(`${app.base}/api/v1/reports/profit-and-loss?workspaceId=${app.ws}&startDate=2026-02-01&endDate=2026-02-28`);
    const pnl = await pnlRes.json() as { expense: { total: number }; netIncome: number };
    assert.equal(pnl.expense.total, 70_000);
    assert.equal(pnl.netIncome, -70_000);

    // A later month keeps the prospective amount ($700/mo), not the understated $600/mo
    const dep2 = await runDepreciation(app.db, { workspaceId: app.ws, uid: 'audit-owner', email: 'audit@example.test', month: '2026-03' });
    assert.equal(dep2.totalCents, 70_000, 'March 2026 continues at the prospective rate');

    // Re-running February posts nothing (the run is idempotent through the accumulated total)
    const dep3 = await runDepreciation(app.db, { workspaceId: app.ws, uid: 'audit-owner', email: 'audit@example.test', month: '2026-02' });
    assert.equal(dep3.totalCents, 0, 'a re-run of a covered month posts nothing');
  } finally {
    await app.close();
    await cleanupAuditWorkspace(app.db, app.ws);
  }
});

test('a cost addition on a disposed asset is refused', { skip: !auditDbValid && 'dedicated local audit database required' }, async () => {
  const app = await startAuditApp('astdisp', assetAccounts, await commandRoutes());
  try {
    await app.db.collection('assets').doc(app.id('sold')).set({
      id: app.id('sold'), workspaceId: app.ws, name: 'Sold Machine', purchaseDate: '2024-01-01',
      purchasePriceCents: 100_000, salvageValueCents: 0, usefulLifeYears: 5, depreciationMethod: 'straight-line',
      accumulatedDepreciationCents: 50_000, status: 'disposed', disposedOn: '2026-01-15',
    });
    const res = await fetch(`${app.base}/api/v1/commands/asset.costaddition`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-operation-id': `op_${app.ws}_2` },
      body: JSON.stringify({ workspaceId: app.ws, input: { assetId: app.id('sold'), date: '2026-02-10', amountCents: 50_000, note: 'Retrofit' } }),
    });
    assert.equal(res.status, 409);
    const asset = (await app.db.collection('assets').doc(app.id('sold')).get()).data();
    assert.equal(asset?.purchasePriceCents, 100_000, 'the refusal changed nothing');
    assert.equal(Array.isArray(asset?.costAdditions) ? asset!.costAdditions.length : 0, 0);
  } finally {
    await app.close();
    await cleanupAuditWorkspace(app.db, app.ws);
  }
});
