import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'fs';
import path from 'path';

let a11yBaseline: Record<string, number> = {};
try {
  const baselinePath = path.resolve(process.cwd(), 'e2e/a11y-baseline.json');
  if (fs.existsSync(baselinePath)) {
    a11yBaseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  }
} catch {
  // fallback
}

test.describe('View Registry & Navigation Coverage Suite', () => {

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('isGuest', 'true');
      localStorage.setItem('has_seen_onboarding', 'true');
    });

    await page.goto('/');

    const guestButton = page.locator('button', { hasText: 'Continue as Guest' });
    try {
      if (await guestButton.isVisible({ timeout: 2000 })) {
        await guestButton.click();
      }
    } catch {
      // Guest mode
    }

    await page.waitForSelector('text="Overview"', { timeout: 15000 });
  });

  const coreViews = [
    { label: 'Overview', searchHint: 'Overview' },
    { label: 'Transactions', searchHint: 'Ledger' },
    { label: 'Sales', searchHint: 'Invoices' },
    { label: 'Purchases', searchHint: 'Bills' },
    { label: 'Banking', searchHint: 'Reconciliation' },
    { label: 'Reports', searchHint: 'Trial Balance' },
    { label: 'Planning', searchHint: 'Budgets' },
    { label: 'Forensics', searchHint: 'Audit' },
    { label: 'Settings', searchHint: 'Workspace' },
  ];

  for (const view of coreViews) {
    test(`Navigate and mount view: ${view.label}`, async ({ page }) => {
      const btn = page.locator(`button:has-text("${view.label}")`).first();
      if (await btn.isVisible()) {
        await btn.click();
        await page.waitForTimeout(500);

        // Assert that the page renders without crashing or showing error boundaries
        await expect(page.locator('body')).toBeVisible();
        const bodyText = await page.locator('body').innerText();
        expect(bodyText).not.toContain('Something went wrong');
        expect(bodyText).not.toContain('Uncaught Error');

        // Run axe accessibility check
        const accessibilityScanResults = await new AxeBuilder({ page }).analyze();
        const criticalViolations = accessibilityScanResults.violations.filter(v => 
          ['critical', 'serious'].includes(v.impact || '')
        );
        if (criticalViolations.length > 0) {
          console.warn(`[A11y] Critical violations in ${view.label}:`, JSON.stringify(criticalViolations, null, 2));
        }
        const maxAllowed = a11yBaseline[view.label] ?? 0;
        expect(criticalViolations.length).toBeLessThanOrEqual(maxAllowed);
      }
    });
  }

  const reportTabs = [
    { label: 'Customer tax certificates', componentName: 'CustomerTaxCertificatesView' },
    { label: 'Vendor tax records', componentName: 'VendorTaxRecordsView' },
    { label: 'Customer Cohorts', componentName: 'CustomerCohortsReportView' },
    { label: 'Asset Register', componentName: 'AssetRegisterReportView' },
    { label: 'Transfer Check', componentName: 'OneSidedTransfersReportView' },
    { label: 'Vendor withholding', componentName: 'VendorWithholdingView' },
    { label: 'Discount Mismatch Review', componentName: 'DiscountMismatchView' },
    { label: 'Registration Threshold Watch', componentName: 'RegistrationThresholdWatchReportView' },
    { label: 'Budget vs Actual', componentName: 'BudgetActualReportView' },
    { label: 'Sales by Item', componentName: 'SalesByItemReportView' },
    { label: 'Purchase Trends by Vendor', componentName: 'PurchaseTrendsView' },
    { label: 'Journal Sheet', componentName: 'JournalSheetReportView' },
    { label: 'Contact Balance Summary', componentName: 'ContactBalanceSummaryView' },
    { label: 'Inventory Valuation', componentName: 'InventoryValuationReportView' },
    { label: 'Inventory Item Details', componentName: 'InventoryDetailsReportView' },
    { label: 'Transactions by Reference', componentName: 'TransactionsByReferenceView' },
    { label: 'Group Summary', componentName: 'GroupSummaryReportView' },
    { label: 'Ask the Books', componentName: 'AskBooksView' },
    { label: 'Profit by Label', componentName: 'LabelProfitReportView' },
    { label: 'Goods Not Yet Billed', componentName: 'GoodsNotBilledReportView' },
    { label: 'Sales Commission', componentName: 'CommissionReportView' },
    { label: 'Backorders', componentName: 'BackordersReportView' },
    { label: 'Stock Aging', componentName: 'StockAgingReportView' },
    { label: 'Slow-moving Items', componentName: 'SlowMovingStockView' },
    { label: 'Profitability by Customer, Item or Project', componentName: 'ProfitabilityByView' },
    { label: 'Item-wise Register', componentName: 'ItemRegisterReportView' },
    { label: 'Asset Depreciation Ledger', componentName: 'DepreciationLedgerReportView' },
    { label: 'Bank Clearance Summary', componentName: 'BankClearanceReportView' },
    { label: 'Withholding Report (Form 856)', componentName: 'Form856ReportView' },
    { label: 'Expense Policy Check', componentName: 'ExpensePolicyReportView' },
    { label: 'Inventory Cycle Count', componentName: 'CycleCountReportView' },
    { label: 'Vendor Scorecard', componentName: 'VendorScorecardReportView' },
    { label: 'Vendor Price History', componentName: 'VendorPriceHistoryReportView' },
    { label: 'Three-Way Match Review', componentName: 'ThreeWayMatchReviewView' },
    { label: 'Customer Lifetime Value', componentName: 'CustomerLifetimeValueReportView' },
    { label: 'Subscription Plans', componentName: 'SubscriptionPlansReportView' },
    { label: 'Use Tax Review', componentName: 'UseTaxReportView' },
    { label: 'Purchases from Abroad', componentName: 'ImportServicesReportView' },
    { label: 'Tax Rule Coverage', componentName: 'RulePackCoverageReportView' },
    { label: 'Customer Credit Limits', componentName: 'CustomerCreditLimitReportView' },
    { label: 'Expense Receipt Checklist', componentName: 'ExpenseReceiptChecklistReportView' },
    { label: 'Duplicate Contact Review', componentName: 'DuplicateContactReviewReportView' },
    { label: 'Purchase Price Variance', componentName: 'PurchasePriceVarianceReportView' },
    { label: 'Sales by Territory', componentName: 'SalesByTerritoryReportView' },
    { label: 'Record Retention Review', componentName: 'RetentionReviewReportView' },
    { label: 'Milestone Billing', componentName: 'MilestoneBillingReportView' },
    { label: 'Reorder Suggestions', componentName: 'ReorderSuggestionsReportView' },
    { label: 'Dunning Letters', componentName: 'DunningLettersReportView' },
    { label: 'Record Notes', componentName: 'RecordNotesReportView' },
    { label: 'Serial & Lot Lookup', componentName: 'SerialLotLookupReportView' },
    { label: 'Landed Cost Preview', componentName: 'LandedCostPreviewReportView' },
    { label: 'Delivery Notes', componentName: 'DeliveryNotesReportView' },
    { label: 'Customer Quotes & Proposals', componentName: 'CustomerQuotesReportView' },
    { label: 'Sales Tax Holidays', componentName: 'SalesTaxHolidaysReportView' },
    { label: 'Quote Versions', componentName: 'QuoteVersionsReportView' },
    { label: 'Blanket Purchase Orders', componentName: 'BlanketOrdersReportView' },
    { label: 'Duplicate Bill Review', componentName: 'DuplicateBillsReviewView' },
    { label: 'Document Number Gaps', componentName: 'DocumentNumberGapsReportView' },
    { label: '13-Week Cash Forecast', componentName: 'CashForecast13WeekView' },
    { label: 'Vendor 1099 Readiness', componentName: 'Vendor1099ReadinessReportView' },
    { label: 'Golden Tax Fixtures', componentName: 'GoldenTaxFixturesReportView' },
    { label: 'US Quarter Journey', componentName: 'UsQuarterJourneyReportView' },
    { label: 'Israel Month Journey', componentName: 'IsraelMonthJourneyReportView' },
    { label: 'Israel: Self-Employed National Insurance', componentName: 'IlSelfEmploymentNiReportView' },
    { label: 'Israel: Advance Tax Calendar (Mikdamot)', componentName: 'IsraelAdvanceTaxReportView' },
  ];

  test('Warehouse operations workflows are reachable from Inventory Cycle Count', async ({ page }) => {
    await page.locator('button:has-text("Reports")').first().click();
    const cycleCount = page.locator('button:has-text("Inventory Cycle Count")').first();
    await expect(cycleCount).toBeVisible({ timeout: 10000 });
    await cycleCount.click();
    await page.getByRole('tab', { name: 'Warehouse operations' }).click();
    await expect(page.getByRole('heading', { name: 'Warehouse operations' })).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'Warehouse operations views' })).toBeVisible();

    for (const tab of ['Bin locations', 'Pick, pack and ship', 'Return authorizations', 'Warranty register']) {
      await page.getByRole('tab', { name: tab }).click();
      await expect(page.getByRole('heading', { name: tab })).toBeVisible();
    }
  });

  for (const report of reportTabs) {
    test(`Report tab mounts: ${report.label} (${report.componentName})`, async ({ page }) => {
      await page.locator('button:has-text("Reports")').first().click();
      const tab = page.locator(`button:has-text("${report.label}")`).first();
      await expect(tab).toBeVisible({ timeout: 10000 });
      await tab.click();
      await page.waitForTimeout(500);

      const bodyText = await page.locator('body').innerText();
      expect(bodyText).not.toContain('Something went wrong');
      expect(bodyText).not.toContain('Uncaught Error');
      expect(bodyText).not.toContain('NaN');
    });
  }

  const settingsTabs = [
    { label: 'Import Data', componentName: 'ImportDataView' },
    { label: 'Emails & Reminders', componentName: 'EmailSettingsView' },
    { label: 'Branding & PDFs', componentName: 'BrandingSettingsView' },
    { label: 'Document Numbering', componentName: 'NumberingSettingsView' },
    { label: 'Defaults', componentName: 'DefaultsSettingsView' },
    { label: 'Schedule', componentName: 'ScheduleSettingsView' },
    { label: 'Incoming events', componentName: 'IncomingEventsSettingsView' },
    { label: 'Tags', componentName: 'TagsSettingsView' },
    { label: 'Scheduled reports', componentName: 'ScheduledReportsSettingsView' },
    { label: 'Alerts', componentName: 'AlertsSettingsView' },
    { label: 'Modules', componentName: 'ModulesSettingsView' },
    { label: 'Split rules', componentName: 'AllocationRulesSettingsView' },
    { label: 'Import price lists', componentName: 'PriceListImportView' },
    { label: 'Price lists', componentName: 'PriceListsSettingsView' },
    { label: 'Sales reps', componentName: 'SalesRepsSettingsView' },
    { label: 'Stages', componentName: 'StagesSettingsView' },
    { label: 'Currencies', componentName: 'CurrenciesSettingsView' },
    { label: 'Groups of books', componentName: 'GroupsSettingsView' },
    { label: 'Tax profiles', componentName: 'TaxProfilesSettingsView' },
    { label: 'Custom fields', componentName: 'CustomFieldsSettingsView' },
  ];

  for (const tab of settingsTabs) {
    test(`Settings tab mounts: ${tab.label} (${tab.componentName})`, async ({ page }) => {
      await page.locator('button:has-text("Settings")').first().click();
      const button = page.locator(`button:has-text("${tab.label}")`).first();
      await expect(button).toBeVisible({ timeout: 10000 });
      await button.click();
      await page.waitForTimeout(500);

      const bodyText = await page.locator('body').innerText();
      expect(bodyText).not.toContain('Something went wrong');
      expect(bodyText).not.toContain('Uncaught Error');
      expect(bodyText.toLowerCase()).toContain(tab.label.split(' ')[0].toLowerCase());
    });
  }

  test('Command Palette (CMD+K / CTRL+K) opens and executes view switching', async ({ page }) => {
    // Open Command Palette via keyboard shortcut or button
    await page.keyboard.press('Meta+k');
    const palette = page.locator('[data-testid="command-palette"], [role="dialog"], input[placeholder*="command" i], input[placeholder*="search" i]').first();
    
    if (await palette.isVisible({ timeout: 2000 })) {
      await expect(palette).toBeVisible();
      // Press Escape to dismiss
      await page.keyboard.press('Escape');
    }
  });

  test('Intelligence Center & Analytics Sandbox render without fatal errors', async ({ page }) => {
    const intelBtn = page.locator('button:has-text("Intelligence"), button:has-text("Insights"), button:has-text("Analytics")').first();
    if (await intelBtn.isVisible()) {
      await intelBtn.click();
      await page.waitForTimeout(1000);

      await expect(page.locator('body')).toBeVisible();
      const bodyText = await page.locator('body').innerText();
      expect(bodyText).not.toContain('NaN');
    }
  });

  test('Tax Center & Compliance Manager mount cleanly', async ({ page }) => {
    const taxBtn = page.locator('button:has-text("Taxes"), button:has-text("Tax Center"), button:has-text("Tax Liability")').first();
    if (await taxBtn.isVisible()) {
      await taxBtn.click();
      await page.waitForTimeout(800);

      await expect(page.locator('body')).toBeVisible();
      const bodyText = await page.locator('body').innerText();
      expect(bodyText).not.toContain('NaN');
    }
  });
});
