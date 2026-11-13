/**
 * EU-D2: three phone jobs in two taps, at 390 px, in the sample company.
 * Each journey starts on Home and counts the taps it takes to reach the job.
 */
import { test, expect, type Page } from '@playwright/test';

async function openHome(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem('isGuest', 'true');
    localStorage.setItem('has_seen_onboarding', 'true');
    localStorage.setItem('ledgerflow-cookie-consent', 'accepted');
  });
  await page.goto('/#dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible({ timeout: 15_000 });
  return page.getByRole('navigation', { name: 'Phone navigation' });
}

const noSidewaysScroll = (page: Page) =>
  expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);

test('EU-D2: send an invoice — New, Invoice (2 taps)', async ({ page }) => {
  const nav = await openHome(page);
  await nav.getByRole('button', { name: 'New', exact: true }).click(); // tap 1
  await page.getByRole('dialog').getByRole('button', { name: 'Invoice', exact: true }).click(); // tap 2
  const form = page.getByRole('dialog');
  await expect(form).toHaveCount(1);
  await expect(form.getByText(/invoice/i).first()).toBeVisible();
  await noSidewaysScroll(page);
});

test('EU-D2: snap a receipt — New, Snap a receipt (2 taps)', async ({ page }) => {
  const nav = await openHome(page);
  await nav.getByRole('button', { name: 'New', exact: true }).click(); // tap 1
  await page.getByRole('dialog').getByRole('button', { name: 'Snap a receipt', exact: true }).click(); // tap 2
  const dialog = page.getByRole('dialog', { name: 'Snap a receipt' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Take or choose a photo')).toBeVisible();
  const box = (await dialog.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(391);
  await noSidewaysScroll(page);
});

test('EU-D2: see who owes money — Home, Owed to you (2 taps from any screen)', async ({ page }) => {
  const nav = await openHome(page);
  await nav.getByRole('button', { name: 'Reports', exact: true }).click(); // somewhere else first
  await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible({ timeout: 15_000 });
  await nav.getByRole('button', { name: 'Home', exact: true }).click(); // tap 1
  const owed = page.locator('[data-summary-report="ar-aging"]');
  await expect(owed).toContainText('Owed to you', { timeout: 15_000 });
  await expect(owed).toBeInViewport();
  const box = (await owed.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  await owed.click(); // tap 2
  await expect(page).toHaveURL(/ar-aging/);
  await expect(page.locator('#main-content').getByText(/Who owes me/).first()).toBeVisible({ timeout: 15_000 });
  await noSidewaysScroll(page);
});
