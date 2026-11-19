import test from 'node:test';
import assert from 'node:assert/strict';
import { statementChangeGroups, changeFilter, changeContributions } from '../lib/statementChange';
import { computeBalanceSheet, computeProfitAndLoss } from '../server/reports/computeReports';
import { explainFigure } from '../server/reports/explain';
import { makeChartAccount, makeTransaction } from './fixtures';

const period = (startDate: string, endDate: string) => ({ startDate, endDate, id: startDate, label: startDate });
const a = period('2026-01-01', '2026-01-31'), b = period('2026-02-01', '2026-02-28');
const accounts = [makeChartAccount({ id: 'cash', openingBalanceCents: 80000 }), makeChartAccount({ id: 'capital', type: 'equity', openingBalanceCents: 80000 }),
  makeChartAccount({ id: 'loans', type: 'liability' }), makeChartAccount({ id: 'sales', type: 'income' }), makeChartAccount({ id: 'cogs', type: 'cost_of_goods' }), makeChartAccount({ id: 'rent', type: 'expense' })];
const tx = (id: string, date: string, amounts: Record<string, number>) => makeTransaction({ id, date, description: id, status: 'completed', lines: Object.entries(amounts).map(([accountId, amountCents]) => ({ accountId, amountCents })) });
const ledger = [tx('jan-sale', '2026-01-31', { cash: 7500, cogs: 2500, sales: -10000 }), tx('feb-sale', '2026-02-01', { cash: 13500, cogs: 1500, sales: -15000 }),
  tx('rent', '2026-02-28', { rent: 3000, cash: -3000 }), tx('loan', '2026-02-04', { cash: 100000, loans: -100000 })];
const totals: Record<string, [number, number]> = {
  'total:income': [15000, 10000], 'total:cogs': [1500, 2500], 'total:expense': [3000, 0], 'total:grossProfit': [13500, 7500], 'total:netIncome': [10500, 7500],
  'total:assets': [198000, 87500], 'total:liabilities': [100000, 0], 'total:retainedEarnings': [18000, 7500], 'total:equity': [98000, 87500], 'total:claims': [198000, 87500],
};
for (const asOf of [false, true]) test(`reconcile all ${asOf ? 'balance sheet' : 'P&L'} headline totals in both directions, excluding common entries and openings`, () => {
  const chart = asOf ? computeBalanceSheet(accounts, []) : computeProfitAndLoss(accounts, []);
  for (const [id, group] of Object.entries(statementChangeGroups(chart, accounts))) {
    const [current, prior] = totals[id];
    const lines = explainFigure(accounts, ledger, changeFilter(group, asOf, b, a)).lines;
    const changes = changeContributions(lines, group, asOf, b, a, current, prior);
    assert.ok(changes, id);
    assert.equal(changes.reduce((sum, e) => sum + e.change, 0), current - prior, id);
    const reverse = changeContributions(lines, group, asOf, a, b, prior, current);
    assert.deepEqual(reverse, changes.map(e => ({ ...e, change: -e.change })), id);
    if (asOf) assert.ok(changes.every(e => e.id !== 'jan-sale'), id);
  }
});
test('overlapping days cancel; two offsetting entries remain even when the total change is zero', () => {
  const now = period('2026-01-15', '2026-02-28');
  const group = { ids: ['sales'], sign: -1 as const };
  const prior = period('2026-01-01', '2026-02-01');
  const activity = [...ledger, tx('repeat', '2026-02-10', { cash: 2000, sales: -2000 }), tx('earlier', '2026-01-10', { cash: 2000, sales: -2000 })];
  const lines = explainFigure(accounts, activity, changeFilter(group, false, now, prior)).lines;
  assert.deepEqual(changeContributions(lines, group, false, now, prior, 27000, 27000)?.map(e => [e.id, e.change]), [['earlier', -2000], ['repeat', 2000]]);
});
