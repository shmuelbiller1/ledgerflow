import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openOperationsScreen } from './support/operationsFixture';
import { downloadAt, item, workspaceId } from './support/comparisonReportFixture';
import { setLedgerField } from './support/journeyFixture';
import { tabTo } from './support/tabTo';

test.use({ locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'reduce' });

for (const width of [390, 1280])
  test(`an expanded order stays with its ID through filtering; receipts keep their own lines at ${width}`, async ({ page }) => {
    const h = await openOperationsScreen(page, 'PurchaseOrdersView', width, width === 390 ? 'dark' : 'light');
    const list = page.getByRole('region', { name: 'Purchase orders', exact: true });
    await tabTo(page, list);
    await page.keyboard.press('End');
    await expect(list.locator('[data-grid-active-row=true]')).toContainText('PO-24');
    const toggle = list.getByRole('button', { name: 'Lines of PO-24' });
    await toggle.press('Enter');
    const lines = page.getByRole('table', { name: 'Lines of PO-24', exact: true });
    const input = lines.getByLabel('New line on PO-24', { exact: true });
    await input.fill('Valve seal');
    // The quantity input owns Home/End while editing: the surrounding grid must not consume it.
    await input.press('Home');
    await input.press('End');
    await expect(input).toBeFocused();
    const search = page.getByPlaceholder('Search records...');
    await search.fill('PO-24');
    await expect(input).toHaveValue('Valve seal');
    await expect(page.getByRole('button', { name: 'Lines of PO-12' })).toHaveCount(0);
    if (width === 1280) await list.getByRole('button', { name: 'Number', exact: true }).press('Enter');
    await expect(input).toHaveValue('Valve seal');
    // Hiding Vendor on a card cannot hide cells in its nested line editor (or change what prints).
    const chooser = page.locator('summary').filter({ hasText: 'Columns' }).first();
    await chooser.press('Enter');
    const hide = page.getByRole('checkbox', { name: 'Column 2 visibility' });
    await hide.uncheck();
    await expect(lines.getByRole('columnheader', { name: 'Quantity' })).toBeVisible();
    if (width === 390) await expect(list.getByRole('listitem').locator('[data-grid-card-column="1"]')).toBeHidden();
    await page.emulateMedia({ media: 'print' });
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    if (width === 390) await expect(list.getByRole('listitem').locator('[data-grid-card-column="1"]')).toBeVisible();
    else
      await expect(
        page.getByRole('table', { name: 'Purchase orders', exact: true }).getByRole('columnheader', { name: 'Vendor' }),
      ).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await page.emulateMedia({ media: 'screen' });
    await hide.check();
    await chooser.press('Enter');
    // Printing never substitutes another record or destroys an unsaved line.
    await expect(input).toHaveValue('Valve seal');
    await lines.getByLabel('Quantity of the new line on PO-24').fill('2');
    const price = lines.getByLabel('Unit price of the new line on PO-24');
    await price.fill('3.50');
    await price.press('Enter');
    await expect.poll(() => h.requests.length).toBe(1);
    expect(h.requests[0].body).toMatchObject({
      input: {
        collection: 'purchaseOrders',
        id: 'po2',
        data: {
          totalAmountCents: 3200,
          items: expect.arrayContaining([
            expect.objectContaining({ description: 'Valve seal', quantity: 2, unitPriceCents: 350 }),
          ]),
        },
      },
    });
    await search.fill('PO-12');
    await page.getByRole('button', { name: 'Lines of PO-12' }).press('Enter');
    const received = page.getByRole('table', { name: 'Lines of PO-12' });
    await expect(received.getByRole('row', { name: new RegExp(item) })).toContainText('$45.00');
    await expect(received.getByLabel('New line on PO-12')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Files of Purchase order PO-12' })).toBeVisible();
    await page.getByRole('tab', { name: 'Goods received (1)' }).press('Enter');
    const receipt = page.locator('[data-grid-row]').filter({ hasText: 'GR-12' });
    for (const value of ['PO-12', item, '(4)', 'SN-17']) await expect(receipt).toContainText(value);
    expect(h.errors).toEqual([]);
  });

test('a viewer gets named purchase order lines, not order mutations', async ({ page }) => {
  const h = await openOperationsScreen(page, 'PurchaseOrdersView', 390, 'dark', 'viewer');
  await page.getByRole('button', { name: 'Lines of PO-24' }).press('Enter');
  await expect(page.getByRole('table', { name: 'Lines of PO-24' }).getByRole('rowheader', { name: item })).toBeVisible();
  await expect(page.getByRole('button', { name: /Receive goods|Delete PO-|Edit Quantity|New purchase order/ })).toHaveCount(0);
  await expect(page.getByLabel('New line on PO-24')).toHaveCount(0);
  expect(h.requests).toEqual([]);
});

test('payslip download uses the run and employee; an unfinished deposit editor cannot download', async ({ page }) => {
  const h = await openOperationsScreen(page, 'PayRunHistory', 390, 'dark');
  await page.route(`**/api/v1/workspaces/${workspaceId}/pay-runs/run/payslips/emp`, (r) =>
    r.fulfill({ contentType: 'application/pdf', body: '%PDF-1.4\nFixture slip for emp: 435000\n%%EOF' }),
  );
  await page.getByRole('button', { name: /^Payslips/ }).press('Enter');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Noa נועה: payslip (PDF)' }).press('Enter');
  const file = await pending;
  expect(file.suggestedFilename()).toMatch(/^payslip_2026-02-20_.*\.pdf$/);
  expect(await readFile((await file.path())!, 'utf8')).toContain('435000');
  await page.getByRole('button', { name: /^Direct deposit file/ }).press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('row', { name: /Noa/ })).toContainText('$4,350.00');
  await dialog.getByRole('button', { name: /Add the bank account/ }).press('Enter');
  const number = dialog.getByLabel('Account number', { exact: true });
  await number.fill('12345');
  await expect(number).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Download the file' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).press('Enter');
  await expect(number).toHaveCount(0);
  expect(h.requests).toEqual([]);
  expect(h.errors).toEqual([]);
});

test('counted quantity and cost stay on their item; a blank count is not zero', async ({ page }) => {
  const h = await openOperationsScreen(page, 'StockCountDialog', 390, 'dark');
  const input = page.getByLabel(`Counted quantity of ${item}`);
  await tabTo(page, input);
  await input.fill('3');
  const row = page.getByRole('row', { name: new RegExp(item) });
  await expect(row).toContainText('-2');
  await expect(row).toContainText('-$15.00');
  await expect(page.getByTestId('stock-count-total')).toHaveText('-$15.00');
  await input.fill('');
  await expect(page.getByTestId('stock-count-total')).toHaveText('$0.00');
  expect(h.requests).toEqual([]);
});

test('capping the bill list blocks blanket exports without reassigning a typed agreement', async ({ page }) => {
  const h = await openOperationsScreen(page, 'BlanketOrdersReportView', 1280, 'light');
  const date = page.getByLabel('Last valid day of PO-24');
  const amount = page.getByLabel('Agreed total of PO-24');
  await date.fill('2026-03-31');
  await amount.fill('80.25');
  await setLedgerField(page, 'truncatedCollections', { bills: true });
  await expect(page.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
  await expect(amount).toHaveValue('80.25');
  await expect(date).toHaveValue('2026-03-31');
  const schedule = page.getByRole('table').first().locator('xpath=..');
  await schedule.getByRole('button', { name: 'Columns' }).press('Enter');
  await expect(page.getByRole('button', { name: /Export displayed/ })).toHaveCount(0);
  expect(h.requests).toEqual([]);
});

test('the goods-only slip prints the same item and quantity, and a capped stock read forbids print and CSV', async ({ page }) => {
  const h = await openOperationsScreen(page, 'PickPackShipPanel', 1280, 'light');
  await page.evaluate(() => {
    window.print = () => window.dispatchEvent(new Event('afterprint'));
  });
  const print = page.getByRole('button', { name: 'Print packing slip' });
  await print.press('Enter');
  const sheet = page.locator('[data-warehouse-packing-slip]');
  await expect(sheet.getByRole('rowheader', { name: item })).toBeVisible();
  await expect(sheet.getByRole('row', { name: new RegExp(item) })).toContainText('8');
  await expect(sheet).not.toContainText('$');
  await sheet.getByRole('button', { name: 'Close packing slip' }).press('Enter');
  await setLedgerField(page, 'truncatedCollections', { inventory: true });
  await expect(print).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Export pick list CSV' })).toBeDisabled();
  expect(h.requests).toEqual([]);
});

test('delivery note CSV follows the document price choice, not a hidden DOM column', async ({ page }) => {
  const h = await openOperationsScreen(page, 'DeliveryNotesReportView', 1280, 'light');
  const csv = page.getByRole('button', { name: 'Download CSV' });
  const prices = page.getByLabel('Show prices on delivery note');
  await prices.uncheck();
  let file = await downloadAt(page, csv);
  expect(file.rows[1]).toEqual([item, '8']);
  await prices.check();
  file = await downloadAt(page, csv);
  expect(file.rows[1]).toEqual([item, '8', '25.00', '200.00']);
  expect(h.requests).toEqual([]);
});
