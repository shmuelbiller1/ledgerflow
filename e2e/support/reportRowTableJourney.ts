import { expect, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { parseCsv } from '../../src/lib/csv';
import { mountJourney, remountJourney, settleStyles } from './journeyFixture';

const workspaceId = 'comparison-books';
const period = { startDate: '2026-02-01', endDate: '2026-02-28' };
const compare = { compareStartDate: '2026-01-01', compareEndDate: '2026-01-31' };
const everyday = '/src/components/reporting/EverydayReportViews.tsx';
const reports = (withComparison: boolean) => [
  { module: everyday, exportName: 'AccountBalancesAsOfView' },
  { module: everyday, exportName: 'PaymentPeriodByInvoiceDateView' },
  { module: '/src/components/reporting/CustomerGrossProfitView.tsx' },
].map(mount => ({ ...mount, props: withComparison ? { ...period, ...compare } : period }));

/** A button that works only after programmatic focus is not keyboard reachable. */
async function tabTo(page: Page, target: Locator, backwards = false) {
  for (let step = 0; step < 32 && !await target.evaluate(el => el === document.activeElement); step++) {
    await page.keyboard.press(backwards ? 'Shift+Tab' : 'Tab');
  }
  await expect(target).toBeFocused();
}

/** Real reports and a deterministic, non-empty ledger for the visual refresh workflow. */
export async function checkComparisonReports(page: Page, width: number, theme: 'light' | 'dark') {
  const he = (width === 390) === (theme === 'light');
  await page.setViewportSize({ width, height: 850 });
  const account = 'Cash מזומן', customer = 'דנה Dana';
  const { errors } = await mountJourney(page, {
    workspaceId, mounts: [reports(true)[1]], ledger: {
      accounts: [{ id: 'cash', workspaceId, code: '1000', type: 'asset', category: 'Cash', name: account, openingBalanceCents: 12345 }],
      customers: [{ id: 'dana', workspaceId, name: customer }],
      invoices: [{ id: 'inv', workspaceId, customerId: 'dana', number: 'INV-10', date: '2026-02-03', paymentDate: '2026-02-08', status: 'paid', currency: 'USD', amountCents: 2000,
        items: [{ id: 'line', description: 'Service', quantity: 1, amountCents: 2000 }] }],
    },
  });
  await page.evaluate(async ({ theme, he }) => {
    const { useUIStore } = await import('/src/stores/useUIStore.ts');
    useUIStore.setState({ language: he ? 'he' : 'en' });
    document.documentElement.className = theme;
    document.documentElement.lang = he ? 'he' : 'en';
    document.documentElement.dir = he ? 'rtl' : 'ltr';
  }, { theme, he });
  const table = page.getByRole('table').filter({ has: page.getByRole('rowheader', { name: account }) });
  const paymentDays = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: /INV-10/ }) });
  const margin = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: customer }) });
  const invoiceLabel = 'INV-10 · 2026-02-03 → 2026-02-08';
  // Each report occupies its own page, with its own scroll region and chooser.
  const inspect = async (name: string) => {
    await settleStyles(page);
    const audit = await new AxeBuilder({ page }).include('section').analyze();
    expect(audit.violations.map(v => v.id), name).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('section')).toHaveScreenshot(`comparison-${name}-${width}-${theme}.png`, {
      animations: 'disabled', caret: 'hide', scale: 'css', threshold: 0.1, maxDiffPixels: 100,
    });
  };
  // Optional at the front of the payments report, at the end of the other two.
  await expect(paymentDays.locator('th')).toHaveText(invoiceLabel);
  await expect(paymentDays.locator('td')).toHaveText([he ? 'נוכחית' : 'Current', '$20.00', '5']);
  await inspect('payment-period');
  await remountJourney(page, [reports(false)[1]]);
  await expect(paymentDays.locator('th:first-child')).toHaveText(invoiceLabel);
  await expect(paymentDays.locator('td')).toHaveText(['$20.00', '5']);
  await remountJourney(page, [reports(true)[2]]);
  await expect(margin.locator('td').last()).toHaveText('$0.00 / $20.00');
  await inspect('gross-profit');
  await remountJourney(page, [reports(false)[2]]);
  await expect(margin.locator('td')).toHaveCount(5);
  await remountJourney(page, [reports(true)[0]]);
  const balances = page.getByRole('region', { name: he ? 'יתרות חשבונות לתאריך' : 'Account balances as of a date', exact: true });
  const chooser = balances.getByRole('button', { name: he ? 'עמודות' : 'Columns', exact: true });
  await tabTo(page, chooser); await page.keyboard.press('Enter');
  const earlier = balances.getByRole('button', { name: he ? 'הקדמת העמודה יתרה' : 'Move Balance earlier', exact: true });
  await tabTo(page, earlier); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  const type = balances.getByRole('checkbox', { name: he ? 'סוג' : 'Type', exact: true });
  await tabTo(page, type); await page.keyboard.press('Space'); await expect(type).not.toBeChecked();
  const headers = he ? ['קוד', 'יתרה', 'חשבון', 'יתרה קודמת / שינוי'] : ['Code', 'Balance', 'Account', 'Previous balance / change'];
  const values = ['1000', '$123.45', account, '$123.45 / $0.00'];
  await expect(table.getByRole('columnheader')).toHaveText(headers);
  await expect(table.locator('tbody tr > :visible')).toHaveText(values);
  await expect(table.getByRole('rowheader')).toHaveText(account);
  const exportCsv = balances.getByRole('button', { name: he ? 'ייצוא השורות המוצגות ל־CSV' : 'Export displayed rows CSV' });
  await tabTo(page, exportCsv, true);
  const downloading = page.waitForEvent('download'); await page.keyboard.press('Enter');
  const csv = await readFile((await (await downloading).path())!, 'utf8');
  expect(parseCsv(csv)).toEqual([headers, values]);
  expect((await exportCsv.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await inspect('balances-columns');

  await remountJourney(page, []); await expect(table).toHaveCount(0);
  await remountJourney(page, [reports(true)[0]]);
  await expect(table.getByRole('columnheader')).toHaveText(headers);
  await expect(table.locator('tbody tr > :visible')).toHaveText(values);
  expect(errors).toEqual([]);
}
