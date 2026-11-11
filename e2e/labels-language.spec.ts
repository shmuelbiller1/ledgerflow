import { test, expect } from '@playwright/test';
import { mountJourney, settleStyles } from './support/journeyFixture';
for (const width of [390, 1280]) for (const theme of ['light', 'dark']) {
  test(`EU-E1 Labels vocabulary ${width}px ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const module of ['/src/components/platform/settings/DimensionsSettings.tsx', '/src/components/platform/settings/TagsSettings.tsx']) {
      await mountJourney(page, { workspaceId: 'eu-labels', ledger: {}, mounts: [{ module }], api: () => ({ json: { data: { tags: [] } } }) });
      await page.evaluate(theme => { document.documentElement.className = theme; }, theme);
      await settleStyles(page);
      const heading = module.includes('Dimensions') ? 'Labels' : 'Tags';
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
      await expect(page.getByText('Labels group line amounts in reports; tags help you find records.')).toBeVisible();
      await expect(page.locator('body')).not.toContainText(/Dimensions|Label Node|Dimension Axis|World \/ Entity|Dimensional Type/);
      if (heading === 'Labels') {
        await page.getByRole('button', { name: 'Add label', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Add label', exact: true })).toBeVisible();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  });
}
