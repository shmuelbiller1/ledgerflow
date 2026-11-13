/**
 * EU-F3: the eight reports Reports offers first, chosen by the kind of business, until the person pins their own
 * (Alt+P on a report, or Bookmarks) — then theirs are shown instead. Every id is a registered report.
 */
const CORE = ['pnl', 'balance-sheet', 'cash-flow', 'ar-aging', 'ap-aging'];
const BY_BUSINESS: Record<string, string[]> = {
  retail: ['sales-trends', 'inventory-turnover', 'expense-by-category'],
  manufacturing: ['inventory-turnover', 'gross-profit-by-customer', 'budget-actual'],
  hospitality: ['sales-trends', 'expense-by-category', 'budget-actual'],
  realestate: ['by-label', 'expense-by-category', 'budget-actual'],
  nonprofit: ['income-by-source', 'budget-actual', 'expense-by-category'],
  saas: ['sales-trends', 'gross-profit-by-customer', 'customer-balance-summary'],
  service: ['gross-profit-by-customer', 'customer-balance-summary', 'expense-by-category'],
  creative: ['gross-profit-by-customer', 'customer-balance-summary', 'expense-by-category'],
};
const OTHERWISE = ['expense-by-category', 'gross-profit-by-customer', 'budget-actual'];

export function starredReports(businessType: string | undefined): string[] {
  return [...CORE, ...(BY_BUSINESS[businessType || ''] || OTHERWISE)];
}
