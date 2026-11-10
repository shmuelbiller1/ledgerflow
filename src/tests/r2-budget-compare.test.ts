/**
 * R-2: the P&L "compare to budget" figures (src/lib/budgetStatement.ts).
 *
 * Hand-worked case (cents), period January–March 2026:
 *   Sales budget 3,000,000 a quarter (quarterly, from 2026-01) → 1,000,000 a month → 3,000,000 for the quarter
 *   Cost of sales budget 400,000 a month (monthly) → 1,200,000
 *   Rent budget "2026" 1,200,000 for the year (dated yearly) → 100,000 a month → 300,000
 *   Rent budget named by its code "6100", 50,000 a month → 150,000 more on the same line → Rent 450,000
 *   A cash (balance-sheet) budget and a project budget have no P&L line.
 *   Gross profit 3,000,000 − 1,200,000 = 1,800,000; net 1,800,000 − 450,000 = 1,350,000.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { budgetPL } from '../lib/budgetStatement';
import type { ChartAccount } from '../types';
import type { SavedBudget } from '../lib/budgetActual';

const acc = (id: string, type: string, extra: Partial<ChartAccount> = {}) => ({ id, name: id, type, balance: 0, ...extra }) as unknown as ChartAccount;
const accounts = [acc('sales', 'income'), acc('cogs', 'cost_of_goods'), acc('rent', 'expense', { code: '6100' }), acc('cash', 'asset')];
const budget = (targetId: string, period: string, amountCents: number, targetType: SavedBudget['targetType'] = 'account') =>
  ({ id: `${targetId}-${period}`, uid: 'u', targetId, targetType, period, amountCents, createdAt: '2026-01-01T00:00:00Z', startDate: '2026-01-01' }) as SavedBudget;

describe('R-2: budget figures for the P&L', () => {
  test('a quarter of quarterly, monthly and yearly budgets, by account id and by code', () => {
    const pl = budgetPL([
      budget('sales', 'quarterly', 3_000_000),
      budget('cogs', 'monthly', 400_000),
      budget('rent', '2026', 1_200_000),
      budget('6100', 'monthly', 50_000),
      budget('cash', 'monthly', 999_999),
      budget('project-x', 'monthly', 777_777, 'project'),
    ], accounts, '2026-01-01', '2026-03-31');
    assert.equal(pl.income.accounts.sales.balance, 3_000_000);
    assert.equal(pl.cogs.accounts.cogs.balance, 1_200_000);
    assert.equal(pl.expense.accounts.rent.balance, 450_000);
    assert.equal(pl.grossProfit, 1_800_000);
    assert.equal(pl.netIncome, 1_350_000);
    assert.deepEqual(Object.keys(pl.expense.accounts), ['rent']);
  });

  test('no budgets: an empty P&L', () => {
    const pl = budgetPL([], accounts, '2026-01-01', '2026-01-31');
    assert.equal(pl.netIncome, 0);
    assert.deepEqual(pl.income.accounts, {});
  });
});
