/**
 * L-123 step 4c: the fixed-asset register reads every asset and posted depreciation run from the server
 * (GET /api/v1/balances/asset-register) when the browser's assets or entries are capped.
 *
 * Hand-worked case (cents), as of 2026-03-31. Assets: A Equipment cost 30,000; B Vehicles cost 14,000; both bought
 * 2026-01-01, nothing brought in. Depreciation runs:
 *   R1 2026-01-31  A 500, B 200   — in force
 *   R2 2026-02-28  A 500, B 200   — reversed by R2R (metadata.reversesTxId)
 *   R3 2026-03-31  A 500          — reversed by R3R (metadata.reversedTransactionId)
 *   R4 2026-04-30  A 500          — after the date
 * Every run:   A depreciation 500, book 29,500; B 200, book 13,800; totals cost 44,000, depreciation 700, book 43,300
 * The browser holds the newest entries only (R2R, R3, R3R, R4), so R1 is missing:
 *              depreciation 0, book 44,000
 */
import { stubFetch } from './helpers/dom';
import test, { after, afterEach, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import React from 'react';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { setComponentWorkspace } from './helpers/componentFixtures';
import AssetRegisterReportView from '../components/reporting/AssetRegisterReportView';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { formatCurrency } from '../lib/utils';
import { assetRegisterReport, type AssetRegisterReport } from '../lib/assetRegisterReport';
import type { ChartAccount, FixedAsset, Transaction } from '../types';
import type { Firestore } from '../server/db/pgFirestore';

const asOf = '2026-03-31';
const chart = (ws: string): ChartAccount[] => [
  { id: `${ws}_eq`, workspaceId: ws, uid: 'owner-1', code: '1500', name: 'Equipment', type: 'asset', category: 'Fixed Assets' } as ChartAccount,
  { id: `${ws}_veh`, workspaceId: ws, uid: 'owner-1', code: '1510', name: 'Vehicles', type: 'asset', category: 'Fixed Assets' } as ChartAccount,
];
const asset = (ws: string, id: string, cost: number, account: string): FixedAsset => ({
  id: `${ws}_${id}`, uid: 'owner-1', workspaceId: ws, name: id, purchaseDate: '2026-01-01', purchasePriceCents: cost, salvageValueCents: 0,
  usefulLifeYears: 5, depreciationMethod: 'straight-line', accumulatedDepreciationCents: 0, status: 'active', createdAt: '2026-01-01',
  assetAccountId: `${ws}_${account}`,
}) as FixedAsset;
const assets = (ws: string) => [asset(ws, 'A', 30000, 'eq'), asset(ws, 'B', 14000, 'veh')];
const entry = (ws: string, id: string, date: string, metadata: Record<string, unknown>) => ({
  id: `${ws}_${id}`, workspaceId: ws, uid: 'owner-1', date, description: id, totalAmountCents: 0, currency: 'USD', status: 'completed', type: 'journal',
  metadata, lines: [],
}) as unknown as Transaction;
const run = (ws: string, id: string, date: string, parts: Array<[string, number]>) =>
  entry(ws, id, date, { type: 'depreciation-run', month: date.slice(0, 7), assets: parts.map(([a, amountCents]) => ({ assetId: `${ws}_${a}`, amountCents })) });
const entries = (ws: string): Transaction[] => [
  run(ws, 'R1', '2026-01-31', [['A', 500], ['B', 200]]),
  run(ws, 'R2', '2026-02-28', [['A', 500], ['B', 200]]),
  entry(ws, 'R2R', '2026-03-02', { isReversal: true, reversesTxId: `${ws}_R2` }),
  run(ws, 'R3', '2026-03-31', [['A', 500]]),
  entry(ws, 'R3R', '2026-04-02', { isReversal: true, reversedTransactionId: `${ws}_R3` }),
  run(ws, 'R4', '2026-04-30', [['A', 500]]),
];
const brief = (r: Pick<AssetRegisterReport, 'rows'>) => r.rows.map(x => `${x.name} ${x.costCents} ${x.depreciationCents} ${x.bookValueCents}`);
const TRUTH = ['A 30000 500 29500', 'B 14000 200 13800'];

describe('L-123 step 4c: asset register (no database)', () => {
  const ws = 'component-workspace';
  const accounts = chart(ws), all = entries(ws), loaded = all.slice(2);
  afterEach(() => { cleanup(); useLedgerStore.setState({ truncatedCollections: {} }); });

  test('every run gives the hand-worked register; the loaded entries do not', () => {
    const full = assetRegisterReport(assets(ws), accounts, all, asOf);
    assert.deepEqual(brief(full), TRUTH);
    assert.deepEqual([full.totals.costCents, full.totals.depreciationCents, full.totals.bookValueCents], [44000, 700, 43300]);
    assert.deepEqual(brief(assetRegisterReport(assets(ws), accounts, loaded, asOf)), ['A 30000 0 30000', 'B 14000 0 14000']);
  });

  test('screen: no request when not capped; the server\'s register when capped; the loaded one with a note when it fails', async () => {
    setComponentWorkspace('owner');
    useDataNeedsStore.setState(s => ({ failed: {}, loaded: { ...s.loaded, assets: true, transactions: true, accounts: true } }) as never);
    useLedgerStore.setState({ accounts, assets: assets(ws), transactions: loaded, truncatedCollections: {} } as never);
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ status: 'success', ...assetRegisterReport(assets(ws), accounts, all, asOf) }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    render(<AssetRegisterReportView endDate={asOf} />);
    await waitFor(() => assert.ok(document.body.textContent!.includes(formatCurrency(44000)), document.body.textContent!));
    assert.ok(!document.body.textContent!.includes(formatCurrency(43300)));
    assert.equal(screen.queryByTestId('asset-register-source'), null);
    assert.equal(screen.queryByTestId('asset-register-partial'), null);
    assert.equal(urls.filter(u => u.includes('asset-register')).length, 0, 'not capped: no request');
    cleanup();

    useLedgerStore.setState({ truncatedCollections: { transactions: true } });
    render(<AssetRegisterReportView endDate={asOf} />);
    await waitFor(() => assert.ok(document.body.textContent!.includes(formatCurrency(43300)), document.body.textContent!), { timeout: 5000 });
    assert.ok(urls.includes(`/api/v1/balances/asset-register?workspaceId=${ws}&asOf=${asOf}`), urls.join('\n'));
    assert.ok(screen.getByTestId('asset-register-source'));
    assert.equal(screen.queryByTestId('asset-register-partial'), null);
    cleanup();

    stubFetch(500);
    render(<AssetRegisterReportView endDate={asOf} />);
    await waitFor(() => assert.ok(screen.getByTestId('asset-register-partial')));
    assert.ok(!document.body.textContent!.includes(formatCurrency(43300)));
  });
});

const url = process.env.LF_TEST_DATABASE_URL;
const OWNER = 'owner-1';

describe('L-123 step 4c: GET /api/v1/balances/asset-register', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  let db: Firestore;
  let server: Server;
  let base = '';
  const realFetch = globalThis.fetch;
  const ws = `ws_l123h_${crypto.randomBytes(4).toString('hex')}`;
  const get = async (q: Record<string, string>, uid = OWNER) => {
    const res = await realFetch(`${base}/api/v1/balances/asset-register?${new URLSearchParams(q)}`, { headers: { 'x-test-uid': uid } });
    return { status: res.status, body: await res.json() as AssetRegisterReport & { runsRead: number } };
  };
  const insert = (table: string, rows: unknown[]) =>
    db.pool.query(`insert into public."${table}" (id, data) select r->>'id', r from jsonb_array_elements($1::jsonb) r`, [JSON.stringify(rows)]);

  before(async () => {
    process.env.DATABASE_URL = url;
    const express = (await import('express')).default;
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    const app = express();
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string } }).user = { uid: String(req.header('x-test-uid')) }; next(); });
    app.use('/api/v1/balances', (await import('../server/routes/balanceRoutes')).balanceRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await db.collection('workspaces').doc(ws).set({ uid: OWNER, name: 'L-123 step 4c', currency: 'USD', timezone: 'UTC', members: [OWNER] });
    await insert('chartAccounts', chart(ws));
    await insert('assets', assets(ws));
    await insert('transactions', entries(ws));
  });

  after(async () => {
    server?.close();
    for (const table of ['transactions', 'assets', 'chartAccounts', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]).catch(() => {});
    }
    const { getSupabase } = await import('../lib/db/client');
    getSupabase().realtime.disconnect();
    await getSupabase().auth.dispose();
    await db.terminate();
  });

  test('every asset and run, with both reversal links honoured; members only', async () => {
    const r = await get({ workspaceId: ws, asOf });
    assert.equal(r.status, 200);
    assert.equal(r.body.runsRead, 4);
    assert.deepEqual(brief(r.body), TRUTH);
    assert.deepEqual([r.body.totals.costCents, r.body.totals.depreciationCents, r.body.totals.bookValueCents], [44000, 700, 43300]);
    // as of 2026-04-30 R4 counts too: A 1,000
    assert.deepEqual(brief(await get({ workspaceId: ws, asOf: '2026-04-30' }).then(x => x.body)), ['A 30000 1000 29000', 'B 14000 200 13800']);
    assert.equal((await get({ workspaceId: ws, asOf }, 'stranger')).status, 403);
    assert.equal((await get({ workspaceId: ws, asOf: '2026-13-01' })).status, 400);
    assert.equal((await get({ workspaceId: 'ws_missing_l123h', asOf })).status, 404);
  });
});
