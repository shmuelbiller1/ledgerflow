import { test, expect } from '@playwright/test';

test('transaction widths and order align header/rows and persist across reload', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ status: 200, json: {} }));
  await page.addInitScript(() => { localStorage.setItem('isGuest', 'true'); localStorage.setItem('has_seen_onboarding', 'true'); });
  await page.goto('/#transactions');
  // the dev server builds the screen on its first visit, which can outlast the 5 s default on a busy runner
  await expect(page.getByRole('heading', { name: 'Journal Entries' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Columns', exact: true }).click();
  const width = page.getByRole('spinbutton', { name: 'Description width in pixels' });
  await width.fill('320');
  await page.getByRole('button', { name: 'Move Description left' }).click();
  const header = page.getByTestId('tx-header');
  await expect(header.locator(':scope > [data-column]').nth(1)).toHaveAttribute('data-column', 'description');
  const headerCell = header.locator(':scope > [data-column="description"]');
  const firstRowCell = page.locator('[role="presentation"] > [data-column="description"]').first();
  await expect(firstRowCell).toBeVisible();
  await expect.poll(async () => (await headerCell.boundingBox())!.width).toBeCloseTo(320, 0);
  await expect.poll(async () => (await firstRowCell.boundingBox())!.width).toBeCloseTo(320, 0);
  await expect.poll(async () => Math.abs((await headerCell.boundingBox())!.x - (await firstRowCell.boundingBox())!.x)).toBeLessThan(2);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Journal Entries' })).toBeVisible();
  await page.getByRole('button', { name: 'Columns', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Description width in pixels' })).toHaveValue('320');
  await expect(header.locator(':scope > [data-column]').nth(1)).toHaveAttribute('data-column', 'description');
  // Keep a phone's compact cell order despite desktop personalization.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(header.locator(':scope > [data-column]').nth(1)).toHaveAttribute('data-column', 'date');
  await expect(header.locator(':scope > [data-column]')).toHaveCount(4);
  await expect(firstRowCell).toBeVisible();
});
