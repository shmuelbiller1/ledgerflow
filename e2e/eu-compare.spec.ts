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

// EU-E6: Reports → One label value (report 'label-value', view 'LabelValuePageView') opens on a phone.
test('One label value opens under Reports at 390 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  await installSmallSample(page);
  await page.goto('/?report=label-value#reports');
  await expect(page.locator('#main-content')).toContainText(/Profit this year|No labels yet|No values for this label yet/, { timeout: 20_000 });
});
