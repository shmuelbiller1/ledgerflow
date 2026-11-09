import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Money dialogs with a keyboard and a screen reader (E-08…E-20): each opens as a dialog named by
 * its title, focus is inside, axe finds nothing (contrast has its own test), Escape closes it.
 */
async function open(page: Page, group: string, screen: string) {
  const g = page.getByRole('button', { name: group, exact: true }).first();
  if (await g.isVisible()) await g.click();
  await page.getByRole('button', { name: screen, exact: true }).first().click();
}

const dialogs: Array<{ name: string; title: RegExp; show: (p: Page) => Promise<void> }> = [
  { name: 'invoice', title: /New invoice/, show: async p => { await open(p, 'Money In', 'Invoices & AP'); await p.getByRole('button', { name: /Add Invoice/ }).first().click(); } },
  { name: 'customer', title: /Add Customer/, show: async p => { await open(p, 'Money In', 'Invoices & AP'); await p.getByRole('button', { name: /Customers/ }).first().click(); await p.getByRole('button', { name: /Add Customer/ }).first().click(); } },
  { name: 'bill', title: /Record New Bill/, show: async p => { await open(p, 'Money Out', 'Purchases'); await p.getByRole('button', { name: /Record Bill/ }).first().click(); } },
  { name: 'vendor', title: /Add Vendor/, show: async p => { await open(p, 'Money Out', 'Purchases'); await p.getByRole('button', { name: /Vendors/ }).first().click(); await p.getByRole('button', { name: /Add Vendor|New Vendor/ }).first().click(); } },
  { name: 'credit note', title: /Credit Note/, show: async p => { await open(p, 'Transactions', 'Credit Notes & Vendor Credits'); await p.getByRole('button', { name: /New Credit Note/ }).first().click(); } },
];

test.describe('Dialogs', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('isGuest', 'true');
      localStorage.setItem('has_seen_onboarding', 'true');
    });
    await page.goto('/');
    await page.waitForSelector('text="Overview"', { timeout: 15000 });
  });

  test('command palette: Ctrl+K opens it with the cursor in the search box', async ({ page }) => {
    await page.keyboard.press('Control+k');
    const search = page.getByRole('textbox', { name: 'Search commands or enter a transaction' });
    await expect(search).toBeVisible();
    await expect(search).toBeFocused();
    await page.keyboard.type('rep');
    await expect(search).toHaveValue('rep');
  });

  for (const d of dialogs) {
    test(`${d.name}: a named dialog, focus inside, no accessibility problems, Escape closes`, async ({ page }) => {
      await d.show(page);
      const dialog = page.getByRole('dialog', { name: d.title });
      await expect(dialog).toBeVisible();
      await page.waitForTimeout(600); // entrance animation
      expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);

      // D-51: the tested dialogs keep keyboard focus in the real tab order and expose the shared
      // visible focus ring. Exercise both ends, not just the initial autofocus.
      const focusable = dialog.locator([
        'button:not([disabled]):visible',
        'input:not([disabled]):visible',
        'select:not([disabled]):visible',
        'textarea:not([disabled]):visible',
        'a[href]:visible',
        '[tabindex]:not([tabindex="-1"]):visible',
      ].join(', '));
      const focusableCount = await focusable.count();
      expect(focusableCount, `${d.name} needs at least two keyboard stops`).toBeGreaterThanOrEqual(2);
      const first = focusable.first();
      await first.focus();
      await page.keyboard.press('Tab');
      const startIndex = await focusable.evaluateAll(elements => elements.findIndex(element => element === document.activeElement));
      expect(startIndex, `${d.name} first keyboard step lands on a collected dialog control`).toBeGreaterThanOrEqual(0);

      // Follow the browser's actual tab order (not assumed DOM order), checking every visible
      // candidate exactly once before wrapping. This catches skipped/reordered intermediate stops.
      const visited = new Set<number>();
      const visitOrder: number[] = [];
      let currentIndex = startIndex;
      let wrapped = false;
      for (let step = 0; step < focusableCount; step += 1) {
        expect(currentIndex, `${d.name} tab stays on a collected dialog control`).toBeGreaterThanOrEqual(0);
        expect(visited.has(currentIndex), `${d.name} tab order repeats before wrapping`).toBe(false);
        visited.add(currentIndex);
        visitOrder.push(currentIndex);
        const current = focusable.nth(currentIndex);
        await expect(current, `${d.name} dialog tab stop ${visited.size}/${focusableCount}`).toBeFocused();
        const visibleFocus = await current.evaluate(element => {
          const style = getComputedStyle(element);
          const outline = style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) >= 2
            && style.outlineColor !== 'rgba(0, 0, 0, 0)' && style.outlineColor !== 'transparent';
          const shadows = [...style.boxShadow.matchAll(/(?:rgba?|oklch|oklab|lab|lch|color)\(([^)]+)\)/g)];
          const shadow = shadows.some(([, value]) => {
            const alpha = value.includes('/')
              ? value.split('/').at(-1)?.trim()
              : value.split(',').length === 4 ? value.split(',').at(-1)?.trim() : undefined;
            return alpha === undefined || Number.parseFloat(alpha) > 0;
          });
          return { keyboard: element.matches(':focus-visible'), indicator: outline || shadow };
        });
        expect(visibleFocus.keyboard, `${d.name} dialog tab stop ${visited.size} is keyboard-focused`).toBe(true);
        expect(visibleFocus.indicator, `${d.name} dialog tab stop ${visited.size} has a visible focus indicator`).toBe(true);

        // Native date/number inputs may consume a Tab for an internal sub-control while the DOM
        // activeElement remains the same. Keep stepping through those sub-controls, with a bound.
        let nextIndex = currentIndex;
        for (let attempt = 0; attempt < 4 && nextIndex === currentIndex; attempt += 1) {
          await page.keyboard.press('Tab');
          nextIndex = await focusable.evaluateAll(elements => elements.findIndex(element => element === document.activeElement));
        }
        expect(nextIndex, `${d.name} Tab leaves stop ${visited.size}`).toBeGreaterThanOrEqual(0);
        if (nextIndex === startIndex) {
          wrapped = true;
          break;
        }
        expect(visited.has(nextIndex), `${d.name} tab order does not skip back before wrapping`).toBe(false);
        currentIndex = nextIndex;
      }
      expect(wrapped, `${d.name} reaches the starting stop only after traversing the whole order`).toBe(true);
      expect(visited.size, `${d.name} keyboard traversal visits every collected tab stop`).toBe(focusableCount);

      // Only after visiting every stop, confirm wrapping in both directions at this actual order's ends.
      const lastInTabOrder = focusable.nth(visitOrder[visitOrder.length - 1]);
      let previousIndex = startIndex;
      for (let attempt = 0; attempt < 4 && previousIndex !== visitOrder[visitOrder.length - 1]; attempt += 1) {
        await page.keyboard.press('Shift+Tab');
        previousIndex = await focusable.evaluateAll(elements => elements.findIndex(element => element === document.activeElement));
      }
      await expect(lastInTabOrder).toBeFocused();
      let nextIndex = previousIndex;
      for (let attempt = 0; attempt < 4 && nextIndex !== startIndex; attempt += 1) {
        await page.keyboard.press('Tab');
        nextIndex = await focusable.evaluateAll(elements => elements.findIndex(element => element === document.activeElement));
      }
      await expect(focusable.nth(startIndex)).toBeFocused();

      const results = await new AxeBuilder({ page }).include('[role="dialog"]').disableRules(['color-contrast']).analyze();
      expect(results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    });
  }

  test('estimate form: no accessibility problems (E-16)', async ({ page }) => {
    await open(page, 'Money In', 'Estimates & Quotes');
    await page.getByRole('button', { name: /New Estimate/ }).first().click();
    const form = page.locator('form', { hasText: 'Create New Quote / Estimate' });
    await expect(form).toBeVisible();
    const results = await new AxeBuilder({ page }).include('form').disableRules(['color-contrast']).analyze();
    expect(results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
});
