import { test, expect } from '@playwright/test';

for (const width of [390, 1280]) test(`interface language and Sales primary text switch to Hebrew at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem('ledgerflow-cookie-consent', 'accepted');
    localStorage.setItem('has_seen_onboarding', 'true');
    localStorage.removeItem('lf_language');
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue as Guest', exact: true }).click();
  await page.goto('/#sales');
  await expect(page.getByRole('heading', { name: 'Sales', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Switch interface language to Hebrew' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'he');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'מכירות', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'חשבוניות', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'לקוחות', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'מספר', exact: true })).toBeAttached();
  await expect(page.getByRole('columnheader', { name: 'לקוח', exact: true })).toBeAttached();

  await page.getByRole('button', { name: 'Switch interface language to English' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('heading', { name: 'Sales', exact: true })).toBeVisible();
});
