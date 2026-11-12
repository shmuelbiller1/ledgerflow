/**
 * EU-E5 by hand: Maui house budgets 1,000.00 of rent income a month and 300.00 of cleaning a month, and 1,200.00 of
 * insurance a year. For January–March (3 months): 3,000.00 − 900.00 − 300.00 = 1,800.00 budgeted result.
 * Aspen has no budget (0); a label nobody budgets gives null (no row).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { budgetedResult, budgetLabel, monthsCovered } from '../lib/budgetByLabel';
import type { Budget, ChartAccount } from '../types';

const accounts = [
  { id: 'rent', name: 'Rent income', type: 'income' }, { id: 'clean', name: 'Cleaning', type: 'expense' },
  { id: 'ins', name: 'Insurance', type: 'expense' }, { id: 'bank', name: 'Bank', type: 'asset' },
] as unknown as ChartAccount[];
const b = (id: string, targetId: string, amountCents: number, period: string, value?: string) =>
  ({ id, uid: 'u', targetId, targetType: 'account', period, amountCents, createdAt: '', ...(value ? { metadata: { label: { dimensionId: 'property', value } } } : {}) }) as Budget & { metadata?: unknown };
const budgets = [b('1', 'rent', 100000, 'monthly', 'maui'), b('2', 'clean', 30000, 'monthly', 'maui'), b('3', 'ins', 120000, 'yearly', 'maui'), b('4', 'rent', 999999, 'monthly'), b('5', 'bank', 5000, 'monthly', 'maui')];

test('EU-E5: months covered', () => {
  assert.equal(monthsCovered('2026-01-01', '2026-03-31'), 3);
  assert.equal(monthsCovered('2025-11-15', '2026-02-01'), 4);
  assert.equal(monthsCovered('2026-05-10', '2026-05-12'), 1);
});

test('EU-E5: Maui house Jan–Mar budgeted result 1,800.00; Aspen 0; an unbudgeted label null', () => {
  const at = (dimensionId: string, value: string) => budgetedResult({ budgets, accounts, dimensionId, value, start: '2026-01-01', end: '2026-03-31' });
  assert.equal(at('property', 'maui'), 180000);
  assert.equal(at('property', 'aspen'), 0);
  assert.equal(at('class', 'ops'), null);
  assert.deepEqual(budgetLabel(budgets[0]), { dimensionId: 'property', value: 'maui' });
  assert.equal(budgetLabel(budgets[3]), null);
});

test('EU-E5: only months where the budget and the period overlap count', () => {
  const later = { ...b('6', 'rent', 100000, 'monthly', 'aspen'), startDate: '2026-06-01' } as Budget & { metadata?: unknown };
  const ended = { ...b('7', 'rent', 100000, 'monthly', 'aspen'), startDate: '2025-01-01', endDate: '2026-01-31' } as Budget & { metadata?: unknown };
  const at = (list: Array<Budget & { metadata?: unknown }>) => budgetedResult({ budgets: list, accounts, dimensionId: 'property', value: 'aspen', start: '2026-01-01', end: '2026-03-31' });
  assert.equal(at([later]), 0, 'starts in June: nothing in Jan–Mar');
  assert.equal(at([ended]), 100000, 'ends in January: one month');
});

test('EU-E5: a budget saved under the account name (the form\'s list) counts; an ambiguous name does not', () => {
  const byName = { ...b('8', 'Rent income', 100000, 'monthly', 'aspen') } as Budget & { metadata?: unknown };
  const at = (list: Array<Budget & { metadata?: unknown }>, accts = accounts) => budgetedResult({ budgets: list, accounts: accts, dimensionId: 'property', value: 'aspen', start: '2026-01-01', end: '2026-01-31' });
  assert.equal(at([byName]), 100000);
  const twin = [...accounts, { id: 'rent2', name: 'Rent income', type: 'income' } as unknown as ChartAccount];
  assert.equal(at([byName], twin), 0);
});
