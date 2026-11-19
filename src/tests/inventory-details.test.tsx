/**
 * Inventory item details (J-10): from the stock-moves ledger, each item's opening quantity and value
 * (everything before the period), its movements in the period in order, what came in and went out,
 * and its closing quantity and value; items with nothing on hand and no movement are left out. The
 * route reads the full history for any member and refuses outsiders (with LF_TEST_DATABASE_URL).
 */
import './helpers/dom';
import test, { after, afterEach, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import React from 'react';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { itemDetails, purchasesByItem, type StockMove } from '../lib/stockMoves';
import InventoryDetailsReportView from '../components/reporting/InventoryDetailsReportView';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { stubFetchWithBodies } from './helpers/dom';
import { useUIStore } from '../stores/useUIStore';
import { getSupabase } from '../lib/db/client';

const move = (itemId: string, seq: string, date: string, kind: StockMove['kind'], quantity: number, before: number, valueCents: number, extra: Partial<StockMove> = {}): StockMove => ({
  workspaceId: 'w', itemId, itemName: itemId === 'i1' ? 'Chair' : itemId === 'i2' ? 'Desk' : 'Lamp', date, kind, quantity, quantityBefore: before, quantityAfter: before + quantity,
  unitCostCents: 1000, valueCents, seq, uid: 'u', createdAt: date, ...extra,
});
const moves = [
  move('i1', '001', '2026-01-05', 'opening', 10, 0, 10000),
  move('i1', '002', '2026-02-03', 'sale', -3, 10, -3000, { transactionId: 't-sale', documentType: 'invoice', documentId: 'inv1' }),
  move('i1', '003', '2026-02-10', 'purchase', 5, 7, 6000, { transactionId: 't-buy' }),
  move('i1', '004', '2026-03-01', 'sale', -1, 12, -1100),
  move('i2', '005', '2026-01-02', 'opening', 2, 0, 5000),
  move('i3', '006', '2026-01-02', 'opening', 1, 0, 500),
  move('i3', '007', '2026-01-03', 'adjustment', -1, 1, -500),
];

describe('The calculation', () => {
  test('opening, the period\'s movements in order, in and out, closing; empty items left out', () => {
    const items = itemDetails(moves, '2026-02-01', '2026-02-28');
    assert.deepEqual(items.map(i => [i.itemName, i.opening, i.moves.map(m => [m.kind, m.quantity, m.quantityAfter, m.valueCents]), i.received, i.issued, i.closing]), [
      ['Chair', { quantity: 10, valueCents: 10000 }, [['sale', -3, 7, -3000], ['purchase', 5, 12, 6000]], 5, 3, { quantity: 12, valueCents: 13000 }],
      ['Desk', { quantity: 2, valueCents: 5000 }, [], 0, 0, { quantity: 2, valueCents: 5000 }],
    ], 'the March sale is after the period; the lamp has nothing and did not move');
    assert.equal(items[0].moves[0].transactionId, 't-sale');
    assert.deepEqual(purchasesByItem(items), [{ itemId: 'i1', itemName: 'Chair', quantity: 5, valueCents: 6000, averageCents: 1200 }], 'J-08: what was bought, per item');
  });
});

describe('Against the database', { skip: !process.env.LF_TEST_DATABASE_URL && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_invdet_${crypto.randomBytes(4).toString('hex')}`;
  let server: Server;
  let base = '';
  let db: import('../server/db/pgFirestore').Firestore;

  before(async () => {
    process.env.DATABASE_URL = process.env.LF_TEST_DATABASE_URL;
    const express = (await import('express')).default;
    const { reportRouter } = await import('../server/routes/reportRoutes');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({ uid: 'owner-1', name: 'Stock', members: ['owner-1', 'view-1'], roles: { 'view-1': 'viewer' } });
    for (const m of moves) await db.collection('stockMoves').doc(`${ws}_${m.seq}`).set({ ...m, workspaceId: ws });
    const app = express();
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string } }).user = { uid: String(req.header('x-test-uid')) }; next(); });
    app.use('/api/v1/reports', reportRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    for (const table of ['stockMoves', 'workspaces']) await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]);
    await db.terminate();
  });

  test('any member reads the period from the full history; outsiders and a reversed period are refused', async () => {
    const get = (uid: string, q: string) => fetch(`${base}/api/v1/reports/inventory-details?workspaceId=${ws}&${q}`, { headers: { 'x-test-uid': uid } });
    const res = await get('view-1', 'startDate=2026-02-01&endDate=2026-03-31');
    const body = await res.json() as { items: Array<{ itemName: string; closing: { quantity: number } }> };
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.deepEqual(body.items.map(i => [i.itemName, i.closing.quantity]), [['Chair', 11], ['Desk', 2]]);
    assert.equal((await get('stranger', 'startDate=2026-02-01&endDate=2026-03-31')).status, 403);
    assert.equal((await get('owner-1', 'startDate=2026-04-01&endDate=2026-03-31')).status, 400);
  });
});

describe('Reports → Inventory Item Details', () => {
  afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

  test('each item with its opening, movements and closing; a movement opens its entry', async () => {
    setComponentWorkspace('owner');
    const calls = stubFetchWithBodies(200, { items: itemDetails(moves, '2026-02-01', '2026-02-28') });
    render(<InventoryDetailsReportView />);
    await waitFor(() => assert.ok(screen.getByText('Chair', { selector: 'caption bdi' })));
    assert.ok(calls[0].url.startsWith('/api/v1/reports/inventory-details?workspaceId=component-workspace'));
    assert.match(screen.getByText('Chair', { selector: 'caption bdi' }).closest('table')!.textContent || '', /Opening10\$100\.00.*Sold.*-37.*Bought.*\+512.*Closing \(in 5, out 3\)12\$130\.00/);
    assert.match(screen.getByText('Bought in the period').closest('table')!.textContent || '', /Chair5\$60\.00\$12\.00/);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Sold on Feb 3, 2026/ })); });
    assert.deepEqual(useUIStore.getState().focusRecord, { type: 'transaction', id: 't-sale' });
  });
});
