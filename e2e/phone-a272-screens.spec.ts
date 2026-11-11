import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { scrollBoxProblems } from './helpers/phoneGeometry';

/**
 * A-276: the phone pass on the ten screens A-272 gave empty/error states — Payments, Credit notes,
 * Estimates, Purchase orders, Recurring, Audit trail, Budgets, Fixed assets, Loans and Time.
 *
 * At 390 px on each one: the page itself never scrolls sideways, every horizontal scroll box fits
 * the phone (a wide table scrolls inside its own box, never off the edge), the heading fits, every
 * touch target measures at least 44 px, and axe reports no serious or critical finding in the
 * screen's own region. Opened the way a reader opens them (`/#<tab>`, guest workspace, the app's
 * own API stubbed), following `phone-main-screens.spec.ts` and `phone-remaining-screens.spec.ts`.
 *
 * Contrast is measured by `contrast.spec.ts` (axe measures colours mid-animation, so this spec
 * disables that one rule and gates on serious/critical, like `ai3-report-audit.spec.ts`).
 */

const WIDTH = 390;

const screens = [
  { tab: 'payments', heading: 'Payments Register' },
  { tab: 'credit-notes', heading: 'Credit Notes & Vendor Credits' },
  { tab: 'estimates', heading: 'Estimates & Quotes' },
  { tab: 'purchase-orders', heading: 'Purchase orders' },
  { tab: 'recurring', heading: 'Recurring Transactions' },
  { tab: 'audit-trail', heading: 'Audit Trail' },
  { tab: 'budgets', heading: 'Budget Protocol' },
  { tab: 'assets', heading: 'Fixed Asset Register' },
  { tab: 'loans', heading: 'Loans' },
  { tab: 'time', heading: 'Time' },
] as const;

async function signInAsGuest(page: Page) {
  await page.setViewportSize({ width: WIDTH, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/**', route => route.fulfill({ status: 200, json: {} }));
  await page.addInitScript(() => {
    localStorage.setItem('isGuest', 'true');
    localStorage.setItem('has_seen_onboarding', 'true');
    localStorage.setItem('ledgerflow-cookie-consent', 'accepted');
    window.print = () => {};
  });
}

for (const screen of screens) {
  test(`A-276 ${screen.tab}: 390 px — no sideways scroll, no clipped text, 44 px targets, axe clean`, async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await signInAsGuest(page);
    await page.goto(`/#${screen.tab}`);
    const main = page.locator('#main-content');
    const heading = main.getByRole('heading', { name: screen.heading, exact: true });
    await expect(heading, `${screen.tab}: its own heading is on screen`).toBeVisible({ timeout: 60_000 });

    // the page itself never scrolls sideways
    await expect.poll(
      async () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      { message: `${screen.tab}: the page does not scroll sideways` },
    ).toBeLessThanOrEqual(1);

    // the heading fits the phone (no clipped text at the edge)
    const headingBox = await heading.boundingBox();
    expect(headingBox, `${screen.tab}: the heading is on screen`).not.toBeNull();
    expect(headingBox!.x, `${screen.tab}: the heading starts on screen`).toBeGreaterThanOrEqual(-0.5);
    expect(headingBox!.x + headingBox!.width, `${screen.tab}: the heading fits the ${WIDTH} px phone`).toBeLessThanOrEqual(WIDTH + 1.5);

    // every scroll box fits the phone, and every table fits or scrolls inside a box that does
    const layout = [
      ...(await scrollBoxProblems(main)),
      ...(await main.evaluate(root => {
      const width = innerWidth;
      const problems: string[] = [];
      for (const table of root.querySelectorAll('table')) {
        const rect = table.getBoundingClientRect();
        if (rect.width === 0) continue;
        let scroller: HTMLElement | null = null;
        let node = table.parentElement;
        while (node && node !== root) {
          const overflowX = getComputedStyle(node).overflowX;
          if (overflowX === 'auto' || overflowX === 'scroll') { scroller = node; break; }
          node = node.parentElement;
        }
        const scrollerRect = scroller?.getBoundingClientRect();
        const fits = rect.width <= width + 1.5;
        const boxed = scrollerRect !== undefined && scrollerRect !== null
          && scrollerRect.left >= -0.5 && scrollerRect.right <= width + 1.5;
        if (!fits && !boxed) {
          const caption = table.querySelector('caption')?.textContent?.trim() || '(no caption)';
          problems.push(`table "${caption}" (${Math.round(rect.width)} px) is clipped without a fitting scroller`);
        }
      }
      return problems;
      })),
    ];
    expect(layout, `${screen.tab}: scroll boxes and tables fit the phone`).toEqual([]);

    // every touch target measures at least 44 px (checkboxes and radios are excluded: their label
    // is the target, and the label itself is checked as part of the layout above)
    const targets = await main.evaluate(root => {
      const problems: string[] = [];
      for (const el of root.querySelectorAll<HTMLElement>('button, select, input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea, summary')) {
        const rect = el.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        const label = el.getAttribute('aria-label') || el.textContent?.trim() || el.tagName;
        if (rect.width < 43.5 || rect.height < 43.5) problems.push(`${label}: target ${rect.width}×${rect.height}`);
        if (rect.left < -1 || rect.right > innerWidth + 1) {
          const scroller = Array.from(root.querySelectorAll<HTMLElement>('*')).find(box => {
            const style = getComputedStyle(box);
            return ['auto', 'scroll'].includes(style.overflowX) && box.contains(el) && box.scrollWidth > box.clientWidth;
          });
          if (!scroller) problems.push(`${label}: clipped without a local scroller`);
        }
      }
      return problems;
    });
    expect(targets, `${screen.tab}: every touch target is at least 44 px`).toEqual([]);

    // axe: no serious or critical finding in the screen's own region
    const axe = await new AxeBuilder({ page }).include('#main-content').disableRules(['color-contrast']).analyze();
    const serious = axe.violations.filter(violation => violation.impact === 'serious' || violation.impact === 'critical');
    expect(
      serious.map(violation => `${violation.id} (${violation.impact}): ${violation.nodes.map(node => node.target.join(' ')).slice(0, 3).join(', ')}`),
      `${screen.tab}: axe serious/critical findings`,
    ).toEqual([]);

    expect(errors).toEqual([]);
  });
}
