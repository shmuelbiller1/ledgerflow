import { inlineEditName } from './helpers/inlineEditName';
/**
 * A-64–A-67 on the existing Inventory Cycle Count host: bin metadata, an open-pick/packing-slip
 * view and tracking annotation, two-person return workflow, and serial-linked warranty dates.
 * Metadata-only annotations use the existing nested-field RPC boundary; RMA and warranty workflows use server commands.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import WarehouseOperationsReportView from '../components/reporting/WarehouseOperationsReportView';
import CycleCountReportView from '../components/reporting/CycleCountReportView';
import { DELIVERY_COGS_TYPE } from '../lib/deliveries';
import { binLocationKey } from '../lib/warehouseWorkflows';
import { warrantyRecordKey } from '../lib/warehouseRecords';
import { getLocalDateISO } from '../lib/utils';
import { getSupabase } from '../lib/db/client';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { stubFetchWithBodies } from './helpers/dom';
import { stubRmaServer } from './helpers/rmaServer';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import type { Customer, Estimate, Invoice, InventoryItem, Transaction } from '../types';

const workspaceId = 'component-workspace';
const location = { id: 'warehouse-1', dimensionId: 'location', description: 'Main warehouse', status: 'active' as const };
const customer: Customer = { id: 'customer-1', uid: 'test-user', workspaceId, name: 'Acme Co' };
const item: InventoryItem = {
  id: 'item-1', uid: 'test-user', workspaceId, name: 'Blue Widget', sku: 'W-100', itemType: 'stock',
  unitPriceCents: 1000, unitCostCents: 400, quantityAtHand: 20, reorderPoint: 2,
  createdAt: '2026-01-01',
  binLocations: { [binLocationKey(location.id)]: { locationId: location.id, bin: 'A-03' } },
};
const order: Estimate = {
  id: 'order-1', uid: 'test-user', workspaceId, customerId: customer.id, customerName: customer.name,
  number: 'SO-001', amountCents: 5000, date: '2026-10-10', status: 'accepted', orderedAt: '2026-10-11',
  createdAt: '2026-10-10', lines: [{ itemId: item.id, description: item.name, quantity: 5, unitPriceCents: 1000, amountCents: 5000 }],
};
const invoice: Invoice = {
  id: 'invoice-1', uid: 'test-user', workspaceId, customerId: customer.id, customerName: customer.name,
  number: 'INV-001', amountCents: 5000, date: '2026-10-12', dueDate: '2026-11-11', status: 'sent',
  metadata: { convertedFromEstimateId: order.id },
  items: [{
    id: 'invoice-line-1', itemId: item.id, description: item.name, quantity: 5,
    rateCents: 1000, amountCents: 5000, accountId: 'income', metadata: { orderLine: 0 },
    serialNumbers: ['SN-001'],
  }],
};
const deliveryEntry: Transaction = {
  id: 'delivery-entry-1', uid: 'test-user', workspaceId, date: '2026-10-13', description: 'Delivery', lines: [],
  totalAmountCents: 0, currency: 'USD', status: 'completed', type: 'actual',
  metadata: {
    type: DELIVERY_COGS_TYPE, orderId: order.id, deliveryId: 'dlv_0123456789abcdef',
    inventoryItemId: item.id, orderLine: 0, quantity: 2,
  },
};

const realFetch = globalThis.fetch;
let calls: ReturnType<typeof stubFetchWithBodies> = [];

function prepare(role: 'owner' | 'accountant' | 'bookkeeper' | 'viewer' = 'owner') {
  const workspace = setComponentWorkspace(role);
  useAuthStore.setState({ workspaces: [{ ...workspace, goodsLeaveWith: 'delivery' }] });
  markComponentCollectionsLoaded('inventory', 'estimates', 'invoices', 'transactions', 'customers', 'creditNotes');
  useLedgerStore.setState({
    inventory: [item], estimates: [order], invoices: [invoice], transactions: [deliveryEntry],
    customers: [customer], creditNotes: [], dimensionNodes: [location], truncatedCollections: {},
  });
  calls = stubFetchWithBodies(200, { status: 'success', data: { id: 'test-record', changed: true } });
}

/** Bin annotations and shipment metadata are fields of an ordinary record: they name `record.save` now. */
function rpcWrites() {
  const legacy = calls.filter(call => call.url.includes('/rpc/lf_update'));
  const commands = calls.filter(call => call.url.includes('/api/v1/commands/record.save')).map(call => {
    const { input } = call.body as { input: { collection: string; id: string; data?: Record<string, unknown>; unset?: string[] } };
    return { ...call, body: { p_table: input.collection, p_id: input.id, p_set: input.data || {}, p_unset: input.unset || [] } };
  });
  return [...legacy, ...commands];
}

function commandWrites(name: string) {
  return calls.filter(call => call.url.includes(`/api/v1/commands/${name}`));
}

describe('Warehouse operations views (A-64–A-67)', () => {
  beforeEach(() => prepare());
  afterEach(async () => {
    cleanup();
    document.body.classList.remove('warehouse-packing-print');
    globalThis.fetch = realFetch;
    getSupabase().realtime.disconnect();
    await getSupabase().auth.dispose();
  });

  test('warehouse workflows are reachable from the existing Inventory Cycle Count report', async () => {
    render(<CycleCountReportView loadMoves={async () => []} />);
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Warehouse operations' })); });
    await waitFor(() => assert.ok(screen.getByRole('heading', { name: 'Warehouse operations' })));
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Return authorizations' })); });
    assert.ok(screen.getByRole('heading', { name: 'Return authorizations' }));
    assert.ok(screen.getByText(/not a server-enforced two-person approval/));
  });

  test('bin assignment persists only an item Location/bin annotation', async () => {
    render(<WarehouseOperationsReportView />);
    const editButton = await screen.findByRole('button', { name: inlineEditName('Edit Bin for Blue Widget at Main warehouse') });
    await act(async () => { fireEvent.click(editButton); });
    const input = screen.getByLabelText('Bin for Blue Widget at Main warehouse');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'B-08' } });
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    await waitFor(() => assert.equal(rpcWrites().length, 1));
    const body = rpcWrites()[0].body as { p_table: string; p_id: string; p_set: Record<string, unknown> };
    assert.equal(body.p_table, 'inventory');
    assert.equal(body.p_id, item.id);
    const binPath = `binLocations.${binLocationKey(location.id)}`;
    const savedBin = body.p_set[binPath] as { locationId: string; bin: string; updatedByUid: string; updatedByName: string; updatedAt: string };
    assert.deepEqual({ locationId: savedBin.locationId, bin: savedBin.bin, updatedByUid: savedBin.updatedByUid, updatedByName: savedBin.updatedByName }, {
      locationId: location.id, bin: 'B-08', updatedByUid: 'test-user', updatedByName: 'Test',
    });
    assert.match(savedBin.updatedAt, /^\d{4}-\d\d-/);
    assert.equal('quantityAtHand' in body.p_set, false);
  });

  test('pick list is sorted by bin, prints goods-only quantities, and shipment marking patches order metadata only', async () => {
    render(<WarehouseOperationsReportView />);
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Pick, pack and ship' })); });
    await waitFor(() => assert.match(screen.getByRole('table', { name: /Open pick list/ }).textContent || '', /A-03/));
    assert.match(screen.getByRole('table', { name: /Open pick list/ }).textContent || '', /3/);

    const originalPrint = window.print;
    let printCalls = 0;
    window.print = () => { printCalls += 1; };
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Print packing slip' })); });
    await waitFor(() => assert.ok(screen.getByRole('article', { name: 'Warehouse packing slip' })));
    assert.equal(printCalls, 1);
    assert.match(screen.getByRole('article', { name: 'Warehouse packing slip' }).textContent || '', /Blue Widget/);
    assert.doesNotMatch(screen.getByRole('article', { name: 'Warehouse packing slip' }).textContent || '', /\$10\.00/);
    window.print = originalPrint;

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Shipment carrier'), { target: { value: 'ParcelCo' } });
      fireEvent.change(screen.getByLabelText('Shipment tracking number'), { target: { value: 'TRACK-001' } });
      fireEvent.change(screen.getByLabelText('Shipment date'), { target: { value: getLocalDateISO() } });
      fireEvent.click(screen.getByRole('button', { name: 'Mark shipped' }));
    });
    await waitFor(() => assert.equal(rpcWrites().length, 1));
    const body = rpcWrites()[0].body as { p_table: string; p_id: string; p_set: Record<string, unknown> };
    assert.equal(body.p_table, 'estimates');
    assert.equal(body.p_id, order.id);
    const path = 'metadata.warehouseShipmentsBySource.delivery_dlv_0123456789abcdef';
    const saved = body.p_set[path] as { carrier: string; trackingNumber: string; shippedDate: string; lines: Array<{ quantity: number }> };
    assert.equal(saved.carrier, 'ParcelCo');
    assert.equal(saved.trackingNumber, 'TRACK-001');
    assert.equal(saved.lines[0].quantity, 2);
    assert.equal('quantityAtHand' in body.p_set, false);
    assert.equal(calls.some(call => call.url.includes('/rpc/lf_batch') || call.url.includes('stockMoves')), false);
  });

  test('RMA request sends the selected invoice lines and reason to the server, not a credit or stock movement', async () => {
    // ISS-143: the RMA is written by the server (returnAuthorizationService.ts), never by a browser write to the customer
    calls = stubRmaServer({ workspaceId: customer.workspaceId, customerName: customer.name, line: () => ({ itemId: 'item-1', description: 'Blue Widget', soldQuantity: 2 }) });
    render(<WarehouseOperationsReportView />);
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Return authorizations' })); });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Return quantity for Blue Widget'), { target: { value: '1' } });
      fireEvent.change(screen.getByLabelText('RMA reason'), { target: { value: 'Customer ordered the wrong size' } });
      fireEvent.click(screen.getByRole('button', { name: 'Submit RMA request' }));
    });
    const rma = () => calls.filter(call => call.url.includes('/return-authorizations'));
    await waitFor(() => assert.equal(rma().length, 1));
    const body = rma()[0].body as { customerId: string; invoiceId: string; reason: string; lines: Array<{ invoiceLineId: string; quantity: number }>; requestKey: string };
    assert.equal(body.customerId, customer.id);
    assert.equal(body.invoiceId, invoice.id);
    assert.equal(body.reason, 'Customer ordered the wrong size');
    assert.deepEqual(body.lines.map(line => [line.invoiceLineId, line.quantity]), [['invoice-line-1', 1]]);
    assert.match(body.requestKey, /^[A-Za-z0-9_-]{8,100}$/);
    assert.equal('amountCents' in body, false);
    assert.equal(rpcWrites().length, 0, 'no browser write to the customer');
    assert.equal(calls.some(call => (call.body as { p_table?: string } | null)?.p_table === 'creditNotes'), false);
  });

  test('warranty end date is keyed to the issued invoice serial and keeps its editor history', async () => {
    render(<WarehouseOperationsReportView />);
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Warranty register' })); });
    await act(async () => { fireEvent.change(screen.getByLabelText('Warranty status filter'), { target: { value: 'all' } }); });
    assert.ok(screen.getByText('SN-001'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Edit Warranty end date for SN-001/ })); });
    const input = screen.getByLabelText(/Warranty end date for SN-001/);
    await act(async () => {
      fireEvent.change(input, { target: { value: '2027-10-15' } });
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    await waitFor(() => assert.equal(commandWrites('warranty.update').length, 1));
    const request = commandWrites('warranty.update')[0];
    const body = request.body as { workspaceId: string; input: { candidate: Record<string, string>; endDate: string } };
    assert.equal(request.method, 'POST');
    assert.equal(body.workspaceId, workspaceId);
    assert.deepEqual(body.input.candidate, {
      id: warrantyRecordKey({ invoiceId: invoice.id, invoiceLineId: 'invoice-line-1', itemId: item.id, serial: 'SN-001' }),
      workspaceId, customerId: customer.id, invoiceId: invoice.id,
      invoiceLineId: 'invoice-line-1', itemId: item.id, serial: 'SN-001',
    });
    assert.equal(body.input.endDate, '2027-10-15');
    assert.equal(rpcWrites().length, 0, 'warranty history must not be patched through a browser RPC');
  });

  test('both inventory tablists are keyboard reachable, wrap, and keep valid panel references', async () => {
    render(<CycleCountReportView loadMoves={async () => []} />);
    const cycle = screen.getByRole('tab', { name: 'Cycle count' });
    cycle.focus();
    await act(async () => { fireEvent.keyDown(cycle, { key: 'ArrowRight' }); });
    const warehouse = screen.getByRole('tab', { name: 'Warehouse operations' });
    assert.equal(document.activeElement, warehouse);
    assert.equal(warehouse.getAttribute('aria-selected'), 'true');
    const bins = screen.getByRole('tab', { name: 'Bin locations' });
    bins.focus();
    await act(async () => { fireEvent.keyDown(bins, { key: 'End' }); });
    const warranty = screen.getByRole('tab', { name: 'Warranty register' });
    assert.equal(document.activeElement, warranty);
    assert.ok(screen.getByRole('heading', { name: 'Warranty register' }));
    await act(async () => { fireEvent.keyDown(warranty, { key: 'ArrowRight' }); });
    assert.equal(document.activeElement, bins);
    await act(async () => { fireEvent.keyDown(bins, { key: 'ArrowLeft' }); });
    assert.equal(document.activeElement, warranty);
    await act(async () => { fireEvent.keyDown(warranty, { key: 'Home' }); });
    assert.equal(document.activeElement, bins);
    await act(async () => { fireEvent.keyDown(bins, { key: 'ArrowRight', ctrlKey: true }); });
    assert.equal(document.activeElement, bins);
    for (const tab of screen.getAllByRole('tab')) {
      assert.ok(document.getElementById(tab.getAttribute('aria-controls') || ''), 'every tab has an existing panel');
    }
    await act(async () => { fireEvent.keyDown(warehouse, { key: 'Home' }); });
    assert.equal(document.activeElement, cycle);
    assert.ok(screen.getByRole('heading', { name: 'Inventory cycle count' }));
  });

  test('RTL warehouse arrows follow visual direction and leave modified shortcuts alone', async () => {
    render(<WarehouseOperationsReportView />);
    for (const tab of screen.getAllByRole('tab')) tab.style.direction = 'rtl';
    const bins = screen.getByRole('tab', { name: 'Bin locations' });
    const pick = screen.getByRole('tab', { name: 'Pick, pack and ship' });
    bins.focus();
    await act(async () => { fireEvent.keyDown(bins, { key: 'ArrowLeft' }); });
    assert.equal(document.activeElement, pick);
    assert.equal(pick.getAttribute('aria-selected'), 'true');
    await act(async () => { fireEvent.keyDown(pick, { key: 'ArrowRight' }); });
    assert.equal(document.activeElement, bins);
    for (const modifier of ['altKey', 'metaKey']) {
      await act(async () => { fireEvent.keyDown(bins, { key: 'ArrowLeft', [modifier]: true }); });
      assert.equal(document.activeElement, bins);
    }
    await act(async () => { fireEvent.keyDown(bins, { key: 'ArrowRight' }); });
    assert.equal(document.activeElement, screen.getByRole('tab', { name: 'Warranty register' }));
  });

  test('a second packing-slip request prints again without closing or changing the order', async () => {
    render(<WarehouseOperationsReportView />);
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Pick, pack and ship' })); });
    const originalPrint = window.print;
    let prints = 0;
    window.print = () => { prints += 1; window.dispatchEvent(new window.Event('afterprint')); };
    try {
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Print packing slip' })); });
      assert.equal(prints, 1);
      assert.ok(screen.getByRole('article', { name: 'Warehouse packing slip' }));
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Print packing slip' })); });
      assert.equal(prints, 2);
      assert.equal(document.body.classList.contains('warehouse-packing-print'), false);
      assert.equal(rpcWrites().length, 0);
    } finally { window.print = originalPrint; }
  });

  test('two immediate shipment activations send only one pending write', async () => {
    render(<WarehouseOperationsReportView />);
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Pick, pack and ship' })); });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Shipment carrier'), { target: { value: 'ParcelCo' } });
      fireEvent.change(screen.getByLabelText('Shipment tracking number'), { target: { value: 'TRACK-002' } });
    });
    let release: () => void = () => {};
    const pending = new Promise<void>(resolve => { release = resolve; });
    const fetchMock = globalThis.fetch;
    let started = 0;
    globalThis.fetch = async (input, init) => {
      if (String(input).includes('/rpc/lf_update') || String(input).includes('/commands/record.save')) { started += 1; await pending; }
      return fetchMock(input, init);
    };
    try {
      const save = screen.getByRole('button', { name: 'Mark shipped' });
      await act(async () => { fireEvent.click(save); fireEvent.click(save); });
      await waitFor(() => assert.equal(started, 1));
      assert.ok(screen.getByRole('button', { name: 'Saving shipment…' }).hasAttribute('disabled'));
    } finally { await act(async () => { release(); }); }
    await waitFor(() => assert.equal(rpcWrites().length, 1));
  });

  test('refused shipment and RMA writes retain their drafts for an explicit retry', async () => {
    calls = stubFetchWithBodies(403, { message: 'Warehouse metadata refused', code: '42501' });
    render(<WarehouseOperationsReportView />);
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Pick, pack and ship' })); });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Shipment carrier'), { target: { value: 'ParcelCo' } });
      fireEvent.change(screen.getByLabelText('Shipment tracking number'), { target: { value: 'RETRY-001' } });
      fireEvent.click(screen.getByRole('button', { name: 'Mark shipped' }));
    });
    await waitFor(() => assert.match(screen.getByRole('alert').textContent || '', /Warehouse metadata refused/));
    assert.equal((screen.getByLabelText('Shipment tracking number') as HTMLInputElement).value, 'RETRY-001');
    calls = stubFetchWithBodies(200, null);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Mark shipped' })); });
    await waitFor(() => assert.equal((screen.getByLabelText('Shipment tracking number') as HTMLInputElement).value, ''));
    assert.equal(rpcWrites().length, 1);

    const line = () => ({ itemId: 'item-1', description: 'Blue Widget', soldQuantity: 2 });
    calls = stubRmaServer({ workspaceId: customer.workspaceId, line, refuse: { status: 409, message: 'RMA refused by the server' } });
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Return authorizations' })); });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Return quantity for Blue Widget'), { target: { value: '1' } });
      fireEvent.change(screen.getByLabelText('RMA reason'), { target: { value: 'Keep this reason' } });
      fireEvent.click(screen.getByRole('button', { name: 'Submit RMA request' }));
    });
    await waitFor(() => assert.match(screen.getByRole('alert').textContent || '', /RMA refused by the server/));
    assert.equal((screen.getByLabelText('RMA reason') as HTMLTextAreaElement).value, 'Keep this reason');
    assert.equal((screen.getByLabelText('Return quantity for Blue Widget') as HTMLInputElement).value, '1');
    calls = stubRmaServer({ workspaceId: customer.workspaceId, line });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Submit RMA request' })); });
    await waitFor(() => assert.equal((screen.getByLabelText('RMA reason') as HTMLTextAreaElement).value, ''));
    assert.equal(calls.filter(call => call.url.includes('/return-authorizations')).length, 1);
  });

  test('viewers cannot edit warehouse metadata in any of the four panels', async () => {
    prepare('viewer');
    render(<WarehouseOperationsReportView />);
    assert.equal(screen.queryByRole('button', { name: /Edit Bin/ }), null);
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Pick, pack and ship' })); });
    assert.ok(screen.getByRole('button', { name: 'Mark shipped' }).hasAttribute('disabled'));
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Return authorizations' })); });
    assert.ok(screen.getByRole('button', { name: 'Submit RMA request' }).hasAttribute('disabled'));
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Warranty register' })); });
    await act(async () => { fireEvent.change(screen.getByLabelText('Warranty status filter'), { target: { value: 'all' } }); });
    assert.equal(screen.queryByRole('button', { name: /Edit Warranty/ }), null);
    assert.equal(rpcWrites().length, 0);
  });

});
