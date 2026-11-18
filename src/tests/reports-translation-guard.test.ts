/** EU-G1: the eight reports Reports offers first speak Hebrew: no visible English outside reportText, and every key has Hebrew. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { checkTranslatedScreen } from './helpers/translationGuard';
import { translateScreenString } from '../lib/i18n/screenTranslations';
import { starredReports } from '../lib/starredReports';
import { fill } from '../components/reporting/useReportText';

// the shared visible props, plus the report-layout props that are shown as text (Gitar on #852)
const REPORT_PROPS = new Set(['aria-label', 'title', 'description', 'label', 'placeholder', 'alt', 'what', 'actionLabel', 'totalLabel', 'secondaryTotalLabel', 'searchPlaceholder', 'emptyMessage', 'caption', 'header', 'totalDisplay']);

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
  // EU-G1 part 2: the reports other kinds of business see starred (starredReports.ts), plus the trial balance and general ledger
  '../components/reporting/InventoryTurnoverReportView.tsx',
  '../components/reporting/LabelProfitReportView.tsx',
  '../components/reporting/IncomeBySourceReportView.tsx',
  '../components/reporting/CustomerBalanceSummaryView.tsx',
  '../components/reporting/DocumentTrendsView.tsx',
  '../components/ledger/GeneralLedgerView.tsx',
  '../components/ledger/TrialBalanceView.tsx',
  // EU-G1 part 3: the everyday reports after the starred ones
  ...['VendorBalanceSummaryView', 'ContactBalanceSummaryView', 'SalesByItemReportView',
    'InventoryValuationReportView', 'StatementView', 'TaxLiabilityView', 'TopExpensesIncomeReportView', 'AverageMonthlyReportView',
    'EverydayReportViews', 'FinancialRatiosReportView'].map(name => `../components/reporting/${name}.tsx`),
  // EU-G1 part 4: the Israeli reports a Hebrew reader opens first
  ...['IsraelVatReportView', 'IsraelAdvanceTaxReportView', 'IsraelMonthJourneyReportView', 'IlSelfEmploymentNiReportView',
    'IsraeliDocumentTypesView', 'IsraeliBankCodesReportView', 'IsraeliAnnualPartySummaryView'].map(name => `../components/reporting/${name}.tsx`),
  // EU-G1 part 5: everyday checks and planning reports
  ...['TopPartiesReportView', 'OpenAdvancesView', 'AccountantExportPackView', 'DataQualityReportView', 'CashForecast13WeekView',
    'GoodsNotBilledReportView', 'SubscriptionPlansReportView', 'CustomerCohortsReportView', 'VendorScorecardReportView',
    'ReorderSuggestionsReportView', 'DuplicateBillsReviewView', 'ThreeWayMatchReviewView'].map(name => `../components/reporting/${name}.tsx`),
  // EU-G1 part 6: inventory, purchasing and quote reports
  ...['CycleCountReportView', 'BlanketOrdersReportView', 'CustomerQuotesReportView', 'SerialLotLookupReportView', 'RetentionReviewReportView',
    'EntityFilingsCalendarView', 'StockValueByLocationLotReportView', 'VendorQuotesCompareView', 'VendorPriceHistoryReportView',
    'QuoteVersionsReportView', 'DeliveryNotesReportView', 'ShippingMethodsView'].map(name => `../components/reporting/${name}.tsx`),
  // EU-G1 part 7: US and cross-border tax reports
  ...['GsaPerDiemReportView', 'UsFilingCalendarReportView', 'Vendor1099ReadinessReportView', 'Us1099PreviewReportView',
    'SalesTaxHolidaysReportView', 'RegistrationThresholdWatchReportView', 'UseTaxReportView', 'ImportServicesReportView',
    'TaxCodeSuggestionsReportView', 'RulePackCoverageReportView', 'GoldenTaxFixturesReportView', 'CustomerTaxCertificatesView'].map(name => `../components/reporting/${name}.tsx`),
  // EU-G1 part 8: operations, group and planning reports
  ...['GroupSummaryReportView', 'PickPackShipPanel', 'ReturnAuthorizationsPanel', 'WarrantyRegisterPanel', 'AskBooksView',
    'BillRetentionReportView', 'MilestoneBillingReportView', 'LandedCostPreviewReportView', 'WorkOrdersView', 'ExpiringLotsReportView',
    'DunningLettersReportView', 'PurchasePriceVarianceReportView', 'ProfitabilityByView', 'ExpenseBillCategories',
    'SampleYearBenchmarkReportView', 'LandedCostPostPanel'].map(name => `../components/reporting/${name}.tsx`),
  // EU-G1 part 9: twenty smaller reports
  ...['Form856ReportView', 'BankingValidationReportView', 'ItemRegisterReportView', 'DocumentNumberGapsReportView', 'CustomerItemCodesView',
    'VendorWithholdingView', 'StandardCostReportView', 'PurchaseItemTrendsView', 'LabelBalanceSheetReportView', 'KitAssemblyReportView',
    'GoldenYearFixturesSection', 'ExpensePolicyReportView', 'DuplicateContactReviewReportView', 'BackordersReportView', 'AssetRegisterReportView',
    'AgedInventoryByLotReportView', 'UsNexusWatchReportView', 'ExpenseReceiptChecklistReportView', 'BankHolidaysReportView',
    'WarehouseBinLocationsPanel'].map(name => `../components/reporting/${name}.tsx`),
];

test('Reports: the default eight are the ones this guard covers', () => {
  assert.deepEqual(starredReports(undefined), ['pnl', 'balance-sheet', 'cash-flow', 'ar-aging', 'ap-aging', 'expense-by-category', 'gross-profit-by-customer', 'budget-actual']);
});

for (const rel of FILES) {
  test(`Reports ${rel.split('/').pop()}: no visible English outside reportText, and every key has Hebrew`, () => {
    const r = checkTranslatedScreen(fileURLToPath(new URL(rel, import.meta.url)), 'reports', 'reportText', REPORT_PROPS, true, true);
    assert.deepEqual(r.untranslated, [], 'Wrap new visible report text with reportText and add its EN/HE entry.');
    assert.deepEqual(r.badKeys, []);
    assert.ok(r.calls > 0);
  });
}

test('Reports: templates keep their values and read in Hebrew', () => {
  assert.equal(fill(translateScreenString('reports', 'r.open-name', 'he', ''), { name: 'Ca$$h & Co' }), 'פתיחת Ca$$h & Co');
  assert.equal(fill(translateScreenString('reports', 'r.n-days-overdue', 'en', '{n} days overdue'), { n: 12 }), '12 days overdue');
  assert.equal(translateScreenString('reports', 'r.total-outstanding', 'he', ''), 'סך הכול פתוח');
  assert.equal(translateScreenString('reports', 'r.bucket.d90plus', 'he', ''), 'מעל 90 ימים');
  assert.equal(fill(translateScreenString('reports', 'r.label-rollup-row', 'he', ''), { name: 'A', own: '1', children: '2', total: '3' }), 'A: עצמי 1, תת-ערכים 2, סך הכול 3');
});
