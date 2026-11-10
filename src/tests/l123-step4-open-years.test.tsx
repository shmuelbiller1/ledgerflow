/**
 * L-123 step 4 (docs/design/L-123-server-balances.md): the browser loads only the entries after the newest fresh
 * year-end snapshot. The server answers that day (GET /api/v1/balances/closed-through); the entry list is then
 * marked partial, so every screen that sums all entries reads the server's figures (steps 3–6), and the status
 * bar says the closed years are in the opening balances.
 *
 * On a real database when LF_TEST_DATABASE_URL is set: a ledger of one entry with a fresh 2025-12-31 snapshot still
 * loads whole (closedThrough null: it is under the 20,000 cap). With 20,001 entries in 2025 the answer is
 * 2025-12-31; an edit dated in 2025 marks the snapshot stale → null again.
 */
import './helpers/dom';
import test, { after, afterEach, before, beforeEach, describe } from 'node:test';
import { balanceRouteHarness, OWNER } from './helpers/balanceRouteHarness';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { useServerOpening } from '../hooks/useServerOpening';
import { openingCutoff } from '../lib/serverBalances';
import DataStatusBar from '../components/layout/DataStatusBar';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { CORE_KEYS, closedThroughFrom, entryListPartial } from '../lib/ledgerCollections';
import { setComponentWorkspace } from './helpers/componentFixtures';

describe('L-123 step 4: what counts as a partial entry list', () => {
  test('the cap, or closed years left to the server', () => {
    assert.equal(entryListPartial(19_999, 20_000, null), false);
    assert.equal(entryListPartial(20_000, 20_000, null), true);
    assert.equal(entryListPartial(10, 20_000, '2025-12-31'), true);
  });
  test('the server\'s answer is read only when it is a day', () => {
    assert.equal(closedThroughFrom({ closedThrough: '2025-12-31' }), '2025-12-31');
    assert.equal(closedThroughFrom({ closedThrough: null }), null);
    assert.equal(closedThroughFrom({ closedThrough: '31/12/2025' }), null);
    assert.equal(closedThroughFrom(null), null);
  });
});

describe('L-123 step 4: the status bar', () => {
  const loaded = Object.fromEntries(CORE_KEYS.map(k => [k, true]));
  beforeEach(() => {
    setComponentWorkspace('owner');
    useDataNeedsStore.setState({ asked: [], loaded, loadedWorkspaceId: 'component-workspace', failed: {} });
  });
  afterEach(() => { cleanup(); useLedgerStore.setState({ truncatedCollections: {}, entriesClosedThrough: null, transactions: [] }); });

  test('closed years: says they are in the opening balances, not that the newest 20,000 are loaded', () => {
    useLedgerStore.setState({ truncatedCollections: { transactions: true }, entriesClosedThrough: '2025-12-31', transactions: [] });
    render(<DataStatusBar />);
    assert.match(screen.getByTestId('closed-years-note').textContent || '', /Entries up to 2025-12-31 are in the closed years' opening balances/);
    assert.doesNotMatch(document.body.textContent || '', /Only the most recent 20,000 entries/);
  });

  test('every entry loaded: no note', () => {
    render(<DataStatusBar />);
    assert.equal(screen.queryByTestId('closed-years-note'), null);
  });
});

describe('L-123 step 4: no entry after the closed years', () => {
  test('the cutoff every opening and period fallback uses is the closed-through day', () => {
    assert.equal(openingCutoff([]), '');
    useLedgerStore.getState().setEntriesClosedThrough('2025-12-31');
    assert.equal(openingCutoff([]), '2025-12-31');
    assert.equal(openingCutoff([{ id: 'a', date: '2026-02-01' } as never]), '2026-02-01');
    useLedgerStore.getState().setEntriesClosedThrough(null);
    assert.equal(openingCutoff([]), '');
  });

  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; useLedgerStore.setState({ entriesClosedThrough: null }); });

  test('the server opening is still read, at the closed-through day', async () => {
    setComponentWorkspace('owner');
    const asked: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      asked.push(String(input));
      return new Response(JSON.stringify({ status: 'success', asOf: '2025-12-31', accounts: { cash: 50_000 } }), { status: 200 });
    }) as typeof fetch;
    useLedgerStore.setState({ entriesClosedThrough: '2025-12-31' });
    const { result } = renderHook(() => useServerOpening([]));
    await waitFor(() => assert.deepEqual(result.current?.accounts, { cash: 50_000 }));
    assert.match(asked[0], /asOf=2025-12-31/);
  });
});

describe('L-123 step 4: GET /api/v1/balances/closed-through', { skip: !process.env.LF_TEST_DATABASE_URL && 'LF_TEST_DATABASE_URL not set' }, () => {
  const h = balanceRouteHarness('ws_l123s4', 'L-123 step 4');
  const ws = h.ws;
  const line = (account: string, cents: number) => ({ accountId: `${ws}_${account}`, amountCents: cents });
  const closedThrough = async (uid?: string) => h.get<{ closedThrough: string | null }>('closed-through', { workspaceId: ws }, uid);

  before(() => h.start({
    chartAccounts: [
      { id: `${ws}_cash`, workspaceId: ws, name: 'Cash', type: 'asset', balance: 0 },
      { id: `${ws}_sales`, workspaceId: ws, name: 'Sales', type: 'income', balance: 0 },
    ],
    transactions: [{ id: `${ws}_t1`, workspaceId: ws, uid: OWNER, date: '2025-03-01', description: 'Sale', status: 'completed', type: 'journal', currency: 'USD', lines: [line('cash', 50_000), line('sales', -50_000)] }],
    periodBalances: [],
  }));
  after(() => h.stop());

  test('a small ledger loads whole; a big one with a fresh snapshot: its day; stale: null again; members only', async () => {
    const db = h.db();
    assert.equal((await closedThrough()).body.closedThrough, null);
    const svc = await import('../server/services/balanceService');
    await svc.buildSnapshot(db, ws, '2025-12-31', 'test');
    assert.equal((await closedThrough()).body.closedThrough, null, 'under the cap: every entry loads');
    await db.pool.query(`
      insert into public.transactions (id, data)
      select $1::text || '_b' || i, jsonb_build_object('id', $1 || '_b' || i, 'workspaceId', $1::text, 'uid', $2::text,
        'date', '2025-04-01', 'description', 'Sale', 'status', 'completed', 'type', 'journal', 'currency', 'USD',
        'lines', jsonb_build_array(jsonb_build_object('accountId', $1 || '_cash', 'amountCents', 1), jsonb_build_object('accountId', $1 || '_sales', 'amountCents', -1)))
      from generate_series(1, 20000) i`, [ws, OWNER]);
    await svc.buildSnapshot(db, ws, '2025-12-31', 'test');
    const big = await closedThrough();
    assert.equal(big.headers.get('cache-control'), 'no-store');
    assert.equal(big.body.closedThrough, '2025-12-31');
    await db.collection('transactions').doc(`${ws}_t1`).update({ date: '2025-06-01' });
    assert.equal((await closedThrough()).body.closedThrough, null);
    assert.equal((await closedThrough('stranger')).status, 403);
  });
});
