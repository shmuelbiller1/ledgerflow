/**
 * #910 family guard: a report whose figures are already in the book's currency must write its CSV
 * money cells with the book's own decimals (JPY 0, KWD 3, USD 2), not the fixed two-decimal writer.
 *
 * This is a scan, not a calculation test: `account-report-csv-book-currency.test.tsx` proves the
 * behaviour on the real screens. What this adds is that a *new* screen in this family cannot quietly
 * reintroduce `csvMoney(` — and that the two deliberate exceptions stay deliberate, because their
 * rows carry each document's own currency in a column beside the amount.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const reportedDir = join(process.cwd(), 'src/components/reporting');
const read = (file: string) => readFileSync(join(reportedDir, file), 'utf8');

/** Files whose money cells are in the book's currency and now use `csvMoneyForBook`. */
const BOOK_CURRENCY_FILES = [
  'TopExpensesIncomeReportView.tsx',
  'IncomeBySourceReportView.tsx',
  'ExpenseByCategoryReportView.tsx',
  'AverageMonthlyReportView.tsx',
  'TagBreakdownReportView.tsx',
  'AssetRegisterReportView.tsx',
  'BankClearanceReportView.tsx',
  'TransactionsByReferenceView.tsx',
  'PartyPeriodSummaryView.tsx',
  'CustomerCohortsReportView.tsx',
  'SlowMovingStockView.tsx',
  'CustomerBalanceSummaryView.tsx',
  'VendorBalanceSummaryView.tsx',
  'ContactBalanceSummaryView.tsx',
  'ProfitabilityByView.tsx',
  'StockSourcesUsesReportView.tsx',
  'partyTransactionsShared.tsx',
];

/**
 * Deliberate exceptions: the row prints its own `Currency` column, so a single book-currency writer
 * would be wrong for it. Their own defect (a foreign-currency row still uses two decimals) is filed
 * separately and must be fixed with a per-row writer, not with this one.
 */
const PER_ROW_CURRENCY = ['DiscountMismatchView.tsx', 'GoodsNotBilledReportView.tsx'];

test('every book-currency report writes CSV money with the book currency (#910)', () => {
  for (const file of BOOK_CURRENCY_FILES) {
    const source = read(file);
    assert.match(source, /csvMoneyForBook\(/, `${file} uses the book-currency writer`);
    assert.doesNotMatch(source, /\bcsvMoney\(/, `${file} must not fall back to the two-decimal writer`);
  }
});

test('only the documented per-row-currency screens still use the two-decimal writer', () => {
  // The two-decimal writer is the one imported under the bare name; a screen that makes its own
  // `const csvMoney = csvMoneyForCurrency(…)` (Inventory Valuation) is already currency-aware.
  const importsFixedWriter = (source: string) => /import \{[^}]*\bcsvMoney\b[^}]*\} from '[^']*csvExport'/.test(source);
  const offenders = readdirSync(reportedDir)
    .filter((file) => file.endsWith('.tsx'))
    .filter((file) => importsFixedWriter(read(file)) && /\bcsvMoney\(/.test(read(file)))
    .filter((file) => !PER_ROW_CURRENCY.includes(file));
  assert.deepEqual(offenders, [], 'a new screen using csvMoney() is either the #910 defect or needs its reason here');
});

test('the deliberate exceptions still say which currency each row is in', () => {
  // If one of these stops exporting a currency column, the reason above no longer holds.
  assert.match(read('DiscountMismatchView.tsx'), /'Currency'/);
  assert.match(read('GoodsNotBilledReportView.tsx'), /r\.currency \|\| home/);
});
