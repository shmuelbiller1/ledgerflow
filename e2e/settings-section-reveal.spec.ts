import { test, expect } from '@playwright/test';

/**
 * Issue #274 §1, in a real browser: on Settings, choosing a section from the shortcut grid changed
 * the selection but left the panel below the fold, so the buttons looked dead. The fix scrolls the
 * panel into view and moves focus to it — but a jsdom test can only assert that `scrollIntoView` was
 * *called*. These checks measure what a reader sees: the panel's top edge is actually on screen, and
 * the choice is announced (`aria-current`).
 *
 * Non-vacuity is measured, not simulated: each test records where the panel was *before* the click.
 * On both viewports it starts below the fold (that was the bug), so the assertions after the click
 * only pass because the reveal really moved it.
 */

test.describe('issue #274: a Settings section chosen from the shortcut grid is revealed', () => {
  for (const viewport of [{ width: 390, height: 760, name: 'phone' }, { width: 1280, height: 800, name: 'desktop' }]) {
    test(`${viewport.name}: choosing a section brings its panel on screen and announces it`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.addInitScript(() => {
        localStorage.setItem('isGuest', 'true');
        localStorage.setItem('has_seen_onboarding', 'true');
        localStorage.setItem('ledgerflow-cookie-consent', 'accepted');
      });
      await page.goto('/#settings');

      const grid = page.getByRole('navigation', { name: 'Settings sections' });
      await expect(grid).toBeVisible({ timeout: 60_000 });
      // before anyone touches the grid the panel (whichever one is open) is below the fold — the state
      // #274 reported: the buttons changed the selection while the content stayed off screen
      const openPanel = page.locator('#settings-panel');
      await expect(openPanel).toBeVisible();
      expect(await openPanel.evaluate(node => node.getBoundingClientRect().top)).toBeGreaterThan(viewport.height);
      // a section far down the grid, so the reveal is what puts the panel on screen
      const choose = grid.getByRole('button', { name: 'Developer' });
      await choose.scrollIntoViewIfNeeded();
      await choose.click();
      await expect(choose).toHaveAttribute('aria-current', 'page');

      const panel = page.getByRole('region', { name: 'Developer settings' });
      await expect(panel).toBeVisible();
      // the panel's top is inside the viewport once the smooth scroll settles…
      await expect
        .poll(() => panel.evaluate(node => node.getBoundingClientRect().top), { timeout: 10_000 })
        .toBeGreaterThanOrEqual(0);
      await expect
        .poll(() => panel.evaluate(node => node.getBoundingClientRect().top), { timeout: 10_000 })
        .toBeLessThanOrEqual(viewport.height);
      // …and the reader's keyboard/screen-reader position is the panel itself
      await expect(panel).toBeFocused();
    });
  }
});
