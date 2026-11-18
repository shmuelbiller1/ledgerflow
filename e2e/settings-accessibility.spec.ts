import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { SETTINGS_TABS_REGISTRY } from '../src/config/registry';
import { waitForFiniteAnimations } from './support/a11yGate';

test.use({ reducedMotion: 'reduce' });

for (const width of [1280, 390]) {
  // Batch adjacent pages to reuse the real app shell without making one all-or-nothing test.
  for (let offset = 0; offset < SETTINGS_TABS_REGISTRY.length; offset += 8) {
    const pages = SETTINGS_TABS_REGISTRY.slice(offset, offset + 8);
    test(`A-280 Settings axe at ${width}px: ${pages[0].id} through ${pages.at(-1)!.id}`, async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height: 850 });
      await page.addInitScript(() => {
        localStorage.setItem('isGuest', 'true');
        localStorage.setItem('has_seen_onboarding', 'true');
        localStorage.setItem('ledgerflow-cookie-consent', 'accepted');
        localStorage.setItem('lf_theme', 'light');
      });
      await page.goto('/#settings');
      const nav = page.getByRole('navigation', { name: 'Settings sections', exact: true });
      await expect(nav.getByRole('button')).toHaveCount(SETTINGS_TABS_REGISTRY.length);
      for (const setting of pages) await test.step(setting.label.en, async () => {
        const tab = nav.getByRole('button', { name: setting.label.en, exact: true });
        await tab.click();
        await expect(tab).toHaveAttribute('aria-current', 'page');
        const panel = page.getByRole('region', { name: `${setting.label.en} settings`, exact: true });
        const content = panel.locator(`[data-settings-page="${setting.id}"]`);
        await expect(content).toBeVisible();
        await expect(content.locator('[data-report-skeleton]:visible')).toHaveCount(0);
        await expect(content).not.toContainText('Something went wrong');
        await waitForFiniteAnimations(page);

        const { violations } = await new AxeBuilder({ page }).analyze();
        const serious = violations.filter(({ impact }) => impact === 'serious' || impact === 'critical');
        if (serious.length) await testInfo.attach(`axe-${setting.id}-${width}`, { body: JSON.stringify(serious, null, 2), contentType: 'application/json' });
        expect.soft(serious.map(({ id, nodes }) => ({ id, nodes: nodes.map(node => node.target.join(' ')) })),
          `${setting.label.en} at ${width}px has no serious/critical axe violations`).toEqual([]);
      });
    });
  }
}
