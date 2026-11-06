import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const reports = [
  { id: 'tax-code-suggestions', name: 'Tax Code Suggestions', heading: /Tax code suggestions from history/i },
  { id: 'entity-filings', name: 'Entity Filings Calendar', heading: /Entity filings calendar/i },
  { id: 'israeli-document-types', name: 'Israeli Document Types', heading: /Israeli document types/i },
  { id: 'us-1099-preview', name: 'US 1099 Preview', heading: /US 1099 Preview/i },
  { id: 'us-filing-calendar', name: 'US Filing Calendar', heading: /US Sales Tax Filing Calendar/i },
];

for (const width of [1280, 390]) {
  for (const theme of ['light', 'dark']) {
    test(`C-120/C-115/C-117/C-121/C-122 ${width}px ${theme} — all five wired tax libraries reachable as reports`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(theme => {
        localStorage.setItem('isGuest', 'true');
        localStorage.setItem('has_seen_onboarding', 'true');
        localStorage.setItem('ledgerflow-cookie-consent', 'accepted');
        localStorage.setItem('lf_theme', theme);
      }, theme);
      await page.route('**/api/**', route => route.fulfill({ json: {} }));
      await page.route('**/rest/v1/**', route => route.fulfill({ json: [] }));
      await page.goto('/#reports');
      await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${theme}\\b`));
      await page.waitForSelector('[data-testid="reports-heading"]', { timeout: 15000 });
      // Basic Reports UI present
      await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible();

      const nav = page.getByRole('navigation', { name: 'Report pages', exact: true });
      const details = nav.locator('details');
      await expect(details).toBeVisible({ timeout: 10000 });
      const chooseReport = async (label: string) => {
        if (!(await details.evaluate((el: HTMLDetailsElement) => el.open))) {
          await details.locator('summary').click();
        }
        await nav.getByLabel('Choose report', { exact: true }).selectOption({ label });
      };

      for (const r of reports) {
        await chooseReport(r.name);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.waitForFunction(() => document.getAnimations().length === 0, { timeout: 700 });
        // Each report's h2 present
        await expect(page.getByRole('heading', { name: r.heading }).first()).toBeVisible({ timeout: 5000 });
        // Ensure no horizontal overflow
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        const box = await details.locator('summary').boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }

      // Specific interaction: Tax Code Suggestions empty state
      await chooseReport('Tax Code Suggestions');
      await expect(page.getByText(/Tax code suggestions from history/i)).toBeVisible();
      await expect(page.getByText(/calculation status only/i).first()).toBeVisible();

      // US Filing Calendar shows 51 states
      await chooseReport('US Filing Calendar');
      await expect(page.getByText(/51 rows \(50 \+ DC\)/i).first()).toBeVisible();
      const stateInput = page.getByLabel('State (code or name)');
      await stateInput.fill('TX');
      await expect(page.getByRole('table')).toContainText('TX');
      await stateInput.fill('');

      // Israeli Document Types: change lifecycle to draft shows Not issued
      await chooseReport('Israeli Document Types');
      await expect(page.getByText(/חשבונית מס/i).first()).toBeVisible();
      await page.getByLabel('Lifecycle').selectOption('draft');
      await expect(page.getByText(/Not issued:/i)).toBeVisible();

      // US 1099 Preview: threshold and NOT IRIS visible
      await chooseReport('US 1099 Preview');
      await expect(page.getByText(/NOT IRIS/i).first()).toBeVisible();

      // Entity Filings: due table caption
      await chooseReport('Entity Filings Calendar');
      await expect(page.getByText(/Due filings/i)).toBeVisible();

      // Screenshot for verification
      const active = page.locator('section[aria-label]').last();
      await active.screenshot({ path: test.info().outputPath(`tax-wiring-${width}-${theme}.png`) });

      // Axe on reports nav
      const results = await new AxeBuilder({ page }).include('[role="navigation"][aria-label="Report pages"]').analyze();
      const critical = results.violations.filter(v => ['critical', 'serious'].includes(v.impact || ''));
      expect(critical.length).toBe(0);
    });
  }
}
