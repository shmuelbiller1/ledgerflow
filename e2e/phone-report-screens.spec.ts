import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * A-261: the six statement screens at phone width (390 px) — Profit & Loss, Balance Sheet, Cash
 * Flow, A/R Aging, A/P Aging and the Trial Balance. On each one the page itself never scrolls
 * sideways, a wide table scrolls inside its own box (that box fits the phone), the period filters
 * stay reachable by keyboard and touch, and the primary controls measure at least 44 px.
 *
 * Opened the way a reader opens them: five through Reports (`?report=…#reports`, the shared-link
 * form), the trial balance through Ledger & Journal → Accountant Lens → Trial Balance, in a guest
 * workspace with the seeded demo books. Shell-level layout on these routes is also covered by
 * `phone-main-screens.spec.ts`; this spec adds the report tables and the filter controls.
 */

const WIDTH = 390;

async function signInAsGuest(page: Page) {
  await page.setViewportSize({ width: WIDTH, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    localStorage.setItem('isGuest', 'true');
    localStorage.setItem('has_seen_onboarding', 'true');
    localStorage.setItem('ledgerflow-cookie-consent', 'accepted');
    window.print = () => {};
  });
}

/** Nothing the reader sees may push the page sideways, and every scroll box itself fits the phone. */
async function expectPhoneLayout(page: Page, screenName: string) {
  await expect.poll(
    async () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    { message: `${screenName}: the page does not scroll sideways` },
  ).toBeLessThanOrEqual(1);

  const boxes = page.locator('#main-content [class*="overflow-x-auto"], #main-content [class*="overflow-auto"]');
  for (let i = 0; i < await boxes.count(); i++) {
    const b = await boxes.nth(i).boundingBox();
    if (!b || b.width === 0) continue;
    expect(b.x, `${screenName}: a scroll box starts on screen`).toBeGreaterThanOrEqual(-0.5);
    expect(b.x + b.width, `${screenName}: every scroll box fits the ${WIDTH} px phone`).toBeLessThanOrEqual(WIDTH + 1.5);
  }

  // A table either fits the phone or scrolls inside a box that does — otherwise its right-hand
  // columns are clipped behind the edge with no way to reach them.
  const tables = await page.evaluate(() => {
    const main = document.querySelector('#main-content');
    if (!main) return [];
    return Array.from(main.querySelectorAll('table')).map((table) => {
      const rect = table.getBoundingClientRect();
      let scroller: HTMLElement | null = null;
      let node = table.parentElement;
      while (node && node !== main) {
        const overflowX = getComputedStyle(node).overflowX;
        if (overflowX === 'auto' || overflowX === 'scroll') { scroller = node; break; }
        node = node.parentElement;
      }
      const scrollerRect = scroller?.getBoundingClientRect();
      return {
        caption: table.querySelector('caption')?.textContent?.trim() || '(no caption)',
        width: rect.width,
        scrollerX: scrollerRect?.x ?? null,
        scrollerWidth: scrollerRect?.width ?? null,
      };
    });
  });
  for (const table of tables) {
    if (table.width === 0) continue;
    const fits = table.width <= WIDTH + 1.5;
    const boxed = table.scrollerWidth !== null && table.scrollerX !== null
      && table.scrollerX >= -0.5 && table.scrollerX + table.scrollerWidth <= WIDTH + 1.5;
    expect(
      fits || boxed,
      `${screenName}: table “${table.caption}” (${Math.round(table.width)} px) fits the phone or scrolls inside a box that does`,
    ).toBe(true);
  }
}

/** A primary control measures at least 44 px tall (and wide, unless it is a text field). */
async function expect44px(control: Locator, name: string, options: { width?: boolean } = {}) {
  await expect(control, `${name} is on the screen`).toHaveCount(1);
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  expect(box, `${name} has a rendered box`).not.toBeNull();
  expect(box!.height, `${name} is at least 44 px tall (got ${Math.round(box!.height)})`).toBeGreaterThanOrEqual(43.5);
  if (options.width !== false) {
    expect(box!.width, `${name} is at least 44 px wide (got ${Math.round(box!.width)})`).toBeGreaterThanOrEqual(43.5);
  }
}

/** Every button/select in the Reports period bar is a 44 px target, and the year filter takes focus. */
async function expectPeriodFilters(page: Page, screenName: string) {
  const region = page.getByRole('region', { name: 'Report period' });
  await expect(region, `${screenName}: the period filters are on the screen`).toBeVisible();
  const controls = region.locator('button, select');
  const count = await controls.count();
  expect(count, `${screenName}: the period bar has controls`).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const control = controls.nth(i);
    if (!(await control.isVisible())) continue;
    const box = await control.boundingBox();
    if (!box || box.height === 0) continue;
    const label = (await control.getAttribute('aria-label')) || (await control.innerText().catch(() => '')).trim() || `control ${i + 1}`;
    expect(box.height, `${screenName}: period control “${label}” is at least 44 px tall (got ${Math.round(box.height)})`).toBeGreaterThanOrEqual(43.5);
  }
  const year = region.getByLabel('Select Year');
  await year.focus();
  await expect(year, `${screenName}: the year filter is reachable by keyboard`).toBeFocused();
}

const reports = [
  {
    id: 'pnl', label: 'Profit & Loss',
    async ready(page: Page) {
      await expect(page.getByLabel('Reporting period start date')).toBeVisible();
      await expect44px(page.getByLabel('Reporting period start date'), 'P&L start date', { width: false });
    },
  },
  {
    id: 'balance-sheet', label: 'Balance Sheet',
    async ready(page: Page) {
      await expect(page.getByRole('heading', { name: 'Assets', exact: true })).toBeVisible();
      await expect44px(page.getByLabel('Reporting period start date'), 'Balance sheet start date', { width: false });
    },
  },
  {
    id: 'cash-flow', label: 'Cash Flow',
    async ready(page: Page) {
      await expect44px(page.getByRole('button', { name: 'Previous month', exact: true }), 'Cash flow previous month');
    },
  },
  {
    id: 'ar-aging', label: 'A/R Aging',
    async ready(page: Page) {
      await expect(page.getByRole('heading', { name: 'Accounts Receivable (AR) Aging' })).toBeVisible();
      await expect44px(page.getByLabel('Search by customer'), 'A/R aging search', { width: false });
      await expect44px(page.getByRole('button', { name: /Export CSV/ }), 'A/R aging export');
    },
  },
  {
    id: 'ap-aging', label: 'A/P Aging',
    async ready(page: Page) {
      await expect(page.getByRole('heading', { name: 'Accounts Payable (AP) Aging' })).toBeVisible();
      await expect44px(page.getByLabel('Search by vendor'), 'A/P aging search', { width: false });
      await expect44px(page.getByRole('button', { name: /Export CSV/ }), 'A/P aging export');
    },
  },
];

for (const report of reports) {
  test(`A-261 ${report.label}: at 390 px the table keeps its own scroll and the filters stay 44 px`, async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await signInAsGuest(page);
    await page.goto(`/?report=${report.id}#reports`);
    await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible({ timeout: 30_000 });
    // The picker names the open report, so a shared link to the wrong screen cannot pass silently.
    await expect(
      page.getByRole('navigation', { name: 'Report pages' }).locator('summary'),
      `${report.label} is the open report`,
    ).toContainText(report.label);
    await report.ready(page);
    await expectPhoneLayout(page, report.label);
    await expectPeriodFilters(page, report.label);
    expect(errors).toEqual([]);
  });
}

test('A-261 Trial Balance: at 390 px the table keeps its own scroll and the As-of filter stays 44 px', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await signInAsGuest(page);
  await page.goto('/#ledger');
  const main = page.locator('#main-content');
  await main.getByRole('button', { name: 'Accountant Lens', exact: true }).click();
  await main.getByRole('button', { name: 'Trial Balance', exact: true }).click();
  await expect(main.getByRole('heading', { name: 'Trial Balance', exact: true })).toBeVisible({ timeout: 30_000 });

  const asOf = main.getByLabel('As of date');
  await expect44px(asOf, 'Trial balance As-of date', { width: false });
  await expect44px(main.getByRole('button', { name: 'Today', exact: true }), 'Trial balance “Today” preset');
  await asOf.focus();
  await expect(asOf, 'the As-of filter is reachable by keyboard').toBeFocused();

  await expectPhoneLayout(page, 'Trial Balance');
  expect(errors).toEqual([]);
});
