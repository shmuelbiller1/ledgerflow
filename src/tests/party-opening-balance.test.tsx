/**
 * A customer's or vendor's opening balance (BA-02): one open invoice (bill) against Opening Balance
 * Equity, so it shows in aging and is paid like any other, and never counts as sales or expenses.
 */
import './helpers/dom';
import test, { after, afterEach, before, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PartyOpeningBalance from '../components/common/PartyOpeningBalance';
import { isOpeningBalanceDocument, openingBalanceDocument } from '../lib/partyOpeningBalance';
import { lineAmount } from '../lib/txFilters';
import { computeSalesByItem } from '../server/reports/itemReports';
import { useLedgerStore } from '../stores/useLedgerStore';
import { getSupabase } from '../lib/db/client';
import { makeBill, makeChartAccount, makeInvoice } from './fixtures';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import type { Transaction, Workspace } from '../types';

const equity = { id: 'obe', name: 'Opening Balance Equity' };

describe('The opening balance document', () => {
  test('customer: an open invoice with one line on Opening Balance Equity; vendor: an open bill', () => {
    const invoice = openingBalanceDocument('customer', { id: 'cust-1234567', name: 'Acme' }, equity, 125000, '2026-01-01', 'USD');
    assert.deepEqual([invoice.number, invoice.customerId, invoice.status, invoice.amountCents, invoice.date, invoice.dueDate], ['OB-CUST-1', 'cust-1234567', 'sent', 125000, '2026-01-01', '2026-01-01']);
    assert.deepEqual(invoice.items?.map(i => [i.accountId, i.amountCents, i.description]), [['obe', 125000, 'Opening balance']]);
    assert.equal(isOpeningBalanceDocument(invoice as { metadata?: Record<string, unknown> }), true);
    const bill = openingBalanceDocument('vendor', { id: 'v1', name: 'Paper Co' }, equity, 4000, '2026-01-01');
    assert.deepEqual([bill.vendorId, bill.status, bill.splits?.[0]?.accountId, bill.splits?.[0]?.amountCents], ['v1', 'pending', 'obe', 4000]);
    assert.equal(isOpeningBalanceDocument({ metadata: { type: 'bill-accrual' } }), false);
  });

  test('it is money owed from before, not a sale: Sales by Item leaves it out', () => {
    const opening = makeInvoice({ id: 'ob', ...openingBalanceDocument('customer', { id: 'c1', name: 'Acme' }, equity, 9000, '2026-01-01') });
    const sale = makeInvoice({ id: 's1', date: '2026-01-05', status: 'sent', items: [{ id: 'l1', description: 'Work', quantity: 1, rateCents: 500, amountCents: 500, accountId: 'rev' }] });
    const report = computeSalesByItem({ invoices: [opening, sale], items: [], transactions: [], accounts: [] });
    assert.deepEqual(report.rows.map(r => r.salesCents), [500]);
  });

  test('refused: zero, a fraction of a cent, no date', () => {
    assert.throws(() => openingBalanceDocument('vendor', { id: 'v1', name: 'P' }, equity, 0, '2026-01-01'), /above 0/);
    assert.throws(() => openingBalanceDocument('vendor', { id: 'v1', name: 'P' }, equity, 10.5, '2026-01-01'), /above 0/);
    assert.throws(() => openingBalanceDocument('vendor', { id: 'v1', name: 'P' }, equity, 100, ''), /date/);
  });
});

describe('Posting an opening balance', () => {
  const sent: Transaction[][] = [];
  const realFetch = globalThis.fetch;
  let LedgerPostService: typeof import('../services/LedgerPostService').LedgerPostService;
  before(async () => {
    globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
      sent.push(JSON.parse(String(init?.body || '{}')).transactions || []);
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    ({ LedgerPostService } = await import('../services/LedgerPostService'));
  });
  after(() => { globalThis.fetch = realFetch; });
  const accounts = [
    makeChartAccount({ id: 'cash', name: 'Checking', type: 'asset', category: 'Cash' }),
    makeChartAccount({ id: 'ar', name: 'Accounts Receivable', type: 'asset', category: 'Receivables' }),
    makeChartAccount({ id: 'ap', name: 'Accounts Payable', type: 'liability', category: 'Payables' }),
    makeChartAccount({ id: 'rev', name: 'Sales', type: 'income', category: 'Revenue' }),
    makeChartAccount({ id: 'exp', name: 'Supplies', type: 'expense', category: 'Operating' }),
    makeChartAccount({ id: 'obe', name: 'Opening Balance Equity', type: 'equity', category: 'Equity' }),
  ];
  const context = { lockDate: null, transactions: [], inventory: [], workspaces: [{ id: 'w1', uid: 'u1', name: 'W', currency: 'USD' } as Workspace], accounts };
  const byAccount = (tx: Transaction) => Object.fromEntries(tx.lines.map(l => [l.accountId, lineAmount(l, tx)]));

  test('customer: DR receivables, CR Opening Balance Equity (not sales)', async () => {
    sent.length = 0;
    await LedgerPostService.postInvoiceLedger('ob1', openingBalanceDocument('customer', { id: 'c1', name: 'Acme' }, equity, 125000, '2026-01-01', 'USD'), 'w1', 'u1', undefined, context);
    assert.deepEqual(byAccount(sent[0][0]), { ar: 125000, obe: -125000 });
  });

  test('vendor: DR Opening Balance Equity, CR payables (not an expense)', async () => {
    sent.length = 0;
    await LedgerPostService.postBillLedger('ob2', openingBalanceDocument('vendor', { id: 'v1', name: 'Paper Co' }, equity, 4000, '2026-01-01', 'USD'), 'w1', 'u1', undefined, context);
    assert.deepEqual(byAccount(sent[0][0]), { obe: 4000, ap: -4000 });
  });
});

describe('On the contact page', () => {
  beforeEach(() => {
    setComponentWorkspace('bookkeeper');
    markComponentCollectionsLoaded('bills', 'invoices', 'accounts');
    useLedgerStore.setState({ bills: [], invoices: [], accounts: [
      makeChartAccount({ id: 'obe', name: 'Opening Balance Equity', type: 'equity', category: 'Equity', code: '3900' }),
      makeChartAccount({ id: 'ap', name: 'Accounts Payable', type: 'liability', category: 'Payables', code: '2000' }),
      makeChartAccount({ id: 'cash', name: 'Checking', type: 'asset', category: 'Cash', code: '1000' }),
      makeChartAccount({ id: 'exp', name: 'Supplies', type: 'expense', category: 'Operating', code: '6000' }),
    ] });
  });
  afterEach(async () => { cleanup(); await getSupabase().auth.dispose(); });

  test('type the amount and date, Enter: the bill is created through the normal posting', async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ url, method: init?.method || 'GET', body });
      if (url === '/api/v1/commands/bill.create') return Response.json({ status: 'success', data: { collection: 'bills' } });
      // The balance sync starts after the save; PostgREST list reads are arrays and RPCs are JSON.
      return Response.json(url.includes('/rest/v1/') ? [] : {});
    }) as typeof fetch;
    render(<PartyOpeningBalance side="vendor" party={{ id: 'v1', name: 'Paper Co' }} />);
    fireEvent.change(screen.getByLabelText('Opening balance date'), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByLabelText('Opening balance of Paper Co'), { target: { value: '40.00' } });
    await act(async () => { fireEvent.keyDown(screen.getByLabelText('Opening balance of Paper Co'), { key: 'Enter' }); });
    // The UI invokes the registered command; the server builds the ledger entry from its bill input.
    const isSave = (call: { url: string }) => call.url === '/api/v1/commands/bill.create';
    await waitFor(() => assert.ok(calls.some(isSave)));
    const request = calls.find(isSave)!.body as { workspaceId: string; input: { bill: Record<string, unknown>; transactions?: unknown } };
    const bill = request.input.bill;
    assert.equal(request.input.transactions, undefined, 'no ledger entries are sent');
    assert.deepEqual([calls.find(isSave)!.method, request.workspaceId, bill.vendorId, bill.amountCents, bill.date, (bill.metadata as { type?: string } | undefined)?.type],
      ['POST', 'component-workspace', 'v1', 4000, '2026-01-01', 'opening-balance']);
  });

  test('once entered it is shown, not entered again; viewers only read', () => {
    useLedgerStore.setState({ bills: [makeBill({ id: 'b1', vendorId: 'v1', amountCents: 4000, date: '2026-01-01', status: 'pending', metadata: { type: 'opening-balance' } })] });
    render(<PartyOpeningBalance side="vendor" party={{ id: 'v1', name: 'Paper Co' }} />);
    assert.ok(screen.getByText(/on 2026-01-01/));
    assert.equal(screen.queryByLabelText('Opening balance of Paper Co'), null);
    cleanup();
    useLedgerStore.setState({ bills: [] });
    setComponentWorkspace('viewer');
    render(<PartyOpeningBalance side="vendor" party={{ id: 'v1', name: 'Paper Co' }} />);
    assert.ok(screen.getByText('None'));
  });
});
