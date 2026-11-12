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
