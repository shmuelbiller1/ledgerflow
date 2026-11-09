import { test, expect } from '@playwright/test';

for (const width of [390, 1280]) for (const theme of ['light', 'dark']) {
  test(`report/settings controls keep authored case and plain labels ${width} ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(selectedTheme => {
      localStorage.setItem('isGuest', 'true');
      localStorage.setItem('has_seen_onboarding', 'true');
      localStorage.setItem('ledgerflow-cookie-consent', 'accepted');
      localStorage.setItem('lf_theme', selectedTheme);
    }, theme);
    for (const screen of ['pnl', 'balance-sheet', 'settings']) {
      await page.goto(screen === 'settings' ? '/#settings' : `/?report=${screen}&start=2026-09-01&end=2026-09-30#reports`);
      await expect(page.getByRole('heading', { name: screen === 'settings' ? 'Settings' : 'Reports', exact: true })).toBeVisible();
      const surface = page.locator('.sentence-case-controls');
      if (screen === 'pnl') await expect(page.getByLabel('Reporting period start date')).toBeVisible();
      if (screen === 'balance-sheet') await expect(page.getByRole('heading', { name: 'Assets', exact: true })).toBeVisible();
      if (screen === 'settings') {
        await expect(page.getByRole('heading', { name: 'About settings', exact: true })).toBeVisible();
        await expect(surface).not.toContainText(/Precision Core|Documentation Protocol|topological registries/);
      }
      // Inspect nested labels as well: an uppercase span can override a normal-case button.
      expect(await surface.evaluate(root => [...root.querySelectorAll('button,button *,h1,h1 *,h2,h2 *,h3,h3 *,h4,h4 *,h5,h5 *,h6,h6 *')]
        .filter(el => el.getBoundingClientRect().width && getComputedStyle(el).textTransform === 'uppercase')
        .map(el => el.textContent?.trim()))).toEqual([]);
      // The shared rule also covers a new lazy child with its own uppercase utility.
      expect(await surface.evaluate(root => {
        const button = document.createElement('button');
        button.className = 'uppercase';
        button.innerHTML = '<span class="uppercase">Export CSV</span>';
        root.append(button);
        const result = [getComputedStyle(button).textTransform, getComputedStyle(button.firstElementChild!).textTransform, button.textContent];
        button.remove(); return result;
      })).toEqual(['none', 'none', 'Export CSV']);
    }
    if (width === 1280) {
      const navigation = page.getByRole('navigation', { name: 'Main navigation', exact: true });
      await expect(navigation.getByRole('heading', { name: 'Account totals', exact: true })).toBeVisible();
      await expect(navigation.getByText('Sum of absolute account balances', { exact: true })).toBeVisible();
      await expect(navigation.getByRole('heading', { name: 'Worlds', exact: true })).toHaveCount(0);
    }
  });
}
