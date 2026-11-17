/**
 * W-02 before its migration is applied: without the stockMoves table, stock changes go through as
 * before (no history written), and the server says once which migration to apply. Its own file: the
 * check is cached per process.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { stockMovesReady, writeStockMoves } from '../server/services/stockMoveService';
import type { Firestore, Transaction } from '../server/db/firestore';

test('without the stockMoves table nothing is written to it, and one warning names the migration', async () => {
  let asked = 0;
  const db = {
    tablesExist: async (table: string) => { assert.equal(table, 'stockMoves'); asked += 1; return false; },
    collection: () => { throw new Error('the missing table was written to'); },
  } as unknown as Firestore;
  const t = { set: () => { throw new Error('the missing table was written to'); } } as unknown as Transaction;
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.join(' ')); };
  try {
    assert.equal(await stockMovesReady(db), false);
    assert.equal(await stockMovesReady(db), false, 'asked again within the minute: the cached answer');
    assert.equal(asked, 1);
    writeStockMoves(db, t, [{
      workspaceId: 'ws', itemId: 'i1', itemName: 'Widget', date: '2026-10-07', kind: 'adjustment',
      quantity: 1, quantityBefore: 0, quantityAfter: 1, unitCostCents: 100, valueCents: 100, transactionId: null, uid: 'u',
    }]);
  } finally {
    console.warn = warn;
  }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /20261013060000_stock_moves\.sql/);
});
