import { expect, type Page } from '@playwright/test';
import { auditComparison, downloadAt, inspectComparison, item, openComparison, pressAt, quotes, vendor } from './comparisonReportFixture';
import { remountJourney, setLedgerField } from './journeyFixture';

// A role change in the same workspace/user must not reuse a writer-only layout in the viewer's table.
async function changeRole(page: Page, role: 'viewer' | 'bookkeeper') {
  await page.evaluate(async role => {
    const { useAuthStore } = await import('/src/stores/useAuthStore.ts');
    const { workspaces, user } = useAuthStore.getState();
    useAuthStore.setState({ workspaces: workspaces.map(w => ({ ...w, roles: { ...w.roles, [user!.uid]: role } })) });
  }, role);
}

export async function checkVendorQuoteTable(page: Page, width: number, theme: 'light' | 'dark') {
  const writer = theme === 'dark';
  const { errors, he } = await openComparison(page, quotes, width, theme, writer ? 'bookkeeper' : 'viewer');
  const table = page.getByRole('table'), headers = table.getByRole('columnheader');
  const north = table.getByRole('row').filter({ has: page.getByRole('cell', { name: vendor, exact: true }) });
  const west = table.getByRole('row').filter({ has: page.getByRole('cell', { name: 'West', exact: true }) });
  const actions = he ? 'פעולות' : 'Actions', lead = he ? 'ימי אספקה' : 'Lead days';
  const columns = page.getByRole('button', { name: he ? 'עמודות' : 'Columns', exact: true });
  const displayedCsv = page.getByRole('button', { name: he ? 'ייצוא השורות המוצגות ל־CSV' : 'Export displayed rows CSV' });
  const formSummary = page.locator('summary').filter({ hasText: he ? 'רישום או עדכון הצעת ספק' : 'Record or update supplier quote' });
  const remove = north.getByRole('button', { name: he ? `הסרת ההצעה של ${vendor} עבור ${item}` : `Remove quote from ${vendor} for ${item}` });
  const price = he ? 'מחיר בהצעה' : 'Quoted price';
  const headingLabels = he ? ['פריט', 'ספק', price, 'פער מהנמוך ביותר', 'כמות מינימום', lead, 'בתוקף עד', 'עלות אחרונה שחויבה']
    : ['Item', 'Vendor', price, 'Spread vs lowest', 'MOQ', lead, 'Valid until', 'Last billed cost'];
  await expect(headers).toHaveText(writer ? [...headingLabels, actions] : headingLabels);
  await expect(north.getByRole('rowheader')).toHaveText(`${item} (V-7)`);
  await expect(north.getByRole('cell', { name: '$19.25 (B-2)', exact: true })).toBeVisible();
  await expect(west.getByRole('cell', { name: '+$3.75', exact: true })).toBeVisible();
  await expect(remove).toHaveCount(writer ? 1 : 0);
  await expect(formSummary).toHaveCount(writer ? 1 : 0);
  if (width === 390) await expect(north.getByRole('rowheader')).toHaveCSS('position', 'sticky');
  await inspectComparison(page, `quotes-${width}-${theme}`);

  await pressAt(page, page.getByLabel(he ? 'סינון לפי פריט' : 'Filter by item'), 'ArrowDown');
  await expect(table.getByRole('rowheader')).toHaveCount(4); // washer is not in either export
  const financial = await downloadAt(page, page.getByRole('button', { name: he ? 'ייצוא CSV' : 'Export CSV', exact: true }), true);
  expect(financial.name).toBe('vendor-quotes-2026-02-28.csv');
  expect(financial.rows).toHaveLength(5);
  expect(financial.rows[0][4]).toBe('Quoted unit price (minor units)');
  expect(financial.rows[2]).toEqual([item, 'V-7', vendor, 'USD', '1875', 'yes', '0', '2', '3', '', 'no', '1925', 'B-2', '']);
  expect(financial.rows[1].slice(2, 7)).toEqual(['Euro', 'EUR', '1300', 'yes', '0']);
  expect(financial.rows[4].slice(4, 11)).toEqual(['1100', 'no', '', '2', '3', '2026-01-01', 'yes']);

  if (!writer) await changeRole(page, 'bookkeeper');
  await pressAt(page, formSummary);
  await expect(page.locator('#vq-vendor')).toBeVisible();
  await auditComparison(page, 'Open quote editor');
  expect((await page.locator('#vq-price').boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect((await remove.boundingBox())!.width).toBeGreaterThanOrEqual(44);
  await pressAt(page, formSummary);
  // Move the actual action column. A click on North must still remove only North's quote from Valve.
  await pressAt(page, columns);
  await pressAt(page, page.getByRole('button', { name: he ? `הקדמת העמודה ${actions}` : `Move ${actions} earlier` }));
  await expect(headers.nth(7)).toHaveText(actions);
  const save = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/api/v1/commands/record.save'));
  await pressAt(page, remove);
  const payload = (await save).postDataJSON();
  expect(payload).toMatchObject({ workspaceId: 'monthly-books', input: { collection: 'inventory', id: 'valve' } });
  expect(payload.input.data.metadata.vendorQuotes.map((q: { id: string }) => q.id)).toEqual(['west', 'eu', 'old']);

  await changeRole(page, 'viewer');
  await expect(headers).toHaveText(headingLabels);
  await expect(table.getByRole('button')).toHaveCount(0);
  await expect(formSummary).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: actions, exact: true })).toHaveCount(0);
  await pressAt(page, page.getByRole('button', { name: he ? `הקדמת העמודה ${price}` : `Move ${price} earlier` }));
  await pressAt(page, page.getByRole('checkbox', { name: lead, exact: true }), 'Space');
  const shownHeaders = [headingLabels[0], price, headingLabels[1], ...headingLabels.slice(3, 5), ...headingLabels.slice(6)];
  await expect(headers).toHaveText(shownHeaders);
  const shown = await downloadAt(page, displayedCsv, true);
  expect(shown.rows).toHaveLength(5);
  expect(shown.rows[0]).toEqual(shownHeaders);
  expect(shown.rows[2]).toEqual([`${item} (V-7)`, `$18.75 ${he ? 'הנמוך ביותר' : 'Lowest'} (USD)`, vendor, he ? 'הטוב ביותר' : 'Best', '2', he ? 'פתיחה' : 'Open', '$19.25 (B-2)']);
  await remountJourney(page, []); await expect(table).toHaveCount(0);
  await remountJourney(page, [quotes]); await expect(headers).toHaveText(shownHeaders);
  // No rows: the viewer gets a real destination, no export or controls offering to edit.
  await setLedgerField(page, 'inventory', []);
  await expect(table).toHaveCount(0);
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await expect(page.getByRole('button')).toHaveCount(1);
  await pressAt(page, page.getByRole('button', { name: he ? 'פתיחת המלאי' : 'Open Inventory' }));
  await expect(page).toHaveURL(/#inventory$/);
  expect(errors).toEqual([]);
}
