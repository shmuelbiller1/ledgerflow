/**
 * L-123 step 4b: the sales-by-item report reads every invoice of the period, and the cost of goods sold posted for
 * them, from the server (GET /api/v1/balances/sales-by-item) when the browser's invoices or entries are capped.
 *
 * Hand-worked case (cents), year Y. Items: W (unit cost 300), G (unit cost 500). Accounts: COGS, Inventory.
 *   I1 Y-01-10 sent   W ×2 = 2,000  — cost of goods sold posted: C1 700
 *   I2 Y-02-05 paid   G ×1 = 1,500  — none posted, so the estimate 1 × 500
 *   I3 Y-03-01 sent   W ×1 = 1,000  — C3 400 posted, then reversed by C3R, so the estimate 1 × 300
 *   I4 Y-03-20 draft  W ×5 = 5,000  — not issued: left out
 * Every invoice:   W qty 3, sales 3,000, cost 700 + 300 = 1,000, margin 2,000
 *                  G qty 1, sales 1,500, cost 500 (estimate), margin 1,000
 *                  totals: sales 4,500, cost 1,500, margin 3,000
 * The browser holds the newest two invoices only (I3, I4) and the entries C3, C3R:
 *                  W qty 1, sales 1,000, cost 300, margin 700; totals sales 1,000
 */
import { stubFetch } from './helpers/dom';
import { balanceRouteHarness } from './helpers/balanceRouteHarness';
import test, { after, afterEach, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { SalesByItemReportView } from '../components/reporting/SalesByItemReportView';
import { useLedgerStore } from '../stores/useLedgerStore';
import { formatCurrency, workspaceYearMonth } from '../lib/utils';
import { computeSalesByItem, type SalesByItemReport } from '../server/reports/itemReports';
import type { ChartAccount, InventoryItem, Invoice, Transaction } from '../types';

const Y = workspaceYearMonth().year;
const from = `${Y}-01-01`, to = `${Y}-12-31`;
const chart = (ws: string): ChartAccount[] => [
  { id: `${ws}_cogs`, workspaceId: ws, uid: 'owner-1', code: '5000', name: 'Cost of Goods Sold', type: 'expense', category: 'COGS' } as ChartAccount,
  { id: `${ws}_inv`, workspaceId: ws, uid: 'owner-1', code: '1300', name: 'Inventory', type: 'asset', category: 'Inventory' } as ChartAccount,
];
const stock = (ws: string): InventoryItem[] => [
  { id: `${ws}_W`, workspaceId: ws, uid: 'owner-1', name: 'Widget', sku: 'W-1', unitCostCents: 300 } as InventoryItem,
  { id: `${ws}_G`, workspaceId: ws, uid: 'owner-1', name: 'Gadget', sku: 'G-1', unitCostCents: 500 } as InventoryItem,
];
const invoice = (ws: string, n: number, date: string, status: string, item: string, quantity: number, amountCents: number) => ({
  id: `${ws}_I${n}`, workspaceId: ws, uid: 'owner-1', number: `I${n}`, date, status, exchangeRate: 1,
  items: [{ id: 'l1', itemId: `${ws}_${item}`, description: item, quantity, amountCents }],
}) as unknown as Invoice;
const invoices = (ws: string): Invoice[] => [
  invoice(ws, 1, `${Y}-01-10`, 'sent', 'W', 2, 2000),
  invoice(ws, 2, `${Y}-02-05`, 'paid', 'G', 1, 1500),
  invoice(ws, 3, `${Y}-03-01`, 'sent', 'W', 1, 1000),
  invoice(ws, 4, `${Y}-03-20`, 'draft', 'W', 5, 5000),
];
const cogsTx = (ws: string, id: string, date: string, cents: number, metadata: Record<string, unknown>) => ({
  id: `${ws}_${id}`, workspaceId: ws, uid: 'owner-1', date, description: id, totalAmountCents: Math.abs(cents), currency: 'USD', status: 'completed', type: 'journal',
  metadata, lines: [{ accountId: `${ws}_cogs`, amountCents: cents }, { accountId: `${ws}_inv`, amountCents: -cents }],
}) as unknown as Transaction;
const entries = (ws: string): Transaction[] => [
  cogsTx(ws, 'C1', `${Y}-01-10`, 700, { cogsForInvoiceId: `${ws}_I1`, cogsForLineId: 'l1' }),
  cogsTx(ws, 'C3', `${Y}-03-01`, 400, { cogsForInvoiceId: `${ws}_I3`, cogsForLineId: 'l1' }),
  cogsTx(ws, 'C3R', `${Y}-03-05`, -400, { isReversal: true, reversesTxId: `${ws}_C3` }),
];
const brief = (r: Pick<SalesByItemReport, 'rows'>) => r.rows.map(x => `${x.name} ${x.quantity} ${x.salesCents} ${x.costCents} ${x.marginCents}`).sort();
const TRUTH = ['Gadget 1 1500 500 1000', 'Widget 3 3000 1000 2000'];

describe('L-123 step 4b: sales by item (no database)', () => {
  const ws = 'component-workspace';
  const accounts = chart(ws), items = stock(ws), all = invoices(ws), txs = entries(ws);
  const loadedInvoices = all.slice(2), loadedTxs = txs.slice(1);
  afterEach(() => { cleanup(); useLedgerStore.setState({ truncatedCollections: {} }); });

  test('every invoice gives the hand-worked report; the loaded two do not', () => {
    const full = computeSalesByItem({ invoices: all, items, transactions: txs, accounts, startDate: from, endDate: to });
    assert.deepEqual(brief(full), TRUTH);
    assert.deepEqual([full.totals.salesCents, full.totals.costCents, full.totals.marginCents], [4500, 1500, 3000]);
    const own = computeSalesByItem({ invoices: loadedInvoices, items, transactions: loadedTxs, accounts, startDate: from, endDate: to });
    assert.deepEqual(brief(own), ['Widget 1 1000 300 700']);
  });

  test('screen: no request when not capped; the server\'s report when capped; the loaded report with a note when it fails', async () => {
    setComponentWorkspace('owner');
    useLedgerStore.setState({ accounts, inventory: items, invoices: loadedInvoices, transactions: loadedTxs, truncatedCollections: {} } as never);
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      const full = computeSalesByItem({ invoices: all, items, transactions: txs, accounts, startDate: from, endDate: to });
      return new Response(JSON.stringify({ status: 'success', ...full }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    render(<SalesByItemReportView selectedYear={Number(Y)} />);
    assert.ok(document.body.textContent!.includes(formatCurrency(1000)));
    assert.ok(!document.body.textContent!.includes(formatCurrency(4500)));
    assert.equal(screen.queryByTestId('sales-by-item-source'), null);
    assert.equal(urls.length, 0, 'not capped: no request');
    cleanup();

    // a capped chart alone (which lines are cost of goods sold) also asks the server
    useLedgerStore.setState({ truncatedCollections: { inventory: true } } as never);
    render(<SalesByItemReportView selectedYear={Number(Y)} />);
    await waitFor(() => assert.ok(urls.length > 0, 'a capped inventory asks the server'));
    cleanup();
    urls.length = 0;
    useLedgerStore.setState({ truncatedCollections: { chartAccounts: true } } as never);
    render(<SalesByItemReportView selectedYear={Number(Y)} />);
    await waitFor(() => assert.ok(urls.length > 0));
    cleanup();
    urls.length = 0;

    useLedgerStore.setState({ truncatedCollections: { invoices: true } });
    render(<SalesByItemReportView selectedYear={Number(Y)} />);
    await waitFor(() => assert.ok(document.body.textContent!.includes(formatCurrency(4500)), document.body.textContent!), { timeout: 5000 });
    assert.ok(urls.includes(`/api/v1/balances/sales-by-item?workspaceId=${ws}&from=${from}&to=${to}`), urls.join('\n'));
    assert.match(screen.getByTestId('sales-by-item-source').textContent || '', /read from the server/);
    // a unit-cost edit changes the server's estimate, so it is asked again
    const asked = urls.length;
    useLedgerStore.setState({ inventory: items.map(i => (i.name === 'Gadget' ? { ...i, unitCostCents: 600 } : i)) } as never);
    await waitFor(() => assert.equal(urls.length, asked + 1));
    // so does reclassifying an account (which lines count as cost of goods sold)
    useLedgerStore.setState({ accounts: accounts.map(a => (a.code === '5000' ? { ...a, category: 'Operating Expenses' } : a)) } as never);
    await waitFor(() => assert.equal(urls.length, asked + 2));
    // and renaming an item (its row label)
    useLedgerStore.setState(st => ({ inventory: st.inventory.map(i => (i.name === 'Widget' ? { ...i, name: 'Widget Pro', sku: 'W-2' } : i)) }) as never);
    await waitFor(() => assert.equal(urls.length, asked + 3));
    // and an entry dated before the range (a range invoice's cost may be posted or reversed then)
    useLedgerStore.setState(st => ({ transactions: [...st.transactions, cogsTx(ws, 'C0R', `${Number(Y) - 1}-12-31`, -100, { isReversal: true, reversesTxId: `${ws}_C1` })] }) as never);
    await waitFor(() => assert.equal(urls.length, asked + 4));
    cleanup();

    stubFetch(500);
    render(<SalesByItemReportView selectedYear={Number(Y)} />);
    await waitFor(() => assert.match(screen.getByTestId('sales-by-item-source').textContent || '', /may be missing/));
    assert.ok(!document.body.textContent!.includes(formatCurrency(4500)));
  });
});

const url = process.env.LF_TEST_DATABASE_URL;

describe('L-123 step 4b: GET /api/v1/balances/sales-by-item', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const api = balanceRouteHarness('ws_l123g', 'L-123 step 4b');
  const ws = api.ws;
  const get = (q: Record<string, string>, uid?: string) => api.get<SalesByItemReport & { invoicesRead: number }>('sales-by-item', q, uid);
  before(() => api.start({ chartAccounts: chart(ws), inventory: stock(ws), invoices: invoices(ws), transactions: entries(ws) }));
  after(() => api.stop());

  test('every invoice of the range with its posted cost and that cost\'s reversal; members only', async () => {
    const year = await get({ workspaceId: ws, from, to });
    assert.equal(year.status, 200);
    assert.equal(year.body.invoicesRead, 4);
    assert.deepEqual(brief(year.body), TRUTH);
    assert.deepEqual([year.body.totals.salesCents, year.body.totals.costCents], [4500, 1500]);
    const feb = await get({ workspaceId: ws, from: `${Y}-02-01`, to: `${Y}-02-28` });
    assert.deepEqual(brief(feb.body), ['Gadget 1 1500 500 1000']);
    assert.equal((await get({ workspaceId: ws, from, to }, 'stranger')).status, 403);
    assert.equal((await get({ workspaceId: ws, from: to, to: from })).status, 400);
    assert.equal((await get({ workspaceId: ws, from: `${Y}-02-30`, to })).status, 400, 'not a calendar day');
    assert.equal((await get({ workspaceId: 'ws_missing_l123g', from, to })).status, 404);
  });
});
