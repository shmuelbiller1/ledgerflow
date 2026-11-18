import { tabTo } from './support/tabTo';
import { installSmallSample } from './helpers/sampleFixture';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.use({ reducedMotion: 'reduce' });

for (const width of [390, 1280]) for (const theme of ['light', 'dark']) {
  test(`sidebar groups preserve routes and keyboard access ${width} ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 850 });
    await page.clock.setFixedTime(new Date('2026-09-30T12:00:00Z'));
    const he = (width === 390) === (theme === 'light');
    await page.addInitScript(({ theme, he }) => {
      localStorage.setItem('isGuest', 'true'); localStorage.setItem('has_seen_onboarding', 'true');
      localStorage.setItem('ledgerflow-cookie-consent', 'accepted'); localStorage.setItem('lf_theme', theme);
      localStorage.setItem('lf_language', he ? 'he' : 'en');
    }, { theme, he });
    await installSmallSample(page);
    await page.goto('/#dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
    const opener = page.getByRole('button', { name: 'Open navigation menu', exact: true });
    if (width < 1024) { await tabTo(page, opener); await page.keyboard.press('Enter'); }
    const nav = page.getByRole('navigation', { name: 'Main navigation', exact: true });
    const daily = nav.getByRole('navigation', { name: 'Daily tools', exact: true });
    const labels = he ? ['סקירה', 'לסקירה', 'מכירות', 'רכישות', 'בנק', 'דוחות', 'הגדרות'] : ['Overview', 'To review', 'Sales', 'Purchases', 'Bank', 'Reports', 'Settings'];
    await expect(daily.getByRole('button')).toHaveCount(labels.length);
    for (const label of labels) {
      const button = daily.getByRole('button', { name: label, exact: true });
      await expect(button).toHaveAttribute('title', label);
      expect(Number((await button.boundingBox())!.height.toFixed(3))).toBeGreaterThanOrEqual(44);
    }
    await expect(daily.getByRole('button', { name: labels[0], exact: true })).toHaveAttribute('aria-current', 'page');
    // D-92 named the box after what it shows and explained the figure; the old "Account totals"
    // heading and its unexplained "sum of absolute balances" line are gone.
    await expect(nav.getByRole('heading', { name: 'Balances by account type', exact: true })).toHaveCount(1);
    await expect(nav.getByText('The total of every account in each type, as recorded in your books. The balance sheet shows the detail.', { exact: true })).toHaveCount(1);
    await expect(nav.getByText('Worlds', { exact: true })).toHaveCount(0);
    const scan = await new AxeBuilder({ page }).include('[aria-label="Main navigation"]').analyze();
    expect(scan.violations.filter(v => ['serious', 'critical'].includes(v.impact || ''))).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`sidebar-${width}-${theme}.png`) });
    // The existing page IDs and labels remain usable by pointer, keyboard and page pins.
    const sales = nav.getByRole('button', { name: labels[2], exact: true });
    await tabTo(page, sales, width < 1024); await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#sales$/);
    await expect(page.locator('#main-content').getByRole('heading', { name: labels[2], exact: true })).toBeVisible();
    if (width < 1024) {
      await expect(nav).toBeHidden();
      await expect(page.locator('#main-content')).toBeFocused();
      await tabTo(page, opener, true); await page.keyboard.press('Enter');
    }
    await expect(sales).toHaveAttribute('aria-current', 'page');
    const search = nav.getByRole('button', { name: 'Search pages', exact: true });
    await expect(search).toHaveAttribute('title', 'Search pages (Ctrl/⌘+K)');
    await tabTo(page, search); await page.keyboard.press('Enter');
    const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
    await expect(palette).toHaveCount(1); await expect(palette.getByRole('textbox', { name: 'Search commands or enter a transaction', exact: true })).toBeFocused(); await page.keyboard.press('Escape'); await expect(palette).toHaveCount(0);
    if (width >= 1024) {
      await page.evaluate(async () => {
        const modulePath = '/src/stores/useUIStore.ts';
        const { useUIStore } = await import(/* @vite-ignore */ modulePath) as typeof import('../src/stores/useUIStore');
        useUIStore.getState().setSidebarOpen(false);
      });
      const reports = nav.getByRole('button', { name: labels[5], exact: true });
      await expect(reports).toHaveAttribute('title', labels[5]);
      await tabTo(page, reports); await page.keyboard.press('Enter'); await expect(page).toHaveURL(/#reports$/);
      await expect(reports).toHaveAttribute('aria-current', 'page');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
