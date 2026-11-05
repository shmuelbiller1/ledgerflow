/**
 * L-123 step 4j: Gross profit by customer (CustomerGrossProfitView) reads its rows from the server
 * (GET /api/v1/balances/customer-gross-profit, useServerCustomerGrossProfit) when the loaded lists are capped, once for
 * the period and once for the comparison period.
 *
 * Hand-worked case (cents) on the step 4 sales ledger (src/tests/helpers/l123SalesLedger.ts), year Y:
 *   Acme (I1 W×2 2,000, cost posted 700; I3 W×1 1,000, posted cost reversed so the estimate 300) → 3,000 · 1,000 · 2,000
 *   Beta (I2 G×1 1,500, no cost posted so the estimate 500)                                     → 1,500 · 500 · 1,000
 *   I4 is a draft, left out. The year before has no invoices.
 * On screen the mocked year before answers Beta 400 then Acme 1,500 (reversed, other names): matched by id, Acme shows
 * previous 15.00 / change 5.00 and Beta 4.00 / 6.00; matching by position or name would give other figures.
 * The browser holds the newest two invoices (I3, I4) and the entries C3, C3R: only Acme 1,000 · 300 · 700.
 */
import './helpers/dom';
import test, { after, afterEach, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { setComponentWorkspace, markComponentCollectionsLoaded } from './helpers/componentFixtures';
import { balanceRouteHarness } from './helpers/balanceRouteHarness';
import { Y, from, to, chart, stock, invoices, entries, clients } from './helpers/l123SalesLedger';
import CustomerGrossProfitView from '../components/reporting/CustomerGrossProfitView';
import { useLedgerStore } from '../stores/useLedgerStore';
import { customerGrossProfit } from '../lib/customerGrossProfit';

type Row = ReturnType<typeof customerGrossProfit>[number];
const brief = (rows: Row[]) => rows.map(r => `${r.name} ${r.salesCents}/${r.costCents}/${r.marginCents}`).sort();
const TRUTH = ['Acme 3000/1000/2000', 'Beta 1500/500/1000'];
const prevFrom = `${Y - 1}-01-01`, prevTo = `${Y - 1}-12-31`;
const input = (ws: string, loadedOnly = false, startDate = from, endDate = to) => ({
  customers: clients(ws), invoices: loadedOnly ? invoices(ws).slice(2) : invoices(ws), items: stock(ws),
  transactions: loadedOnly ? entries(ws).slice(1) : entries(ws), accounts: chart(ws), startDate, endDate,
});

describe('L-123 step 4j: customer gross profit (no database)', () => {
  const ws = 'component-workspace';
  afterEach(() => { cleanup(); useLedgerStore.setState({ truncatedCollections: {} }); });

  test('every invoice gives the hand-worked rows; the loaded two do not', () => {
    assert.deepEqual(brief(customerGrossProfit(input(ws))), TRUTH);
    assert.deepEqual(brief(customerGrossProfit(input(ws, true))), ['Acme 1000/300/700']);
  });

  test('screen: the server\'s rows for both periods when the invoices are capped, with a note and no provisional alert', async () => {
    setComponentWorkspace('owner');
    const own = input(ws, true);
    useLedgerStore.setState({ customers: own.customers, invoices: own.invoices, inventory: own.items, transactions: own.transactions,
      accounts: own.accounts, truncatedCollections: { invoices: true } } as never);
    markComponentCollectionsLoaded('customers', 'invoices', 'inventory', 'transactions', 'accounts');
    const asked: string[] = [];
    globalThis.fetch = (async (u: RequestInfo | URL) => {
      asked.push(String(u));
      const q = new URL(String(u), 'http://x').searchParams;
      if (q.get('from') === prevFrom) {
        const row = (id: string, name: string, marginCents: number) => ({ id, name, salesCents: marginCents, costCents: 0, marginCents, marginPct: 100, quantity: 1, costIsEstimate: false });
        return Response.json({ status: 'success', rows: [row(`${ws}_beta`, 'Old B', 400), row(`${ws}_acme`, 'Old A', 1500)] });
      }
      return Response.json({ status: 'success', rows: customerGrossProfit(input(ws, false, q.get('from')!, q.get('to')!)) });
    }) as typeof fetch;
    render(<CustomerGrossProfitView startDate={from} endDate={to} compareStartDate={prevFrom} compareEndDate={prevTo} />);
    await waitFor(() => assert.ok(document.body.textContent!.includes('Beta'), document.body.textContent!), { timeout: 5000 });
    const cells = (name: string) => [...document.querySelectorAll('tbody tr')].find(r => r.querySelector('th')?.textContent === name)!.lastElementChild!.textContent!.replace(/[^0-9./-]/g, '');
    await waitFor(() => assert.equal(cells('Acme'), '15.00/5.00'), { timeout: 5000 });
    assert.equal(cells('Beta'), '4.00/6.00');
    assert.match(screen.getByTestId('customer-gross-profit-compare-source').textContent || '', /read from every entry on the server/);
    assert.match(screen.getByTestId('customer-gross-profit-source').textContent || '', /read from every entry on the server/);
    assert.equal(screen.queryByText(/These figures are provisional/), null);
    for (const [f, t] of [[from, to], [prevFrom, prevTo]]) {
      assert.ok(asked.some(u => u.includes(`/api/v1/balances/customer-gross-profit?workspaceId=${ws}&from=${f}&to=${t}`)), asked.join('\n'));
    }
  });
});

const url = process.env.LF_TEST_DATABASE_URL;

describe('L-123 step 4j: GET /api/v1/balances/customer-gross-profit', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const api = balanceRouteHarness('ws_l123m', 'L-123 step 4j');
  const ws = api.ws;
  const get = (q: Record<string, string>, uid?: string) => api.get<{ rows: Row[]; invoicesRead: number }>('customer-gross-profit', { workspaceId: ws, ...q }, uid);
  before(() => api.start({ chartAccounts: chart(ws), inventory: stock(ws), invoices: invoices(ws), transactions: entries(ws), customers: clients(ws) }));
  after(() => api.stop());

  test('every invoice: the hand-worked rows with ids; the year before is empty; members only', async () => {
    const r = await get({ from, to });
    assert.equal(r.status, 200);
    assert.deepEqual(brief(r.body.rows), TRUTH);
    assert.ok(r.body.rows.every(row => row.id), 'rows keep the customer id for the comparison');
    assert.equal(r.body.invoicesRead, 4);
    const before = await get({ from: prevFrom, to: prevTo });
    assert.deepEqual(before.body.rows, []);
    assert.equal((await get({ from: 'x', to })).status, 400);
    assert.equal((await get({ from, to }, 'stranger')).status, 403);
  });
});
