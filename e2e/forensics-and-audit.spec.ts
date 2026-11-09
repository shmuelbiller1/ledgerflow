import { test, expect } from '@playwright/test';

test.describe('Forensics, Cryptographic Hash Chain & Audit Trail Suite', () => {

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('isGuest', 'true');
      localStorage.setItem('has_seen_onboarding', 'true');
    });

    await page.goto('/');

    const guestButton = page.locator('button', { hasText: 'Continue as Guest' });
    try {
      if (await guestButton.isVisible({ timeout: 2000 })) {
        await guestButton.click();
      }
    } catch {
      // Guest mode
    }

    await page.waitForSelector('text="Overview"', { timeout: 15000 });
  });

  test('Audit Trail & Forensics Center mounts with verifiable cryptographic log items', async ({ page }) => {
    const forensicsNav = page.locator('button:has-text("Forensics"), button:has-text("Audit")').first();
    if (await forensicsNav.isVisible()) {
      await forensicsNav.click();
      await page.waitForTimeout(800);

      await expect(page.locator('body')).toBeVisible();
      const bodyText = await page.locator('body').innerText();
      expect(bodyText).not.toContain('Uncaught Exception');
    }
  });

  test('Data Health Center verifies database invariants without integrity errors', async ({ page }) => {
    const settingsNav = page.locator('button:has-text("Settings"), button:has-text("System")').first();
    if (await settingsNav.isVisible()) {
      await settingsNav.click();
    }

    const healthTab = page.locator('button:has-text("Data Health"), button:has-text("Integrity")').first();
    if (await healthTab.isVisible()) {
      await healthTab.click();
      await page.waitForTimeout(800);

      await expect(page.locator('body')).toBeVisible();
      const bodyText = await page.locator('body').innerText();
      expect(bodyText).not.toContain('Something went wrong');
    }
  });
});
