import { inlineEditName } from './helpers/inlineEditName';
/**
 * Purchase orders edited in place (I-22): vendor, expected delivery and lines while nothing was
 * received or billed; the order total follows a line change; delete only with nothing against it;
 * "Same as last order" fills a new order with the vendor's latest lines (I-23).
 */
import './helpers/dom';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PurchaseOrdersView from '../components/purchases/PurchaseOrdersView';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import { getSupabase } from '../lib/db/client';
import type { PurchaseOrder, Vendor } from '../types';

const base = { uid: 'test-user', workspaceId: 'component-workspace', vendorName: 'Paper Co', vendorId: 'paper', status: 'approved' as const, currency: 'USD', createdAt: '2026-09-01T00:00:00Z' };
const open: PurchaseOrder = { ...base, id: 'po1', poNumber: 'PO-2026-001', issueDate: '2026-09-01', expectedDeliveryDate: '2026-09-20', totalAmountCents: 10000,
  items: [{ id: 'l1', description: 'Paper', quantity: 4, unitPriceCents: 2500, totalCents: 10000, receivedQuantity: 0 }] };
const partly: PurchaseOrder = { ...base, id: 'po2', poNumber: 'PO-2026-002', issueDate: '2026-09-05', status: 'partially_received', totalAmountCents: 5000,
  items: [{ id: 'l2', description: 'Toner', quantity: 2, unitPriceCents: 2500, totalCents: 5000, receivedQuantity: 1 }], receipts: [{ id: 'r', receiptNumber: 'GR-1' } as never] };
const vendors = [{ id: 'paper', name: 'Paper Co' }, { id: 'ink', name: 'Ink Ltd' }] as Vendor[];

let writes: { fn: string; body: Record<string, unknown> }[] = [];
beforeEach(() => {
  writes = [];
  setComponentWorkspace('owner');
  markComponentCollectionsLoaded('bills', 'vendors');
  useLedgerStore.setState({ bills: [], vendors, accounts: [] });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    // an ordinary record is written by naming a command now, not by a table write
    if (url.includes('/commands/record.')) {
      const body = JSON.parse(String(init?.body || '{}'));
      const name = url.split('/commands/')[1];
      writes.push({ fn: name, body: body.input });
      const answer = name === 'record.save'
        ? { ok: true, data: { collection: body.input.collection, id: body.input.id, created: Boolean(body.input.create), updatedAt: new Date().toISOString() } }
        : { ok: true, data: { collection: body.input.collection, id: body.input.id, deleted: true } };
      return new Response(JSON.stringify(answer), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const rpc = url.match(/\/rpc\/(lf_\w+)/);
    if (rpc) { writes.push({ fn: rpc[1], body: JSON.parse(String(init?.body || '{}')) }); return new Response('null', { status: 200, headers: { 'Content-Type': 'application/json' } }); }
    if (url.includes('/purchaseOrders')) return new Response(JSON.stringify([open, partly].map(po => ({ id: po.id, data: po, updated_at: po.createdAt }))), { status: 200, headers: { 'Content-Type': 'application/json' } });
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
});
afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

const type = async (label: string, value: string) => {
  fireEvent.click(screen.getByRole('button', { name: inlineEditName(`Edit ${label}`) }));
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
  await act(async () => { fireEvent.keyDown(screen.getByLabelText(label), { key: 'Enter' }); });
};

test('an open order: vendor, delivery and lines change in place, and the total follows', async () => {
  render(<PurchaseOrdersView />);
  await waitFor(() => assert.ok(screen.getByRole('button', { name: 'Lines of PO-2026-001' })));
  assert.ok(screen.getByRole('button', { name: inlineEditName('Edit Vendor of PO-2026-001') }));
  assert.equal(screen.queryByRole('button', { name: inlineEditName('Edit Vendor of PO-2026-002') }), null, 'goods already arrived on PO-2026-002');
  assert.ok(screen.getByRole('button', { name: inlineEditName('Edit Expected delivery of PO-2026-002') }), 'delivery can still move');

  await type('Expected delivery of PO-2026-001', '2026-08-01');
  assert.match(screen.getByRole('alert').textContent || '', /before the order date/);
  assert.equal(writes.length, 0);
  fireEvent.keyDown(screen.getByLabelText('Expected delivery of PO-2026-001'), { key: 'Escape' });

  fireEvent.click(screen.getByRole('button', { name: 'Lines of PO-2026-001' }));
  await waitFor(() => assert.ok(screen.getByRole('region', { name: 'Files of Purchase order PO-2026-001' })));
  await type('Quantity of Paper', '6');
  await waitFor(() => assert.equal(writes.length, 1));
  const set = writes[0].body.data as Record<string, unknown>;
  assert.equal(writes[0].fn, 'record.save');
  assert.deepEqual([writes[0].body.collection, writes[0].body.id], ['purchaseOrders', 'po1'], 'one record, named');
  assert.equal(set.totalAmountCents, 15000);
  assert.deepEqual((set.items as PurchaseOrder['items']).map(i => [i.quantity, i.totalCents]), [[6, 15000]]);

  fireEvent.change(screen.getByLabelText('New line on PO-2026-001'), { target: { value: 'Envelopes' } });
  fireEvent.change(screen.getByLabelText('Unit price of the new line on PO-2026-001'), { target: { value: '3.50' } });
  await act(async () => { fireEvent.keyDown(screen.getByLabelText('Unit price of the new line on PO-2026-001'), { key: 'Enter' }); });
  await waitFor(() => assert.equal(writes.length, 2));
  const added = writes[1].body.data as Record<string, unknown>;
  assert.deepEqual((added.items as PurchaseOrder['items']).map(i => i.description), ['Paper', 'Envelopes']);
  assert.equal(added.totalAmountCents, 10000 + 350);

  fireEvent.click(screen.getByRole('button', { name: 'Lines of PO-2026-002' }));
  assert.equal(screen.queryByRole('button', { name: inlineEditName('Edit Quantity of Toner') }), null, 'lines are fixed once goods arrived');
  assert.equal(screen.queryByLabelText('New line on PO-2026-002'), null);
});

test('delete only when nothing was received or billed; a viewer edits nothing', async () => {
  const confirm = window.confirm;
  window.confirm = () => true;
  try {
    render(<PurchaseOrdersView />);
    await waitFor(() => assert.ok(screen.getByRole('button', { name: 'Delete PO-2026-001' })));
    assert.equal(screen.queryByRole('button', { name: 'Delete PO-2026-002' }), null);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete PO-2026-001' })); });
    await waitFor(() => assert.deepEqual(writes.map(w => [w.fn, w.body.collection, w.body.id]), [['record.delete', 'purchaseOrders', 'po1']]));
  } finally {
    window.confirm = confirm;
  }
  cleanup();
  setComponentWorkspace('viewer');
  render(<PurchaseOrdersView />);
  await waitFor(() => assert.ok(screen.getByRole('button', { name: 'Lines of PO-2026-001' })));
  assert.equal(screen.queryByRole('button', { name: /^Edit / }), null);
  assert.equal(screen.queryByRole('button', { name: /^Delete / }), null);
});

test('"Same as last order" fills a new order with the vendor\'s latest lines', async () => {
  render(<PurchaseOrdersView />);
  await waitFor(() => assert.ok(screen.getByRole('button', { name: 'Lines of PO-2026-001' })));
  fireEvent.click(screen.getByRole('button', { name: /New purchase order/ }));
  assert.deepEqual([...(screen.getByLabelText('Vendor') as HTMLSelectElement).options].map(o => o.text), ['Choose a vendor…', 'Paper Co', 'Ink Ltd'], 'the vendor ordered from most comes first');
  assert.equal(screen.queryByRole('button', { name: /Same as last order/ }), null);
  fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: 'paper' } });
  fireEvent.click(screen.getByRole('button', { name: 'Same as last order (PO-2026-002, 1 line)' }));
  assert.equal((screen.getByLabelText('Item 1 description') as HTMLInputElement).value, 'Toner');
  assert.equal((screen.getByLabelText('Item 1 quantity') as HTMLInputElement).value, '2');
  assert.equal((screen.getByLabelText('Item 1 unit price') as HTMLInputElement).value, '25.00');
  assert.equal(screen.queryByRole('button', { name: /Same as last order/ }), null, 'offered only while the lines are empty');
});

test('a line can be a stock item: its name and cost fill in, and the order keeps the item (J-08)', async () => {
  markComponentCollectionsLoaded('inventory');
  useLedgerStore.setState({ inventory: [{ id: 'desk', name: 'Desk', unitCostCents: 45000, quantityAtHand: 0 } as never] });
  render(<PurchaseOrdersView />);
  await waitFor(() => assert.ok(screen.getByRole('button', { name: 'Lines of PO-2026-001' })));
  fireEvent.click(screen.getByRole('button', { name: /New purchase order/ }));
  fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: 'ink' } });
  fireEvent.change(screen.getByLabelText('Item 1 stock item'), { target: { value: 'desk' } });
  assert.equal((screen.getByLabelText('Item 1 description') as HTMLInputElement).value, 'Desk');
  assert.equal((screen.getByLabelText('Item 1 unit price') as HTMLInputElement).value, '450.00');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Save purchase order/ })); });
  await waitFor(() => assert.ok(writes.some(w => JSON.stringify(w.body).includes('"itemId":"desk"')), JSON.stringify(writes)));
});
