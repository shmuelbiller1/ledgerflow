/**
 * L-123 step 4q: Customer lifetime value (CustomerLifetimeValuePanel) reads its report from the server
 * (GET /api/v1/balances/customer-lifetime-value, useServerCustomerLifetimeValue) when the loaded lists are capped. The
 * route reads documents at any date, so all recorded history is not limited to three years.
 *
 * Hand-worked case (cents), Alpha, as of 2026-12-31, all recorded history, item Widget at unit cost 400 (no cost posted,
 * so estimated):
 *   I1 2023-03-01 W×1 1,000 (more than three years back) + I2 2026-03-01 W×2 2,000 → sales 3,000, cost 1,200
 *   credit note N1 2026-04-01 300 → net revenue 2,700, gross profit 1,500; orders 2, first 2023-03-01, last 2026-03-01
 *   a draft invoice and a void credit note are left out.
 * The browser holds only I2 and N1 (the invoices are capped): orders 1, net revenue 1,700, gross profit 900.
 */
import './helpers/dom';
import test, { after, afterEach, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { setComponentWorkspace, markComponentCollectionsLoaded } from './helpers/componentFixtures';
import { balanceRouteHarness } from './helpers/balanceRouteHarness';
import { CustomerLifetimeValuePanel } from '../components/reporting/CustomerLifetimeValueReportView';
import { useLedgerStore } from '../stores/useLedgerStore';
import { customerLifetimeValue, type CustomerLifetimeValueReport } from '../lib/customerLifetimeValue';
import type { CreditNote, Customer, InventoryItem, Invoice } from '../types';

const asOf = '2026-12-31';
const customers = (ws: string) => [{ id: `${ws}_alpha`, workspaceId: ws, uid: 'owner-1', name: 'Alpha' }] as Customer[];
const items = (ws: string) => [{ id: `${ws}_W`, workspaceId: ws, uid: 'owner-1', name: 'Widget', sku: 'W-1', unitCostCents: 400 }] as InventoryItem[];
const invoice = (ws: string, n: string, date: string, status: string, quantity: number, amountCents: number) => ({
  id: `${ws}_${n}`, workspaceId: ws, uid: 'owner-1', number: n, customerId: `${ws}_alpha`, date, status, exchangeRate: 1, amountCents,
  items: [{ id: 'l1', itemId: `${ws}_W`, description: 'Widget', quantity, amountCents }],
}) as unknown as Invoice;
const invoices = (ws: string) => [invoice(ws, 'I1', '2023-03-01', 'paid', 1, 1000), invoice(ws, 'D', '2026-05-01', 'draft', 5, 5000), invoice(ws, 'I2', '2026-03-01', 'sent', 2, 2000)];
const notes = (ws: string) => [
  { id: `${ws}_N1`, workspaceId: ws, uid: 'owner-1', customerId: `${ws}_alpha`, date: '2026-04-01', status: 'open', amountCents: 300, exchangeRate: 1 },
  { id: `${ws}_N2`, workspaceId: ws, uid: 'owner-1', customerId: `${ws}_alpha`, date: '2026-04-02', status: 'void', amountCents: 999, exchangeRate: 1 },
] as unknown as CreditNote[];
const brief = (r: CustomerLifetimeValueReport) => r.rows.map(x => `${x.name} ${x.orders} ${x.netRevenueCents}/${x.costCents}/${x.grossProfitCents} ${x.firstOrder}…${x.lastOrder}`);
const TRUTH = ['Alpha 2 2700/1200/1500 2023-03-01…2026-03-01'];
const all = (ws: string, list = invoices(ws)) => customerLifetimeValue({ customers: customers(ws), invoices: list, creditNotes: notes(ws), items: items(ws), transactions: [], accounts: [], asOfDate: asOf, lifespanYears: 3 });

describe('L-123 step 4q: customer lifetime value (no database)', () => {
  const ws = 'component-workspace';
  afterEach(() => { cleanup(); useLedgerStore.setState({ truncatedCollections: {} }); });

  test('every document gives the hand-worked row; the loaded ones do not', () => {
    assert.deepEqual(brief(all(ws)), TRUTH);
    assert.deepEqual(brief(all(ws, invoices(ws).slice(2))), ['Alpha 1 1700/800/900 2026-03-01…2026-03-01']);
  });

  test('screen: capped invoices give the server report over all history, with a note and no provisional alert', async () => {
    setComponentWorkspace('owner');
    useLedgerStore.setState({ customers: customers(ws), invoices: invoices(ws).slice(2), creditNotes: notes(ws), inventory: items(ws), transactions: [], accounts: [], truncatedCollections: { invoices: true } } as never);
    markComponentCollectionsLoaded('customers', 'invoices', 'creditNotes', 'inventory', 'transactions', 'accounts');
    const asked: string[] = [];
    globalThis.fetch = (async (u: RequestInfo | URL) => { asked.push(String(u)); return Response.json({ status: 'success', report: all(ws) }); }) as typeof fetch;
    render(<CustomerLifetimeValuePanel asOf={asOf} />);
    await waitFor(() => assert.match(screen.getByTestId('customer-lifetime-value-source').textContent || '', /read from every entry on the server/), { timeout: 5000 });
    assert.ok(document.body.textContent!.includes('2023-03-01'), document.body.textContent!);
    assert.equal(screen.queryByText(/These figures are provisional/), null);
    assert.ok(asked.some(u => u.includes(`/api/v1/balances/customer-lifetime-value?workspaceId=${ws}&from=0001-01-01&to=${asOf}&lifespan=3`)), asked.join('\n'));
  });
});

const url = process.env.LF_TEST_DATABASE_URL;

describe('L-123 step 4q: GET /api/v1/balances/customer-lifetime-value', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const api = balanceRouteHarness('ws_l123t', 'L-123 step 4q');
  const ws = api.ws;
  const get = (q: Record<string, string>, uid?: string) => api.get<{ report: CustomerLifetimeValueReport; invoicesRead: number; creditNotesRead: number }>('customer-lifetime-value', { workspaceId: ws, ...q }, uid);
  before(() => api.start({ customers: customers(ws), inventory: items(ws), invoices: invoices(ws), creditNotes: notes(ws) }));
  after(() => api.stop());

  test('all recorded history, more than three years: the hand-worked row; a window; bad input; members only', async () => {
    const r = await get({ from: '0001-01-01', to: asOf, lifespan: '3' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(brief(r.body.report), TRUTH);
    assert.equal(r.body.invoicesRead, 3);
    assert.equal(r.body.creditNotesRead, 2);
    assert.deepEqual(brief((await get({ from: '2026-01-01', to: asOf, lifespan: '3' })).body.report), ['Alpha 1 1700/800/900 2026-03-01…2026-03-01']);
    assert.equal((await get({ from: '0001-01-01', to: asOf, lifespan: '21' })).status, 400);
    assert.equal((await get({ from: 'x', to: asOf, lifespan: '3' })).status, 400);
    assert.equal((await get({ from: '0001-01-01', to: asOf, lifespan: '3' }, 'stranger')).status, 403);
  });
});
