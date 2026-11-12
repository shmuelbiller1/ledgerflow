import { discoverPluginModules, extractPluginRouteIds } from './pluginDiscovery';

/**
 * Canonical route, report, and settings tab IDs synchronized with `src/config/registry.tsx`
 * and augmented with discovered plugin route IDs from `src/config/pluginDiscovery.ts`.
 * Kept in a compact leaf module so initial preference hydration (`useUIStore` /
 * `reportPreferences`) validates saved routes without bundling the full lazy component
 * registry or bilingual screen-help prose into `assets/app-[hash].js`.
 * 1-to-1 parity with `registry.tsx` is enforced by `src/tests/stage6-footprint-optimization.test.ts`.
 */
const STATIC_SCREEN_TAB_IDS: readonly string[] =
  "dashboard inbox practice copilot transactions credit-notes assets register ledger intercompany recurring query-builder banking audit-trail client-queries tasks reconciliation month-end-close fiscal-periods sales estimates payments time purchases purchase-orders inventory loans petty-cash payroll reports charts forecaster budgets projects intelligence settings data-health support help glossary vault pricing api-hub system-command-center architecture audit time-machine ask magic taxes consolidation accept-invite general-ledger statement tax-liability accountant-queue".split(' ');

/**
 * Combines static core screen route IDs with dynamically discovered plugin route IDs
 * so pinned plugin pages survive `useReportPreferencesSync` normalization and reload.
 */
export function buildScreenTabIds(
  pluginModulePaths: Iterable<string> = Object.keys(discoverPluginModules()),
): readonly string[] {
  const pluginIds = extractPluginRouteIds(pluginModulePaths);
  return pluginIds.length === 0
    ? STATIC_SCREEN_TAB_IDS
    : [...new Set([...STATIC_SCREEN_TAB_IDS, ...pluginIds])];
}

export const SCREEN_TAB_IDS: readonly string[] = buildScreenTabIds();

export const REPORT_TAB_IDS: readonly string[] =
  "customer-cohorts asset-register one-sided-transfers budget-actual pnl balance-sheet group-summary ask-books cash-flow party-linked-trial-balance import-acceptance sales-trends purchase-trends sales-payment-summary deferred-revenue-waterfall exchange-rates-used open-advances financial-ratios vendor-withholding customer-tax-certificates vendor-tax-records discount-mismatch registration-threshold-watch use-tax-review purchases-from-abroad expense-policy-check cycle-count vendor-scorecard vendor-price-history three-way-match customer-lifetime-value subscription-plans compare gross-profit-by-customer inactive-items account-balances-as-of payment-period-by-invoice-date customer-period-summary supplier-period-summary customer-balance-summary vendor-balance-summary contact-balance-summary transactions-by-customer transactions-by-vendor transactions-by-reference sales-by-item inventory-valuation goods-not-billed bank-clearance depreciation-ledger item-register stock-aging slow-moving-stock profitability-by commissions backorders form-856 inventory-details stock-sources-uses expiring-lots stock-transfers kit-assembly standard-cost-variance stock-value-by-location-lot journal-sheet expense-by-category income-by-source top-expenses-income monthly-averages by-label label-value balance-sheet-by-label tag-breakdown ar-aging ap-aging general-ledger statement tax-liability accountant-export-pack rule-pack-coverage customer-credit-limits aged-receivables-by-rep gross-margin-by-item-group top-customers-vendors inventory-turnover expense-by-employee time-by-project bank-holidays israeli-bank-codes gsa-per-diem milestone-billing reorder-suggestions dunning-letters expense-receipt-checklist duplicate-contact-review purchase-price-variance sales-by-territory record-retention-review duplicate-bill-review document-number-gaps cash-forecast-13-week vendor-1099-readiness golden-tax-fixtures us-quarter-journey il-month-journey record-notes serial-lot-lookup landed-cost-preview delivery-notes customer-quotes sales-tax-holidays quote-versions blanket-orders mileage-rates israel-self-employment-ni israel-advance-tax israel-vat-report banking-validation us-nexus-watch tax-code-suggestions entity-filings israeli-document-types us-1099-preview us-filing-calendar data-quality-checks sample-year-benchmark vendor-quotes-compare customer-item-codes shipping-methods bill-retention aged-inventory-by-lot work-orders il-annual-party-summary accountant-queue".split(' ');

export const SETTINGS_TAB_IDS: readonly string[] =
  "rules dimensions tax-profiles appearance team billing templates security rule developer import emails branding branding-profiles numbering defaults schedule incoming-events tags scheduled-reports alerts modules groups split-rules price-lists price-list-import custom-fields sales-reps stages currencies export shortcuts".split(' ');
