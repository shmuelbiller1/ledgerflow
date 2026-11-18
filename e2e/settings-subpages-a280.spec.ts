import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { SETTINGS_TABS_REGISTRY } from '../src/config/registry';
import { installSmallSample } from './helpers/sampleFixture';
import { waitForFiniteAnimations } from './support/a11yGate';

/** A-280: scan every *currently registered* Settings page (32, rather than freezing the
 * original task's count of 25). The scope is the active section, not 32 copies of the shell.
 * Do not skip color contrast: it is a serious axe rule, and motion is settled before scanning.
 */
test.use({ reducedMotion: 'reduce' });

for (const width of [1280, 390]) {
  test(`A-280 all Settings sub-pages have no serious/critical axe violations at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    const errors: string[] = [];
    const findings: Array<{ page: string; rule: string; impact: string; targets: string[] }> = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 850 });
    await page.addInitScript(() => {
      localStorage.setItem('isGuest', 'true');
      localStorage.setItem('has_seen_onboarding', 'true');
      localStorage.setItem('ledgerflow-cookie-consent', 'accepted');
    });
    await installSmallSample(page);
    await page.goto('/#settings');
    const sections = page.getByRole('navigation', { name: 'Settings sections' });
    const panel = page.locator('#settings-panel');
    await expect(sections).toBeVisible({ timeout: 30_000 });
    expect(SETTINGS_TABS_REGISTRY.length).toBeGreaterThanOrEqual(25);

    for (const tab of SETTINGS_TABS_REGISTRY) {
      const button = sections.getByRole('button', { name: tab.label.en, exact: true });
      await button.click();
      await expect(button).toHaveAttribute('aria-current', 'page');
      await expect(panel.locator(`[data-settings-section="${tab.id}"]`), `${tab.id}: real section mounted`).toBeVisible();
      await expect(panel.getByText('Loading settings…')).toHaveCount(0);
      await waitForFiniteAnimations(page);
      await expect(panel, `${tab.id}: no error boundary`).not.toContainText('Something went wrong');
      const result = await new AxeBuilder({ page }).include('#settings-panel').analyze();
      for (const violation of result.violations) {
        if (violation.impact !== 'serious' && violation.impact !== 'critical') continue;
        findings.push({ page: tab.id, rule: violation.id, impact: violation.impact,
          targets: violation.nodes.map(node => node.target.join(' ')) });
      }
    }

    await testInfo.attach(`settings-a280-${width}.json`, { body: JSON.stringify(findings, null, 2), contentType: 'application/json' });
    expect(findings, `${width}px: serious/critical findings by registered section`).toEqual([]);
    expect(errors, `${width}px: no uncaught page errors`).toEqual([]);
  });
}
