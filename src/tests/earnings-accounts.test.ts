/**
 * The balance sheet's equity "Entries" asks for the equity accounts plus the accounts whose lines make the
 * earnings. That list must be exactly the accounts calculateNetIncome counts, or the explanation cannot add
 * up to the sub-total printed beside it (a 'revenue' account was missing until 28 Oct).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateNetIncome, isEarningsAccount } from '../lib/txFilters';
import type { ChartAccount, Transaction } from '../types';

// every type the account schema accepts (src/schemas.ts), including ones the app's own type does not list
const types = ['asset', 'liability', 'equity', 'income', 'expense', 'cost_of_goods', 'revenue', 'other_income', 'other_expense'];

test('an account counts in the earnings exactly when isEarningsAccount says so', () => {
  const variants: Array<Record<string, string>> = [
    ...types.map(type => ({ type })),
    { type: 'asset', category: 'COGS' }, { type: 'expense', category: 'Direct Costs' }, { type: 'liability', role: 'cogs' },
  ];
  for (const [i, variant] of variants.entries()) {
    const account = { id: `a${i}`, name: `Account ${i}`, ...variant } as unknown as ChartAccount;
    const entry = { id: `t${i}`, date: '2026-03-01', status: 'completed', type: 'journal', lines: [{ accountId: account.id, amountCents: 1000 }, { accountId: 'other', amountCents: -1000 }] } as unknown as Transaction;
    const counted = calculateNetIncome([entry], [account], '2026-01-01', '2026-12-31').netIncome !== 0;
    assert.equal(isEarningsAccount(account), counted, `${JSON.stringify(variant)}: drill-down and earnings agree`);
  }
});
