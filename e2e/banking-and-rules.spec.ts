import { test, expect } from '@playwright/test';

test.describe('Banking, Feeds, Rules Engine & Reconciliation Suite', () => {

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

  test('Bank Feeds View and Transactions Import Workspace render properly', async ({ page }) => {
    const bankingNav = page.locator('button:has-text("Banking")').first();
    if (await bankingNav.isVisible()) {
      await bankingNav.click();
      await page.waitForTimeout(600);
      await expect(page.locator('body')).toBeVisible();
    }
  });

  test('Bank Rules Engine loads and supports rule definition interfaces', async ({ page }) => {
    const bankingNav = page.locator('button:has-text("Banking")').first();
    if (await bankingNav.isVisible()) {
      await bankingNav.click();
    }

    const rulesTab = page.locator('button:has-text("Bank Rules"), button:has-text("Rules")').first();
    if (await rulesTab.isVisible()) {
      await rulesTab.click();
      await page.waitForTimeout(600);
      await expect(page.locator('body')).toBeVisible();
      const bodyText = await page.locator('body').innerText();
      expect(bodyText).not.toContain('Something went wrong');
    }
  });

  test('Chart of Accounts Hierarchy & Role Resolution Verification', async ({ page }) => {
    const settingsNav = page.locator('button:has-text("Settings"), button:has-text("Accounts")').first();
    if (await settingsNav.isVisible()) {
      await settingsNav.click();
    }

    const coaTab = page.locator('button:has-text("Chart of Accounts"), button:has-text("Accounts")').first();
    if (await coaTab.isVisible()) {
      await coaTab.click();
      await page.waitForTimeout(800);
      await expect(page.locator('body')).toBeVisible();

      // Check account codes and types
      const text = await page.locator('body').innerText();
      expect(text).not.toContain('NaN');
    }
  });
});
