/**
 * A-117 screen: stock value by location and lot. Hand-checked against the same worked figures as
 * stock-valuation.test.ts, passed in as props: the widget's two location rows and the total, the
 * gadget's unknown reason (never split), the lot table's received value with "on hand: not
 * tracked", and the CSV buttons. Nothing is written.
 */
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { parseCsv } from '../lib/csv';
import { stubFetch } from './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import StockValueByLocationLotReportView from '../components/reporting/StockValueByLocationLotReportView';
import { itemDetails, type StockMove } from '../lib/stockMoves';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { useAuthStore } from '../stores/useAuthStore';
import { getSupabase } from '../lib/db/client';

let seq = 0;
const move = (over: Partial<StockMove> & { quantity: number; quantityBefore: number }): StockMove => ({
  workspaceId: 'w1', itemId: 'widget', date: '2026-01-05', kind: 'purchase',
  quantityAfter: over.quantityBefore + over.quantity, unitCostCents: 0, valueCents: 0,
  seq: `2026-01-01T00:00:00Z-${String(++seq).padStart(4, '0')}`, uid: 'u', createdAt: '2026-01-01T00:00:00Z',
  ...over,
});
const history = itemDetails([
  move({ itemId: 'widget', date: '2026-01-05', kind: 'purchase', quantity: 10, quantityBefore: 0, quantityAfter: 10, unitCostCents: 500, valueCents: 5_000, locationId: 'L1' }),
  move({ itemId: 'widget', date: '2026-01-10', kind: 'transfer-out', quantity: -4, quantityBefore: 10, quantityAfter: 6, unitCostCents: 500, valueCents: -2_000, locationId: 'L1' }),
  move({ itemId: 'widget', date: '2026-01-10', kind: 'transfer-in', quantity: 4, quantityBefore: 6, quantityAfter: 10, unitCostCents: 500, valueCents: 2_000, locationId: 'L2' }),
  move({ itemId: 'widget', date: '2026-01-15', kind: 'sale', quantity: -3, quantityBefore: 10, quantityAfter: 7, unitCostCents: 500, valueCents: -1_500, locationId: 'L1' }),
  move({ itemId: 'gadget', date: '2026-01-05', kind: 'purchase', quantity: 3, quantityBefore: 5, quantityAfter: 8, unitCostCents: 200, valueCents: 600 }),
], '1900-01-01', '2026-12-31');

const items = [
  { id: 'widget', name: 'Widget', sku: 'W-1', workspaceId: 'w1', quantityAtHand: 7, unitPriceCents: 900, unitCostCents: 500, reorderPoint: 0, createdAt: '2025-12-01', uid: 'u' },
  { id: 'gadget', name: 'Gadget', sku: 'G-1', workspaceId: 'w1', quantityAtHand: 8, unitPriceCents: 400, unitCostCents: 200, reorderPoint: 0, createdAt: '2025-12-01', uid: 'u' },
];
const purchaseOrders = [{
  id: 'po1', workspaceId: 'w1', poNumber: 'PO-1', vendorId: 'v1', vendorName: 'Vendor One',
  items: [{ id: 'poi1', description: 'Widget', quantity: 20, itemId: 'widget' }],
  receipts: [{
    receiptNumber: 'GR-1', receivedDate: '2026-01-05', vendorName: 'Vendor One',
    items: [
      { poItemId: 'poi1', description: 'Widget', quantityReceived: 10, unitPriceCents: 500, lotNumber: 'L-A', lotExpiryDate: '2027-06-30' },
      { poItemId: 'poi1', description: 'Widget', quantityReceived: 5, unitPriceCents: 600, lotNumber: 'L-A' },
    ],
  }],
}];

describe('Stock value by location and lot screen', () => {
  beforeEach(() => {
    stubFetch(404);
    useAuthStore.setState({
      isGuest: true, user: null, currentWorkspaceId: 'w1', workspaces: [{ id: 'w1', name: 'W', currency: 'USD' }] as never,
    });
    useDataNeedsStore.setState({ loadedWorkspaceId: 'w1', failed: {} as never });
    useLedgerStore.setState({ inventory: items as never, invoices: [] as never, truncatedCollections: {} as never });
  });
  afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

  test('the location table shows the widget split L1 3 / 15.00 and L2 4 / 20.00, and the gadget unsplit with its reason', async () => {
    render(<StockValueByLocationLotReportView purchaseOrders={purchaseOrders as never} history={history} />);
    const table = await screen.findByRole('table', { name: 'Value by location' });
    const rows = within(table).getAllByRole('row').map(r => (r.textContent || '').replace(/\s+/g, ' '));
    assert.ok(rows.some(t => /No location|L1|Warehouse/.test(t) && /Widget/.test(t) && /3/.test(t) && /\$15\.00/.test(t)), rows.join(' | '));
    assert.ok(rows.some(t => /L2/.test(t) && /Widget/.test(t) && /4/.test(t) && /\$20\.00/.test(t)), rows.join(' | '));
    assert.ok(rows.some(t => /Gadget/.test(t) && /starts at 5 units/.test(t)), rows.join(' | '));
    assert.ok(rows.some(t => /Total value of the items the history explains/.test(t) && /\$35\.00/.test(t)), rows.join(' | '));
  });

  test('the lot table values what was received (15 units, $80.00) and says on-hand is not tracked', async () => {
    render(<StockValueByLocationLotReportView purchaseOrders={purchaseOrders as never} history={history} />);
    await waitFor(() => assert.ok(screen.getByText(/On-hand per lot is not tracked/)));
    const lotTable = await screen.findByRole('table', { name: 'Value by lot' });
    const rows = within(lotTable).getAllByRole('row').map(r => (r.textContent || '').replace(/\s+/g, ' '));
    assert.ok(rows.some(t => /L-A/.test(t) && /15/.test(t) && /\$80\.00/.test(t) && /\$5\.33/.test(t)), rows.join(' | '));
    assert.ok(rows.some(t => /Total received value/.test(t) && /\$80\.00/.test(t)), rows.join(' | '));
    assert.ok(screen.getAllByRole('button', { name: 'Download CSV' }).length === 2);
  });

  test('untagged payloads belong to the confirmed book, not a foreign tag or the next book', async () => {
    setComponentWorkspace('viewer'); markComponentCollectionsLoaded('inventory', 'invoices');
    const sale = { id: 'sale', status: 'paid', date: '2026-01-15', items: [{ itemId: 'widget', lotNumber: 'L-A', quantity: 2 }] };
    useLedgerStore.setState({ inventory: [...items.map(i => ({ ...i, workspaceId: undefined })),
      { ...items[0], id: 'other', name: 'Foreign item', workspaceId: 'other-book' }] as never,
      invoices: [sale, { ...sale, workspaceId: 'other-book', items: [{ ...sale.items[0], quantity: 1000 }] }] as never });
    const orders = [{ ...purchaseOrders[0], workspaceId: undefined }, { ...purchaseOrders[0], workspaceId: 'other-book' }];
    render(<StockValueByLocationLotReportView purchaseOrders={orders as never} history={history} />);
    const location = await screen.findByRole('table', { name: 'Value by location' });
    assert.match(location.textContent!, /Widget/); assert.match(location.querySelector('tfoot')!.textContent!, /\$35\.00/);
    assert.doesNotMatch(location.textContent!, /Foreign item/);
    const lot = screen.getByRole('table', { name: 'Value by lot' });
    assert.deepEqual(Array.from(lot.querySelectorAll('tbody tr > *'), c => c.textContent).slice(3), ['15', '$80.00', '$5.33', 'GR-1', '2']);
    act(() => useAuthStore.setState({ currentWorkspaceId: 'new-book' }));
    assert.equal(screen.queryByRole('table'), null, 'old untagged records cannot be claimed by the next workspace');
    assert.match(screen.getByRole('status').textContent!, /Loading/);
  });

  test('a long lot schedule pages the drawing, never its receipt total, printout or financial CSV', async () => {
    const receipt = purchaseOrders[0].receipts[0];
    const many = [{ ...purchaseOrders[0], receipts: [{ ...receipt, items: Array.from({ length: 205 }, (_, i) => ({
      ...receipt.items[0], lotNumber: `LOT-${String(i + 1).padStart(3, '0')}`, quantityReceived: 1, unitPriceCents: 100,
    })) }] }];
    render(<StockValueByLocationLotReportView purchaseOrders={many as never} history={history} />);
    const table = await screen.findByRole('table', { name: 'Value by lot' });
    const rowCount = () => table.querySelectorAll('tbody tr').length;
    assert.equal(rowCount(), 200); assert.match(table.querySelector('tfoot')!.textContent!, /\$205\.00/);
    const downloads: Blob[] = [];
    const anchor = window.HTMLAnchorElement.prototype, click = anchor.click, create = URL.createObjectURL;
    try {
      anchor.click = () => {}; URL.createObjectURL = blob => { assert.ok(blob instanceof Blob); downloads.push(blob); return 'blob:received-lots'; };
      fireEvent.click(screen.getAllByRole('button', { name: 'Download CSV' })[1]);
      const csv = parseCsv(await downloads[0].text());
      assert.equal(csv.length, 206); assert.deepEqual(csv[205].slice(1, 5), ['LOT-205', '2027-06-30', '1', '1.00']);
    } finally { anchor.click = click; URL.createObjectURL = create; }
    act(() => { window.dispatchEvent(new window.Event('beforeprint')); }); assert.equal(rowCount(), 205);
    act(() => { window.dispatchEvent(new window.Event('afterprint')); }); assert.equal(rowCount(), 200);
    fireEvent.click(screen.getByRole('button', { name: 'Show more lots (200 of 205)' }));
    assert.equal(rowCount(), 205); assert.match(table.querySelector('tbody tr:last-child')!.textContent!, /LOT-205/);
  });

  test('an unreadable server history is not an empty warehouse or an export; retry does not replace lot evidence', async () => {
    const dates: string[] = [];
    let complete = false;
    const fallback = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input), 'http://localhost');
      if (url.pathname !== '/api/v1/reports/inventory-details') return fallback(input, init);
      dates.push(url.searchParams.get('endDate')!);
      return Response.json({ items: complete ? history : [{ ...history[0], moves: [{ quantity: 1 }] }] });
    };
    render(<StockValueByLocationLotReportView purchaseOrders={purchaseOrders as never} />);
    const locationCsv = screen.getAllByRole<HTMLButtonElement>('button', { name: 'Download CSV' })[0];
    assert.ok(locationCsv.disabled);
    await waitFor(() => assert.match(screen.getByRole('alert').textContent!, /did not contain report rows/));
    assert.equal(screen.queryByRole('table', {name: 'Value by location'}), null);
    assert.ok(screen.getByRole('table', {name: 'Value by lot'}));
    complete = true;
    fireEvent.click(screen.getByRole('button', {name: 'Retry'}));
    await screen.findByRole('table', {name: 'Value by location'}); assert.ok(!locationCsv.disabled);
    fireEvent.change(screen.getByLabelText('As of'), { target: { value: '2026-01-06' } });
    const location = screen.getByRole('table', { name: 'Value by location' });
    assert.match(location.querySelector('tfoot')!.textContent!, /\$50\.00/);
    assert.equal(dates.length, 2, 'selecting a historical date still reconciles against the full read through today');
    await act(async () => useAuthStore.setState({ currentWorkspaceId: null, isGuest: false, user: null }));
    assert.equal(screen.queryByRole('table'), null, 'neither schedule survives closing the book');
    globalThis.fetch = fallback;
  });
});
