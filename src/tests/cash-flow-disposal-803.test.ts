/**
 * #803: a fixed-asset sale is investing cash only. Equipment 12,000, posted depreciation 4,000, catch-up 500,
 * proceeds 9,000, gain 1,500: DR dep exp 500 / DR acc dep 4,000 / DR bank 9,000 / CR equipment 12,000 / CR gain 1,500.
 * Expected: investing +9,000, operating 0.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeCashFlow } from '../server/reports/computeReports';
import type { ChartAccount, Transaction } from '../types';

const accounts = [
  { id: 'bank', name: 'Checking', type: 'asset', category: 'Cash', code: '1000' },
  { id: 'equip', name: 'Equipment', type: 'asset', category: 'Fixed Assets', code: '1500' },
  { id: 'accdep', name: 'Accumulated Depreciation', type: 'asset', category: 'Fixed Assets', code: '1590' },
  { id: 'depexp', name: 'Depreciation Expense', type: 'expense', code: '6100' },
  { id: 'gain', name: 'Gain on Disposal', type: 'revenue', code: '4900' },
  { id: 'sales', name: 'Sales', type: 'revenue', code: '4000' },
] as unknown as ChartAccount[];
const entry = (id: string, type: string | undefined, lines: Array<[string, number]>) => ({
  id, date: '2026-10-05', status: 'completed', description: id, ...(type ? { metadata: { type } } : {}),
  lines: lines.map(([accountId, amountCents]) => ({ accountId, amountCents })),
}) as unknown as Transaction;
const sale = (type = 'asset-disposal') => entry('sale', type, [['depexp', 500], ['accdep', 4000], ['bank', 9000], ['equip', -12000], ['gain', -1500]]);

test('a sale with a gain is 9,000 of investing cash and nothing operating', () => {
  const r = computeCashFlow(accounts, [sale()]);
  assert.deepEqual([r.investing.total, r.operating.total, r.netChange], [9000, 0, 9000]);
});

test('a partial disposal, a loss, and no proceeds', () => {
  assert.equal(computeCashFlow(accounts, [sale('asset-partial-disposal')]).investing.total, 9000);
  const loss = entry('loss', 'asset-disposal', [['accdep', 4000], ['bank', 6000], ['depexp', 2000], ['equip', -12000]]);
  assert.deepEqual([computeCashFlow(accounts, [loss]).investing.total, computeCashFlow(accounts, [loss]).operating.total], [6000, 0]);
  const scrapped = entry('scrap', 'asset-disposal', [['accdep', 12000], ['equip', -12000]]);
  assert.equal(computeCashFlow(accounts, [scrapped]).netChange, 0);
});

test('ordinary cash sales stay operating', () => {
  const r = computeCashFlow(accounts, [entry('cashsale', undefined, [['bank', 500], ['sales', -500]])]);
  assert.deepEqual([r.operating.total, r.investing.total], [500, 0]);
});
