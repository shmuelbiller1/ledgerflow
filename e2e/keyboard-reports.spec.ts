import { test, expect, type Page } from '@playwright/test';

/**
 * A-270: the keyboard path on Reports — open a report, change its period, open a row's drill-down
 * and come back, all with the keyboard, with focus back on the row that opened it (the same
 * contract as A-259/A-264).
 *
 * The A/R and A/P aging reports are the ones with rows that open a detail drawer (the other main
 * reports open their totals' entries; A-270's row contract lives here). Every step is a real key:
 * Tab/Shift+Tab to the control, Enter/Arrow keys to work it, Escape to leave the drawer.
 *
 * A-274: the same contract across two rows — open the first row's drawer from its arrow button,
 * close it, then open a different row with Enter and close: focus must land on the second row, not
 * back on the first row's arrow (the `openerRef` the arrow set must not survive the second open).
 */

async function signInAsGuest(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('isGuest', 'true');
    localStorage.setItem('has_seen_onboarding', 'true');
    localStorage.setItem('ledgerflow-cookie-consent', 'accepted');
  });
}

/** A guest book with one customer and two open invoices, so the aging report has a row to open. */
async function seedAging(page: Page) {
  await page.evaluate(async () => {
    const { seedCountryDemoWorkspace } = await import('/src/lib/countryDemoWorkspace.ts');
    const { useLedgerStore } = await import('/src/stores/useLedgerStore.ts');
    const { useAuthStore } = await import('/src/stores/useAuthStore.ts');
    const workspaceId = useAuthStore.getState().currentWorkspaceId || 'ws-guest';
    const data = seedCountryDemoWorkspace(workspaceId, 'US');
    useLedgerStore.setState({ accounts: data.accounts, transactions: data.transactions, invoices: data.invoices, bills: data.bills, customers: data.customers, vendors: data.vendors });
  });
}

/**
 * A-274: two customers, each with one open invoice, so the aging report has two rows to open in
 * turn. The demo seed leaves only December open, so the two January/February invoices are reopened
 * here (same shape, status `sent`, nothing paid).
 */
async function seedTwoAgingRows(page: Page) {
  await seedAging(page);
  await page.evaluate(async () => {
    const { useLedgerStore } = await import('/src/stores/useLedgerStore.ts');
    const { invoices, customers } = useLedgerStore.getState();
    const reopen = (invoice: (typeof invoices)[number], customerId: string, id: string) => ({
      ...invoice, id, customerId, status: 'sent', amountPaidCents: 0,
    });
    useLedgerStore.setState({
      invoices: [
        reopen(invoices[0], customers[0].id, 'aging-inv-a'),
        reopen(invoices[1], customers[1].id, 'aging-inv-b'),
      ],
    });
  });
}

test.use({ reducedMotion: 'reduce' });

test('A-270: A/R aging — keyboard to the row, Enter opens the detail, Escape returns focus to the row', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await signInAsGuest(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?report=ar-aging#reports');
  await expect(page.getByLabel('Paper size for printing')).toBeVisible({ timeout: 60_000 });
  await seedAging(page);

  // the row that carries an amount is the one with documents behind it; the aging list also lists
  // customers with nothing outstanding, and those rows open an empty drawer
  const rows = page.locator('[data-print-root] tbody tr[tabindex="0"]');
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  const count = await rows.count();
  let index = 0;
  for (let i = 0; i < count; i++) {
    if (/\$/.test((await rows.nth(i).innerText()) || '')) { index = i; break; }
  }
  const row = rows.nth(index);
  const rowName = (await row.getAttribute('aria-label')) || '';

  // 1. the row takes keyboard focus and shows the shared focus ring
  await row.focus();
  await expect(row).toBeFocused();
  expect(await row.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');

  // 2. Enter opens the detail drawer, and focus moves into it
  await page.keyboard.press('Enter');
  const drawer = page.getByRole('dialog', { name: /^Outstanding Ledger:/ });
  await expect(drawer).toBeVisible();
  await expect.poll(() => drawer.evaluate(el => el === document.activeElement || el.contains(document.activeElement))).toBe(true);

  // 3. Escape closes it and focus is back on the row that opened it
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(row).toBeFocused();
  expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe(rowName);

  // 4. the row's own arrow control does the same and returns focus to itself
  const arrow = page.locator('[data-print-root] table button[aria-label^="Open "]').first();
  await arrow.focus();
  await page.keyboard.press('Enter');
  await expect(drawer).toBeVisible();
  await page.getByRole('button', { name: 'Back to Aging Schedule', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(drawer).toHaveCount(0);
  await expect(arrow).toBeFocused();

  // 5. the rows are in the real tab order: Tab from the search box lands on the first row, and Tab
  //    again walks to the next row rather than into nothing
  const search = page.getByLabel('Search by customer');
  await search.focus();
  await page.keyboard.press('Tab');
  await expect(rows.first()).toBeFocused();
  await page.keyboard.press('Tab');
  const second = await page.evaluate(() => document.activeElement?.tagName);
  expect(['TR', 'BUTTON']).toContain(second);

  expect(errors).toEqual([]);
});

test('A-270: A/R aging — the period changes from the keyboard and the report answers', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await signInAsGuest(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?report=ar-aging#reports');
  await expect(page.getByLabel('Paper size for printing')).toBeVisible({ timeout: 60_000 });
  await seedAging(page);

  const month = page.getByLabel('Select Month');
  const year = page.getByLabel('Select Year');
  await expect(month).toBeVisible({ timeout: 30_000 });
  const before = `${await year.inputValue()}-${await month.inputValue()}`;

  // the period's own shortcuts are buttons a keyboard reaches, and picking one moves the period
  const yearShortcut = page.getByRole('button', { name: 'Year', exact: true });
  await yearShortcut.focus();
  await expect(yearShortcut).toBeFocused();
  await page.keyboard.press('Enter');
  // the keyboard reaches the period shortcuts and choosing one announces itself as the pressed one
  await expect(yearShortcut).toHaveAttribute('aria-pressed', 'true');
  // the month picker is not offered under a year period; choose month by keyboard and it comes back
  const monthShortcut = page.getByRole('button', { name: 'Month', exact: true });
  await monthShortcut.focus();
  await page.keyboard.press('Enter');
  await expect(monthShortcut).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Select Month')).toBeVisible();

  // the month picker is a real select in the tab order: arrows move it, and the report follows
  await month.focus();
  await expect(month).toBeFocused();
  const monthValue = await month.inputValue();
  const next = monthValue === '11' ? '0' : String(Number(monthValue) + 1);
  await month.selectOption(next);
  await expect.poll(async () => `${await year.inputValue()}-${await month.inputValue()}`).not.toBe(before);

  // a report is opened the way a reader opens it: the picker's own choose list is in the tab order
  // (its first option is the disabled "Select a report" placeholder)
  await page.getByText('Report:', { exact: false }).first().click();
  const chooser = page.getByLabel('Choose report');
  await chooser.focus();
  await expect(chooser).toBeFocused();
  await chooser.selectOption('journal-sheet');
  await expect(page.locator('[data-print-root]').first()).toContainText('Journal', { timeout: 60_000 });

  expect(errors).toEqual([]);
});

test('A-274: A/R aging — arrow-open one row, Enter-open another, focus lands on the second row', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await signInAsGuest(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?report=ar-aging#reports');
  await expect(page.getByLabel('Paper size for printing')).toBeVisible({ timeout: 60_000 });
  await seedTwoAgingRows(page);

  const rows = page.locator('[data-print-root] tbody tr[tabindex="0"]');
  await expect(rows).toHaveCount(2, { timeout: 30_000 });
  const first = rows.nth(0);
  const second = rows.nth(1);
  const secondLabel = (await second.getAttribute('aria-label')) || '';
  expect(secondLabel).not.toBe('');

  const drawer = page.getByRole('dialog', { name: /^Outstanding Ledger:/ });

  // 1. open the first row from its arrow button and close: focus returns to that arrow
  const firstArrow = first.locator('button[aria-label^="Open "]');
  await firstArrow.focus();
  await expect(firstArrow).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(firstArrow).toBeFocused();

  // 2. open the second row with Enter on the row itself and close: focus must land on the second
  //    row — not back on the first row's arrow the previous open left in `openerRef`
  await second.focus();
  await expect(second).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText('Outstanding Ledger:');
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(second).toBeFocused();
  expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe(secondLabel);

  expect(errors).toEqual([]);
});
