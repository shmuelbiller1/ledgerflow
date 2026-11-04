/**
 * L-123 step 4p: the dashboard's chart exploration (ChartExploration) reads its expense maps and invoice payment points
 * from the server (GET /api/v1/balances/chart-exploration, useServerChartExploration) when the loaded lists are capped.
 *
 * Hand-worked case (cents), months 2026-01 … 2026-02:
 *   Rent (category Occupancy): E1 2026-01-10 300 + E2 2026-02-10 200 → 500
 *   Invoice I-1 issued 2026-01-05, paid 2026-01-15, 1,000 → one point: 10 days, 1,000. I-2 is still open: no point.
 * The browser holds only E2 (the entries are capped, the oldest loaded day 2026-02-10): Rent 200.
 */
import './helpers/dom';
import test, { after, afterEach, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { formatCurrency } from '../lib/utils';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { setComponentWorkspace, markComponentCollectionsLoaded } from './helpers/componentFixtures';
import { balanceRouteHarness } from './helpers/balanceRouteHarness';
import ChartExploration from '../components/charts/ChartExploration';
import { useLedgerStore } from '../stores/useLedgerStore';
import { expenseChartLeaves, invoicePaymentPoints, type ExpenseChartLeaf } from '../lib/chartExploration';
import { makeChartAccount, makeTransaction } from './fixtures';
import type { Invoice, Transaction } from '../types';

globalThis.ResizeObserver = window.ResizeObserver;

const months = ['2026-01', '2026-02'], from = '2026-01-01', to = '2026-02-28';
const chart = (ws: string) => [
  makeChartAccount({ id: `${ws}_rent`, workspaceId: ws, name: 'Rent', type: 'expense', category: 'Occupancy' }),
  makeChartAccount({ id: `${ws}_cash`, workspaceId: ws, name: 'Cash', type: 'asset', category: 'Cash' }),
];
const spend = (ws: string, id: string, date: string, cents: number) => makeTransaction({
  id: `${ws}_${id}`, workspaceId: ws, date, totalAmountCents: cents, status: 'completed',
  lines: [{ accountId: `${ws}_rent`, amountCents: cents }, { accountId: `${ws}_cash`, amountCents: -cents }],
}) as Transaction;
const entries = (ws: string) => [spend(ws, 'E1', '2026-01-10', 300), spend(ws, 'E2', '2026-02-10', 200)];
const invoices = (ws: string) => [
  { id: `${ws}_I1`, workspaceId: ws, uid: 'owner-1', number: 'I-1', date: '2026-01-05', paymentDate: '2026-01-15', status: 'paid', amountCents: 1000, exchangeRate: 1, items: [] },
  { id: `${ws}_I2`, workspaceId: ws, uid: 'owner-1', number: 'I-2', date: '2026-02-01', status: 'sent', amountCents: 400, exchangeRate: 1, items: [] },
] as unknown as Invoice[];
const brief = (leaves: ExpenseChartLeaf[]) => leaves.filter(l => l.cents).map(l => `${l.path[0]}/${l.label} ${l.cents}`);

describe('L-123 step 4p: chart exploration (no database)', () => {
  const ws = 'component-workspace';
  afterEach(() => { cleanup(); useLedgerStore.setState({ truncatedCollections: {} }); });

  test('every entry gives the hand-worked leaves and point; the loaded one does not', () => {
    assert.deepEqual(brief(expenseChartLeaves(chart(ws), entries(ws), from, to)), ['Occupancy/Rent 500']);
    assert.deepEqual(brief(expenseChartLeaves(chart(ws), entries(ws).slice(1), from, to)), ['Occupancy/Rent 200']);
    assert.deepEqual(invoicePaymentPoints(invoices(ws)).map(p => `${p.days}d ${p.cents}`), ['10d 1000']);
  });

  test('screen: capped entries reaching the oldest loaded day give the charts from the server, with a note', async () => {
    setComponentWorkspace('owner');
    useLedgerStore.setState({ accounts: chart(ws), transactions: entries(ws).slice(1), invoices: invoices(ws), truncatedCollections: { transactions: true } } as never);
    markComponentCollectionsLoaded('invoices', 'accounts', 'transactions');
    const asked: string[] = [];
    globalThis.fetch = (async (u: RequestInfo | URL) => {
      asked.push(String(u));
      return Response.json({ status: 'success', leaves: expenseChartLeaves(chart(ws), entries(ws), from, to), points: invoicePaymentPoints(invoices(ws)) });
    }) as typeof fetch;
    render(<ChartExploration months={months} currency="USD" />);
    await waitFor(() => assert.match(screen.getByTestId('chart-exploration-source').textContent || '', /read from every entry on the server/), { timeout: 5000 });
    assert.ok(asked.some(u => u.includes(`/api/v1/balances/chart-exploration?workspaceId=${ws}&from=${from}&to=${to}`)), asked.join('\n'));
    const treemap = screen.getByRole('region', { name: 'Expenses by category treemap' }).textContent || '';
    assert.ok(treemap.includes(`Rent: ${formatCurrency(500, 'USD')}`), treemap);
  });

  test('screen: the expense maps draw while the invoices are still loading', async () => {
    setComponentWorkspace('owner');
    useLedgerStore.setState({ accounts: chart(ws), transactions: entries(ws), invoices: [], truncatedCollections: {} } as never);
    markComponentCollectionsLoaded('accounts', 'transactions');
    useDataNeedsStore.setState(s => ({ loaded: { ...s.loaded, invoices: false }, failed: {} }));
    render(<ChartExploration months={months} currency="USD" />);
    await waitFor(() => {
      const treemap = screen.getByRole('region', { name: 'Expenses by category treemap' }).textContent || '';
      assert.ok(treemap.includes(`Rent: ${formatCurrency(500, 'USD')}`), treemap);
    }, { timeout: 5000 });
  });
});

const url = process.env.LF_TEST_DATABASE_URL;

describe('L-123 step 4p: GET /api/v1/balances/chart-exploration', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const api = balanceRouteHarness('ws_l123s', 'L-123 step 4p');
  const ws = api.ws;
  const get = (q: Record<string, string>, uid?: string) => api.get<{ leaves: ExpenseChartLeaf[]; points: { days: number; cents: number }[]; entriesRead: number; invoicesRead: number }>('chart-exploration', { workspaceId: ws, ...q }, uid);
  before(() => api.start({ chartAccounts: chart(ws), transactions: entries(ws), invoices: invoices(ws) }));
  after(() => api.stop());

  test('every entry and invoice of the months: the hand-worked leaves and point; members only', async () => {
    const r = await get({ from, to });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(brief(r.body.leaves), ['Occupancy/Rent 500']);
    assert.deepEqual(r.body.points.map(p => `${p.days}d ${p.cents}`), ['10d 1000']);
    assert.equal(r.body.invoicesRead, 2);
    assert.equal((await get({ from: 'x', to })).status, 400);
    assert.equal((await get({ from, to }, 'stranger')).status, 403);
  });
});
