/**
 * Sales orders (K-04): an estimate the customer said yes to becomes an order ("Order", with their
 * reference), and the order is invoiced in one go or in parts (the rest, a percentage, an amount).
 * What is invoiced is read from the invoices made from it (voided ones don't count); each part
 * gives every order line its share, so once everything is invoiced each line was invoiced exactly.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import EstimatesView from '../components/sales/EstimatesView';
import { orderPartInvoice, orderProgress, orderStage, partCents, partLabel, partProblem } from '../lib/salesOrders';
import { layoutDocumentPdf } from '../server/services/pdfService';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { makeChartAccount } from './fixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import { getSupabase } from '../lib/db/client';
import type { Estimate, Invoice } from '../types';

const order = (over: Partial<Estimate> = {}): Estimate => ({
  id: 'so1', uid: 'u', workspaceId: 'component-workspace', customerId: 'c1', customerName: 'Acme', number: 'EST-12', amountCents: 100001,
  date: '2026-09-01', status: 'accepted', orderedAt: '2026-09-02T10:00:00Z', createdAt: '',
  lines: [
    { description: 'Design', quantity: 2, unitPriceCents: 30000, amountCents: 60000 },
    { description: 'Build', quantity: 1, unitPriceCents: 40001, amountCents: 40001 },
  ],
  ...over,
} as Estimate);
const invoice = (id: string, amountCents: number, over: Partial<Invoice> = {}): Invoice => ({
  id, uid: 'u', workspaceId: 'component-workspace', customerId: 'c1', number: id.toUpperCase(), amountCents, date: '2026-09-10', status: 'sent',
  metadata: { convertedFromEstimateId: 'so1' }, ...over,
} as Invoice);

describe('The rules', () => {
  test('invoiced so far comes from the invoices made from it; voided ones and other estimates don\'t count', () => {
    const est = order({ amountCents: 100001 });
    const progress = orderProgress(est, [invoice('inv-1', 40000), invoice('inv-2', 5000, { status: 'void' }), invoice('inv-3', 7000, { metadata: { convertedFromEstimateId: 'other' } })]);
    assert.deepEqual([progress.invoicedCents, progress.leftCents, progress.invoices.map(i => i.id)], [40000, 60001, ['inv-1']]);
    assert.equal(orderStage(est, progress), 'partly invoiced');
    assert.equal(orderStage(est, orderProgress(est, [])), 'order');
    assert.equal(orderStage(est, orderProgress(est, [invoice('inv-1', 100001)])), 'invoiced');
    assert.equal(orderStage(order({ orderedAt: undefined, status: 'sent' }), orderProgress(est, [])), 'quote');
    assert.equal(orderStage(order({ orderedAt: undefined, status: 'converted' }), orderProgress(est, [])), 'invoiced');
    assert.equal(orderStage(order({ status: 'declined' }), orderProgress(est, [])), 'declined');
  });

  test('how much a part is, and when it is refused', () => {
    const progress = orderProgress(order({ amountCents: 100001 }), [invoice('inv-1', 40000)]);
    assert.equal(partCents({ mode: 'rest' }, progress), 60001);
    assert.equal(partCents({ mode: 'percent', percent: 25 }, progress), 25000);
    assert.equal(partProblem({ mode: 'percent', percent: 70 }, progress), 'That is more than is left to invoice');
    assert.equal(partProblem({ mode: 'percent', percent: 0 }, progress), 'Enter a percentage between 0 and 100');
    assert.equal(partProblem({ mode: 'amount', cents: 0 }, progress), 'Enter an amount above zero');
    assert.equal(partProblem({ mode: 'amount', cents: 60001 }, progress), null);
    assert.equal(partProblem({ mode: 'rest' }, orderProgress(order({ amountCents: 40000 }), [invoice('inv-1', 40000)])), 'Nothing is left to invoice on this order');
  });

  test('each line gets its share in whole cents, and after the last part every line is invoiced exactly', () => {
    const est = order({ amountCents: 100001 });
    const first = orderPartInvoice(est, orderProgress(est, []), 33333, partLabel({ mode: 'amount', cents: 33333 }, est, orderProgress(est, [])));
    assert.deepEqual(first.items!.map(i => [i.description, i.amountCents, i.quantity]), [['Design (part 1 of order EST-12)', 20000, 1], ['Build (part 1 of order EST-12)', 13333, 1]]);
    assert.equal(first.amountCents, 33333);
    assert.deepEqual(first.metadata, { convertedFromEstimateId: 'so1', convertedFromEstimateNumber: 'EST-12', salesOrderPart: 1 });
    const afterFirst = orderProgress(est, [invoice('inv-1', 33333)]);
    const rest = orderPartInvoice(est, afterFirst, afterFirst.leftCents, partLabel({ mode: 'rest' }, est, afterFirst));
    assert.deepEqual(rest.items!.map(i => [i.description, i.amountCents]), [['Design (rest of order EST-12)', 40000], ['Build (rest of order EST-12)', 26668]]);
  });

  test('invoiced in one go, the lines keep their quantity and price', () => {
    const est = order({ amountCents: 100001 });
    const all = orderPartInvoice(est, orderProgress(est, []), 100001, 'x');
    assert.deepEqual(all.items!.map(i => [i.description, i.quantity, i.rateCents, i.amountCents]), [['Design', 2, 30000, 60000], ['Build', 1, 40001, 40001]]);
  });

  test('its PDF is titled SALES ORDER with the customer\'s reference; a quote stays an ESTIMATE', () => {
    const layout = layoutDocumentPdf('estimate', { number: 'EST-12', orderedAt: '2026-09-02', customerReference: 'PO-77', amountCents: 100 }, { name: 'Shop' });
    assert.equal(layout.title, 'SALES ORDER');
    assert.ok(layout.meta.some(([k, v]) => k === 'Your reference' && v === 'PO-77'));
    assert.equal(layoutDocumentPdf('estimate', { number: 'EST-1', amountCents: 100 }, { name: 'Shop' }).title, 'ESTIMATE');
  });
});

describe('On the estimates screen', () => {
  beforeEach(() => {
    markComponentCollectionsLoaded('estimates', 'customers', 'payments', 'invoices');
    useLedgerStore.setState({ accounts: [
      makeChartAccount({ id: 'ar', code: '1200', name: 'Accounts Receivable', type: 'asset', category: 'Accounts Receivable' }),
      makeChartAccount({ id: 'sales', code: '4000', name: 'Sales', type: 'revenue', category: 'Revenue' }),
      makeChartAccount({ id: 'bank', code: '1000', name: 'Checking', type: 'asset', category: 'Cash' }),
    ], transactions: [] });
  });
  afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });
  /** next-number answers with `number`, reads with no rows, writes with nothing; every request kept */
  const stubServer = (number = 'INV-2') => {
    const calls: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
      const body = url.endsWith('/next-number') ? { number } : url.endsWith('/transactions/bulk') ? { status: 'ok' } : /\/rpc\//.test(url) ? null : [];
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    return calls;
  };
  type Row = Record<string, unknown>;
  // database writes (p_table + p_set/p_data) and documents saved through the server's posting (entityMutation, or
  // an invoice or bill sent to /documents/:type/:id/post, L94-STEP2)
  const written = (calls: Array<{ url: string; body: unknown }>, table: string): Row[] => calls.flatMap(c => {
    const body = (c.body || {}) as { p_table?: string; p_set?: Row; p_data?: Row; entityMutation?: { collection: string; data: Row } };
    const post = c.url.match(/\/api\/v1\/documents\/(invoices|bills)\/[^/]+\/post$/);
    if (post) return post[1] === table ? [(body as { data: Row }).data] : [];
    if (c.url.endsWith('/transactions/bulk')) return body.entityMutation?.collection === table ? [body.entityMutation.data] : [];
    return /\/rpc\/lf_\w+/.test(c.url) && body.p_table === table ? [(body.p_set || body.p_data)!] : [];
  });

  test('a quote becomes an order with the customer\'s reference', async () => {
    setComponentWorkspace('bookkeeper');
    useLedgerStore.setState({ estimates: [order({ orderedAt: undefined, status: 'sent' })], invoices: [], payments: [], customers: [] });
    const calls = stubServer();
    render(<EstimatesView />);
    assert.ok(screen.getByText('quote'));
    fireEvent.click(screen.getByRole('button', { name: 'Make estimate EST-12 an order' }));
    fireEvent.change(screen.getByLabelText(/Customer's reference/), { target: { value: 'PO-77' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Make it an order' })); });
    await waitFor(() => assert.ok(written(calls, 'estimates').some(d => d.orderedAt)));
    const saved = written(calls, 'estimates').find(d => d.orderedAt)!;
    assert.deepEqual([saved.status, saved.customerReference, saved.orderedBy], ['accepted', 'PO-77', 'test-user']);
  });

  test('an order shows what is invoiced and left; a part becomes a draft invoice', async () => {
    setComponentWorkspace('bookkeeper');
    useLedgerStore.setState({ estimates: [order({ customerReference: 'PO-77' })], invoices: [invoice('inv-1', 40000)], payments: [], customers: [] });
    const calls = stubServer('INV-2');
    render(<EstimatesView />);
    assert.ok(screen.getByText('partly invoiced'));
    assert.match(document.body.textContent || '', /Customer ref PO-77/);
    assert.match(document.body.textContent || '', /Invoiced \$400\.00 \(INV-1\)/);
    assert.match(document.body.textContent || '', /\$600\.01 left to invoice/);
    assert.ok(screen.getByRole('button', { name: 'Orders to invoice (1)' }));
    assert.equal(screen.queryByRole('button', { name: /^Convert/ }), null, 'an order is invoiced in parts, not converted whole again');
    fireEvent.click(screen.getByRole('button', { name: 'Invoice order EST-12' }));
    fireEvent.click(screen.getByLabelText('A percentage of the order'));
    fireEvent.change(screen.getByLabelText('Percentage of the order'), { target: { value: '25' } });
    assert.match(document.body.textContent || '', /Design \(25% of order EST-12\)\$150\.00/);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create $250.00 invoice' })); });
    await waitFor(() => assert.ok(written(calls, 'invoices').some(d => d.amountCents === 25000)));
    const inv = written(calls, 'invoices').find(d => d.amountCents === 25000)!;
    assert.deepEqual([inv.number, inv.status, (inv.metadata as Record<string, unknown>).salesOrderPart, (inv.metadata as Record<string, unknown>).convertedFromEstimateId], ['INV-2', 'draft', 2, 'so1']);
    assert.equal(written(calls, 'estimates').some(d => d.status === 'converted'), false, 'not finished yet');
  });

  test('invoicing the rest finishes the order', async () => {
    setComponentWorkspace('owner');
    useLedgerStore.setState({ estimates: [order()], invoices: [invoice('inv-1', 40000)], payments: [], customers: [] });
    const calls = stubServer('INV-3');
    render(<EstimatesView />);
    fireEvent.click(screen.getByRole('button', { name: 'Invoice order EST-12' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create $600.01 invoice' })); });
    await waitFor(() => assert.ok(written(calls, 'estimates').some(d => d.status === 'converted')));
    assert.ok(written(calls, 'invoices').some(d => d.amountCents === 60001));
  });

  test('a viewer sees the orders but gets no Order or Invoice; Declined closes a quote', async () => {
    setComponentWorkspace('viewer');
    useLedgerStore.setState({ estimates: [order(), order({ id: 'q2', number: 'EST-13', orderedAt: undefined, status: 'sent' })], invoices: [], payments: [], customers: [] });
    stubServer();
    const view = render(<EstimatesView />);
    assert.equal(screen.queryByRole('button', { name: /^Invoice order/ }), null);
    assert.equal(screen.queryByRole('button', { name: /^Make estimate/ }), null);
    view.unmount();
    setComponentWorkspace('accountant');
    const calls = stubServer();
    render(<EstimatesView />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Mark estimate EST-13 declined' })); });
    await waitFor(() => assert.ok(written(calls, 'estimates').some(d => d.status === 'declined')));
    fireEvent.click(screen.getByRole('button', { name: 'Quotes (1)' }));
    assert.doesNotMatch(document.body.textContent || '', /#EST-12/);
    assert.match(document.body.textContent || '', /#EST-13/);
  });
});
