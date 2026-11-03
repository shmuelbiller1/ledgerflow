/**
 * L-123 step 4k: Gross margin by item group (GrossMarginByItemGroupReportView) reads its months from the server
 * (GET /api/v1/balances/item-group-margin, useServerItemGroupMargin) when the loaded lists are capped.
 *
 * Hand-worked case (cents) on the step 4 sales ledger (src/tests/helpers/l123SalesLedger.ts), year Y, with Widget in
 * group Hardware and Gadget in group Gizmos:
 *   Hardware  Jan I1 W×2 2,000, cost posted 700; Mar I3 W×1 1,000, posted cost reversed so the estimate 300
 *               → 3,000 · 1,000 · 2,000 over the year (Jan margin 1,300, Mar 700)
 *   Gizmos    Feb I2 G×1 1,500, no cost posted so the estimate 500 → 1,500 · 500 · 1,000
 *   I4 is a draft, left out.
 * The browser holds the newest two invoices (I3, I4) and the entries C3, C3R: only Hardware 1,000 · 300 · 700.
 */
import './helpers/dom';
import test, { after, afterEach, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { setComponentWorkspace, markComponentCollectionsLoaded } from './helpers/componentFixtures';
import { balanceRouteHarness } from './helpers/balanceRouteHarness';
import { Y, from, to, chart, stock, invoices, entries, clients } from './helpers/l123SalesLedger';
import GrossMarginByItemGroupReportView from '../components/reporting/GrossMarginByItemGroupReportView';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { grossMarginByItemGroup, monthsBetween, type GroupMarginRow } from '../lib/grossMarginByGroup';

const brief = (rows: GroupMarginRow[]) => rows.map(r => `${r.group} ${r.salesCents}/${r.costCents}/${r.marginCents}`).sort();
const TRUTH = ['Gizmos 1500/500/1000', 'Hardware 3000/1000/2000'];
const grouped = (ws: string) => stock(ws).map(item => ({ ...item, category: item.name === 'Widget' ? 'Hardware' : 'Gizmos' }));
const input = (ws: string, loadedOnly = false) => ({
  invoices: loadedOnly ? invoices(ws).slice(2) : invoices(ws), items: grouped(ws),
  transactions: loadedOnly ? entries(ws).slice(1) : entries(ws), accounts: chart(ws), months: monthsBetween(`${Y}-01`, `${Y}-12`),
});

describe('L-123 step 4k: gross margin by item group (no database)', () => {
  const ws = 'component-workspace';
  afterEach(() => { cleanup(); useLedgerStore.setState({ truncatedCollections: {} }); useDataNeedsStore.setState({ failed: {} }); });

  test('every invoice gives the hand-worked groups and months; the loaded two do not', () => {
    const all = grossMarginByItemGroup(input(ws));
    assert.deepEqual(brief(all.rows), TRUTH);
    const hardware = all.rows.find(r => r.group === 'Hardware')!;
    assert.deepEqual(hardware.months.filter(m => m.salesCents).map(m => `${m.month} ${m.marginCents}`), [`${Y}-01 1300`, `${Y}-03 700`]);
    assert.deepEqual(brief(grossMarginByItemGroup(input(ws, true)).rows), ['Hardware 1000/300/700']);
  });

  test('screen: the server\'s groups when the invoices are capped, with a note and no incomplete alert', async () => {
    setComponentWorkspace('owner');
    const own = input(ws, true);
    useLedgerStore.setState({ customers: clients(ws), invoices: own.invoices, inventory: own.items, transactions: own.transactions,
      accounts: own.accounts, truncatedCollections: { invoices: true } } as never);
    markComponentCollectionsLoaded('customers', 'invoices', 'inventory', 'transactions', 'accounts');
    const asked: string[] = [];
    globalThis.fetch = (async (u: RequestInfo | URL) => {
      asked.push(String(u));
      return Response.json({ status: 'success', ...grossMarginByItemGroup(input(ws)) });
    }) as typeof fetch;
    render(<GrossMarginByItemGroupReportView />);
    await waitFor(() => assert.ok(document.body.textContent!.includes('Gizmos'), document.body.textContent!), { timeout: 5000 });
    assert.match(screen.getByTestId('item-group-margin-source').textContent || '', /read from every entry on the server/);
    assert.equal(screen.queryByText(/may be incomplete/), null);
    assert.ok(asked.some(u => u.includes(`/api/v1/balances/item-group-margin?workspaceId=${ws}&from=${from}&to=${to}`)), asked.join('\n'));
  });

  for (const [what, setUp] of [
    ['a capped entry list', () => useLedgerStore.setState({ truncatedCollections: { transactions: true } })],
    ['entries that failed to load', () => useDataNeedsStore.setState({ failed: { transactions: 'offline' } })],
    ['accounts that failed to load', () => useDataNeedsStore.setState({ failed: { accounts: 'offline' } })],
  ] as const) {
    test(`screen: ${what} also asks the server (cost of goods sold can be posted before the year)`, async () => {
      setComponentWorkspace('owner');
      const own = input(ws, true);
      useLedgerStore.setState({ customers: clients(ws), invoices: own.invoices, inventory: own.items, transactions: own.transactions, accounts: own.accounts } as never);
      markComponentCollectionsLoaded('customers', 'invoices', 'inventory', 'transactions', 'accounts');
      setUp();
      let asked = 0;
      globalThis.fetch = (async () => { asked += 1; return Response.json({ status: 'success', ...grossMarginByItemGroup(input(ws)) }); }) as typeof fetch;
      render(<GrossMarginByItemGroupReportView />);
      await waitFor(() => assert.ok(document.body.textContent!.includes('Gizmos'), document.body.textContent!), { timeout: 5000 });
      assert.ok(asked > 0);
      assert.match(screen.getByTestId('item-group-margin-source').textContent || '', /read from every entry on the server/);
    });
  }
});

const url = process.env.LF_TEST_DATABASE_URL;

describe('L-123 step 4k: GET /api/v1/balances/item-group-margin', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const api = balanceRouteHarness('ws_l123n', 'L-123 step 4k');
  const ws = api.ws;
  const get = (q: Record<string, string>, uid?: string) => api.get<{ rows: GroupMarginRow[]; months: string[]; invoicesRead: number }>('item-group-margin', { workspaceId: ws, ...q }, uid);
  before(() => api.start({ chartAccounts: chart(ws), inventory: grouped(ws), invoices: invoices(ws), transactions: entries(ws), customers: clients(ws) }));
  after(() => api.stop());

  test('every invoice: the hand-worked groups over twelve months; one calendar year only; members only', async () => {
    const r = await get({ from, to });
    assert.equal(r.status, 200);
    assert.deepEqual(brief(r.body.rows), TRUTH);
    assert.equal(r.body.months.length, 12);
    assert.equal(r.body.invoicesRead, 4);
    assert.equal((await get({ from: `${Y}-02-01`, to })).status, 400, 'not a whole calendar year');
    assert.equal((await get({ from, to }, 'stranger')).status, 403);
  });
});
