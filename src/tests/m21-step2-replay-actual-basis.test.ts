/**
 * M-21 step 2, review fix: the cost replay keeps the actual receipt basis when a receipt moved stock under
 * standard-cost posting. A purchase move under the setting carries its standard value (what the books posted
 * Inventory at) beside its actual value (what the average-cost basis must use); the replay's average must
 * consume the actual value, not the standard one, so the stock's average-cost basis is unaffected by turning
 * the setting on.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { replay } from '../server/services/repostService';
import type { StockMove } from '../lib/stockMoves';
import type { Transaction } from '../types';

  const move = (kind: StockMove['kind'], quantity: number, valueCents: number, actualValueCents?: number, transactionId?: string): StockMove & { id: string } => ({
    id: `m_${kind}_${quantity}`,
    workspaceId: 'ws', itemId: 'chair', itemName: 'Chair', date: '2026-11-10', kind,
    quantity, quantityBefore: 0, quantityAfter: quantity, unitCostCents: 0, valueCents,
    seq: `${kind}_${quantity}`, uid: 'o', createdAt: '2026-11-10T00:00:00.000Z',
    ...(actualValueCents !== undefined ? { actualValueCents } : {}),
    ...(transactionId ? { transactionId } : {}),
  });

test('M-21 step 2: a receipt under standard-cost posting replays its average at the actual, not the standard', () => {
  // 10 chairs: the books posted Inventory at the standard 4,000 (valueCents 40,000) but the average-cost basis
  // is the actual 5,000 (actualValueCents 50,000)
  const moves = [
    move('purchase', 10, 40000, 50000),
    // a sale of 4 relieves 4 × 5,000 = 20,000 at the actual basis, not 4 × 4,000 = 16,000
    move('sale', -4, -20000, undefined, 'sale_1'),
  ];
  const saleEntry = {
    id: 'sale_1', workspaceId: 'ws', uid: 'o', date: '2026-11-10', totalAmountCents: 20000, currency: 'USD',
    status: 'completed', type: 'actual', createdAt: '2026-11-10',
    metadata: { type: 'invoice-cogs-auto', invoiceId: 'inv1', cogsForLineId: 'l1' },
  } as unknown as Transaction;
  const entries = new Map<string, Transaction & { id: string }>([['sale_1', saleEntry as Transaction & { id: string }]]);

  const result = replay(moves as never, entries, '2026-01-01');

  assert.equal(result.cost, 5000, 'the average after the receipt is the actual basis, not the standard');
  const valued = result.valued.find(v => v.of === 'sale');
  assert.ok(valued, 'the sale is valued');
  assert.equal(valued!.cents, 20000, 'the sale is valued at 4 × 5,000 (actual), not 4 × 4,000 (standard)');
});

test('M-21 step 2: a receipt without an actual value replays its average at the value it moved at', () => {
  // no actual basis recorded (the setting was off, or a pre-step-2 history): the value is the basis
  const moves = [move('purchase', 10, 50000)];
  const result = replay(moves as never, new Map(), '2026-01-01');
  assert.equal(result.cost, 5000, 'the average is the value the stock came in at');
});
