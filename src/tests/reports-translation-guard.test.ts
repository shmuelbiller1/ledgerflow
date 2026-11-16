/** EU-G1: the eight reports Reports offers first speak Hebrew: no visible English outside reportText, and every key has Hebrew. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { checkTranslatedScreen } from './helpers/translationGuard';
import { translateScreenString } from '../lib/i18n/screenTranslations';
import { starredReports } from '../lib/starredReports';
import { fill } from '../components/reporting/useReportText';

// the default top eight (pnl, balance-sheet, cash-flow, ar-aging, ap-aging, expense-by-category,
// gross-profit-by-customer, budget-actual) and the files that draw them; A/R and A/P share one view
const FILES = [
  '../components/ledger/ProfitAndLossView.tsx',
  '../components/ledger/BalanceSheetView.tsx',
  '../components/ledger/CashFlowView.tsx',
  '../components/reporting/PartyAgingReportView.tsx',
  '../components/reporting/ExpenseByCategoryReportView.tsx',
  '../components/reporting/CustomerGrossProfitView.tsx',
  '../components/reporting/BudgetActualReportView.tsx',
];

test('Reports: the default eight are the ones this guard covers', () => {
  assert.deepEqual(starredReports(undefined), ['pnl', 'balance-sheet', 'cash-flow', 'ar-aging', 'ap-aging', 'expense-by-category', 'gross-profit-by-customer', 'budget-actual']);
});

for (const rel of FILES) {
  test(`Reports ${rel.split('/').pop()}: no visible English outside reportText, and every key has Hebrew`, () => {
    const r = checkTranslatedScreen(fileURLToPath(new URL(rel, import.meta.url)), 'reports', 'reportText');
    assert.deepEqual(r.untranslated, [], 'Wrap new visible report text with reportText and add its EN/HE entry.');
    assert.deepEqual(r.badKeys, []);
    assert.ok(r.calls > 0);
  });
}

test('Reports: templates keep their values and read in Hebrew', () => {
  assert.equal(fill(translateScreenString('reports', 'r.open-name', 'he', ''), { name: 'Ca$$h & Co' }), 'פתיחת Ca$$h & Co');
  assert.equal(fill(translateScreenString('reports', 'r.n-days-overdue', 'en', '{n} days overdue'), { n: 12 }), '12 days overdue');
  assert.equal(translateScreenString('reports', 'r.total-outstanding', 'he', ''), 'סך הכול פתוח');
});
