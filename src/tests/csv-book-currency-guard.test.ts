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
  'DiscountMismatchView.tsx',
];

/**
 * The one screen that is not book-currency: each row keeps its own document currency, printed in a
 * `Currency` column beside the amount (#940). It uses the same writer, chosen per row, so this test
 * also pins that its currency column has not been dropped — the reason the per-row choice is right.
 */
const PER_ROW_CURRENCY = ['GoodsNotBilledReportView.tsx'];

test('every book-currency report writes CSV money with the book currency (#910)', () => {
  for (const file of BOOK_CURRENCY_FILES) {
    const source = read(file);
    assert.match(source, /csvMoneyForBook\(/, `${file} uses the book-currency writer`);
    assert.doesNotMatch(source, /\bcsvMoney\(/, `${file} must not fall back to the two-decimal writer`);
  }
});

test('no report screen imports the two-decimal writer; the per-row screen chooses by row', () => {
  // The two-decimal writer is the one imported under the bare name; a screen that makes its own
  // `const csvMoney = csvMoneyForCurrency(…)` (Inventory Valuation) is already currency-aware.
  const importsFixedWriter = (source: string) => /import \{[^}]*\bcsvMoney\b[^}]*\} from '[^']*csvExport'/.test(source);
  const offenders = readdirSync(reportedDir)
    .filter((file) => file.endsWith('.tsx'))
    .filter((file) => importsFixedWriter(read(file)) && /\bcsvMoney\(/.test(read(file)))
    .filter((file) => !PER_ROW_CURRENCY.includes(file));
  assert.deepEqual(offenders, [], 'a new screen using csvMoney() is either the #910 defect or needs its reason here');
});

test('the per-row-currency screen still names each row\'s currency and picks its writer per row', () => {
  const source = read('GoodsNotBilledReportView.tsx');
  assert.match(source, /r\.currency \|\| home/, 'the currency column is still exported');
  assert.match(source, /moneyForRow\(r\.currency\)/, 'the writer is chosen from the row');
});

test('the current-price review compares only book-currency lines, so it uses the book writer', () => {
  // If `discountMismatch` ever keeps a foreign-currency line, this screen needs a per-row writer too.
  assert.match(readFileSync(join(process.cwd(), 'src/lib/discountMismatch.ts'), 'utf8'), /currency !== input\.currency/);
});
