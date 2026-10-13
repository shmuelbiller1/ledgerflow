/**
 * A-45 on the screen: the cycle-count sheet opens with what the ledger puts at the place, a typed
 * count shows the difference and its value at the item's own cost, a blank row is listed as not
 * counted (never zero), a sheet whose expected figure the history does not explain refuses to be
 * marked ready, and marking it ready posts nothing — no request leaves the screen.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import CycleCountReportView from '../components/reporting/CycleCountReportView';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import type { InventoryItem } from '../types';
import type { StockMove } from '../lib/stockMoves';

const item = (overrides: Partial<InventoryItem>): InventoryItem => ({
  id: 'a', uid: 'u1', workspaceId: 'component-workspace', name: 'Widget', sku: 'W-1',
  unitPriceCents: 900, unitCostCents: 400, quantityAtHand: 10, reorderPoint: 0, createdAt: '2026-01-01', ...overrides,
});

const move = (overrides: Partial<StockMove>): StockMove => ({
  workspaceId: 'component-workspace', itemId: 'a', date: '2026-10-01', kind: 'purchase', quantity: 10,
  quantityBefore: 0, quantityAfter: 10, unitCostCents: 400, valueCents: 4000, seq: '1', uid: 'u1',
  createdAt: '2026-10-01T00:00:00Z', ...overrides,
});

const clickText = (text: string) => act(async () => { fireEvent.click(screen.getByText(text)); });
const warehouse = { id: 'warehouse', dimensionId: 'location', description: 'Warehouse', status: 'active' as const, createdAt: '2026-01-01' };

describe('The cycle-count screen', () => {
  let fetches: string[] = [];
  beforeEach(() => {
    fetches = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => { fetches.push(String(input)); return new Response('{}', { status: 200 }); }) as typeof fetch;
    markComponentCollectionsLoaded('inventory');
    setComponentWorkspace('owner');
    useLedgerStore.setState({ inventory: [item({}), item({ id: 'b', name: 'Gadget', unitCostCents: 1000 })], dimensionNodes: [warehouse] });
  });
  afterEach(() => cleanup());

  const renderSheet = async (moves: StockMove[]) => {
    render(<CycleCountReportView loadMoves={async () => moves} />);
    await act(async () => {});
    await clickText('Open the count sheet');
  };

  test('the sheet opens with the ledger’s expected quantity and counts nothing yet', async () => {
    await renderSheet([move({ itemId: 'a', quantityBefore: 0, quantityAfter: 10, quantity: 10 })]);
    assert.equal((screen.getByLabelText('Counted quantity for Widget') as HTMLInputElement).value, '');
    const body = () => document.body.textContent || '';
    assert.match(body(), /0 of 2 counted/, 'nothing is counted until it is typed');
    assert.match(body(), /Not counted yet \(2\): Widget, Gadget/, 'blank rows are listed as not counted, never zero');
    assert.match(body(), /Nothing is counted yet/, 'nothing to mark ready yet');
    const button = screen.getByText('Mark ready (no posting)') as HTMLButtonElement;
    assert.equal(button.disabled, true);
  });

  test('a typed count shows the difference and its value at the item’s cost', async () => {
    await renderSheet([move({ itemId: 'a', quantityBefore: 0, quantityAfter: 10, quantity: 10 })]);
    const input = screen.getByLabelText('Counted quantity for Widget');
    await act(async () => { fireEvent.change(input, { target: { value: '8' } }); });
    const body = () => document.body.textContent || '';
    assert.match(body(), /1 of 2 counted · 1 differ from the ledger · units short 2/);
    assert.match(screen.getByRole('table').textContent || '', /8\.00/, 'the 2 units at the item’s own $4.00 cost are shown');
    const button = screen.getByText('Mark ready (no posting)') as HTMLButtonElement;
    assert.equal(button.disabled, false);
    await clickText('Mark ready (no posting)');
    assert.match(screen.getByText(/Ready — marked by/).textContent || '', /Ready/);
    assert.equal(fetches.length, 0, 'nothing was posted or even requested');
  });

  test('an unreadable entry is refused and the row keeps what it had', async () => {
    await renderSheet([move({ itemId: 'a', quantityBefore: 0, quantityAfter: 10, quantity: 10 })]);
    const input = screen.getByLabelText('Counted quantity for Widget');
    await act(async () => { fireEvent.change(input, { target: { value: '4' } }); });
    await act(async () => { fireEvent.change(input, { target: { value: '-2' } }); });
    assert.equal((screen.getByLabelText('Counted quantity for Widget') as HTMLInputElement).value, '4');
  });

  test('a history that does not explain the expected figure blocks the sheet', async () => {
    const broken: StockMove[] = [
      move({ itemId: 'a', seq: '1', quantityBefore: 0, quantityAfter: 10, quantity: 10 }),
      move({ itemId: 'a', seq: '2', quantityBefore: 3, quantityAfter: 8, quantity: 5 }),
    ];
    await renderSheet(broken);
    const input = screen.getByLabelText('Counted quantity for Widget');
    await act(async () => { fireEvent.change(input, { target: { value: '8' } }); });
    const body = () => document.body.textContent || '';
    assert.match(body(), /does not explain/);
    const button = screen.getByText('Mark ready (no posting)') as HTMLButtonElement;
    assert.equal(button.disabled, true, 'a broken history is not waved through');
    assert.match(body(), /Not ready to mark/, 'the screen says why it cannot be marked ready');
  });

  test('a named place lists only the items the ledger puts there; a full count adds the rest and says why', async () => {
    await renderSheet([move({ itemId: 'a', locationId: 'warehouse', quantityBefore: 0, quantityAfter: 10, quantity: 10 })]);
    await act(async () => { fireEvent.change(screen.getByLabelText('Count place'), { target: { value: 'warehouse' } }); });
    await clickText('Open the count sheet');
    assert.ok(screen.getByLabelText('Counted quantity for Widget'), 'the item the ledger puts at the place is listed');
    assert.equal(screen.queryByLabelText('Counted quantity for Gadget'), null, 'an item with no units there is not listed for a cycle count');
    assert.match(document.body.textContent || '', /Warehouse — /, 'the sheet names the place');
    await act(async () => { fireEvent.click(screen.getByLabelText('Include every item')); });
    await clickText('Open the count sheet');
    assert.ok(screen.getByLabelText('Counted quantity for Gadget'), 'the full count lists every item');
    assert.match(document.body.textContent || '', /nothing says these units are at this place|no units of this item at this place/i);
  });
});
