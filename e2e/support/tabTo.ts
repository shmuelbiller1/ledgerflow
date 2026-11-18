import { expect, type Locator, type Page } from '@playwright/test';

/** Reach the control through the browser's tab order, not locator.focus() (which bypasses it). */
export async function tabTo(page: Page, target: Locator, backwards = false, maxTabs = 160) {
  await expect(target).toBeVisible();
  for (let step = 0; step < maxTabs; step++) {
    if (await target.evaluate(el => el === document.activeElement)) return;
    await page.keyboard.press(backwards ? 'Shift+Tab' : 'Tab');
  }
  await expect(target, 'the control must be in the natural tab order').toBeFocused({ timeout: 1000 });
}
