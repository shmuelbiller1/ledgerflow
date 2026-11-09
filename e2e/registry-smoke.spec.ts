import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * A-213: mount the busiest registry entries that previously had no browser smoke coverage.
 * Each entry must draw its screen, produce no browser/React error, and have no axe violation
 * (colour contrast has its own dedicated suite). These are smoke gates, not accounting goldens.
 */
const mainViews = [
  'general-ledger',
  'statement',
  'projects',
  'budgets',
  'consolidation',
  'taxes',
  'accept-invite',
  'architecture',
  'audit',
  'time-machine',
  'ask',
  'magic',
  'system-command-center',
] as const;

const reports = [
  ['pnl', 'PNLView'],
  ['balance-sheet', 'BalanceSheetReportView'],
  ['cash-flow', 'CashFlowView'],
  ['ar-aging', 'ARAgingReportView'],
  ['ap-aging', 'APAgingReportView'],
  ['general-ledger', 'GeneralLedgerView'],
  ['statement', 'StatementView'],
  ['tax-liability', 'TaxLiabilityView'],
  ['expense-by-category', 'ExpenseByCategoryReportView'],
  ['income-by-source', 'IncomeBySourceReportView'],
  ['top-expenses-income', 'TopExpensesIncomeReportView'],
  ['monthly-averages', 'AverageMonthlyReportView'],
  ['tag-breakdown', 'TagBreakdownReportView'],
  ['customer-balance-summary', 'CustomerBalanceSummaryView'],
  ['vendor-balance-summary', 'VendorBalanceSummaryView'],
  ['transactions-by-customer', 'TransactionsByCustomerView'],
  ['transactions-by-vendor', 'TransactionsByVendorView'],
  ['mileage-rates', 'MileageRatesReportView'],
  ['banking-validation', 'BankingValidationReportView'],
] as const;

const lenses = [
  ['forensics_1', 'ToolSandbox'],
] as const;

async function openGuest(page: Page, url: string) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => {
    localStorage.setItem('isGuest', 'true');
    localStorage.setItem('has_seen_onboarding', 'true');
  });
  await page.goto(url);
  const main = page.locator('#main-content');
  await main.waitFor({ timeout: 15_000 });
  await expect(page.locator('h1:visible')).toHaveCount(1, { timeout: 15_000 });
  await expect.poll(() => main.evaluate(element => element.innerText.trim().length)).toBeGreaterThan(20);
  // Let lazy data/report effects settle so a later render error cannot escape the assertion.
  await page.waitForTimeout(600);
}

function watchCodeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    // Browser-generated resource logs include expected guest/API 401s in the backend-less harness.
    // Keep every application console.error (React keys, hooks, render warnings, etc.) as a failure.
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) {
      errors.push(message.text());
    }
  });
  return errors;
}

async function expectHealthyScreen(page: Page) {
  const main = page.locator('#main-content');
  const text = await main.innerText();
  expect(text).not.toContain('Something went wrong');
  expect(text).not.toContain('Uncaught Error');
  const axe = await new AxeBuilder({ page }).include('#main-content').disableRules(['color-contrast']).analyze();
  expect(axe.violations.map(violation => `${violation.id}: ${violation.nodes.map(node => node.target.join(' ')).join(', ')}`)).toEqual([]);
}

for (const id of mainViews) {
  test(`A-213 main registry smoke: ${id}`, async ({ page }) => {
    const errors = watchCodeErrors(page);
    await openGuest(page, `/#${id}`);
    await expectHealthyScreen(page);
    expect(errors).toEqual([]);
  });
}

for (const [id, componentName] of reports) {
  test(`A-213 report registry smoke: ${componentName}`, async ({ page }) => {
    const errors = watchCodeErrors(page);
    await openGuest(page, `/?report=${id}#reports`);
    await expectHealthyScreen(page);
    expect(errors).toEqual([]);
  });
}

for (const [id, componentName] of lenses) {
  test(`A-221 lens registry smoke: ${componentName}`, async ({ page }) => {
    const errors = watchCodeErrors(page);
    await openGuest(page, `/?lens=${id}#intelligence`);
    await expectHealthyScreen(page);
    expect(errors).toEqual([]);
  });
}
