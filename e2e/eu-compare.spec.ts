import { test, expect } from '@playwright/test';
import { installSmallSample } from './helpers/sampleFixture';

// EU-E8: Reports → Compare (report 'compare', view 'CompareReportView') opens and keeps a named layout.
test('Compare opens under Reports and saves a layout at 390 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  await installSmallSample(page);
  await page.goto('/?report=compare#reports');
  const main = page.locator('#main-content');
  await expect(main.getByRole('heading', { name: 'Compare', exact: true })).toBeVisible({ timeout: 20_000 });
  await main.getByLabel('Layout name').fill('By payee');
  await main.getByRole('button', { name: 'Save layout' }).click();
  await expect(main.getByLabel('Saved layout')).toContainText('By payee');
});
