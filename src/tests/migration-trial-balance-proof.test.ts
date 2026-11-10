import test from 'node:test';
import assert from 'node:assert/strict';
import { compareTrialBalances, parseQuickBooksTrialBalance } from '../lib/migrationTrialBalanceProof';

import { BRAND_NAME } from '../config/brand';
const fixture = 'Account,Debit,Credit\nCash,100.00,\nRevenue,,100.00\nTOTAL,100.00,100.00';
const server = {
  accounts: [
    { id: 'a', name: 'Cash', debit: 10000, credit: 0 },
    { id: 'b', name: 'Revenue', debit: 0, credit: 10000 },
  ],
  totalDebit: 10000, totalCredit: 10000, isBalanced: true,
};

test('E-57: source and server account balances match without claiming migration certification', () => {
  const result = compareTrialBalances(parseQuickBooksTrialBalance(fixture), server);
  assert.equal(result.accountsMatch, true);
  assert.equal(result.financialMigrationVerified, false);
  assert.deepEqual(result.differences, []);
});

test('E-57: detects a missing source account and unexpected durable balance', () => {
  const result = compareTrialBalances(parseQuickBooksTrialBalance(fixture), {
    accounts: [{ id: 'a', name: 'Cash', debit: 10000, credit: 0 },
      { id: 'b', name: 'Other Revenue', debit: 0, credit: 10000 }],
    totalDebit: 10000, totalCredit: 10000, isBalanced: true,
  });
  assert.equal(result.accountsMatch, false);
  assert.deepEqual(result.differences.map(d => d.problem), ['missing-in-ledger', 'extra-in-ledger']);
});

test('E-57: detects an amount mismatch even where both trials balance', () => {
  const result = compareTrialBalances(parseQuickBooksTrialBalance(fixture), {
    accounts: [{ id: 'a', name: 'Cash', debit: 9900, credit: 0 },
      { id: 'b', name: 'Revenue', debit: 0, credit: 9900 }],
    totalDebit: 9900, totalCredit: 9900, isBalanced: true,
  });
  assert.equal(result.accountsMatch, false);
  assert.equal(result.debitDifferenceCents, -100);
  assert.equal(result.creditDifferenceCents, -100);
});

test(`E-57: does not match duplicate ${BRAND_NAME} names as if mapped uniquely`, () => {
  const result = compareTrialBalances(parseQuickBooksTrialBalance(fixture), {
    accounts: [{ id: 'a', name: 'Cash', debit: 5000, credit: 0 }, { id: 'b', name: 'Cash', debit: 5000, credit: 0 },
      { id: 'c', name: 'Revenue', debit: 0, credit: 10000 }],
    totalDebit: 10000, totalCredit: 10000, isBalanced: true,
  });
  assert.equal(result.accountsMatch, false);
  assert.equal(result.differences[0].problem, 'ambiguous-name');
});

test('E-57: rejects manipulated or partial server report', () => {
  const source = parseQuickBooksTrialBalance(fixture);
  assert.throws(() => compareTrialBalances(source, { ...server, totalDebit: 9999 }), /does not reconcile/);
  assert.throws(() => compareTrialBalances(source, { ...server, isBalanced: false }), /does not reconcile/);
});

test('E-57: refuses malformed and ambiguous QuickBooks exports', () => {
  assert.throws(() => parseQuickBooksTrialBalance('Account,Debit,Credit\nCash,5.00,5.00'), /both debit and credit/);
  assert.throws(() => parseQuickBooksTrialBalance('Account,Debit,Credit\nCash,5.00,\nCash,,5.00'), /duplicate account/);
  assert.throws(() => parseQuickBooksTrialBalance('Account,Debit,Credit\nCash,5.00,\nTotal,4.00,0'), /total row/);
  assert.throws(() => parseQuickBooksTrialBalance('Account,Debit,Credit\nCash,5.001,'), /at most two decimals/);
  assert.throws(() => parseQuickBooksTrialBalance('Account,Debit,Credit\nCash,-5.00,'), /nonnegative/);
});

test('E-57: strict source amounts never round third-decimal values', () => {
  assert.throws(() => parseQuickBooksTrialBalance('Account,Debit,Credit\nCash,5.001,'), /at most two decimals/);
  assert.throws(() => parseQuickBooksTrialBalance('Account,Debit,Credit\nCash,1.234,'), /at most two decimals/);
  assert.throws(() => parseQuickBooksTrialBalance('Account,Debit,Credit\nCash,"1,23",'), /at most two decimals/);
  const exact = parseQuickBooksTrialBalance('Account,Debit,Credit\nCash,"$1,234.50",\nRevenue,,"$1,234.50"');
  assert.equal(exact.totalDebitCents, 123450);
  assert.equal(exact.totalCreditCents, 123450);
});

test('E-57: account differences carry stable server IDs; zero-balance extra accounts still need review', () => {
  const result = compareTrialBalances(parseQuickBooksTrialBalance(fixture), {
    accounts: [...server.accounts, { id: 'extra-id', name: 'Unused account', debit: 0, credit: 0 }],
    totalDebit: 10000, totalCredit: 10000, isBalanced: true,
  });
  assert.equal(result.accountsMatch, false);
  assert.equal(result.differences[0].accountId, 'extra-id');
  assert.equal(result.differences[0].problem, 'extra-in-ledger');
});

test('E-57: duplicate server account IDs are refused, not rendered as unstable rows', () => {
  const source = parseQuickBooksTrialBalance(fixture);
  assert.throws(() => compareTrialBalances(source, {
    accounts: [
      { id: 'a', name: 'Cash', debit: 10000, credit: 0 },
      { id: 'a', name: 'Revenue', debit: 0, credit: 10000 },
    ],
    totalDebit: 10000, totalCredit: 10000, isBalanced: true,
  }), /duplicate account id/);
});
