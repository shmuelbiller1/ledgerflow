/**
 * BF-08 step 1: quotes and orders that sell stock items. A quote line can name an item; the order
 * is then invoiced by quantity, and each invoice line carries the item and its units, so the invoice
 * lowers stock and books the cost of exactly those units (src/services/invoiceCogs.ts). Two parts
 * never book the same units twice; a percentage or an amount of such an order is refused (money
 * before delivery is a deposit). Before this, an order's invoice lines had no item at all, so an
 * order of stock items never moved stock or cost.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import EstimatesView from '../components/sales/EstimatesView';
import { ITEM_ORDER_BY_QUANTITY, orderLineProgress, orderPartInvoice, orderProgress, partCents, partLabel, partProblem, resolvePart, type OrderPart } from '../lib/salesOrders';
import { convertEstimateToInvoice } from '../lib/estimateConverter';
import { planInvoiceCogs } from '../services/invoiceCogs';
import { blankEstimateLine, estimateLinesProblem, toEstimateLines } from '../lib/estimateLines';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { makeChartAccount, makeCustomer } from './fixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import { getSupabase } from '../lib/db/client';
import type { Estimate, InventoryItem, Invoice } from '../types';

const chair = { id: 'item-chair', uid: 'u', workspaceId: 'component-workspace', name: 'Oak chair', sku: 'CH-1', unitPriceCents: 12000, unitCostCents: 4500, quantityAtHand: 40, reorderPoint: 0, createdAt: '' } as InventoryItem;
const order = (over: Partial<Estimate> = {}): Estimate => ({
  id: 'so9', uid: 'u', workspaceId: 'component-workspace', customerId: 'c1', customerName: 'Acme', number: 'EST-20', amountCents: 63333,
  date: '2026-09-01', status: 'accepted', orderedAt: '2026-09-02T10:00:00Z', createdAt: '',
  lines: [
    { itemId: 'item-chair', description: 'Oak chair', quantity: 5, unitPriceCents: 12000, amountCents: 60000 },
    { description: 'Delivery and assembly', quantity: 1, unitPriceCents: 3333, amountCents: 3333 },
  ],
  ...over,
} as Estimate);
/** the invoice saved from a part (as the screen saves it), with an id and a status */
const saved = (est: Estimate, invoices: Invoice[], part: OrderPart, id: string, status = 'sent'): Invoice => {
  const progress = orderProgress(est, invoices);
  const resolved = resolvePart(part, est, progress);
  return { ...orderPartInvoice(est, progress, partCents(resolved, progress, est), partLabel(resolved, est, progress), resolved), id, uid: 'u', workspaceId: 'component-workspace', number: id.toUpperCase(), status } as Invoice;
};
const accounts = { inventoryAccount: { id: 'inv', name: 'Inventory' }, cogsAccount: { id: 'cogs', name: 'Cost of Goods Sold' } };
const costOf = (inv: Invoice) => planInvoiceCogs({ invoiceId: inv.id, invoice: inv, date: '2026-09-10', uid: 'u', workspaceId: 'w', baseCurrency: 'USD', items: [chair], ...accounts })
  .entries.reduce((s, e) => s + e.totalAmountCents, 0);

describe('The rules', () => {
  test('a part by quantity keeps the item, its units and its price on the invoice line', () => {
    const est = order();
    const inv = saved(est, [], { mode: 'quantities', quantities: [2, 0] }, 'inv-1');
    assert.deepEqual(inv.items!.map(i => [i.itemId, i.description, i.quantity, i.rateCents, i.amountCents, i.metadata?.orderLine]), [['item-chair', 'Oak chair', 2, 12000, 24000, 0]]);
    assert.equal(inv.amountCents, 24000);
    assert.equal(costOf(inv), 9000, 'two chairs at 45.00');
  });

  test('two parts book the cost of each unit once; the last part takes each line\'s exact remainder', () => {
    const est = order();
    const first = saved(est, [], { mode: 'quantities', quantities: [2, 0] }, 'inv-1');
    const lines = orderLineProgress(est, orderProgress(est, [first]));
    assert.deepEqual(lines.map(l => [l.invoicedQuantity, l.leftQuantity, l.leftCents]), [[2, 3, 36000], [0, 1, 3333]]);
    const rest = saved(est, [first], { mode: 'rest' }, 'inv-2');
    assert.deepEqual(rest.items!.map(i => [i.itemId ?? null, i.quantity, i.amountCents]), [['item-chair', 3, 36000], [null, 1, 3333]]);
    assert.equal(first.amountCents + rest.amountCents, est.amountCents, 'the order is invoiced exactly');
    assert.equal(costOf(first) + costOf(rest), 5 * 4500, 'five chairs, never more');
    assert.equal(orderProgress(est, [first, rest]).leftCents, 0);
    assert.equal(partProblem({ mode: 'quantities', quantities: [1, 0] }, orderProgress(est, [first, rest]), est), 'Nothing is left to invoice on this order');
  });

  test('voiding a part gives back exactly its units to invoice again', () => {
    const est = order();
    const first = saved(est, [], { mode: 'quantities', quantities: [2, 0] }, 'inv-1', 'void');
    assert.deepEqual(orderLineProgress(est, orderProgress(est, [first])).map(l => l.leftQuantity), [5, 1]);
  });

  test('a percentage or an amount of an order with stock items is refused; too many units too', () => {
    const est = order();
    const progress = orderProgress(est, []);
    assert.equal(partProblem({ mode: 'percent', percent: 20 }, progress, est), ITEM_ORDER_BY_QUANTITY);
    assert.equal(partProblem({ mode: 'amount', cents: 10000 }, progress, est), ITEM_ORDER_BY_QUANTITY);
    assert.equal(partProblem({ mode: 'quantities', quantities: [6, 0] }, progress, est), 'Only 5 of Oak chair are left to invoice');
    assert.equal(partProblem({ mode: 'quantities', quantities: [0, 0] }, progress, est), 'Enter how many to invoice');
    assert.equal(partProblem({ mode: 'quantities', quantities: [1.255, 0] }, progress, est), 'Enter how many of Oak chair, with two decimals at most');
    assert.equal(partProblem({ mode: 'quantities', quantities: [-1, 0] }, progress, est), 'Enter how many of Oak chair, with two decimals at most');
    assert.equal(partProblem({ mode: 'quantities', quantities: [5, 1] }, progress, est), null);
    // an order without stock items keeps its percentages and amounts
    const services = order({ lines: [{ description: 'Design', quantity: 1, unitPriceCents: 63333, amountCents: 63333 }] });
    assert.equal(partProblem({ mode: 'percent', percent: 20 }, orderProgress(services, []), services), null);
  });

  test('quote lines: each needs a description, a quantity above zero and a price; only linked lines keep an item', () => {
    const line = (description: string, quantity: number, priceText: string, itemId?: string) => ({ ...blankEstimateLine(description, priceText), quantity, quantityText: String(quantity), amountCents: Math.round(quantity * Math.round(Number(priceText) * 100)), ...(itemId ? { itemId } : {}) });
    assert.equal(estimateLinesProblem([line('', 1, '5')]), 'Describe line 1');
    assert.equal(estimateLinesProblem([line('Chair', 0, '5')]), 'Enter how many for Chair (more than zero, two decimals at most)');
    assert.equal(estimateLinesProblem([line('Chair', 1.005, '5')]), 'Enter how many for Chair (more than zero, two decimals at most)');
    assert.equal(estimateLinesProblem([line('Chair', 1, '')]), 'Enter the price of Chair');
    assert.equal(estimateLinesProblem([line('Free sample', 1, '0')]), 'The quote must come to more than zero');
    assert.equal(estimateLinesProblem([line('Free sample', 1, '0'), line('Chair', 2, '120', 'item-chair')]), null);
    assert.deepEqual(toEstimateLines([line(' Chair ', 2, '120', 'item-chair'), line('Fee', 1, '9.99')]), [
      { itemId: 'item-chair', description: 'Chair', quantity: 2, unitPriceCents: 12000, amountCents: 24000 },
      { description: 'Fee', quantity: 1, unitPriceCents: 999, amountCents: 999 },
    ]);
  });

  test('a quote converted whole keeps its item, so the invoice books the cost of all its units', () => {
    const inv = { ...convertEstimateToInvoice(order({ orderedAt: undefined, status: 'sent' })), id: 'inv-9' } as Invoice;
    assert.deepEqual(inv.items!.map(i => [i.itemId ?? null, i.quantity]), [['item-chair', 5], [null, 1]]);
    assert.equal(costOf(inv), 5 * 4500);
  });
});

describe('On the estimates screen', () => {
  beforeEach(() => {
    markComponentCollectionsLoaded('estimates', 'customers', 'payments', 'invoices', 'inventory');
    useLedgerStore.setState({ accounts: [
      makeChartAccount({ id: 'ar', code: '1200', name: 'Accounts Receivable', type: 'asset', category: 'Accounts Receivable' }),
      makeChartAccount({ id: 'sales', code: '4000', name: 'Sales', type: 'revenue', category: 'Revenue' }),
      makeChartAccount({ id: 'bank', code: '1000', name: 'Checking', type: 'asset', category: 'Cash' }),
    ], transactions: [], inventory: [chair] });
  });
  afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });
  const stubServer = (number: string) => {
    const calls: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
      const body = url.endsWith('/next-number') ? { number }
        : url.includes('/api/v1/commands/') ? { status: 'success', data: {} }
          : url.endsWith('/transactions/bulk') ? { status: 'ok' } : /\/rpc\//.test(url) ? null : [];
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    return calls;
  };
  type Row = Record<string, unknown>;
  const written = (calls: Array<{ url: string; body: unknown }>, table: string): Row[] => calls.flatMap(c => {
    const body = (c.body || {}) as {
      p_table?: string; p_set?: Row; p_data?: Row; entityMutation?: { collection: string; data: Row };
      input?: { invoice?: Row; bill?: Row };
    };
    const post = c.url.match(/\/api\/v1\/documents\/(invoices|bills)\/[^/]+\/post$/);
    if (post) return post[1] === table ? [(body as { data: Row }).data] : [];
    const commandName = c.url.endsWith('/api/v1/commands/invoice.create') ? 'invoice' : c.url.endsWith('/api/v1/commands/bill.create') ? 'bill' : null;
    if (commandName && `${commandName}s` === table) {
      const document = commandName === 'invoice' ? body.input?.invoice : body.input?.bill;
      return document ? [document] : [];
    }
    if (c.url.endsWith('/transactions/bulk')) return body.entityMutation?.collection === table ? [body.entityMutation.data] : [];
    return /\/rpc\/lf_\w+/.test(c.url) && body.p_table === table ? [(body.p_set || body.p_data)!] : [];
  });

  test('a quote with lines: picking a stock item links it, and the quote saves its lines and total', async () => {
    setComponentWorkspace('bookkeeper');
    useLedgerStore.setState({ estimates: [], invoices: [], payments: [], customers: [makeCustomer({ id: 'cust-1', name: 'Acme' })] });
    const calls = stubServer('EST-21');
    render(<EstimatesView />);
    fireEvent.click(screen.getByRole('button', { name: 'New Estimate' }));
    fireEvent.change(screen.getByLabelText('Customer *'), { target: { value: 'cust-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add lines (items, quantities, prices)' }));
    assert.equal(screen.queryByLabelText('Amount ($) *'), null, 'the amount now comes from the lines');
    fireEvent.change(screen.getByLabelText('Item or description, line 1'), { target: { value: 'CH-1' } });
    assert.equal((screen.getByLabelText('Item or description, line 1') as HTMLInputElement).value, 'Oak chair');
    assert.ok(screen.getByText('Stock item: invoiced by quantity'));
    fireEvent.change(screen.getByLabelText('Quantity, line 1'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add a line' }));
    fireEvent.change(screen.getByLabelText('Item or description, line 2'), { target: { value: 'Delivery' } });
    fireEvent.change(screen.getByLabelText('Price, line 2 (USD)'), { target: { value: '25.50' } });
    assert.match(document.body.textContent || '', /\$385\.50 from the lines/);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save Estimate' })); });
    await waitFor(() => assert.ok(written(calls, 'estimates').length > 0));
    const quote = written(calls, 'estimates')[0];
    assert.equal(quote.amountCents, 38550);
    assert.equal(quote.currency, 'USD');
    assert.deepEqual(quote.lines, [
      { itemId: 'item-chair', description: 'Oak chair', quantity: 3, unitPriceCents: 12000, amountCents: 36000 },
      { description: 'Delivery', quantity: 1, unitPriceCents: 2550, amountCents: 2550 },
    ]);
  });

  test('an order with stock items is invoiced by quantity, and the draft invoice carries the item', async () => {
    setComponentWorkspace('owner');
    useLedgerStore.setState({ estimates: [order()], invoices: [], payments: [], customers: [] });
    const calls = stubServer('INV-30');
    render(<EstimatesView />);
    fireEvent.click(screen.getByRole('button', { name: 'Invoice order EST-20' }));
    assert.equal(screen.queryByLabelText('A percentage of the order'), null);
    assert.match(document.body.textContent || '', /invoiced by quantity/);
    fireEvent.change(screen.getByLabelText('How many of Oak chair to invoice now'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('How many of Delivery and assembly to invoice now'), { target: { value: '0' } });
    assert.match(document.body.textContent || '', /Oak chair × 2\$240\.00/);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create $240.00 invoice' })); });
    await waitFor(() => assert.ok(written(calls, 'invoices').length > 0));
    const inv = written(calls, 'invoices')[0];
    assert.equal(inv.amountCents, 24000);
    assert.deepEqual((inv.items as Row[]).map(i => [i.itemId, i.quantity, i.amountCents]), [['item-chair', 2, 24000]]);
    assert.equal(written(calls, 'estimates').some(d => d.status === 'converted'), false, 'three chairs and the delivery are still to invoice');
  });
});
