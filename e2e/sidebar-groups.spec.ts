import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.use({ reducedMotion: 'reduce' });

for (const width of [390, 1280]) for (const theme of ['light', 'dark']) {
  test(`sidebar groups preserve routes and keyboard access ${width} ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 850 });
    await page.clock.setFixedTime(new Date('2026-09-30T12:00:00Z'));
    await page.addInitScript(selectedTheme => {
      localStorage.setItem('isGuest', 'true'); localStorage.setItem('has_seen_onboarding', 'true');
      localStorage.setItem('ledgerflow-cookie-consent', 'accepted'); localStorage.setItem('lf_theme', selectedTheme);
    }, theme);
    await page.goto('/#dashboard');
    await expect(page.getByRole('heading', { name: 'Real-Time Financial Ledger', exact: true })).toBeVisible();
    if (width < 1024) await page.getByRole('button', { name: 'Open navigation menu', exact: true }).click();
    const nav = page.getByRole('navigation', { name: 'Main navigation', exact: true });
    for (const [section, labels] of [
      ['Daily work', ['Dashboard', 'Transactions', 'Reconcile']],
      ['Sales and purchases', ['Money In', 'Money Out']],
      ['Reports and settings', ['Reports', 'Settings']],
    ] as const) {
      const group = nav.getByRole('region', { name: section, exact: true });
      await expect(group.getByRole('button')).toHaveCount(labels.length);
      for (const label of labels) {
        const button = group.getByRole('button', { name: label, exact: true });
        await expect(button).toHaveAttribute('title', label);
        expect(Number((await button.boundingBox())!.height.toFixed(3))).toBeGreaterThanOrEqual(44);
      }
    }
    await expect(nav.getByRole('button', { name: 'Dashboard', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('heading', { name: 'Account totals', exact: true })).toHaveCount(1);
    await expect(nav.getByText('Sum of absolute account balances', { exact: true })).toHaveCount(1);
    await expect(nav.getByText('Worlds', { exact: true })).toHaveCount(0);
    const scan = await new AxeBuilder({ page }).include('[aria-label="Main navigation"]').analyze();
    expect(scan.violations.filter(v => ['serious', 'critical'].includes(v.impact || ''))).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`sidebar-${width}-${theme}.png`) });
    // The existing page IDs and labels remain usable by pointer, keyboard and page pins.
    const sales = nav.getByTestId('nav-sales'); await sales.focus(); await sales.press('Enter');
    await expect(page).toHaveURL(/#sales$/);
    await expect(nav.getByRole('button', { name: 'Money In', exact: true })).toHaveAttribute('aria-current', 'page');
    const search = nav.getByRole('button', { name: 'Search pages', exact: true });
    await expect(search).toHaveAttribute('title', 'Search pages (Ctrl/⌘+K)');
    await search.focus(); await search.press('Enter');
    const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
    await expect(palette).toHaveCount(1); await expect(palette.getByRole('textbox', { name: 'Search commands or enter a transaction', exact: true })).toBeFocused(); await page.keyboard.press('Escape'); await expect(palette).toHaveCount(0);
    if (width >= 1024) {
      await page.evaluate(async () => {
        const modulePath = '/src/stores/useUIStore.ts';
        const { useUIStore } = await import(/* @vite-ignore */ modulePath) as typeof import('../src/stores/useUIStore');
        useUIStore.getState().setSidebarOpen(false);
      });
      const reports = nav.getByRole('button', { name: 'Reports', exact: true });
      await expect(reports).toHaveAttribute('title', 'Reports');
      await reports.focus(); await reports.press('Enter'); await expect(page).toHaveURL(/#reports$/);
      await expect(reports).toHaveAttribute('aria-current', 'page');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
