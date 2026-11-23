/**
 * Audit RP-04 (reporting review, 22 Nov 2026), as an acceptance test: the cash-flow statement
 * counts only actual cash legs, not every noncash counterpart line of a partly financed entry.
 *
 * Audit worked example: acquire $10,000 of equipment, paying $2,000 cash directly and owing the
 * seller $8,000 on a loan (no separate borrowing cash inflow). Journal: debit equipment
 * $10,000; credit bank $2,000; credit loan payable $8,000. The statement must show investing
 * outflow $2,000, financing inflow $0 and net cash change −$2,000.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeCashFlow } from '../server/reports/computeReports';
import type { ChartAccount, Transaction } from '../types';

const accounts = [
  { id: 'cash', name: 'Bank', type: 'asset', category: 'Cash', code: '1000' },
  { id: 'equip', name: 'Equipment', type: 'asset', category: 'Fixed Assets', code: '1500' },
  { id: 'loan', name: 'Loan Payable', type: 'liability', category: 'Long Term Liabilities', code: '2500' },
  { id: 'rev', name: 'Sales', type: 'revenue', category: 'Revenue' },
  { id: 'ar', name: 'Accounts Receivable', type: 'asset', category: 'Receivables' },
] as ChartAccount[];

test('RP-04: a partly financed acquisition shows only its cash leg in the cash sections', () => {
  const tx = {
    id: 't', date: '2026-05-01', description: 'Equipment paid partly with cash and supplier loan',
    status: 'completed', type: 'actual', currency: 'USD', exchangeRate: 1,
    lines: [
      { accountId: 'equip', amountCents: 1_000_000 },
      { accountId: 'cash', amountCents: -200_000 },
      { accountId: 'loan', amountCents: -800_000 },
    ],
  } as Transaction;
  const result = computeCashFlow(accounts, [tx], '2026-05-01', '2026-05-31');
  assert.equal(result.investing.total, -200_000, 'investing carries the $2,000 cash paid, not the $10,000 gross');
  assert.equal(result.financing.total, 0, 'the $8,000 supplier loan is noncash: no fictional financing inflow');
  assert.equal(result.netChange, -200_000, 'net cash change is the actual cash movement');
});

test('RP-04: an all-cash acquisition still classifies its cash leg as investing', () => {
  const tx = {
    id: 't2', date: '2026-05-02', description: 'Equipment bought outright for cash',
    status: 'completed', type: 'actual', currency: 'USD', exchangeRate: 1,
    lines: [
      { accountId: 'equip', amountCents: 1_000_000 },
      { accountId: 'cash', amountCents: -1_000_000 },
    ],
  } as Transaction;
  const result = computeCashFlow(accounts, [tx], '2026-05-01', '2026-05-31');
  assert.equal(result.investing.total, -1_000_000);
  assert.equal(result.financing.total, 0);
  assert.equal(result.netChange, -1_000_000);
});

test('RP-04: a loan drawn in cash is a real financing inflow, and a cash sale is operating', () => {
  const drawn = {
    id: 'd', date: '2026-05-03', description: 'Loan drawn in cash',
    status: 'completed', type: 'actual', currency: 'USD', exchangeRate: 1,
    lines: [{ accountId: 'cash', amountCents: 500_000 }, { accountId: 'loan', amountCents: -500_000 }],
  } as Transaction;
  const sold = {
    id: 's', date: '2026-05-04', description: 'Sold on credit, no cash yet',
    status: 'completed', type: 'actual', currency: 'USD', exchangeRate: 1,
    lines: [{ accountId: 'ar', amountCents: 700_000 }, { accountId: 'rev', amountCents: -700_000 }],
  } as Transaction;
  const result = computeCashFlow(accounts, [drawn, sold], '2026-05-01', '2026-05-31');
  assert.equal(result.financing.total, 500_000, 'a loan actually received in cash is financing');
  assert.equal(result.operating.total, 0, 'a credit sale moves no cash');
  assert.equal(result.netChange, 500_000);
});
