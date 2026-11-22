/** #923: when refunds exceed charges the period net is negative; each row still shows its share of that net's size. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeExpenseByCategory } from '../lib/reportGenerators';
import { makeChartAccount, makeTransaction } from './fixtures';

test('a negative net gives signed shares instead of 0.0% everywhere', () => {
  const accounts = [
    makeChartAccount({ id: 'occ', name: 'Occupancy', type: 'expense', category: 'Occupancy' }),
    makeChartAccount({ id: 'reb', name: 'Rebates', type: 'expense', category: 'Rebates' }),
    makeChartAccount({ id: 'bank', name: 'Bank', type: 'asset', category: 'Cash' }),
  ];
  const ledger = [
    makeTransaction({ id: 't1', date: '2026-03-01', status: 'completed', posted: true, lines: [{ accountId: 'occ', amountCents: 10000 }, { accountId: 'bank', amountCents: -10000 }] }),
    makeTransaction({ id: 't2', date: '2026-03-02', status: 'completed', posted: true, lines: [{ accountId: 'reb', amountCents: -200000 }, { accountId: 'bank', amountCents: 200000 }] }),
  ];
  const rows = computeExpenseByCategory(accounts, ledger);
  const share = (cat: string) => Number(rows.find(r => r.category === cat)!.percentage.toFixed(1));
  assert.equal(share('Occupancy'), 5.3);
  assert.equal(share('Rebates'), -105.3);
});

test('a positive net is unchanged', () => {
  const accounts = [makeChartAccount({ id: 'a', name: 'A', type: 'expense', category: 'A' }), makeChartAccount({ id: 'b', name: 'B', type: 'expense', category: 'B' }), makeChartAccount({ id: 'bank', name: 'Bank', type: 'asset', category: 'Cash' })];
  const ledger = [
    makeTransaction({ id: 't1', date: '2026-03-01', status: 'completed', posted: true, lines: [{ accountId: 'a', amountCents: 3000 }, { accountId: 'bank', amountCents: -3000 }] }),
    makeTransaction({ id: 't2', date: '2026-03-01', status: 'completed', posted: true, lines: [{ accountId: 'b', amountCents: 1000 }, { accountId: 'bank', amountCents: -1000 }] }),
  ];
  const rows = computeExpenseByCategory(accounts, ledger);
  assert.deepEqual(rows.map(r => [r.category, r.percentage]).sort(), [['A', 75], ['B', 25]]);
});
