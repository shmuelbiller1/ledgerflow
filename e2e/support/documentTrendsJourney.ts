import { expect, type Page } from '@playwright/test';
import { customer, downloadAt, inspectComparison, item, openComparison, pressAt, trends, vendor } from './comparisonReportFixture';
import { remountJourney, setLedgerField } from './journeyFixture';

export async function checkDocumentTrends(page: Page, width: number, theme: 'light' | 'dark') {
  const { errors, he } = await openComparison(page, trends('sales'), width, theme);
  const table = page.getByRole('table');
  const headers = table.getByRole('columnheader'), names = table.getByRole('rowheader');
  const rows = table.locator('tbody tr');
  const window = he ? 'חלון' : 'Window', month = he ? 'חודש' : 'Month', amount = he ? 'סכום' : 'Amount';
  const party = he ? 'לקוח' : 'Customer', current = he ? 'נוכחית' : 'Current', previous = he ? 'קודמת' : 'Previous';
  const hasRows = async (name: string, amounts: string[]) => {
    await expect(names).toHaveText([name, name, name]);
    for (const [i, value] of amounts.entries()) {
      await expect(rows.nth(i).getByRole('cell')).toHaveText([i === 2 ? previous : current, i === 1 ? '2026-02' : '2026-01', value]);
    }
  };
  // January is in both windows: these are distinct rows, not one month lost to a key collision.
  await expect(headers).toHaveText([window, month, party, amount]);
  await hasRows(customer, ['$18.75', '$234.56', '$18.75']);
  await inspectComparison(page, `trends-sales-${width}-${theme}`);
  await pressAt(page, page.getByRole('button', { name: he ? 'עמודות' : 'Columns', exact: true }));
  const earlier = page.getByRole('button', { name: he ? 'הקדמת העמודה סכום' : 'Move Amount earlier' });
  await pressAt(page, earlier); await page.keyboard.press('Enter');
  await pressAt(page, page.getByRole('checkbox', { name: month, exact: true }), 'Space', true);
  await expect(headers).toHaveText([window, amount, party]);
  const csv = await downloadAt(page, page.getByRole('button', { name: he ? 'ייצוא השורות המוצגות ל־CSV' : 'Export displayed rows CSV' }), true);
  expect(csv.rows).toEqual([[window, amount, party], [current, '$18.75', customer], [current, '$234.56', customer], [previous, '$18.75', customer]]);

  await remountJourney(page, [trends('sales', false)]);
  await expect(headers).toHaveText([month, party, amount]);
  await expect(names).toHaveText([customer, customer]);
  await remountJourney(page, []); await expect(table).toHaveCount(0);
  await remountJourney(page, [trends('sales')]);
  await expect(headers).toHaveText([window, amount, party]);
  await pressAt(page, page.getByRole('combobox', { name: he ? 'קיבוץ המכירות לפי' : 'Group sales by' }), 'ArrowDown');
  await expect(headers).toHaveText([window, month, he ? 'פריט' : 'Item', amount]);
  await hasRows(item, ['$18.75', '$234.56', '$18.75']);

  await remountJourney(page, [trends('purchases')]);
  await expect(headers).toHaveText([window, month, he ? 'ספק' : 'Vendor', amount]);
  await hasRows(vendor, ['$42.00', '$38.50', '$42.00']);
  await inspectComparison(page, `trends-purchases-${width}-${theme}`);
  // A current period with no documents must not hide valid previous-period figures.
  await remountJourney(page, [trends('purchases', true, '2028-02-29')]);
  await expect(names).toHaveText([vendor]);
  await expect(rows.getByRole('cell')).toHaveText([previous, '2026-01', '$42.00']);
  await remountJourney(page, [trends('purchases', false, '2028-02-29')]);
  // Data outside the window: still a period report, not an invitation to enter duplicate bills.
  await expect(headers).toHaveText([month, he ? 'ספק' : 'Vendor', amount]);
  await expect(rows.getByRole('cell')).toHaveCount(1);
  await expect(page.getByRole('button', { name: he ? 'עמודות' : 'Columns' })).toHaveCount(0);
  await setLedgerField(page, 'bills', []);
  await expect(table).toHaveCount(0);
  await pressAt(page, page.getByRole('button', { name: he ? 'פתיחת רכישות' : 'Open Purchases' }));
  await expect(page).toHaveURL(/#purchases$/);
  expect(errors).toEqual([]);
}
