import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TransactionTemplates } from '../../src/kernel/templates/TransactionTemplates';
import { DoubleEntryValidator } from '../../src/kernel/validation/DoubleEntryValidator';
import { calculateAmountDue, calculateDocumentTax } from '../../src/lib/documentMath';
import { computeBalanceSheet, computeProfitAndLoss, computeTrialBalance } from '../../src/server/reports/computeReports';
import { postingLock } from '../../src/lib/periodLock';
import type { ChartAccount, Transaction, TransactionLine } from '../../src/types';

// Independently worked synthetic figures. This is pure calculation evidence, not
// authenticated posting, database persistence, legal tax classification or E2E.
const account = (id: string, type: string): ChartAccount => ({ id, name: id, type, workspaceId: 'w' }) as ChartAccount;
const ref = (id: string) => ({ id, name: id });
const accounts = [account('cash', 'asset'), account('ar', 'asset'), account('input-tax', 'asset'), account('ap', 'liability'), account('output-tax', 'liability'), account('capital', 'equity'), account('sales', 'revenue'), account('discount', 'expense'), account('expense', 'expense')];
const transaction = (id: string, lines: TransactionLine[], status = 'completed'): Transaction => ({ id, uid: 'u', workspaceId: 'w', date: '2026-07-01', currency: 'USD', status, type: 'actual', lines } as Transaction);

test('worked invoice, bill and partial settlements reconcile trial balance, P&L and balance sheet', () => {
  // $1,000 capital; $1,000 gross sale less $100 discount + $162 tax = $1,062;
  // $200 expense + $36 input tax = $236. Receive $300, pay $100.
  const invoice = TransactionTemplates.buildInvoiceLines({ invoiceNumber: 'I1', customerName: 'C', totalCents: 106200, taxCents: 16200, discountCents: 10000, arAccount: ref('ar'), revenueAccount: ref('sales'), taxAccount: ref('output-tax'), discountAccount: ref('discount') });
  const bill = TransactionTemplates.buildBillLines({ billNumber: 'B1', vendorName: 'V', totalCents: 23600, taxCents: 3600, apAccount: ref('ap'), expenseAccount: ref('expense'), taxAccount: ref('input-tax') });
  const received = TransactionTemplates.buildPaymentLines({ documentNumber: 'I1', entityName: 'C', amountCents: 30000, cashAccount: ref('cash'), offsetAccount: ref('ar'), isReceipt: true });
  const paid = TransactionTemplates.buildPaymentLines({ documentNumber: 'B1', entityName: 'V', amountCents: 10000, cashAccount: ref('cash'), offsetAccount: ref('ap'), isReceipt: false });
  const txs = [transaction('opening', [{ accountId: 'cash', amountCents: 100000 }, { accountId: 'capital', amountCents: -100000 }]), transaction('invoice', invoice), transaction('bill', bill), transaction('receipt', received), transaction('payment', paid)];
  for (const tx of txs) assert.equal(DoubleEntryValidator.validateJournalEntry(tx), true);
  const pl = computeProfitAndLoss(accounts, txs, '2026-07-01', '2026-07-31');
  const bs = computeBalanceSheet(accounts, txs, '2026-07-31');
  const tb = computeTrialBalance(accounts, txs, '2026-07-31');
  assert.equal(pl.income.total, 100000);
  assert.equal(pl.expense.total, 30000);
  assert.equal(pl.netIncome, 70000);
  assert.deepEqual([bs.assets.cash, bs.assets.ar, bs.assets['input-tax']], [120000, 76200, 3600]);
  assert.deepEqual([bs.liabilities.ap, bs.liabilities['output-tax']], [13600, 16200]);
  assert.deepEqual([bs.totalAssets, bs.totalClaims, bs.isBalanced], [199800, 199800, true]);
  assert.equal(tb.totalDebit, tb.totalCredit);
  assert.equal(tb.isBalanced, true);
  assert.equal(calculateAmountDue({ amountCents: 106200, amountPaidCents: 30000 }), 76200);
  assert.equal(calculateAmountDue({ amountCents: 23600, amountPaidCents: 10000 }), 13600);
});

test('tax-exclusive and inclusive cases, explicit tax precedence, and deposits', () => {
  assert.equal(calculateDocumentTax({ amountCents: 100000, discountCents: 10000, taxRate: 0.18 }), 16200);
  assert.equal(calculateDocumentTax({ amountCents: 11800, taxInclusive: true, taxRate: 0.18 }), 1800);
  assert.equal(calculateDocumentTax({ taxAmountCents: 700, taxCents: 900, amountCents: 10000, taxRate: 0.18 }), 700);
  assert.equal(calculateAmountDue({ amountCents: 11800, depositCents: 3000, amountPaidCents: 5000 }), 3800);
});

test('void/draft and future-dated records do not enter the selected period', () => {
  const lines = [{ accountId: 'cash', amountCents: 100 }, { accountId: 'sales', amountCents: -100 }];
  const included = transaction('current', lines);
  const draft = transaction('draft', lines, 'draft');
  const voided = transaction('void', lines, 'void');
  const future = { ...transaction('future', lines), date: '2026-08-01' };
  assert.equal(computeProfitAndLoss(accounts, [included, draft, voided, future], '2026-07-01', '2026-07-31').income.total, 100);
  assert.equal(computeBalanceSheet(accounts, [included, draft, voided, future], '2026-07-31').assets.cash, 100);
});

test('hard and soft close are date- and role-sensitive in the pure guard', () => {
  const ws = { uid: 'owner', roles: { clerk: 'bookkeeper', accountant: 'accountant' }, lockDate: '2026-01-31', softLockDate: '2026-02-28' };
  assert.equal(postingLock('2026-01-31', ws, 'owner')?.kind, 'hard');
  assert.equal(postingLock('2026-02-28', ws, 'clerk')?.kind, 'soft');
  assert.equal(postingLock('2026-02-28', ws, 'accountant'), null);
  assert.equal(postingLock('2026-03-01', ws, 'clerk'), null);
});
