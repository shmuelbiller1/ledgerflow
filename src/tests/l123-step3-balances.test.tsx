/**
 * L-123 step 3: the balances on the chart of accounts (and the account register's header) are the server's
 * (GET /api/v1/balances, src/server/routes/balanceRoutes.ts) through the oldest loaded day, plus the loaded entries
 * after it (src/lib/serverBalances.ts, src/hooks/useServerOpening.ts). The browser loads at most
 * LEDGER_COLLECTIONS.transactions.cap = 20,000 entries, newest first.
 *
 * Hand-worked case (cents). Accounts: Cash (asset, code 1000, opening 5,000), Sales (income, 4000), Rent (expense, 6000).
 * 25,000 entries, entry i (1…25,000) dated 2019-01-01 + ⌊(i−1)/7⌋ days (7 a day):
 *   i odd  (12,500): sale  Cash +300 / Sales −300
 *   i even (12,500): rent  Rent +100 / Cash  −100
 * Every entry (the server):  Cash 5,000 + 12,500·300 − 12,500·100 = 2,505,000 · Sales 3,750,000 · Rent 1,250,000
 * The newest 20,000 loaded (i 5,001…25,000: 10,000 sales, 10,000 rents). Today's browser sums only them:
 *   Cash 5,000 + 3,000,000 − 1,000,000 = 2,005,000 · Sales 3,000,000 · Rent 1,000,000 (wrong by 500,000 / 750,000 / 250,000)
 * The oldest loaded day is day 714 = 2020-12-15 (entries 4,999…5,005; 5,001…5,005 loaded, so it is cut part-way).
 *   The server through 2020-12-15 (i ≤ 5,005: 2,503 sales, 2,502 rents): Cash 750,900 − 250,200 = 500,700
 *     · Sales −750,900 · Rent 250,200
 *   The loaded entries after it (i 5,006…25,000: 9,997 sales, 9,998 rents): Cash 2,999,100 − 999,800 = 1,999,300
 *   Shown: Cash 5,000 + 500,700 + 1,999,300 = 2,505,000 · Sales 750,900 + 2,999,100 = 3,750,000
 *     · Rent 250,200 + 999,800 = 1,250,000 — the server's figures.
 * The screen test runs without a database (fetch stubbed to the server's answer above); the DB-backed test (when
 * LF_TEST_DATABASE_URL is set) builds the 25,000 entries in one SQL insert, asks the real route, and renders the
 * chart from the newest 20,000 rows of the database.
 */
import { stubFetch } from './helpers/dom';
import test, { after, afterEach, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import React from 'react';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { setComponentWorkspace } from './helpers/componentFixtures';
import Ledger from '../components/ledger/Ledger';
import DashboardWidgets from '../components/dashboard/DashboardWidgets';
import { useServerOpeningSync } from '../hooks/useServerOpening';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { AccountRegisterView } from '../components/finance/AccountRegisterView';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useAuthStore } from '../stores/useAuthStore';
import { LEDGER_COLLECTIONS } from '../lib/ledgerCollections';
import { formatCurrency, getLocalDateISO } from '../lib/utils';
import { dashboardFigures, dashboardPeriod } from '../lib/dashboardOverview';
import { entriesAfter, openingCutoff, withServerOpening } from '../lib/serverBalances';
import type { ChartAccount, Transaction } from '../types';
import type { Firestore } from '../server/db/pgFirestore';

const N = 25_000;
const CAP = LEDGER_COLLECTIONS.transactions.cap;
const dayOf = (i: number) => new Date(Date.UTC(2019, 0, 1) + Math.floor((i - 1) / 7) * 86_400_000).toISOString().slice(0, 10);
const chart = (ws: string): ChartAccount[] => [
  { id: `${ws}_cash`, workspaceId: ws, uid: 'owner-1', code: '1000', name: 'Cash', type: 'asset', category: 'Cash', openingBalanceCents: 5000 } as ChartAccount,
  { id: `${ws}_sales`, workspaceId: ws, uid: 'owner-1', code: '4000', name: 'Sales', type: 'income', category: 'Sales', openingBalanceCents: 0 } as ChartAccount,
  { id: `${ws}_rent`, workspaceId: ws, uid: 'owner-1', code: '6000', name: 'Rent', type: 'expense', category: 'Rent', openingBalanceCents: 0 } as ChartAccount,
];
const entry = (ws: string, i: number): Transaction => ({
  id: `${ws}_e${String(i).padStart(5, '0')}`, workspaceId: ws, uid: 'owner-1', date: dayOf(i), description: i % 2 ? 'Sale' : 'Rent',
  totalAmountCents: i % 2 ? 300 : 100, currency: 'USD', status: 'completed', type: 'journal',
  lines: i % 2
    ? [{ accountId: `${ws}_cash`, amountCents: 300 }, { accountId: `${ws}_sales`, amountCents: -300 }]
    : [{ accountId: `${ws}_rent`, amountCents: 100 }, { accountId: `${ws}_cash`, amountCents: -100 }],
} as Transaction);
/** what the loader keeps: the newest `CAP` entries, by date then id (ledgerCollections: newestFirstBy date) */
const newest = (entries: Transaction[]) => [...entries].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)).slice(0, CAP);

const rowOf = (code: string) => within(screen.getByRole('table', { name: 'Chart of accounts' })).getAllByRole('row').find(r => within(r).queryByText(code))!;
const shownIn = (code: string) => rowOf(code).textContent || '';
const answer = (body: unknown, onUrl?: (u: string) => void) => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const target = String(input);
    onUrl?.(target);
    if (target.startsWith('/api/v1/balances')) return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
};

describe('L-123 step 3: browser balances from the server (screen, fetch stubbed)', () => {
  const ws = 'component-workspace';
  const all = Array.from({ length: N }, (_, k) => entry(ws, k + 1));
  const loaded = newest(all);
  afterEach(() => cleanup());

  test('the hand-worked cut-off: the oldest loaded day and the loaded entries after it', () => {
    assert.equal(loaded.length, 20_000);
    assert.equal(openingCutoff(loaded), '2020-12-15');
    assert.equal(entriesAfter(loaded, '2020-12-15').length, 19_995);
    const shown = withServerOpening(chart(ws), loaded, { workspaceId: ws, asOf: '2020-12-15', accounts: { [`${ws}_cash`]: 500_700, [`${ws}_sales`]: -750_900, [`${ws}_rent`]: 250_200 } });
    assert.deepEqual(shown.map(a => a.balanceCents), [2_505_000, 3_750_000, 1_250_000]);
  });

  test('the chart of accounts shows the server figures; with no server answer, today\'s (wrong) sums of 20,000', async () => {
    setComponentWorkspace('owner');
    useLedgerStore.setState({ accounts: chart(ws), transactions: loaded, computedAccounts: [] });
    const urls: string[] = [];
    answer({ status: 'success', asOf: '2020-12-15', accounts: { [`${ws}_cash`]: 500_700, [`${ws}_sales`]: -750_900, [`${ws}_rent`]: 250_200 } }, u => urls.push(u));
    render(<Ledger />);
    await waitFor(() => assert.match(shownIn('1000'), new RegExp(formatCurrency(2_505_000).replace(/[$.]/g, '\\$&'))), { timeout: 5000 });
    assert.ok(shownIn('4000').includes(formatCurrency(3_750_000)), shownIn('4000'));
    assert.ok(shownIn('6000').includes(formatCurrency(1_250_000)), shownIn('6000'));
    assert.ok(urls.some(u => u === `/api/v1/balances?workspaceId=${ws}&asOf=2020-12-15`), urls.join('\n'));
    assert.match(screen.getByTestId('balances-source').textContent || '', /through 2020-12-15 as summed by the server, plus the 19995 loaded entries/);
    cleanup();

    stubFetch(404);
    useLedgerStore.setState({ computedAccounts: [] });
    useLedgerStore.getState().recomputeBalances();
    render(<Ledger />);
    await waitFor(() => assert.ok(shownIn('1000').includes(formatCurrency(2_005_000)), shownIn('1000')), { timeout: 5000 });
    assert.match(screen.getByTestId('balances-source').textContent || '', /loaded entries only/);
  });

  test('step 3b: computedAccounts (the Sidebar and every reader) and the dashboard cash total are the server\'s', async () => {
    setComponentWorkspace('owner');
    const Sync = () => { useServerOpeningSync(); return null; };
    useLedgerStore.setState({ accounts: chart(ws), transactions: loaded, computedAccounts: [], serverOpening: null, invoices: [], bills: [], customers: [], vendors: [], truncatedCollections: { transactions: true } });
    useDataNeedsStore.setState({ loaded: { transactions: true, accounts: true, invoices: true, bills: true, customers: true, vendors: true } } as never);
    answer({ status: 'success', asOf: '2020-12-15', accounts: { [`${ws}_cash`]: 500_700, [`${ws}_sales`]: -750_900, [`${ws}_rent`]: 250_200 } });
    render(<><Sync /><DashboardWidgets /></>);
    const balances = () => useLedgerStore.getState().computedAccounts.map(a => a.balanceCents);
    await waitFor(() => assert.deepEqual(balances(), [2_505_000, 3_750_000, 1_250_000]), { timeout: 5000 });
    const cash = () => document.getElementById('dashboard-summary-balance-sheet')?.textContent || '';
    // the dashboard's cash is as of the end of this month, and the hand-built entries run into 2028: the expected
    // figure is every one of the 25,000 entries through that day (what the server's books say), not the loaded 20,000
    const period = dashboardPeriod('month', getLocalDateISO(), 1);
    const truth = dashboardFigures(chart(ws), all, period).cash, loadedOnly = dashboardFigures(chart(ws), loaded, period).cash;
    assert.notEqual(truth, loadedOnly);
    await waitFor(() => assert.equal(cash(), formatCurrency(truth, 'USD')), { timeout: 5000 });
    assert.match(screen.getByTestId('dashboard-balances-source').textContent || '', /through 2020-12-15 as summed by the server/);
    cleanup();
    // without the server: the loaded entries alone, as before (and the cap makes the summary unavailable)
    stubFetch(404);
    useLedgerStore.getState().setServerOpening(null);
    await waitFor(() => assert.deepEqual(balances(), [2_005_000, 3_000_000, 1_000_000]), { timeout: 5000 });
    useLedgerStore.setState({ truncatedCollections: {} });
  });

  test('the account register header: the server through the cut-off plus the loaded entries after it', async () => {
    // the register lists every loaded row, so a small ledger keeps it fast: entries 1…35, the newest 30 loaded
    // (6…35). Cut-off 2019-01-01 (entries 1…7; 6 and 7 loaded). Server through it: 4 sales, 3 rents, Cash 900.
    // Loaded after it (8…35): 14 sales, 14 rents, Cash 2,800. Header: 5,000 + 900 + 2,800 = 8,700 = every entry
    // (18 sales, 17 rents: 5,000 + 5,400 − 1,700). The loaded entries alone: 5,000 + 4,500 − 1,500 = 8,000.
    setComponentWorkspace('owner');
    const few = Array.from({ length: 35 }, (_, k) => entry(ws, k + 1)).slice(5);
    useLedgerStore.setState({ accounts: chart(ws), transactions: few });
    const card = () => screen.getByText('Current Register Balance').parentElement!.textContent || '';
    stubFetch(404);
    render(<AccountRegisterView />);
    await waitFor(() => assert.match(screen.getByTestId('register-balances-source').textContent || '', /the loaded entries/));
    assert.ok(card().includes(formatCurrency(8_000)), card());
    cleanup();
    answer({ status: 'success', asOf: '2019-01-01', accounts: { [`${ws}_cash`]: 900 } });
    render(<AccountRegisterView />);
    await waitFor(() => assert.ok(card().includes(formatCurrency(8_700)), card()), { timeout: 5000 });
    assert.match(screen.getByTestId('register-balances-source').textContent || '', /through 2019-01-01/);
  });
});

const url = process.env.LF_TEST_DATABASE_URL;
const OWNER = 'owner-1';

describe('L-123 step 3: GET /api/v1/balances on a 25,000-entry ledger', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  let db: Firestore;
  let server: Server;
  let base = '';
  const realFetch = globalThis.fetch;
  const ws = `ws_l123s3_${crypto.randomBytes(4).toString('hex')}`;
  const get = async (q: Record<string, string>, uid = OWNER) => {
    const res = await realFetch(`${base}/api/v1/balances?${new URLSearchParams(q)}`, { headers: { 'x-test-uid': uid } });
    return { status: res.status, body: await res.json() as { accounts: Record<string, number>; byLabel?: Record<string, unknown>; entriesRead: number } };
  };

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
    await db.collection('workspaces').doc(ws).set({ uid: OWNER, name: 'L-123 step 3', currency: 'USD', timezone: 'UTC', members: [OWNER] });
    await db.pool.query(`insert into public."chartAccounts" (id, data) select a->>'id', a from jsonb_array_elements($1::jsonb) a`, [JSON.stringify(chart(ws))]);
    // the 25,000 entries in one statement (entry() above, in SQL)
    await db.pool.query(`
      insert into public.transactions (id, data)
      select $1::text || '_e' || lpad(i::text, 5, '0'), jsonb_build_object(
        'id', $1 || '_e' || lpad(i::text, 5, '0'), 'workspaceId', $1::text, 'uid', $2::text,
        'date', to_char(date '2019-01-01' + ((i - 1) / 7), 'YYYY-MM-DD'),
        'description', case when i % 2 = 1 then 'Sale' else 'Rent' end, 'totalAmountCents', case when i % 2 = 1 then 300 else 100 end,
        'currency', 'USD', 'status', 'completed', 'type', 'journal',
        'lines', case when i % 2 = 1
          then jsonb_build_array(jsonb_build_object('accountId', $1 || '_cash', 'amountCents', 300), jsonb_build_object('accountId', $1 || '_sales', 'amountCents', -300))
          else jsonb_build_array(jsonb_build_object('accountId', $1 || '_rent', 'amountCents', 100), jsonb_build_object('accountId', $1 || '_cash', 'amountCents', -100)) end)
      from generate_series(1, ${N}) i`, [ws, OWNER]);
  });

  after(async () => {
    globalThis.fetch = realFetch;
    server?.close();
    for (const table of ['transactions', 'chartAccounts', 'periodBalances', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]).catch(() => {});
    }
    const { getSupabase } = await import('../lib/db/client');
    getSupabase().realtime.disconnect();
    await getSupabase().auth.dispose();
    await db.terminate();
  });

  test('the route: every entry through the day, members only, labels on request', async () => {
    const all = await get({ workspaceId: ws, asOf: '2030-12-31' });
    assert.equal(all.status, 200);
    assert.deepEqual(all.body.accounts, { [`${ws}_cash`]: 2_500_000, [`${ws}_sales`]: -3_750_000, [`${ws}_rent`]: 1_250_000 });
    assert.equal(all.body.entriesRead, N);
    assert.equal(all.body.byLabel, undefined);
    const cut = await get({ workspaceId: ws, asOf: '2020-12-15' });
    assert.deepEqual(cut.body.accounts, { [`${ws}_cash`]: 500_700, [`${ws}_sales`]: -750_900, [`${ws}_rent`]: 250_200 });
    const labelled = await get({ workspaceId: ws, asOf: '2020-12-15', byLabel: '1' });
    assert.deepEqual((labelled.body.byLabel as Record<string, Record<string, unknown>>).category, { Unassigned: cut.body.accounts });
    assert.equal((await get({ workspaceId: ws, asOf: '2020-12-15' }, 'stranger')).status, 403);
    assert.equal((await get({ workspaceId: ws, asOf: '15/12/2020' })).status, 400);
    assert.equal((await get({ workspaceId: 'ws_missing_l123s3', asOf: '2020-12-15' })).status, 404);
  });

  test('every balance on the chart of accounts equals the server\'s, with the newest 20,000 of 25,000 loaded', async () => {
    const accounts = (await db.collection('chartAccounts').where('workspaceId', '==', ws).get()).docs.map(d => ({ ...d.data(), id: d.id }) as ChartAccount);
    const rows = await db.pool.query(`select data from public.transactions where workspace_id = $1 order by data->>'date' desc, id desc limit ${CAP}`, [ws]);
    const loaded = rows.rows.map(r => r.data as Transaction);
    assert.equal(loaded.length, CAP);
    const server = (await get({ workspaceId: ws, asOf: '2030-12-31' })).body.accounts;
    useAuthStore.setState({ currentWorkspaceId: ws });
    useLedgerStore.setState({ accounts, transactions: loaded, computedAccounts: [] });
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const target = String(input);
      if (!target.startsWith('/api/v1/balances')) return new Response('{}', { status: 404 });
      return realFetch(`${base}${target}`, { ...init, headers: { 'x-test-uid': OWNER } });
    }) as typeof fetch;
    try {
      render(<Ledger />);
      for (const a of accounts) {
        const debit = a.type === 'asset' || a.type === 'expense';
        const expected = (debit ? 1 : -1) * ((server[a.id] || 0) + (debit ? 1 : -1) * (a.openingBalanceCents || 0));
        await waitFor(() => assert.ok(shownIn(String(a.code)).includes(formatCurrency(expected)), `${a.name}: ${shownIn(String(a.code))} ≠ ${formatCurrency(expected)}`), { timeout: 10_000 });
      }
      // step 3b: computedAccounts (the Sidebar and the other readers) from the same real route
      const Sync = () => { useServerOpeningSync(); return null; };
      useLedgerStore.setState({ serverOpening: null, computedAccounts: [] });
      render(<Sync />);
      for (const a of accounts) {
        const debit = a.type === 'asset' || a.type === 'expense';
        const expected = (debit ? 1 : -1) * ((server[a.id] || 0) + (debit ? 1 : -1) * (a.openingBalanceCents || 0));
        await waitFor(() => assert.equal(useLedgerStore.getState().computedAccounts.find(c => c.id === a.id)?.balanceCents, expected, a.name), { timeout: 10_000 });
      }
      // what today's browser shows from the loaded entries alone differs
      const today = withServerOpening(accounts, loaded, { workspaceId: ws, asOf: '0000-00-00', accounts: {} });
      assert.deepEqual(today.map(a => [a.code, a.balanceCents]).sort(), [['1000', 2_005_000], ['4000', 3_000_000], ['6000', 1_000_000]]);
    } finally {
      cleanup();
      globalThis.fetch = realFetch;
    }
  });
});
