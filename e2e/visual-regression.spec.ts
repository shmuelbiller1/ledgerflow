import { test, expect } from '@playwright/test';

// Fixed civil date, seeded guest records, real UI and real fonts. Nothing financial is masked.
test.use({ locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'reduce' });
const screens = [
  ['dashboard', '/#dashboard', 'Real-Time Financial Ledger'],
  ['transactions', '/#transactions', 'Journal Entries'],
  ['sales', '/#sales', 'Invoicing & Customer Accounts'],
  ['purchases', '/#purchases', 'Purchases & AP'],
  ['reconcile', '/#reconciliation', 'Smart Matching & Bank Reconciliation'],
  ['pnl', '/?report=pnl&start=2026-09-01&end=2026-09-30&cmp=none#reports', 'Reports'],
  ['balance-sheet', '/?report=balance-sheet&start=2026-09-01&end=2026-09-30&cmp=none#reports', 'Reports'],
  ['settings', '/#settings', 'Settings'],
  ['tasks', '/#tasks', 'Tasks'],
  ['time', '/#time', 'Time'],
] as const;

for (const width of [1280, 390]) for (const theme of ['light', 'dark'] as const) {
  for (const [screen, url, heading] of screens) {
    test(`visual ${screen} ${width === 390 ? 'phone' : 'desktop'} ${theme}`, async ({ page }) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width, height: 850 });
      await page.clock.setFixedTime(new Date('2026-09-30T12:00:00Z'));
      await page.addInitScript(selectedTheme => {
        localStorage.setItem('isGuest', 'true');
        localStorage.setItem('has_seen_onboarding', 'true');
        localStorage.setItem('ledgerflow-cookie-consent', 'accepted');
        localStorage.setItem('lf_theme', selectedTheme);
      }, theme);
      await page.goto(url);
      const main = page.locator('#main-content');
      await expect(main.getByRole('heading', { name: heading, exact: true })).toBeVisible({ timeout: 20_000 });
      await expect.poll(() => page.evaluate(async () => {
        const modulePath = '/src/stores/useLedgerStore.ts';
        const { useLedgerStore } = await import(/* @vite-ignore */ modulePath) as typeof import('../src/stores/useLedgerStore');
        return useLedgerStore.getState().transactions.length;
      })).toBe(2);
      if (screen === 'pnl') await expect(main.getByLabel('Reporting period start date')).toHaveValue('2026-09-01');
      if (screen === 'balance-sheet') await expect(main.getByRole('heading', { name: 'Assets', exact: true })).toBeVisible();
      await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*\bdark\b)/);
      await page.evaluate(() => document.fonts.ready);
      await expect(main).not.toContainText('Something went wrong');
      // The list of report tabs and the shared total-explainer footer are not what these statement shots check.
      await page.addStyleTag({ content: '[data-testid="report-tabs"],[data-testid="report-total-explainer"]{display:none !important}' });
      // The app scrolls inside main, so fullPage alone would clip the report body.
      // Keep the real responsive width and expand only the capture height to fit it.
      if (screen === 'transactions') {
        // A virtual grid grows with its viewport; use a fixed height and require a real row.
        await page.setViewportSize({ width, height: 1600 });
        const descriptions = main.locator('[role="presentation"] > [data-column="description"]');
        await expect(descriptions).toHaveCount(2);
        await expect.poll(async () => {
          const cell = await descriptions.last().boundingBox(), frame = await main.boundingBox();
          return !!cell && !!frame && cell.y >= frame.y && cell.y + cell.height <= frame.y + frame.height;
        }).toBe(true);
      } else for (let attempt = 0; attempt < 3; attempt++) {
        const overflow = await main.evaluate(element => element.scrollHeight - element.clientHeight);
        if (overflow <= 1) break;
        const height = page.viewportSize()!.height + overflow;
        expect(height).toBeLessThan(16_000);
        await page.setViewportSize({ width, height });
      }
      if (screen !== 'transactions') await expect.poll(() => main.evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
      await page.mouse.move(0, 0);
      // A tight absolute pixel allowance catches small regressions even on tall screens.
      await expect(page).toHaveScreenshot(`${screen}-${width}-${theme}.png`, {
        fullPage: true, animations: 'disabled', caret: 'hide', scale: 'css',
        threshold: 0.1, maxDiffPixels: 100,
      });
    });
  }
}
