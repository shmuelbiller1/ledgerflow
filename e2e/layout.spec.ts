import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Every screen fits a 1280 px laptop: nothing sticks out past the right edge of the main area (the
 * Overview was cut off on screens under ~1600 px), and the screen draws something. Opened by
 * address (#tab), as a shared link would. Screen readers (E-30): each screen has exactly one h1,
 * and headings after it never skip a level (h1 -> h3); axe finds nothing (E-24; contrast has its
 * own test).
 */
const screens = [
  'dashboard', 'inbox', 'practice', 'copilot', 'transactions', 'credit-notes', 'assets', 'register', 'ledger',
  'intercompany', 'recurring', 'query-builder', 'banking', 'audit-trail', 'client-queries', 'tasks', 'time', 'reconciliation',
  'month-end-close', 'fiscal-periods', 'sales', 'estimates', 'payments', 'purchases',
  'purchase-orders', 'loans', 'petty-cash', 'payroll', 'reports', 'charts', 'forecaster', 'intelligence', 'settings',
  'data-health', 'support', 'help', 'vault', 'pricing', 'api-hub',
];

test.describe('Layout at 1280 x 800', () => {
  for (const screen of screens) {
    test(`${screen} fits the window`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.addInitScript(() => {
        localStorage.setItem('isGuest', 'true');
        localStorage.setItem('has_seen_onboarding', 'true');
      });
      await page.goto(`/#${screen}`);
      const main = page.locator('#main-content');
      await main.waitFor({ timeout: 15000 });
      // wait for the lazy screen to draw (heavy screens take longer under load), then its entrance animation;
      // its heading, not just any text: the help bar above every screen (C-20) has text of its own
      await expect.poll(() => main.evaluate(el => el.innerText.trim().length), { timeout: 15000 }).toBeGreaterThan(20);
      await expect.poll(() => page.locator('h1:visible').count(), { timeout: 15000 }).toBeGreaterThan(0);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForFunction(() => document.getAnimations().length === 0, { timeout: 600 });
      const { overflow, text } = await main.evaluate(el => ({ overflow: el.scrollWidth - el.clientWidth, text: el.innerText.trim().length }));
      expect(overflow, `${screen} is ${overflow}px wider than the window`).toBeLessThanOrEqual(1);
      expect(text, `${screen} drew nothing`).toBeGreaterThan(20);
      const headings = await page.evaluate(() => {
        const visible = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]
          .filter(h => (h as HTMLElement).offsetParent !== null || getComputedStyle(h).position === 'fixed');
        const h1s = visible.filter(h => h.tagName === 'H1').map(h => (h.textContent || '').trim());
        const skips: string[] = [];
        let prev = 0;
        for (const h of visible.slice(visible.findIndex(x => x.tagName === 'H1'))) {
          const level = Number(h.tagName[1]);
          if (prev && level > prev + 1) skips.push(`h${prev} -> h${level} "${(h.textContent || '').trim().slice(0, 40)}"`);
          prev = level;
        }
        return { h1s, skips };
      });
      expect(headings.h1s, `${screen}: one h1`).toHaveLength(1);
      expect(headings.skips, `${screen}: heading levels`).toEqual([]);
      const axe = await new AxeBuilder({ page }).disableRules(['color-contrast']).analyze();
      expect(axe.violations.map(v => `${v.id} (${v.impact}): ${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(', ')}`), `${screen}: accessibility`).toEqual([]);
    });
  }
});
