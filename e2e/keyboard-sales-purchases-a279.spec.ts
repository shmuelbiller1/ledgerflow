import { test, expect, type Locator, type Page } from '@playwright/test';
import { mountJourney } from './support/journeyFixture';

/** A-279: the four list → record → list paths (not just their edit dialogs).
 * Start on the search field, walk by real Tab presses through two rows and their actions,
 * open each record with Enter, close with Escape, and return to that exact row opener.
 */
test.use({ reducedMotion: 'reduce' });

async function tabTo(page: Page, target: Locator, label: string) {
  await expect(target, `${label} is rendered`).toBeVisible();
  for (let step = 0; step < 100; step++) {
    if (await target.evaluate(el => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target, `Tab reaches ${label} (including through earlier row controls)`).toBeFocused();
}

async function openAndReturn(page: Page, opener: Locator, heading: string, back: string) {
  await expect(opener).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: back, exact: true }), 'the record focuses its Back control').toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: heading, exact: true })).toHaveCount(0);
  await expect(opener, 'Escape returns to the row that opened this record').toBeFocused();
}

type RowVisit = { opener: Locator; heading: string; back: string; action: Locator; label: string };

/** Exercise both rows in tab order, including a real row action after each focus return. */
async function visitTwoRows(page: Page, rows: readonly [RowVisit, RowVisit]) {
  for (const [index, row] of rows.entries()) {
    await tabTo(page, row.opener, row.label);
    await openAndReturn(page, row.opener, row.heading, row.back);
    await tabTo(page, row.action, `${index === 0 ? 'first' : 'second'} ${row.label} action`);
  }
}

const salesLedger = {
  customers: [
    { id: 'cust-acme', uid: 'journey-user', workspaceId: 'kbd-sales-records', name: 'Acme Corp', email: 'acme@example.test', status: 'active' },
    { id: 'cust-beta', uid: 'journey-user', workspaceId: 'kbd-sales-records', name: 'Beta LLC', email: 'beta@example.test', status: 'active' },
  ],
  invoices: [
    { id: 'inv-1001', uid: 'journey-user', workspaceId: 'kbd-sales-records', customerId: 'cust-acme', customerName: 'Acme Corp', number: '1001', status: 'sent', amountCents: 118000, date: '2026-09-05', dueDate: '2026-10-05' },
    { id: 'inv-1002', uid: 'journey-user', workspaceId: 'kbd-sales-records', customerId: 'cust-beta', customerName: 'Beta LLC', number: '1002', status: 'sent', amountCents: 50000, date: '2026-09-05', dueDate: '2026-10-05' },
  ],
};
const purchasesLedger = {
  vendors: [
    { id: 'vendor-parts', uid: 'journey-user', workspaceId: 'kbd-purchases-records', name: 'Parts Ltd', category: 'Supplies', status: 'active' },
    { id: 'vendor-paper', uid: 'journey-user', workspaceId: 'kbd-purchases-records', name: 'Paper Co', category: 'Office', status: 'active' },
  ],
  bills: [
    { id: 'bill-2001', uid: 'journey-user', workspaceId: 'kbd-purchases-records', vendorId: 'vendor-parts', vendorName: 'Parts Ltd', number: '2001', status: 'pending', amountCents: 42000, date: '2026-09-08', dueDate: '2026-09-20' },
    { id: 'bill-2002', uid: 'journey-user', workspaceId: 'kbd-purchases-records', vendorId: 'vendor-paper', vendorName: 'Paper Co', number: '2002', status: 'pending', amountCents: 25000, date: '2026-09-08', dueDate: '2026-09-20' },
  ],
};

test('A-279 invoice list: Tab through two rows/actions, Enter opens, Escape restores the exact invoice opener', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const { errors } = await mountJourney(page, { workspaceId: 'kbd-sales-records', ledger: salesLedger, mounts: [{ module: '/src/components/sales/Sales.tsx' }] });
  await expect(page.getByRole('table', { name: 'Invoices' })).toBeVisible();
  await page.getByPlaceholder('Search invoices by customer or number...').focus();
  await visitTwoRows(page, [
    { opener: page.getByRole('button', { name: '1001', exact: true }), heading: 'Invoice 1001', back: 'Back to invoices',
      action: page.getByRole('button', { name: 'Edit invoice 1001' }), label: 'invoice 1001' },
    { opener: page.getByRole('button', { name: '1002', exact: true }), heading: 'Invoice 1002', back: 'Back to invoices',
      action: page.getByRole('button', { name: 'Edit invoice 1002' }), label: 'invoice 1002' },
  ]);
  expect(errors).toEqual([]);
});

test('A-279 customer list: Tab through both profile rows/actions, Enter opens, Escape restores the correct customer opener', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const { errors } = await mountJourney(page, { workspaceId: 'kbd-sales-records', ledger: salesLedger, mounts: [{ module: '/src/components/sales/Sales.tsx' }] });
  await page.getByRole('button', { name: 'Customers', exact: true }).click();
  await page.getByPlaceholder('Search customers by name or email...').focus();
  await visitTwoRows(page, [
    { opener: page.getByRole('button', { name: 'View customer Acme Corp' }), heading: 'Acme Corp', back: 'Back to Customers',
      action: page.getByRole('button', { name: 'Reminders on' }).first(), label: 'Acme profile' },
    { opener: page.getByRole('button', { name: 'View customer Beta LLC' }), heading: 'Beta LLC', back: 'Back to Customers',
      action: page.getByRole('button', { name: 'Reminders on' }).last(), label: 'Beta profile' },
  ]);
  expect(errors).toEqual([]);
});

test('A-279 bill list: Tab through two rows/actions, Enter opens, Escape restores the exact bill opener', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const { errors } = await mountJourney(page, { workspaceId: 'kbd-purchases-records', ledger: purchasesLedger, mounts: [{ module: '/src/components/purchases/Purchases.tsx' }] });
  await page.getByPlaceholder('Search bills...').focus();
  await visitTwoRows(page, [
    { opener: page.getByRole('button', { name: 'Open bill 2001' }), heading: 'Bill 2001', back: 'Back to bills',
      action: page.getByRole('button', { name: 'Edit bill 2001' }), label: 'bill 2001' },
    { opener: page.getByRole('button', { name: 'Open bill 2002' }), heading: 'Bill 2002', back: 'Back to bills',
      action: page.getByRole('button', { name: 'Edit bill 2002' }), label: 'bill 2002' },
  ]);
  expect(errors).toEqual([]);
});

test('A-279 vendor list: Tab through two profile rows/actions, Enter opens, Escape restores the correct vendor opener', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const { errors } = await mountJourney(page, { workspaceId: 'kbd-purchases-records', ledger: purchasesLedger, mounts: [{ module: '/src/components/purchases/Purchases.tsx' }] });
  await page.getByRole('button', { name: 'Vendors (2)' }).click();
  await page.getByPlaceholder('Search vendors...').focus();
  await visitTwoRows(page, [
    { opener: page.getByRole('button', { name: 'View vendor Parts Ltd' }), heading: 'Parts Ltd', back: 'Back to Vendors',
      action: page.getByRole('button', { name: /Edit Category of Parts Ltd/ }), label: 'Parts profile' },
    { opener: page.getByRole('button', { name: 'View vendor Paper Co' }), heading: 'Paper Co', back: 'Back to Vendors',
      action: page.getByRole('button', { name: /Edit Category of Paper Co/ }), label: 'Paper profile' },
  ]);
  expect(errors).toEqual([]);
});
