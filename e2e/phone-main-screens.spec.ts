import { test, expect, type Page } from '@playwright/test';

const screens = [
  { tab: 'dashboard', heading: 'Real-Time Financial Ledger', action: 'Add Entry' },
  { tab: 'transactions', heading: 'Journal Entries', action: 'Create new entry' },
  { tab: 'sales', heading: 'Invoicing & Customer Accounts', action: 'Add Invoice' },
  { tab: 'purchases', heading: 'Purchases & AP', action: 'Record Bill' },
  { tab: 'reports', heading: 'Reports', action: 'Generate' },
  { tab: 'settings', heading: 'Settings', action: 'Backup & Export' },
  { tab: 'general-ledger', heading: 'General Ledger', action: 'Print Ledger' },
  { tab: 'statement', heading: 'Account Statement', action: 'Print Statement' },
  { tab: 'consolidation', heading: 'Multi-Entity Consolidation', action: 'Top-Level Adjustments' },
  { tab: 'banking', heading: 'Bank & Institution Connections', action: 'Make deposit' },
];

for (const screen of screens) {
  test(`${screen.tab}: main action is reachable at 390px without page overflow`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/**', route => route.fulfill({ status: 200, json: {} }));
    await page.addInitScript(() => {
      localStorage.setItem('isGuest', 'true');
      localStorage.setItem('has_seen_onboarding', 'true');
      window.print = () => {};
    });
    await page.goto(`/#${screen.tab}`);
    await expect(page.getByRole('heading', { name: screen.heading, exact: true })).toBeVisible();
    const action = page.locator('#main-content').getByRole('button', { name: screen.action, exact: true });
    await expect(action).toBeEnabled();
    await action.scrollIntoViewIfNeeded();
    await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    const box = (await action.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(391);
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await action.focus();
    await expect(action).toBeFocused();
    await action.press('Enter');
    if (['dashboard', 'transactions', 'sales', 'purchases', 'banking'].includes(screen.tab)) {
      await expect(page.getByRole('dialog')).toHaveCount(1);
    } else if (screen.tab === 'settings') {
      await expect(page.getByRole('button', { name: 'Choose export', exact: true })).toBeVisible();
    } else {
      await expect(page.getByRole('heading', { name: screen.heading, exact: true })).toBeVisible();
    }
  });
}

/**
 * A-233: the next ten screens at 390 px. The four with their own tab are checked end to end here —
 * the heading fits, the page never scrolls sideways and the card/list boxes keep their own scroll.
 * The six that live inside another tab (Customers and Bills in Money In/Out, Vendors, Credit notes'
 * vendor half, Bank rules, Settings → Users and the monthly pack) are covered by the same CSS rule
 * (`min-h-11` targets and `overflow-x-auto` boxes were put on them in A-233) and by
 * `phone-targets.spec.ts` for the shared controls; each gets its own tab-level check when its
 * sub-tab navigation is stable to address from a URL.
 */
const nextScreens = [
  { tab: 'inventory', heading: 'Inventory' },
  { tab: 'budgets', heading: 'Budget Protocol' },
  { tab: 'projects', heading: 'Project & Initiative Tracking' },
  { tab: 'credit-notes', heading: 'Credit Notes & Vendor Credits' },
];

for (const screen of nextScreens) {
  test(`${screen.tab}: heading and layout hold at 390px without page overflow`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/**', route => route.fulfill({ status: 200, json: {} }));
    await page.addInitScript(() => {
      localStorage.setItem('isGuest', 'true');
      localStorage.setItem('has_seen_onboarding', 'true');
      window.print = () => {};
    });
    await page.goto(`/#${screen.tab}`);
    await expect(page.getByRole('heading', { name: screen.heading, exact: true })).toBeVisible();
    await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);

    // #main-content clips overflow, so the document width alone would hide a table hanging off the
    // side. Every horizontal scroll box the screen uses has to fit the viewport itself, and the
    // first working control of the screen itself (not the shared Help button rendered above every
    // screen) has to sit fully inside it.
    const boxes = page.locator('#main-content [class*="overflow-x-auto"]');
    for (let i = 0; i < await boxes.count(); i++) {
      const b = (await boxes.nth(i).boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(391.5);
    }
    const controls = page.locator('#main-content button:enabled:not([aria-label^="Help for"]), #main-content a[href]');
    const first = (await controls.first().boundingBox())!;
    expect(first.x).toBeGreaterThanOrEqual(-0.5);
    expect(first.x + first.width).toBeLessThanOrEqual(391.5);
  });
}

/**
 * A-233, the six screens that live inside another tab: Customers (Sales), Bills and Vendors
 * (Purchases), Settings → Users and Settings → Bank rules, and the monthly report pack. Each is
 * opened the way a reader opens it — the tab, then the sub-tab button — and held to the same rule
 * as the screens above: nothing scrolls sideways, and every box that scrolls on the screen fits
 * the 390 px column (otherwise the table is clipped and the right-hand column is unreachable).
 *
 * The 44 px targets of the Customers and Vendors rows are checked in
 * `src/tests/phone-tap-targets.test.tsx`: a guest workspace has no contacts, so there is no row
 * to measure here, and the class (`min-h-11 min-w-11`) is the contract jsdom can check.
 */
const innerScreens = [
  {
    name: 'sales → customers',
    tab: 'sales',
    async open(page: Page) {
      await page.getByRole('button', { name: 'Customers & Clients', exact: true }).click();
      await expect(page.locator('[data-list-columns="sales-customers"]')).toBeVisible();
    },
  },
  {
    name: 'purchases → bills',
    tab: 'purchases',
    async open(page: Page) {
      await expect(page.locator('[data-list-columns="purchase-bills"]')).toBeVisible();
    },
  },
  {
    name: 'purchases → vendors',
    tab: 'purchases',
    async open(page: Page) {
      await page.getByRole('button', { name: /^Vendors/ }).click();
      await expect(page.locator('[data-list-columns="purchase-vendors"]')).toBeVisible();
    },
  },
  {
    name: 'settings → users',
    tab: 'settings',
    async open(page: Page) {
      await page.getByRole('button', { name: 'Team & Invites', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Team & Invites settings' })).toBeVisible();
    },
  },
  {
    name: 'settings → bank rules',
    tab: 'settings',
    async open(page: Page) {
      await page.getByRole('button', { name: 'Rules & Automation', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Rules & Automation settings' })).toBeVisible();
    },
  },
  {
    name: 'reports → monthly pack',
    tab: 'reports',
    async open(page: Page) {
      await page.getByRole('button', { name: 'Report pack', exact: true }).first().click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      const box = (await dialog.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(391.5);
    },
  },
];

for (const screen of innerScreens) {
  test(`${screen.name}: opens at 390px, nothing scrolls sideways, every scrolling box fits`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/**', route => route.fulfill({ status: 200, json: {} }));
    await page.addInitScript(() => {
      localStorage.setItem('isGuest', 'true');
      localStorage.setItem('has_seen_onboarding', 'true');
      window.print = () => {};
    });
    await page.goto(`/#${screen.tab}`);
    await screen.open(page);
    await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    const boxes = page.locator('#main-content [class*="overflow-x-auto"], #main-content [class*="overflow-auto"]');
    for (let i = 0; i < await boxes.count(); i++) {
      const b = (await boxes.nth(i).boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(391.5);
    }
  });
}
