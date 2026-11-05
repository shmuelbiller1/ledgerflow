/**
 * L-123 step 4h: the asset depreciation ledger (DepreciationLedgerReportView) reads the ledger from the server
 * (GET /api/v1/balances/depreciation-ledger, useServerDepreciationLedger in src/hooks/useServerAssetRegister.ts) when the
 * loaded assets or entries are capped: the depreciation before the period needs every earlier run.
 *
 * Hand-worked case (cents), the CB-27 fixture (src/tests/depreciation-ledger.test.tsx), period 2026-01-01…2026-03-31:
 *   Van 12,000.00, came with 1,000.00 depreciated; runs r1 (2025-12) 200.00, r2 (2026-01) 200.00, r3 (2026-02) 200.00;
 *     r4 (2026-02, 999.99) is undone. Before 1,000.00 + r1 = 1,200.00 · in r2 + r3 = 400.00 · end 1,600.00 · book 10,400.00
 *   Computer 2,400.00: r1 100.00 before · r2 100.00 in · end 200.00 · book 2,200.00, disposed 2026-03-15
 * The loaded list (capped) holds only the newest runs r3 and r4, so the browser alone misses r1 and r2.
 */
import './helpers/dom';
import test, { after, afterEach, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { depreciationLedger, type DepreciationLedgerRow } from '../lib/depreciationLedger';
import DepreciationLedgerReportView from '../components/reporting/DepreciationLedgerReportView';
import { useLedgerStore } from '../stores/useLedgerStore';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { balanceRouteHarness } from './helpers/balanceRouteHarness';
import type { FixedAsset, Transaction } from '../types';

const from = '2026-01-01', to = '2026-03-31';
const asset = (ws: string, id: string, name: string, extra: Partial<FixedAsset>) => ({
  id: `${ws}_${id}`, uid: 'owner-1', workspaceId: ws, name, purchaseDate: '2025-01-01', purchasePriceCents: 1_200_000, salvageValueCents: 0,
  usefulLifeYears: 5, depreciationMethod: 'straight-line', accumulatedDepreciationCents: 0, status: 'active', createdAt: '2025-01-01', ...extra,
}) as FixedAsset;
const run = (ws: string, id: string, month: string, list: Array<[string, number]>, extra: Partial<Transaction> = {}) => ({
  id: `${ws}_${id}`, workspaceId: ws, uid: 'owner-1', date: `${month}-28`, status: 'completed', type: 'actual', lines: [], ...extra,
  metadata: { type: 'depreciation-run', month, assets: list.map(([a, amountCents]) => ({ assetId: `${ws}_${a}`, amountCents })) },
}) as unknown as Transaction;
const assetsOf = (ws: string) => [
  asset(ws, 'van', 'Van', { accumulatedDepreciationCents: 100_000 + 20_000 * 3 }),
  asset(ws, 'pc', 'Computer', { purchasePriceCents: 240_000, accumulatedDepreciationCents: 10_000 * 2, disposedOn: '2026-03-15', status: 'disposed' }),
];
const runsOf = (ws: string) => [
  run(ws, 'r1', '2025-12', [['van', 20_000], ['pc', 10_000]]),
  run(ws, 'r2', '2026-01', [['van', 20_000], ['pc', 10_000]]),
  run(ws, 'r3', '2026-02', [['van', 20_000]]),
  run(ws, 'r4', '2026-02', [['van', 99_999]], { reversalEventId: `${ws}_rev4` } as never),
];
const brief = (rows: DepreciationLedgerRow[]) => rows.map(r => `${r.name} ${r.openingCents}/${r.periodCents}/${r.closingCents}/${r.bookValueCents}`);
const TRUTH = ['Computer 10000/10000/20000/220000', 'Van 120000/40000/160000/1040000'];

describe('L-123 step 4h: depreciation ledger (no database)', () => {
  const ws = 'component-workspace';
  const assets = assetsOf(ws), runs = runsOf(ws), loaded = runs.slice(2);
  afterEach(() => { cleanup(); useLedgerStore.setState({ truncatedCollections: {} }); });

  test('every run gives the hand-worked ledger; the newest two alone do not', () => {
    assert.deepEqual(brief(depreciationLedger(assets, runs, from, to)), TRUTH);
    assert.notDeepEqual(brief(depreciationLedger(assets, loaded, from, to)), TRUTH, 'r1 and r2 are missing');
  });

  test('screen: the server\'s ledger when the entries are capped, with a note', async () => {
    setComponentWorkspace('owner');
    useLedgerStore.setState({ assets, transactions: loaded, truncatedCollections: { transactions: true } } as never);
    markComponentCollectionsLoaded('assets', 'transactions');
    const asked: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      asked.push(String(input));
      const q = new URL(String(input), 'http://x').searchParams;
      return Response.json({ status: 'success', rows: depreciationLedger(assets, runs, q.get('from')!, q.get('to')!) });
    }) as typeof fetch;
    render(<DepreciationLedgerReportView />);
    fireEvent.change(screen.getByLabelText('From'), { target: { value: from } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: to } });
    await waitFor(() => assert.match(screen.getByRole('rowheader', { name: /^Van/ }).parentElement!.textContent || '', /\$12,000\.00\$1,200\.00\$400\.00\$1,600\.00\$10,400\.00/), { timeout: 5000 });
    assert.match(screen.getByTestId('depreciation-ledger-source').textContent || '', /read from every entry on the server/);
    assert.ok(asked.some(u => u.includes(`/api/v1/balances/depreciation-ledger?workspaceId=${ws}&from=${from}&to=${to}`)), asked.join('\n'));
  });
});

const url = process.env.LF_TEST_DATABASE_URL;

describe('L-123 step 4h: GET /api/v1/balances/depreciation-ledger', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const api = balanceRouteHarness('ws_l123k', 'L-123 step 4h');
  const ws = api.ws;
  const get = (q: Record<string, string>, uid?: string) => api.get<{ rows: DepreciationLedgerRow[]; runsRead: number }>('depreciation-ledger', { workspaceId: ws, ...q }, uid);
  before(() => api.start({ assets: assetsOf(ws), transactions: runsOf(ws) }));
  after(() => api.stop());

  test('every asset and run: the hand-worked ledger; any period from 1900 on; members only', async () => {
    const r = await get({ from, to });
    assert.equal(r.status, 200);
    assert.equal(r.body.runsRead, 4);
    assert.deepEqual(brief(r.body.rows), TRUTH);
    assert.equal((await get({ from: '2001-01-01', to })).status, 200, 'longer than three years: only runs are read');
    assert.equal((await get({ from: to, to: from })).status, 400);
    assert.equal((await get({ from: '1899-01-01', to })).status, 400, 'before 1900: the report refuses it');
    assert.equal((await get({ from, to }, 'stranger')).status, 403);
  });
});
