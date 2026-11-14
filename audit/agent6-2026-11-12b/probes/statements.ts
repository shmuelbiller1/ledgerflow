/**
 * Agent #6 (12 Nov 2026, second session) — do the four statements agree with each other and with the entries?
 *
 * The trial balance, the profit and loss, the balance sheet and the cash-flow statement are computed by
 * separate functions from the same entries. An accountant's first checks are the ones below, and they
 * hold for any book, however it was entered:
 *
 *   1. trial balance     total debits = total credits, and each account's balance is its own lines.
 *   2. balance sheet     assets = liabilities + equity + profit to date (isBalanced).
 *   3. cross-statement   the P&L's net income is the balance sheet's net income for the same end date.
 *   4. cash flow         the sections add up to the change in cash, and the closing cash is the balance
 *                        sheet's cash accounts.
 *   5. general ledger    the account's movements add up to its trial-balance balance.
 *
 * The fixture is a small year with an opening balance, an invoice and its payment, a bill and its
 * payment, an interest journal, a credit note left out of nothing, and a void entry that must not count.
 *
 * Run: NODE_ENV=test npx tsx audit/agent6-2026-11-12b/probes/statements.ts
 */
import {
  computeBalanceSheet,
  computeCashFlow,
  computeGeneralLedger,
  computeProfitAndLoss,
  computeTrialBalance,
} from '../../../src/server/reports/computeReports';
import { makeChartAccount, makeTransaction } from '../../../src/tests/fixtures';
import type { ChartAccount, Transaction } from '../../../src/types';

let failures = 0;
const report = (id: string, ok: boolean, detail: string) => {
  if (!ok) failures++;
  console.log(`${ok ? 'OK    ' : 'DEFECT'} ${id}: ${detail}`);
};

const account = (id: string, code: string, name: string, type: string, category = '', openingCents?: number) =>
  makeChartAccount({ id, code, name, type, category, ...(openingCents !== undefined ? { openingBalanceCents: openingCents } : {}) } as never);

const accounts: ChartAccount[] = [
  account('bank', '1010', 'Checking', 'asset', 'Bank'),
  account('ar', '1200', 'Accounts Receivable', 'asset', 'Receivables'),
  account('ap', '2000', 'Accounts Payable', 'liability', 'Payables'),
  account('vat', '2200', 'VAT payable', 'liability'),
  account('capital', '3000', 'Owner equity', 'equity'),
  account('sales', '4000', 'Sales', 'income'),
  account('rent', '6000', 'Rent', 'expense'),
  account('interest', '6100', 'Interest', 'expense'),
];

const tx = (id: string, date: string, lines: Array<[string, number]>, metadata: Record<string, unknown> = {}, status = 'completed') =>
  makeTransaction({ id, workspaceId: 'w', date, status, type: 'actual', metadata, lines: lines.map(([accountId, amountCents]) => ({ accountId, amountCents })) } as never);

const transactions: Transaction[] = [
  // the opening balance posted as an entry (a book that carries it as an entry rather than a snapshot)
  tx('open', '2026-01-01', [['bank', 10_000_000], ['capital', -10_000_000]], { type: 'opening-balance' }),
  // sell 1,000.00 + 170.00 VAT on account, then the customer pays
  tx('inv1', '2026-02-10', [['ar', 117_000], ['sales', -100_000], ['vat', -17_000]], { type: 'invoice-accrual', invoiceId: 'i1' }),
  tx('pay1', '2026-03-05', [['bank', 117_000], ['ar', -117_000]], { type: 'payment-posting', paymentId: 'p1' }),
  // rent bill 400.00, paid in April
  tx('bill1', '2026-03-31', [['rent', 40_000], ['ap', -40_000]], { type: 'bill-accrual', billId: 'b1' }),
  tx('pay2', '2026-04-02', [['ap', 40_000], ['bank', -40_000]], { type: 'payment-posting', paymentId: 'p2' }),
  // a hand journal: interest charged by the bank
  tx('int', '2026-06-30', [['interest', 1_500], ['bank', -1_500]]),
  // a void entry that must not count anywhere
  tx('void1', '2026-07-01', [['rent', 999_999], ['bank', -999_999]], {}, 'void'),
];

const start = '2026-01-01';
const end = '2026-12-31';

console.log('=== 1: the trial balance balances ===');
{
  const tb = computeTrialBalance(accounts, transactions, end);
  const rows = tb.accounts as Array<{ id: string; type: string; debit: number; credit: number; netSigned: number }>;
  report('1a debits equal credits', tb.totalDebit === tb.totalCredit && tb.totalDebit !== 0, `debit ${tb.totalDebit}, credit ${tb.totalCredit}, ${rows.length} rows, isBalanced ${tb.isBalanced}`);
  // each row's net is the account's own lines, in the account's own direction (N-13)
  let mismatched = 0;
  for (const row of rows) {
    const own = transactions.filter(t => t.status === 'completed').flatMap(t => t.lines || []).filter(l => l.accountId === row.id).reduce((s, l) => s + (l.amountCents || 0), 0);
    const debitNature = ['asset', 'expense', 'cost_of_goods'].includes(row.type);
    const expected = debitNature ? own : -own;
    if (Math.abs(row.netSigned - expected) > 1) mismatched++;
  }
  report('1b every row is its own lines', mismatched === 0, `${mismatched} row(s) disagree with their lines`);
}

console.log('');
console.log('=== 2 and 3: the balance sheet balances and agrees with the profit and loss ===');
{
  const bs = computeBalanceSheet(accounts, transactions, end);
  report(
    '2 assets = liabilities + equity + profit',
    bs.isBalanced && bs.totalAssets === bs.totalLiabilities + bs.totalEquity + bs.netIncome,
    `assets ${bs.totalAssets}, liabilities ${bs.totalLiabilities}, equity ${bs.totalEquity}, profit ${bs.netIncome}, claims ${bs.totalClaims}`,
  );
  const pl = computeProfitAndLoss(accounts, transactions, start, end);
  report('3a P&L net income = balance sheet net income', Math.abs(pl.netIncome - bs.netIncome) <= 1, `P&L ${pl.netIncome}, balance sheet ${bs.netIncome}`);
  // by hand: sales 100,000 − rent 40,000 − interest 1,500 = 58,500; no cogs
  report('3b P&L figures are the hand-worked ones', pl.income.total === 100_000 && pl.expense.total === 41_500 && pl.netIncome === 58_500, `income ${pl.income.total}, expense ${pl.expense.total}, net ${pl.netIncome}`);
  report('3c the void entry is not counted', pl.expense.accounts.rent?.balance === 40_000, `rent ${pl.expense.accounts.rent?.balance}`);
}

console.log('');
console.log('=== 4: the cash-flow statement and the cash on the balance sheet ===');
{
  const bs = computeBalanceSheet(accounts, transactions, end);
  const cf = computeCashFlow(accounts, transactions, start, end);
  // by hand: capital 1,000,000.00 in through the opening entry; +1,170.00 sale collected; −400.00 rent paid;
  // −15.00 interest = 1,007,550.00 of cash at the end, and the same as the net change (cash started at 0).
  const expectedClosing = 10_000_000 + 117_000 - 40_000 - 1_500;
  report('4a the net change is the hand-worked movement in cash', cf.netChange === expectedClosing, `net change ${cf.netChange}, expected ${expectedClosing}`);
  report('4b the net change closes the balance sheet cash', bs.assets.bank === cf.netChange, `balance-sheet bank ${bs.assets.bank}, net change ${cf.netChange} (no opening snapshot: cash started at 0)`);
  const sectionTotal = cf.operating.total + cf.investing.total + cf.financing.total;
  report('4c the sections add up to the net change', sectionTotal === cf.netChange, `sections ${sectionTotal}, net change ${cf.netChange}`);
  report('4d operating cash is only the trading movements', cf.operating.total === 117_000 - 40_000 - 1_500, `operating ${cf.operating.total} (1,170 − 400 − 15 = 755.00); financing ${cf.financing.total} is the capital paid in`);
}

console.log('');
console.log('=== 5: the general ledger adds up to the trial balance ===');
{
  const tb = computeTrialBalance(accounts, transactions, end);
  const rows = tb.accounts as Array<{ id: string; netSigned: number }>;
  const gl = computeGeneralLedger(accounts, transactions, start, end) as unknown as { accounts: Array<{ accountId: string; endingBalanceCents: number; periodDebitsCents: number; periodCreditsCents: number }> };
  let mismatched = 0;
  for (const row of rows) {
    const account = gl.accounts.find(a => a.accountId === row.id);
    if (!account || Math.abs(account.endingBalanceCents - row.netSigned) > 1) mismatched++;
  }
  report('5 the ledger balance equals the trial-balance balance for every account', mismatched === 0, `${mismatched} of ${rows.length} account(s) disagree`);
}

console.log('');
console.log(failures === 0 ? 'all statement invariants hold' : `${failures} case(s) reported DEFECT`);
process.exit(0);
