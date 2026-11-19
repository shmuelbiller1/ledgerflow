/**
 * Backorders (W-08): open sales orders' item lines still to deliver, oldest order first, take the
 * stock on hand; what they cannot take is short; what is on order from vendors is shown; delivered
 * units, closed orders and non-item lines are left out. The report shows both tables.
 */
import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { backorders, ordersReadyToRelease, releasableLines, shortages } from '../lib/backorders';
import { DELIVERY_COGS_TYPE } from '../lib/deliveries';
import BackordersReportView from '../components/reporting/BackordersReportView';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import { makeTransaction } from './fixtures';
import { getSupabase } from '../lib/db/client';
import type { Estimate, InventoryItem, PurchaseOrder } from '../types';

const chair = { id: 'chair', name: 'Chair', quantityAtHand: 5 } as InventoryItem;
const desk = { id: 'desk', name: 'Desk', quantityAtHand: 0 } as InventoryItem;
const order = (id: string, orderedAt: string, lines: Array<[string | undefined, number]>, status = 'accepted') => ({
  id, number: id.toUpperCase(), customerName: `Customer ${id}`, status, orderedAt, amountCents: 0, date: orderedAt,
  lines: lines.map(([itemId, quantity]) => ({ ...(itemId ? { itemId } : {}), description: itemId || 'Service', quantity, unitPriceCents: 1000, amountCents: quantity * 1000 })),
}) as unknown as Estimate;
const orders = [
  order('so2', '2026-10-05', [['chair', 4]]),
  order('so1', '2026-10-01', [['chair', 3], ['desk', 2], [undefined, 1]]),
  order('so3', '2026-10-06', [['chair', 9]], 'declined'),
];
// two chairs of SO1 already left
const entries = [makeTransaction({ id: 'd1', metadata: { type: DELIVERY_COGS_TYPE, orderId: 'so1', orderLine: 0, quantity: 2 } as never })];
const pos = [{ id: 'po', status: 'approved', items: [{ itemId: 'desk', quantity: 10, receivedQuantity: 4 }, { itemId: 'chair', quantity: 1, receivedQuantity: 1 }] }] as unknown as PurchaseOrder[];

test('oldest first takes the stock; what is short; on order from vendors', () => {
  const rows = backorders(orders, entries, [chair, desk], pos);
  assert.deepEqual(rows.map(r => [r.number, r.itemId, r.left, r.covered, r.short, r.onOrder]), [
    ['SO1', 'chair', 1, 1, 0, 0],
    ['SO1', 'desk', 2, 0, 2, 6],
    ['SO2', 'chair', 4, 4, 0, 0],
  ]);
  const tight = backorders(orders, entries, [{ ...chair, quantityAtHand: 3 }, desk], pos);
  assert.deepEqual(tight.map(r => r.short), [0, 2, 2]);
  assert.deepEqual(shortages(tight), [{ itemId: 'chair', item: 'Chair', short: 2, onOrder: 0 }, { itemId: 'desk', item: 'Desk', short: 2, onOrder: 6 }]);

  // A-121: the release list is the lines the same allocation already covers in full.
  // With 5 chairs: SO1's last chair and SO2's four can go; SO1 as a whole cannot (desks short).
  assert.deepEqual(releasableLines(rows).map(r => [r.number, r.itemId, r.left]), [
    ['SO1', 'chair', 1],
    ['SO2', 'chair', 4],
  ]);
  assert.deepEqual(ordersReadyToRelease(rows), ['so2']);
  // with only 3 chairs the partly covered SO2 line is not released: part-cover is the order's call
  assert.deepEqual(releasableLines(tight).map(r => [r.number, r.itemId]), [['SO1', 'chair']]);
  assert.deepEqual(ordersReadyToRelease(tight), []);
});

afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

test('the report shows short items and order lines', async () => {
  const workspace = setComponentWorkspace('owner');
  markComponentCollectionsLoaded('estimates', 'transactions', 'inventory');
  useLedgerStore.setState({ estimates: orders.map(o => ({ ...o, workspaceId: workspace.id })), transactions: entries.map(t => ({ ...t, workspaceId: workspace.id })), inventory: [chair, desk].map(i => ({ ...i, workspaceId: workspace.id })) });
  globalThis.fetch = (async () => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
  render(<BackordersReportView />);
  assert.ok(await screen.findByText('Short items (1)'));
  assert.ok(screen.getByRole('rowheader', { name: 'Desk' }));
  assert.ok(screen.getByText('Order lines to deliver (3)'));
  // A-121: the release list leads, with the one order that can go out in full said in words
  assert.ok(screen.getByText('Ready to release (2)'));
  assert.ok(screen.getByText(/1 order\(s\) can be delivered in full from stock on hand/));
});
