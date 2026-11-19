import { test, expect } from '@playwright/test';

/**
 * R-6: the year-end pack ('year-end-pack', component 'YearEndPackView') opens in a real browser as a guest,
 * shows its sections and offers the report behind each one, at phone and desktop widths.
 */
for (const width of [390, 1280]) test(`the year-end pack opens with its sections at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem('ledgerflow-cookie-consent', 'accepted');
    localStorage.setItem('has_seen_onboarding', 'true');
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue as Guest', exact: true }).click();
  await page.goto('/?report=year-end-pack#reports');

  await expect(page.getByRole('heading', { name: 'Year-end pack', exact: true })).toBeVisible({ timeout: 15000 });
  for (const id of ['profit-and-loss', 'balance-sheet', 'trial-balance', 'receivables', 'payables', 'fixed-assets', 'closing']) {
    await expect(page.locator(`[data-year-end-section="${id}"]`)).toBeVisible();
  }
  await expect(page.locator('[data-year-end-checks]')).toBeVisible();
});
