// Real workspace opening-balances route + balance-sheet route in a JPY workspace on isolated Postgres.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { TruthEngine } from '../../src/modules/integrity/TruthEngine';
import { formatMoney } from '../../src/lib/moneyFormat';

const url = process.env.LF_TEST_DATABASE_URL;
const valid = url && new URL(url).hostname === '127.0.0.1' && new URL(url).port === '55439' && new URL(url).pathname === '/lf_test';

test('JPY opening balance payload produced by OpeningBalancesSetup posts 100x yen to the balance sheet', { skip: !valid && 'dedicated local audit database required' }, async () => {
  process.env.DATABASE_URL = url;
  const express = (await import('express')).default;
  const { getDb } = await import('../../src/server/db/firestore');
  const { workspaceRouter } = await import('../../src/server/routes/workspaceRoutes');
  const { reportRouter } = await import('../../src/server/routes/reportRoutes');
  const db = getDb();
  const ws = `ws_audit_objpy_${crypto.randomBytes(5).toString('hex')}`;
  const id = (s: string) => `${ws}_${s}`;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as never as { user: { uid: string; email: string } }).user = { uid: 'audit-owner', email: 'audit@example.test' };
    next();
  });
  app.use('/api/v1/workspaces', workspaceRouter);
  app.use('/api/v1/reports', reportRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(r => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    await db.collection('workspaces').doc(ws).set({ uid: 'audit-owner', members: ['audit-owner'], name: 'Synthetic Tokyo Books', currency: 'JPY' });
    await db.collection('chartAccounts').doc(id('bank')).set({ workspaceId: ws, code: '1010', name: 'Checking', type: 'asset', category: 'Cash' });
    await db.collection('chartAccounts').doc(id('obe')).set({ workspaceId: ws, code: '3900', name: 'Opening Balance Equity', type: 'equity', subtype: 'opening_balance_equity' });

    // Exact conversion OpeningBalancesSetup.tsx:30 runs when user types '1000000' in Balance (JPY):
    const uiAmountMinorUnits = TruthEngine.parseAmountToCentsOrZero('1000000');
    assert.equal(uiAmountMinorUnits, 100_000_000);

    const postRes = await fetch(`${base}/api/v1/workspaces/${ws}/opening-balances`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ date: '2026-01-01', balances: [{ accountId: id('bank'), amountCents: uiAmountMinorUnits }] }),
    });
    const postBody = await postRes.json();
    assert.equal(postRes.status, 200, JSON.stringify(postBody));

    const bsRes = await fetch(`${base}/api/v1/reports/balance-sheet?workspaceId=${ws}&asOfDate=2026-01-31`);
    const bs = await bsRes.json() as { totalAssets: number; totalClaims: number; isBalanced: boolean };
    assert.equal(bsRes.status, 200);
    assert.equal(bs.totalAssets, 100_000_000);
    assert.equal(bs.isBalanced, true);
    assert.equal(formatMoney(bs.totalAssets, 'JPY', { locale: 'en-US' }), '¥100,000,000');
    console.log(JSON.stringify({ typedMajorJPY: 1_000_000, storedAssets: bs.totalAssets, displayedJPY: formatMoney(bs.totalAssets, 'JPY', { locale: 'en-US' }) }));
  } finally {
    await new Promise<void>(r => server.close(() => r()));
    for (const table of ['transactions', 'chartAccounts', 'auditLogs', 'idempotencyKeys', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id=$1 or id=$1`, [ws]);
    }
    await db.terminate();
  }
});
