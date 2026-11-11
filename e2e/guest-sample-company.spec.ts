import { test, expect } from '@playwright/test';

for (const width of [390, 1280]) test(`EU-A1 guest can save a local invoice and exit discards it ${width}px`, async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem('ledgerflow-cookie-consent', 'accepted');
    localStorage.setItem('has_seen_onboarding', 'true');
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue as Guest', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Sample company' })).toContainText('Sample company — sign up to keep your own');
  const writes: string[] = [];
  page.on('request', request => {
    if (/\/api\/|\/rest\/v1\/|\/storage\/v1\//.test(request.url())) writes.push(request.url());
  });
  const create = width === 390 ? page.getByRole('navigation', { name: 'Phone navigation' }).getByRole('button', { name: 'New', exact: true }) : page.locator('header').getByRole('button', { name: 'New', exact: true });
  await create.click();
  await page.getByRole('button', { name: 'Invoice', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New invoice', exact: true });
  await dialog.getByLabel('Customer', { exact: true }).fill('Sample-only customer');
  await dialog.getByLabel('Invoice Date', { exact: true }).fill('2026-12-31');
  await dialog.getByLabel('Item / Description', { exact: true }).fill('Browser-only consulting');
  await dialog.getByLabel(/^Rate/).fill('120');
  await dialog.getByRole('button', { name: 'Save Draft', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('#main-content')).toContainText('Sample-only customer');
  await page.reload();
  // Reload waits for navigation, not for auth/bootstrap and the lazy application shell.
  await page.locator('#main-content').waitFor({ state: 'visible', timeout: 15_000 });
  await expect(page.locator('#main-content')).toContainText('Sample-only customer');
  // The bootstrap guard also fails closed for a future API-only action (not just today's forms).
  const blocked = await page.evaluate(async () => {
    try { await fetch('/api/v1/must-not-leave-the-demo', { method: 'POST', body: 'sample-only record' }); return false; }
    catch (error) { return String(error).includes('Nothing was sent'); }
  });
  expect(blocked).toBe(true);
  expect(writes).toEqual([]);
  await page.getByText('Sample-only customer', { exact: true }).first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `/tmp/ai14-guest-invoice-${width}.png` });
  await page.getByRole('status', { name: 'Sample company' }).getByRole('button', { name: 'Sign up', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continue as Guest', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continue as Guest', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Sample company' })).toBeVisible();
  await page.goto('/#sales');
  await expect(page.getByRole('heading', { name: 'Sales', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Sample-only customer', exact: true })).toHaveCount(0);
});

for (const width of [390, 1280]) test(`EU-A1 bill draft stays local across refresh ${width}px`, async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(() => { localStorage.setItem('has_seen_onboarding', 'true'); localStorage.setItem('ledgerflow-cookie-consent', 'accepted'); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue as Guest', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Sample company' })).toBeVisible();
  const requests: string[] = [];
  page.on('request', request => { if (/\/api\/|\/rest\/v1\/|\/storage\/v1\//.test(request.url())) requests.push(request.url()); });
  const create = width === 390 ? page.getByRole('navigation', { name: 'Phone navigation' }).getByRole('button', { name: 'New', exact: true }) : page.locator('header').getByRole('button', { name: 'New', exact: true });
  await create.click();
  await page.getByRole('button', { name: 'Bill', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Record New Bill', exact: true });
  await dialog.getByLabel('Vendor', { exact: true }).selectOption({ index: 1 });
  await dialog.getByLabel('Bill Date', { exact: true }).fill('2026-12-31');
  await dialog.getByLabel('Description', { exact: true }).fill('Browser-only supplies');
  await dialog.getByLabel('Expense Account', { exact: true }).selectOption({ label: 'Cost of Goods Sold' });
  await dialog.getByLabel(/^Amount \(/).fill('45');
  await dialog.getByRole('button', { name: 'Save Draft', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const edit = page.getByRole('button', { name: /^Edit bill SAMPLE-BILL-/ }).first();
  await expect(edit).toBeVisible();
  const label = await edit.getAttribute('aria-label');
  const number = label!.replace('Edit bill ', '');
  await page.reload();
  await page.getByRole('button', { name: `Edit bill ${number}`, exact: true }).click();
  const saved = page.getByRole('dialog', { name: `Edit bill ${number}`, exact: true });
  await expect(saved.getByLabel('Description', { exact: true })).toHaveValue('Browser-only supplies');
  await expect(saved.getByLabel(/^Amount \(/)).toHaveValue('45');
  expect(requests).toEqual([]);
});
