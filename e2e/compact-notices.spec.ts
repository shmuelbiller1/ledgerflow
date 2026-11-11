import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const width of [390, 1280]) for (const theme of ['light', 'dark']) {
  test(`sample notice ${width} ${theme}: single, reachable and persistent until exit`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.addInitScript(selectedTheme => {
      localStorage.setItem('isGuest', 'true');
      localStorage.setItem('has_seen_onboarding', 'true');
      localStorage.setItem('ledgerflow-cookie-consent', 'accepted');
      localStorage.setItem('lf_theme', selectedTheme);
    }, theme);
    await page.goto('/#dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
    const notice = page.getByRole('status', { name: 'Sample company', exact: true });
    await expect(notice).toHaveCount(1);
    await expect(notice).toContainText('Sample company — sign up to keep your own');
    await expect(page.locator('#ledger-backup-reminder-banner')).toHaveCount(0);
    await expect(page.getByTestId('desktop-demo-notice')).toHaveCount(0);
    const box = (await notice.boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(72);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    const signup = notice.getByRole('button', { name: 'Sign up', exact: true });
    const target = (await signup.boundingBox())!;
    expect(target.height).toBeGreaterThanOrEqual(44);
    expect(target.width).toBeGreaterThanOrEqual(44);
    const axe = await new AxeBuilder({ page }).include('[aria-label="Sample company"]').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(axe.violations).toEqual([]);
    await page.reload();
    await expect(notice).toBeVisible();
    await signup.focus();
    await page.keyboard.press('Enter');
    await expect(notice).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Continue as Guest', exact: true })).toBeVisible();
  });
}
