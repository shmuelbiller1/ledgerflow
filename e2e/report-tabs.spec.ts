import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const theme of ['light', 'dark']) {
  for (const width of [390, 1280]) {
    test(`D-44 grouped report chooser: ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 850 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript(selectedTheme => {
        localStorage.setItem('isGuest', 'true');
        localStorage.setItem('has_seen_onboarding', 'true');
        localStorage.setItem('ledgerflow-cookie-consent', 'accepted');
        localStorage.setItem('lf_theme', selectedTheme);
      }, theme);
      await page.goto('/?report=trial-balance#reports');
      const navigation = page.getByRole('navigation', { name: 'Report pages', exact: true });
      const summary = navigation.locator('summary');
      await expect(summary).toContainText('Report:');
      // Native disclosure is operable with Enter and preserves platform Tab/select handling.
      await summary.focus();
      await page.keyboard.press('Enter');
      const search = navigation.getByLabel('Search reports');
      await expect(search).toBeVisible();
      await search.fill('Balance Sheet');
      const chooser = navigation.getByLabel('Choose report', { exact: true });
      await chooser.selectOption('balance-sheet');
      await expect.poll(() => new URL(page.url()).searchParams.get('report')).toBe('balance-sheet');
      await expect(summary).toContainText('Balance Sheet');
      await search.fill('no-such-report-xyz');
      await expect(navigation.getByRole('status')).toContainText('Clear the search');
      await search.fill('');
      await expect(navigation.getByRole('region', { name: 'Recent reports' }).getByRole('button', { name: 'Balance Sheet', exact: true })).toBeVisible();
      await expect(chooser.locator('optgroup')).toHaveCount(7);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const result = await new AxeBuilder({ page }).include('[data-testid="report-tabs"]').analyze();
      expect(result.violations).toEqual([]);
      await page.screenshot({ path: `test-results/report-picker-${theme}-${width}.png` });
    });
  }
}
