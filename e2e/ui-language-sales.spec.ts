import { test, expect } from '@playwright/test';

for (const width of [390, 1280]) test(`Accessibility & language sets Hebrew and Sales uses RTL at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem('ledgerflow-cookie-consent', 'accepted');
    localStorage.setItem('has_seen_onboarding', 'true');
    localStorage.removeItem('lf_language');
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue as Guest', exact: true }).click();
  await page.goto('/#help');
  await page.getByRole('button', { name: 'Accessibility & language', exact: true }).click();
  await page.getByRole('button', { name: 'עברית', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'he');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'he');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  await page.goto('/#sales');
  await expect(page.getByRole('heading', { name: 'מכירות', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'חשבוניות', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'לקוחות', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'מספר', exact: true })).toBeAttached();
  await expect(page.getByRole('columnheader', { name: 'לקוח', exact: true })).toBeAttached();

  await page.goto('/#help');
  await page.getByRole('button', { name: 'Accessibility & language', exact: true }).click();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});
