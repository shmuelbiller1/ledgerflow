/**
 * Audit RP-03 (reporting review, 22 Nov 2026), as an acceptance test: the scheduled profit-and-loss
 * table carries cost of goods sold and gross profit, so the displayed figures reconcile. The audit
 * worked case: income $1,000, cost of goods $300, other expenses $200 → gross profit $700 and
 * net profit $500, with a COGS line so the $500 net is explainable.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { profitAndLossTable } from '../lib/scheduledReports';

test('RP-03: the scheduled P&L shows cost of goods sold and gross profit', () => {
  const table = profitAndLossTable(
    {
      income: { total: 100000, accounts: { s: { name: 'Sales', code: '4000', balance: 100000 } } },
      cogs: { total: 30000, accounts: { c: { name: 'Cost of goods sold', code: '5000', balance: 30000 } } },
      expense: { total: 20000, accounts: { r: { name: 'Rent', code: '6000', balance: 20000 } } },
      grossProfit: 70000,
      netIncome: 50000,
    },
    { key: 'M:2026-01', startDate: '2026-01-01', endDate: '2026-01-31', label: '2026-01' },
  );
  const cells = table.rows.map(r => r.cells);
  assert.deepEqual(cells, [
    ['Income', ''], ['4000 Sales', 100000], ['Total income', 100000],
    ['Cost of goods sold', ''], ['5000 Cost of goods sold', 30000], ['Total cost of goods sold', 30000],
    ['Gross profit', 70000],
    ['Operating expenses', ''], ['6000 Rent', 20000], ['Total operating expenses', 20000],
    ['Net profit', 50000],
  ]);
  // the displayed lines reconcile: income - COGS - expenses = net profit
  const indexOf = (label: string) => cells.findIndex(c => c[0] === label);
  assert.equal(
    (cells[indexOf('Total income')][1] as number) - (cells[indexOf('Total cost of goods sold')][1] as number) - (cells[indexOf('Total operating expenses')][1] as number),
    (cells[indexOf('Net profit')][1] as number),
  );
});
