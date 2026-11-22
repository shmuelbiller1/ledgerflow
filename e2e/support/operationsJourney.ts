import { expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { downloadAt, item, customer, vendor } from './comparisonReportFixture';
import { settleStyles } from './journeyFixture';
import { openOperationsScreen } from './operationsFixture';
import type { OperationsScreen } from './operationsScreens';
import { tabTo } from './tabTo';

// These figures belong together on ONE record. A nearby summary or an unrelated table doesn't count.
const worked: Record<OperationsScreen, string[]> = {
  TimeView: ['Fit valve', '1:30'],
  PriceListImportView: ['Missing', '3'],
  PurchaseOrdersView: ['PO-12', vendor, '$45.00'],
  GeneralLedgerView: ['Invoice INV-17', '$100.00'],
  LoansView: ['2026-02-28', '$408.03', '$12.00', '$396.03', '$803.97'],
  PettyCashView: ['Valve purchase', 'PC-3', '-$7.50'],
  OpeningDocumentsDialog: ['OPEN-3', customer, '$12.50'],
  DirectDepositDialog: ['Noa נועה', '$4,350.00'],
  PayRunHistory: ['$5,050.00', '1 team'],
  PayrollImportDialog: ['Parts expense', '$4,000.00'],
  PayrollView: ['Noa נועה', '$60,000.00', '$4,350.00'],
  StockCountDialog: [item, '5'],
  StockHistoryDialog: ['+3', '$22.50'],
  MigrationTrialBalanceProof: ['Debits', '$12.50', '$0.00'],
  BlanketOrdersReportView: ['PO-12', '$60.00', '$30.00'],
  CashForecast13WeekView: ['2026-03-06', '$98.00', '$52.50', '$45.50'],
  CustomerQuotesReportView: ['SO-5', customer, '$200.00'],
  DataQualityReportView: ['Valve purchase', 'Parts expense', '$7.50'],
  DeliveryNotesReportView: [item, '8'],
  DunningLettersReportView: ['INV-17', '16', '$98.00'],
  ExpenseBillCategories: ['Parts expense', 'cost', '1'],
  ExpenseByEmployeeReportView: [vendor, '1', '$7.50'],
  GoldenYearFixturesSection: ['2026-01', '15,000.00', '2,700.00'],
  IsraelAdvanceTaxReportView: ['2026-01-01', '2026-03-15'],
  IsraelVatReportView: ['עסקאות חייבות במס', '$100.00'],
  IsraeliDocumentTypesView: ['tax-invoice', 'חשבונית מס'],
  OpenAdvancesView: ['PAY-3', '$25.00', '$13.00', '$12.00'],
  PickPackShipPanel: ['V-7', item, '8'],
  QuoteVersionsReportView: ['Avi אבי', '$150.00', '2026-03-31'],
  RecordNotesReportView: ['Check delivery window', 'Avi אבי', customer],
  ReturnAuthorizationsPanel: [item, 'V-7', '4'],
  SerialLotLookupReportView: ['SN-17', 'GR-12'],
  ShippingMethodsView: ['Local ground', 'UPS', '$14.95'],
  SpreadWaterfallView: ['INV-17', '$15.00', '$0.00'],
  TaxLiabilityView: ['1', '$18.00'],
  WarehouseBinLocationsPanel: ['K-2', 'Pump kit ערכה'],
  WarrantyRegisterPanel: [customer, 'INV-17', 'SN-17'],
  AccountantExportPackView: ['1100', 'Receivables', '100.00'],
  ReportPackDialog: ['Sales', '-$12.50'],
  OrderInvoiceDialog: [item, '$200.00'],
};
// Financial CSVs use their contractual units, not text scraped from a card or a visible page.
const csvFields: Partial<Record<OperationsScreen, string[]>> = {
  PriceListImportView: ['3', 'No item has the SKU “Missing”'],
  BlanketOrdersReportView: ['PO-12', 'USD', '60.00', '30.00'],
  CashForecast13WeekView: ['1', '2026-02-28', '2026-03-06', '98.00', '52.50', '45.50'],
  CustomerQuotesReportView: ['SO-5', customer, 'USD'],
  DataQualityReportView: ['Missing required label', 'cash', 'Valve purchase'],
  DeliveryNotesReportView: [item, '8'],
  DunningLettersReportView: ['INV-17', customer, '16', '9800', 'USD'],
  ExpenseByEmployeeReportView: [vendor, 'USD', '750'],
  IsraelAdvanceTaxReportView: ['2026-03-15'],
  IsraelVatReportView: ['Box 2', 'Output VAT', '18.00'],
  PickPackShipPanel: ['SO-5', 'V-7', item, '8'],
  QuoteVersionsReportView: ['1', '2026-02-01T12:00:00Z', 'Avi אבי', '150.00'],
  ShippingMethodsView: ['Local ground', 'SHIP', 'USD', '1495', '10000'],
  WarrantyRegisterPanel: [customer, 'INV-17', 'V-7', 'SN-17'],
  AccountantExportPackView: ['1100', 'Receivables', 'asset', '100.00'],
};
export async function operationsExample(page: Page, id: OperationsScreen, width: number, theme: 'light' | 'dark') {
  const state = await openOperationsScreen(page, id, width, theme);
  const target = page.locator('table:visible').nth(['SerialLotLookupReportView', 'OrderInvoiceDialog'].includes(id) ? -1 : 0);
  const inGrid = [
    'PurchaseOrdersView',
    'TimeView',
    'PayRunHistory',
    'PayrollView',
    'CustomerQuotesReportView',
    'ShippingMethodsView',
    'WarrantyRegisterPanel',
  ].includes(id);
  const cards = width === 390 && inGrid;
  const row = cards ? page.locator('[data-grid-row][role=listitem]').first() : target.locator('tbody tr').first();
  for (const field of worked[id]) await expect(row).toContainText(field);
  if (!cards) {
    await expect(target).toHaveAccessibleName(/\S/);
    await expect(row.getByRole('rowheader')).toHaveCount(1);
  }
  await settleStyles(page);
  await row.scrollIntoViewIfNeeded();
  return { ...state, row };
}
export async function checkOperationsScreen(page: Page, id: OperationsScreen, width: number, theme: 'light' | 'dark') {
  const { row, errors, requests, he } = await operationsExample(page, id, width, theme);
  if (process.env.LF_OPERATION_EVIDENCE) {
    const { writeFile, mkdir } = await import('node:fs/promises');
    const dir = process.env.LF_OPERATION_EVIDENCE;
    await mkdir(dir, { recursive: true });
    const stem = `${dir}/${id}-${width}-${theme}`;
    await page.screenshot({ path: stem + '.png', animations: 'disabled' });
    const tables = await page.locator('table:visible').evaluateAll((ts) =>
      ts.map((t) => {
        const table = t as HTMLTableElement;
        return [table.caption?.textContent, ...Array.from(table.rows, (r) => Array.from(r.cells, (c) => c.textContent?.trim()))];
      }),
    );
    const cards = await page
      .locator('[data-grid-row][role=listitem]')
      .evaluateAll((rs) =>
        rs.map((r) => Array.from(r.querySelectorAll('[data-grid-card-column]'), (c) => c.lastElementChild?.textContent?.trim())),
      );
    await writeFile(stem + '.json', JSON.stringify({ tables, cards }));
  }
  const scope = id === 'ReportPackDialog' ? '[role=dialog]' : '#root';
  const audit = await new AxeBuilder({ page }).include(scope).analyze();
  expect(audit.violations.map((v) => [v.id, v.nodes.map((n) => n.target)])).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect(page).toHaveScreenshot(`operations-${id}-${width}-${theme}.png`, {
    animations: 'disabled',
    caret: 'hide',
    scale: 'css',
    threshold: 0.1,
    maxDiffPixels: 100,
  });
  const region = row.locator('xpath=ancestor::*[@role="region" and @tabindex="0"][1]');
  await tabTo(page, region);
  if (await region.locator('[data-grid-row]').count()) {
    await page.keyboard.press('Home');
    await expect(region.locator('[data-grid-active-row=true]')).toHaveCount(1);
  }
  await expect(page.locator('html')).toHaveAttribute('dir', he ? 'rtl' : 'ltr');
  const wanted = csvFields[id];
  if (wanted) {
    const button = page
      .getByRole('button', {
        name: id === 'AccountantExportPackView' ? /trial-balance\.csv/ : id === 'PriceListImportView' ? /problem|בעיות/i : /CSV/i,
      })
      .first();
    const file = await downloadAt(page, button);
    expect(file.name).toMatch(/\.csv$/);
    expect(file.rows.slice(1)).toContainEqual(expect.arrayContaining(wanted));
  }
  expect(errors).toEqual([]);
  expect(requests.map((r) => new URL(r.url).pathname)).toEqual(
    id === 'OpeningDocumentsDialog' ? ['/api/v1/open-items/preview'] : [],
  );
}
