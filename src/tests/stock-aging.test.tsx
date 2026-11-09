/**
 * Stock aging (W-09): units on hand split by how long ago they came in (first in, first out), a
 * purchase undone takes back the latest units, moves between locations keep the age, stock from
 * before the history is said apart; the last sale; from the server; on screen.
 */
import './helpers/dom';
import test, { after, afterEach, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import React from 'react';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { stockAging, type StockMove } from '../lib/stockMoves';
import StockAgingReportView from '../components/reporting/StockAgingReportView';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { stubFetchWithBodies } from './helpers/dom';

// the screen test stubs fetch; the database test asks the real server
const realFetch = globalThis.fetch;
const names: Record<string, string> = { i1: 'Chair', i2: 'Desk', i3: 'Lamp', i4: 'Old stock', i5: 'Shelf' };
const move = (itemId: string, seq: string, date: string, kind: StockMove['kind'], quantity: number, before: number, valueCents: number): StockMove => ({
  workspaceId: 'w', itemId, itemName: names[itemId], date, kind, quantity, quantityBefore: before, quantityAfter: before + quantity, unitCostCents: 1000, valueCents, seq, uid: 'u', createdAt: date,
});
const moves = [
  move('i1', '001', '2026-01-05', 'opening', 10, 0, 10000),
  move('i1', '002', '2026-02-03', 'sale', -3, 10, -3000),
  move('i1', '003', '2026-02-10', 'purchase', 5, 7, 6000),
  move('i1', '004', '2026-03-01', 'sale', -1, 12, -1100),
  move('i2', '005', '2026-01-02', 'opening', 2, 0, 5000),
  move('i3', '006', '2026-01-02', 'opening', 1, 0, 500),
  move('i3', '007', '2026-01-03', 'adjustment', -1, 1, -500),
  // the history begins with a sale of stock it never saw come in
  move('i4', '008', '2026-04-01', 'sale', -2, 5, -2000),
  move('i5', '009', '2026-01-01', 'purchase', 4, 0, 4000),
  move('i5', '010', '2026-03-01', 'purchase', 3, 4, 3000),
  move('i5', '011', '2026-03-02', 'purchase-reversal', -3, 7, -3000),
  move('i5', '012', '2026-04-20', 'transfer-out', -4, 4, -4000),
  move('i5', '013', '2026-04-20', 'transfer-in', 4, 0, 4000),
];

describe('Stock aging', () => {
  afterEach(() => { cleanup(); });

  test('by age, first in first out; the last sale; the oldest first', () => {
    const rows = stockAging(moves, '2026-04-30');
    assert.deepEqual(rows.map(r => [r.itemName, r.quantity, r.valueCents, r.buckets, r.unknownAge, r.oldestDays, r.lastSold, r.daysSinceSold]), [
      ['Old stock', 3, -2000, { d30: 0, d90: 0, d180: 0, d365: 0, older: 0 }, 3, null, '2026-04-01', 29],
      ['Shelf', 4, 4000, { d30: 0, d90: 0, d180: 4, d365: 0, older: 0 }, 0, 119, null, null],
      ['Desk', 2, 5000, { d30: 0, d90: 0, d180: 2, d365: 0, older: 0 }, 0, 118, null, null],
      ['Chair', 11, 11900, { d30: 0, d90: 5, d180: 6, d365: 0, older: 0 }, 0, 115, '2026-03-01', 60],
    ], 'the lamp has none left; the shelf keeps the January units (the March purchase was undone), and moving it kept their age');
    assert.deepEqual(stockAging(moves, '2026-01-31').find(r => r.itemName === 'Chair')?.buckets, { d30: 10, d90: 0, d180: 0, d365: 0, older: 0 }, 'as of an earlier day');
  });

  test('on screen: asks the server for the day, and shows each item by age', async () => {
    setComponentWorkspace('owner');
    const calls = stubFetchWithBodies(200, { asOf: '2026-04-30', items: stockAging(moves, '2026-04-30') });
    render(<StockAgingReportView />);
    await waitFor(() => assert.ok(screen.getByRole('rowheader', { name: 'Chair' })));
    assert.ok(calls[0].url.startsWith('/api/v1/reports/stock-aging?workspaceId=component-workspace&asOf='));
    assert.match(screen.getByRole('rowheader', { name: 'Chair' }).parentElement!.textContent || '', /11\$119\.0056.*2026-03-01 \(60 days ago\)/);
    assert.ok(screen.getByRole('columnheader', { name: 'Before the history' }));
  });
});

describe('Against the database', { skip: !process.env.LF_TEST_DATABASE_URL && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_aging_${crypto.randomBytes(4).toString('hex')}`;
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

  test('any member reads it as of a day; moves after it are not counted; outsiders are refused', async () => {
    const get = (uid: string, q: string) => realFetch(`${base}/api/v1/reports/stock-aging?workspaceId=${ws}&${q}`, { headers: { 'x-test-uid': uid } });
    const res = await get('view-1', 'asOf=2026-02-05');
    const body = await res.json() as { items: Array<{ itemName: string; quantity: number }> };
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.deepEqual(body.items.map(i => [i.itemName, i.quantity]).sort(), [['Chair', 7], ['Desk', 2], ['Shelf', 4]]);
    assert.equal((await get('stranger', 'asOf=2026-02-05')).status, 403);
    assert.equal((await get('owner-1', 'asOf=yesterday')).status, 400);
  });
});
