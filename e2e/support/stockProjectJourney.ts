import { expect, type Locator, type Page } from '@playwright/test';
import { downloadAt, inspectComparison, pressAt } from './comparisonReportFixture';
import { setLedgerField } from './journeyFixture';
import { openSchedule, type Schedule } from './stockProjectFixture';
import { tabTo } from './tabTo';

const item = 'Valve ברז';
const values = (table: Locator, row: number) => table.locator('tbody tr').nth(row).getByRole('cell');
const csv = (page: Page) => page.getByRole('button', { name: /CSV/, exact: false });

async function scrollWithKeyboard(page: Page, table: Locator, rtl: boolean) {
  const region = table.locator('xpath=ancestor::*[@role="region" and @tabindex="0"][1]');
  await tabTo(page, region);
  const overflows = await region.evaluate(el => el.scrollWidth > el.clientWidth + 2);
  if (overflows) {
    await page.keyboard.press(rtl ? 'ArrowLeft' : 'ArrowRight');
    await expect.poll(() => region.evaluate(el => Math.abs(el.scrollLeft))).toBeGreaterThan(0);
  }
}

async function verifyProject(page: Page, table: Locator, he: boolean) {
  await expect(values(table, 0)).toHaveText(['2', '$125.00', '$31.25', '$93.75', '75.0%']);
  await expect(values(table, 1)).toHaveText(['1', '$0.00', '$15.75', '-$15.75', '0%']);
  await pressAt(page, page.getByRole('button', { name: he ? 'הפסד' : 'Loss', exact: true }));
  await expect(table.getByRole('rowheader')).toHaveText(['Jetty']);
  await pressAt(page, page.getByRole('button', { name: /40%/ }), 'Enter', true);
  await expect(table.getByRole('rowheader')).toHaveText(['Pier רציף']);
  await pressAt(page, page.getByRole('button', { name: he ? 'טבלה' : 'Table', exact: true }));
  await expect(page.getByRole('table').last().getByRole('cell')).toHaveText(['$125.00', '$31.25', '75%']);
  await expect(page.getByRole('button', { name: he ? 'ייצוא שורות הפרויקטים' : 'Export project rows' })).toBeDisabled();
}
async function verifyTransfers(page: Page, table: Locator, he: boolean) {
  await expect(table.getByRole('rowheader')).toHaveText([item, item]);
  await expect(values(table, 1).nth(1)).toHaveText('2');
  await expect(values(table, 1).nth(5)).toHaveText('—');
  await pressAt(page, page.getByRole('checkbox', { name: he ? 'רק תנועות שחסר להן זוג' : 'Only moves missing their pair' }), 'Space');
  await expect(table.getByRole('rowheader')).toHaveCount(1);
  expect((await downloadAt(page, csv(page), true)).rows).toEqual([
    ['Date', 'Item', 'Quantity', 'From', 'To', 'Complete', 'Note'],
    ['2026-02-07', item, '1', 'West', '(no location)', 'no', 'Its move-in half is not in the loaded history.'],
  ]);
}
async function verifyGroups(page: Page, table: Locator, he: boolean) {
  await expect(table.getByRole('columnheader')).toHaveCount(16);
  await expect(values(table, 0).nth(0)).toHaveText('—');
  await expect(values(table, 0).nth(1)).toHaveText('70.0%');
  await expect(table.locator('tfoot td').nth(13)).toHaveText('$35.00');
  await pressAt(page, table.getByRole('button', { name: '70.0%' }));
  await expect(page.getByRole('status')).toContainText(/\$50\.00.*\$15\.00.*\$35\.00/);
  const file = (await downloadAt(page, csv(page))).rows;
  expect(file[0]).toHaveLength(54);
  expect(file[1].slice(5, 9)).toEqual(['5000', '1500', '3500', '70.00']);
  expect(file[1].slice(-5)).toEqual(['5000', '1500', '3500', '70.00', 'Yes']);
  await pressAt(page, page.getByRole('button', { name: he ? 'עמודות' : 'Columns', exact: true }));
  const headers = table.getByRole('columnheader');
  const jan = await headers.nth(1).innerText();
  await pressAt(page, page.getByRole('checkbox', { name: jan, exact: true }), 'Space');
  await expect(headers).toHaveCount(15);
  const displayed = page.getByRole('button', { name: /Export displayed rows CSV|ייצוא השורות המוצגות/ });
  const visible = (await downloadAt(page, displayed, true)).rows;
  expect(visible[0]).not.toContain(jan); expect(visible[1][1]).toBe('70.0%');
  expect(visible[2].slice(-3)).toEqual(['$50.00', '$35.00', '70.0%']);
  // Applying an incomplete read closes both download paths, not just the financial CSV.
  await setLedgerField(page, 'truncatedCollections', { invoices: true });
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(csv(page)).toHaveCount(1); await expect(csv(page)).toBeDisabled();
}
async function verifyDetails(page: Page, table: Locator, he: boolean) {
  await expect(values(page.getByRole('table').first(), 0)).toHaveText(['2', '$15.00', '$7.50']);
  await expect(values(table, 0)).toHaveText(['4', '$30.00']);
  await expect(table.locator('tfoot td')).toHaveText(['4', '$30.00']);
  await pressAt(page, table.getByRole('button', { name: he ? /נמכר/ : /Sold/ }));
  expect(await page.evaluate(async () => (await import('/src/stores/useUIStore.ts')).useUIStore.getState().focusRecord)).toEqual({ type: 'transaction', id: 'entry-sale' });
}
async function verifyInactive(page: Page, table: Locator, he: boolean) {
  await expect(table.getByRole('rowheader')).toHaveText([item, 'Gauge מד']);
  await expect(values(table, 0).nth(2)).toHaveText('146');
  await expect(values(table, 0).last()).toContainText(he ? 'מכירה בתוך הסף' : 'Sale within threshold');
  await setLedgerField(page, 'isDataTruncated', true);
  await expect(page.getByRole('alert')).toBeVisible();
  await pressAt(page, page.getByRole('button', { name: he ? 'עמודות' : 'Columns', exact: true }));
  await expect(page.getByRole('button', { name: /CSV/ })).toHaveCount(0);
  await setLedgerField(page, 'isDataTruncated', false);
  await expect(page.getByRole('alert')).toHaveCount(0);
  const input = page.getByRole('textbox'); await tabTo(page, input);
  await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.type('147');
  await expect(table.getByRole('rowheader')).toHaveText(['Gauge מד']);
  await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.type('0');
  await expect(page.getByRole('alert')).toBeVisible(); await expect(table).toHaveCount(0);
}

export async function checkSchedule(page: Page, screen: Schedule, width: number, theme: 'light' | 'dark') {
  const { he, errors, requests } = await openSchedule(page, screen, width, theme);
  const tables = page.getByRole('table'), table = screen === 'projects' ? tables.first() : tables.last();
  for (const t of await tables.all()) {
    await expect(t).toHaveAccessibleName(/\S/);
    await expect(t.locator('tbody th[scope="row"]').first()).toBeVisible();
  }
  if (['time', 'groups', 'inactive', 'turnover', 'transfers'].includes(screen)) await expect(page.getByRole('button', { name: he ? 'עמודות' : 'Columns', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', he ? 'rtl' : 'ltr');
  await inspectComparison(page, `schedule-${screen}-${width}-${theme}`);
  switch (screen) {
    case 'projects': await verifyProject(page, table, he); break;
    case 'groups': await verifyGroups(page, table, he); break;
    case 'inactive': await verifyInactive(page, table, he); break;
    case 'details': await verifyDetails(page, table, he); break;
    case 'transfers': await verifyTransfers(page, table, he); break;
    case 'time': {
      const h = he ? 'שעות' : 'h';
      await expect(values(table, 0)).toHaveText(['Pier רציף', `1:20 ${h}`, `0:45 ${h}`, `0:45 ${h}`, '2']);
      expect((await downloadAt(page, csv(page))).rows).toEqual([
        ['Person', 'Project', 'Minutes', 'Hours', 'Billable minutes', 'Waiting for approval (minutes)', 'Entries'], ['Avi אבי', 'Pier רציף', '80', '1.33', '45', '45', '2'],
      ]); break;
    }
    case 'sales': {
      const actual = ['2', '$50.00', `$15.00 ${he ? '(הערכה)' : '(est.)'}`, '$35.00', '70.0%'];
      await expect(values(table, 0)).toHaveText(actual); await expect(table.locator('tfoot td')).toHaveText(actual);
      await scrollWithKeyboard(page, table, he); break;
    }
    case 'backorders':
      await expect(tables.nth(0).getByRole('rowheader')).toHaveText(['SO-1']);
      await expect(values(tables.nth(1), 0)).toHaveText(['2', '6', '0']);
      await expect(values(table, 1)).toHaveText(['Dana דנה', item, '4', '2', '2']);
      await scrollWithKeyboard(page, table, he);
      await setLedgerField(page, 'truncatedCollections', { estimates: true });
      await expect(page.getByRole('alert')).toBeVisible(); await expect(tables).toHaveCount(0); break;
    case 'aging':
      await expect(values(table, 0)).toHaveText(['4', '$30.00', '2', '1', '', '', '', '1', /24/]);
      await expect(table.locator('time')).toHaveAttribute('datetime', '2026-02-04');
      await scrollWithKeyboard(page, table, he); break;
    case 'turnover':
      await expect(values(table, 0)).toHaveText(['4', '2', '2', '2', '4', '4', '$15.00', '$30.00', '0.50', '0.50', '118.0']);
      expect((await downloadAt(page, csv(page))).rows[1]).toEqual([item, '4', '2', '2', '2', '4', '4', '1500', '3000', '3000', '3000', '0.5', '0.5', '118', '']); break;
  }
  expect(errors).toEqual([]); expect(requests).toEqual([]);
}
