/** #802: lines on accounts the chart does not have are reported, and the trial balance is then never "balanced". */
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeTrialBalance } from '../server/reports/computeReports';
import type { ChartAccount, Transaction } from '../types';

const accounts = [
  { id: 'cash', name: 'Checking', type: 'asset' },
  { id: 'sales', name: 'Sales', type: 'revenue' },
] as unknown as ChartAccount[];
const tx = (lines: Array<[string, number]>) => ({ id: 't1', date: '2026-10-01', status: 'completed', lines: lines.map(([accountId, amountCents]) => ({ accountId, amountCents })) }) as unknown as Transaction;

test('normal books: balanced, nothing orphaned', () => {
  const r = computeTrialBalance(accounts, [tx([['cash', 1200], ['sales', -1200]])]);
  assert.equal(r.isBalanced, true);
  assert.deepEqual(r.orphanedLines, []);
});

test('paired unknown accounts: arithmetically even, but reported and not balanced', () => {
  const r = computeTrialBalance(accounts, [tx([['cash', 1200], ['sales', -1200], ['gone1', 5000], ['gone2', -5000]])]);
  assert.equal(r.totalDebit, r.totalCredit);
  assert.equal(r.isBalanced, false);
  assert.deepEqual(r.orphanedLines.map(l => [l.accountId, l.amountCents]), [['gone1', 5000], ['gone2', -5000]]);
});

test('a single unknown line, and gross opening movement on an unknown account', () => {
  assert.equal(computeTrialBalance(accounts, [tx([['cash', 100], ['gone', -100]])]).isBalanced, false);
  const r = computeTrialBalance(accounts, [], undefined, { debits: { gone: 300 }, credits: {} });
  assert.equal(r.isBalanced, false);
  assert.deepEqual(r.orphanedLines, [{ accountId: 'gone', amountCents: 300 }]);
});
