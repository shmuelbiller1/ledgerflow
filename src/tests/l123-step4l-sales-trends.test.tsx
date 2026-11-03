/**
 * L-123 step 4l: Sales trends (DocumentTrendsView, kind sales) read their months from the server
 * (GET /api/v1/balances/sales-trends, useServerSalesTrends) when the loaded lists are capped, for the period and the
 * comparison period.
 *
 * Hand-worked case (cents) on the step 4 sales ledger (src/tests/helpers/l123SalesLedger.ts), twelve months ending
 * Y-12-31 (window from Y-01-01):
 *   by customer  Acme Jan 2,000 (I1), Mar 1,000 (I3); Beta Feb 1,500 (I2)
 *   by item      Widget Jan 2,000, Mar 1,000; Gadget Feb 1,500
 *   I4 is a draft, left out. The twelve months ending (Y-1)-12-31 have no invoices.
 * The browser holds the newest two invoices (I3, I4): by customer only Acme Mar 1,000.
 */
import './helpers/dom';
import test, { after, afterEach, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { setComponentWorkspace, markComponentCollectionsLoaded } from './helpers/componentFixtures';
import { balanceRouteHarness } from './helpers/balanceRouteHarness';
import { Y, from, to, chart, stock, invoices, entries, clients } from './helpers/l123SalesLedger';
import { SalesTrendsView } from '../components/reporting/DocumentTrendsView';
import { useLedgerStore } from '../stores/useLedgerStore';
import { salesTrends, trendWindowStart, type TrendRow } from '../lib/documentTrends';

const brief = (rows: TrendRow[]) => rows.map(r => `${r.month.slice(5)} ${r.name} ${r.cents}`).sort();
const TRUTH = {
  customer: ['01 Acme 2000', '02 Beta 1500', '03 Acme 1000'],
  item: ['01 Widget 2000', '02 Gadget 1500', '03 Widget 1000'],
};
const prevTo = `${Y - 1}-12-31`;
const input = (ws: string, loadedOnly = false) => ({
  customers: clients(ws), invoices: loadedOnly ? invoices(ws).slice(2) : invoices(ws), items: stock(ws),
  transactions: loadedOnly ? entries(ws).slice(1) : entries(ws), accounts: chart(ws),
});

describe('L-123 step 4l: sales trends (no database)', () => {
  const ws = 'component-workspace';
  afterEach(() => { cleanup(); useLedgerStore.setState({ truncatedCollections: {} }); });

  test('the window starts eleven months back; every invoice gives the hand-worked months; the loaded two do not', () => {
    assert.equal(trendWindowStart(to), from);
    assert.equal(trendWindowStart(`${Y}-03-15`), `${Y - 1}-04-01`);
    for (const group of ['customer', 'item'] as const) assert.deepEqual(brief(salesTrends(input(ws), to, group)), TRUTH[group], group);
    assert.deepEqual(brief(salesTrends(input(ws, true), to, 'customer')), ['03 Acme 1000']);
  });

  test('screen: the server\'s months for both periods when the invoices are capped, with notes and no provisional alert', async () => {
    setComponentWorkspace('owner');
    const own = input(ws, true);
    useLedgerStore.setState({ customers: own.customers, vendors: [], bills: [], invoices: own.invoices, inventory: own.items,
      transactions: own.transactions, accounts: own.accounts, truncatedCollections: { invoices: true } } as never);
    markComponentCollectionsLoaded('customers', 'vendors', 'invoices', 'bills', 'inventory', 'transactions', 'accounts');
    const asked: string[] = [];
    globalThis.fetch = (async (u: RequestInfo | URL) => {
      asked.push(String(u));
      const q = new URL(String(u), 'http://x').searchParams;
      return Response.json({ status: 'success', rows: salesTrends(input(ws), q.get('to')!, q.get('group') as 'customer') });
    }) as typeof fetch;
    render(<SalesTrendsView endDate={to} compareEndDate={prevTo} />);
    await waitFor(() => assert.ok(document.body.textContent!.includes('Beta'), document.body.textContent!), { timeout: 5000 });
    assert.match(screen.getByTestId('sales-trends-source').textContent || '', /read from every entry on the server/);
    assert.match(screen.getByTestId('sales-trends-compare-source').textContent || '', /read from every entry on the server/);
    assert.equal(screen.queryByText(/These trends are provisional/), null);
    for (const [f, t] of [[from, to], [`${Y - 1}-01-01`, prevTo]]) {
      assert.ok(asked.some(u => u.includes(`/api/v1/balances/sales-trends?workspaceId=${ws}&from=${f}&to=${t}&group=customer`)), asked.join('\n'));
    }
  });
});

const url = process.env.LF_TEST_DATABASE_URL;

describe('L-123 step 4l: GET /api/v1/balances/sales-trends', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const api = balanceRouteHarness('ws_l123o', 'L-123 step 4l');
  const ws = api.ws;
  const get = (q: Record<string, string>, uid?: string) => api.get<{ rows: TrendRow[]; invoicesRead: number }>('sales-trends', { workspaceId: ws, ...q }, uid);
  before(() => api.start({ chartAccounts: chart(ws), inventory: stock(ws), invoices: invoices(ws), transactions: entries(ws), customers: clients(ws) }));
  after(() => api.stop());

  test('every invoice: the hand-worked months by customer and by item; the twelve-month window and group are required; members only', async () => {
    for (const group of ['customer', 'item'] as const) {
      const r = await get({ group, from, to });
      assert.equal(r.status, 200, group);
      assert.deepEqual(brief(r.body.rows), TRUTH[group], group);
      assert.equal(r.body.invoicesRead, 4);
    }
    assert.equal((await get({ group: 'customer', from: `${Y}-02-01`, to })).status, 400, 'not the twelve-month window');
    assert.equal((await get({ group: 'region', from, to })).status, 400);
    assert.equal((await get({ from, to })).status, 400, 'group is required');
    assert.equal((await get({ group: 'customer', from, to }, 'stranger')).status, 403);
  });
});
