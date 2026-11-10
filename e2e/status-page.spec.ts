import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import { BRAND_NAME } from '../src/config/brand';
/**
 * Status page (L-17): /status opens without signing in, asks the real server, lists each part
 * of LedgerFlow, and has no accessibility violations.
 */
test('status page works without sign-in', async ({ page }) => {
  await page.goto('/status');
  await expect(page.getByRole('heading', { name: 'System status' })).toBeVisible();
  await expect(page.getByRole('list', { name: `Parts of ${BRAND_NAME}` })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Database', { exact: true })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map(v => v.id)).toEqual([]);
});
