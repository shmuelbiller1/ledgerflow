/**
 * A-45: inventory cycle counts. Hand-checked here: a sheet for a place lists what the stock-moves
 * ledger puts there with the expected quantity, a blank row is never read as zero, a difference is
 * valued at the item's own cost, an item whose history does not explain its quantity is flagged so
 * the count is not blamed, and marking a sheet ready records who checked it and posts nothing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  COUNT_POSTING_NOTE, countInputProblem, countSheetId, countSheetVariance, enterCount, markReady,
  openCountSheet, readyProblem, type CountSheet,
} from '../lib/cycleCounts';
import { NO_LOCATION, type StockMove } from '../lib/stockMoves';

const item = (overrides: Partial<{ id: string; name: string; sku: string; quantityAtHand: number; unitCostCents: number }>) => ({
  id: 'a', name: 'Widget', sku: 'W-1', quantityAtHand: 10, unitCostCents: 400, ...overrides,
});

const move = (overrides: Partial<StockMove>): StockMove => ({
  workspaceId: 'w1', itemId: 'a', date: '2026-10-01', kind: 'purchase', quantity: 10,
  quantityBefore: 0, quantityAfter: 10, unitCostCents: 400, valueCents: 4000, seq: '1', uid: 'u1',
  createdAt: '2026-10-01T00:00:00Z', ...overrides,
});

test('a sheet lists what the ledger puts at the place, with the expected quantity', () => {
  const moves: StockMove[] = [
    move({ itemId: 'a', locationId: 'warehouse', seq: '1', quantityBefore: 0, quantityAfter: 10, quantity: 10 }),
    move({ itemId: 'a', locationId: 'warehouse', seq: '2', date: '2026-10-02', kind: 'sale', quantity: -4, quantityBefore: 10, quantityAfter: 6, valueCents: -1600 }),
    move({ itemId: 'b', locationId: 'shop', seq: '3', quantityBefore: 0, quantityAfter: 5, quantity: 5 }),
  ];
  const items = [item({}), item({ id: 'b', name: 'Gadget', unitCostCents: 1000, quantityAtHand: 5 }), item({ id: 'c', name: 'Unmoved', quantityAtHand: 2 })];
  const sheet = openCountSheet({ locationId: 'warehouse', date: '2026-10-12', items, moves });
  assert.equal(sheet.id, 'count-warehouse-2026-10-12');
  assert.deepEqual(sheet.rows.map(r => [r.itemId, r.expected]), [['a', 6]], 'only the items the ledger puts there, at their expected quantity');
  assert.equal(sheet.rows[0].unitCostCents, 400);

  const full = openCountSheet({ locationId: 'warehouse', date: '2026-10-12', items, moves, includeZero: true });
  assert.deepEqual(full.rows.map(r => r.itemId), ['a', 'b', 'c'], 'a full count lists every item');
  assert.equal(full.rows.find(r => r.itemId === 'b')?.expected, 0);
  assert.equal(full.rows.find(r => r.itemId === 'b')?.unexplained, true, 'nothing says these units are at this place');
});

test('an item with no history uses its own quantity on hand, and says so', () => {
  const sheet = openCountSheet({ locationId: NO_LOCATION, date: '2026-10-12', items: [item({ quantityAtHand: 7 })] });
  assert.equal(sheet.rows.length, 1);
  assert.equal(sheet.rows[0].expected, 7);
  assert.equal(sheet.rows[0].unexplained, true);
  assert.match(sheet.rows[0].unexplainedReason || '', /quantity on hand/);

  const named = openCountSheet({ locationId: 'warehouse', date: '2026-10-12', items: [item({ quantityAtHand: 7 })], includeZero: true });
  assert.equal(named.rows[0].expected, 0, 'a named place does not inherit the item’s total');
  assert.match(named.rows[0].unexplainedReason || '', /nothing says/);
});

test('an unexplained history is flagged on the row', () => {
  const broken: StockMove[] = [
    move({ itemId: 'a', locationId: NO_LOCATION, seq: '1', quantityBefore: 0, quantityAfter: 10, quantity: 10 }),
    move({ itemId: 'a', locationId: NO_LOCATION, seq: '2', quantityBefore: 3, quantityAfter: 8, quantity: 5 }),
  ];
  const sheet = openCountSheet({ locationId: NO_LOCATION, date: '2026-10-12', items: [item({})], moves: broken });
  assert.equal(sheet.rows[0].unexplained, true);
  assert.match(sheet.rows[0].unexplainedReason || '', /history|ends at|starts at/);
});

test('a counted row that differs shows the difference and its value at the item’s cost', () => {
  const moves: StockMove[] = [move({ itemId: 'a', locationId: 'warehouse', quantityBefore: 0, quantityAfter: 10, quantity: 10 })];
  let sheet = openCountSheet({ locationId: 'warehouse', date: '2026-10-12', items: [item({ id: 'a' }), item({ id: 'b', name: 'Gadget', unitCostCents: 1000 })], moves, includeZero: true });
  sheet = enterCount(sheet, 'a', '8');
  sheet = enterCount(sheet, 'b', '12');

  const variance = countSheetVariance(sheet);
  assert.deepEqual(variance.differences.map(r => [r.itemId, r.difference, r.valueCents]), [['a', -2, -800], ['b', 12, 12000]]);
  assert.equal(variance.unitsShort, 2);
  assert.equal(variance.unitsFound, 12);
  assert.equal(variance.valueCents, 11200);
  assert.deepEqual(variance.notCounted, [], 'both were counted');

  const blank = countSheetVariance(openCountSheet({ locationId: 'warehouse', date: '2026-10-12', items: [item({})], moves }));
  assert.equal(blank.countedRows.length, 0);
  assert.equal(blank.notCounted.length, 1, 'a blank row is not zero, it is not counted');
  assert.equal(countSheetVariance(sheet).countedRows.length, 2);
});

test('a typed count that cannot be read is refused, and a blank clears the row', () => {
  assert.equal(countInputProblem(''), null);
  assert.equal(countInputProblem('  '), null, 'blank means not counted');
  assert.equal(countInputProblem('4.5'), null);
  assert.match(countInputProblem('four') || '', /number/);
  assert.match(countInputProblem('-1') || '', /negative/);
  assert.match(countInputProblem('1.1234567') || '', /decimal/);

  let sheet = openCountSheet({ locationId: NO_LOCATION, date: '2026-10-12', items: [item({})] });
  sheet = enterCount(sheet, 'a', '5');
  assert.equal(sheet.rows[0].counted, 5);
  assert.equal(enterCount(sheet, 'a', 'oops').rows[0].counted, 5, 'an unreadable entry leaves the row as it was');
  assert.equal(enterCount(sheet, 'a', '').rows[0].counted, undefined, 'blank clears it back to not counted');
  assert.equal(countSheetId(NO_LOCATION, '2026-10-12'), 'count-no-location-2026-10-12');
});

test('marking ready checks the sheet, records who, and posts nothing', () => {
  const moves: StockMove[] = [move({ itemId: 'a', locationId: 'warehouse', quantityBefore: 0, quantityAfter: 10, quantity: 10 })];
  let sheet: CountSheet = openCountSheet({ locationId: 'warehouse', date: '2026-10-12', items: [item({})], moves });

  assert.match(readyProblem(sheet) || '', /Nothing is counted/);
  const refused = markReady(sheet, 'Dana', '2026-10-12T10:00:00Z');
  assert.equal(refused.sheet.status, 'open');
  assert.match(refused.problem || '', /Nothing is counted/);

  sheet = enterCount(sheet, 'a', '9');
  const done = markReady(sheet, 'Dana', '2026-10-12T10:00:00Z');
  assert.equal(done.problem, undefined);
  assert.equal(done.sheet.status, 'ready');
  assert.equal(done.sheet.markedReadyBy, 'Dana');
  assert.equal(done.sheet.markedReadyAt, '2026-10-12T10:00:00Z');
  assert.equal(done.sheet.rows[0].counted, 9, 'the count is kept');
  assert.equal(done.sheet.rows[0].expected, 10, 'the expected quantity is untouched');
  assert.match(readyProblem(done.sheet) || '', /already marked ready/);
  assert.match(COUNT_POSTING_NOTE, /does not post/);

  const broken: StockMove[] = [
    move({ itemId: 'a', locationId: 'warehouse', seq: '1', quantityBefore: 0, quantityAfter: 10, quantity: 10 }),
    move({ itemId: 'a', locationId: 'warehouse', seq: '2', quantityBefore: 3, quantityAfter: 8, quantity: 5 }),
  ];
  const odd = enterCount(openCountSheet({ locationId: 'warehouse', date: '2026-10-12', items: [item({})], moves: broken }), 'a', '8');
  assert.match(readyProblem(odd) || '', /does not explain/);
  assert.equal(markReady(odd, 'Dana', 'T').sheet.status, 'open', 'a broken history is not waved through');
});

test('the library posts nothing: it never reaches a writing service', () => {
  const source = fs.readFileSync(path.resolve('src/lib/cycleCounts.ts'), 'utf8');
  assert.ok(!/services\//.test(source), 'no service (and so no request) is imported');
  assert.ok(!/fetch\(|countStockRequest|adjustStockRequest/.test(source), 'the library sends nothing anywhere');
});
