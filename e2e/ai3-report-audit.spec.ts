import { test, expect, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * A-203 / A-204 / A-205 for the reports AI #3 built.
 *
 * `layout.spec.ts` audits one default report per screen; the reports below are separate tabs that
 * only appear once chosen, so each one is opened by its own address (`?report=<id>#reports`), the
 * way a shared link opens it. For every one of them this spec checks, in a guest workspace with no
 * records (the empty state a new tester sees first):
 *
 *  - the report draws its own region and text (no blank screen),
 *  - no runtime error, and no `NaN` / `Infinity` / `undefined` is printed as a figure,
 *  - nothing sticks out at 390 px and at 320 px (A-204),
 *  - axe finds nothing serious or critical in the report's own region (A-203),
 *  - the same holds with the page in right-to-left layout, the direction a Hebrew workspace uses
 *    (A-205). Numbers and dates are checked for direction isolation where a report shows them.
 *
 * The scope is the report tabs reached here; panels on Month-End Close, loans, petty cash and the
 * warehouse have their own browser tests (`month-end-close-journey`, `warehouse-operations`).
 * Empty-state checks do not prove a report's figures with real records — the worked-figure tests
 * (`israel-month-journey`, `us-quarter-journey`, `close-journey`, golden fixtures) do that.
 */
const reports: ReadonlyArray<{ id: string; title: string; selector?: string }> = [
  { id: 'blanket-orders', title: 'Blanket purchase orders' },
  { id: 'customer-credit-limits', title: 'Customer credit limits' },
  { id: 'customer-quotes', title: 'Customer quotes and proposals' },
  { id: 'customer-tax-certificates', title: 'Customer tax certificates' },
  { id: 'delivery-notes', title: 'Delivery notes' },
  { id: 'dunning-letters', title: 'Dunning letters' },
  { id: 'golden-tax-fixtures', title: 'Golden tax fixtures' },
  { id: 'cycle-count', title: 'Inventory cycle count' },
  { id: 'il-month-journey', title: 'Israel month journey' },
  { id: 'landed-cost-preview', title: 'Landed cost preview' },
  { id: 'milestone-billing', title: 'Milestone billing' },
  { id: 'purchases-from-abroad', title: 'Purchases from abroad' },
  { id: 'quote-versions', title: 'Quote versions' },
  { id: 'record-notes', title: 'Record notes' },
  { id: 'reorder-suggestions', title: 'Reorder suggestions' },
  { id: 'sales-tax-holidays', title: 'Sales tax holidays' },
  { id: 'serial-lot-lookup', title: 'Serial and lot lookup' },
  { id: 'rule-pack-coverage', title: 'Tax rule coverage' },
  { id: 'us-quarter-journey', title: 'US quarter journey' },
  { id: 'use-tax-review', title: 'Use tax review' },
  { id: 'vendor-scorecard', title: 'Vendor scorecard' },
  { id: 'vendor-price-history', title: 'Vendor price history' },
  { id: 'by-label', title: 'Profit by label', selector: 'section[aria-labelledby="by-label-title"]' },
  { id: 'slow-moving-stock', title: 'Slow-moving items', selector: 'section[aria-labelledby="slow-moving-title"]' },
  { id: 'profitability-by', title: 'Profitability', selector: 'section[aria-labelledby="profitability-by-title"]' },
  { id: 'form-856', title: 'Withholding Report (Form 856)', selector: 'section[aria-labelledby="form-856-title"]' },
  { id: 'gross-profit-by-customer', title: 'Gross profit by customer' },
];

async function signInAsGuest(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('isGuest', 'true');
    localStorage.setItem('has_seen_onboarding', 'true');
    localStorage.setItem('ledgerflow-cookie-consent', 'accepted');
  });
}

async function open(page: Page, id: string, title: string) {
  await page.goto(`/?report=${id}#reports`);
  const region = page.getByRole('region', { name: title, exact: true });
  await expect(region).toBeVisible({ timeout: 30000 });
  // the lazy screen and its first paint, without waiting on unrelated background work
  await expect.poll(() => region.innerText().then(text => text.trim().length), { timeout: 20000 }).toBeGreaterThan(10);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.getAnimations().length === 0, { timeout: 200 });
  return region;
}

async function expectBounded(page: Page, width: number, where: string) {
  await page.setViewportSize({ width, height: 844 });
  await expect.poll(
    () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    { timeout: 10000 },
  ).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), where).toBe(true);
}

async function expectNoBrokenFigures(region: Locator) {
  const text = await region.innerText();
  // Words a report may use on purpose ("… undefined when sales are zero") are not figures, so
  // `undefined` is only a failure inside a table cell; the other three are never prose in these
  // reports and are checked across the whole region.
  for (const bad of ['NaN', 'Infinity', 'Invalid Date']) {
    expect(text, `a figure reads "${bad}"`).not.toContain(bad);
  }
  const cells = region.locator('td, th, dd, dt, output');
  const cellCount = await cells.count();
  for (let index = 0; index < cellCount; index += 1) {
    const cell = cells.nth(index);
    const value = (await cell.textContent()) || '';
    expect(value, `a cell reads "${value.trim()}"`).not.toContain('undefined');
  }
}

for (const { id, title, selector: reportSelector } of reports) {
  test(`${id}: empty state draws, fits a phone, stays right-to-left clean and passes serious axe`, async ({ page }, testInfo) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await signInAsGuest(page);
    await page.setViewportSize({ width: 390, height: 844 });

    const region = await open(page, id, title);
    await expectNoBrokenFigures(region);
    await expectBounded(page, 390, `${id} is wider than a 390 px phone`);

    // A-203: the report's own region, empty state, no serious or critical axe finding.
    // Scoped to this report's own region, so a finding in the shared screen chrome or in another
    // report cannot fail this one. Contrast has its own test (`contrast.spec.ts`).
    const selector = reportSelector ?? `section[aria-label="${title}"]`;
    const axe = await new AxeBuilder({ page }).include(selector).disableRules(['color-contrast']).analyze();
    const serious = axe.violations.filter(violation => violation.impact === 'serious' || violation.impact === 'critical');
    expect(serious.map(violation => `${violation.id} (${violation.impact}): ${violation.nodes.map(node => node.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([]);

    // A-209: a picture of the screen for the owner, attached to the CI run (not committed: a new image
    // cannot be reviewed in the push that creates it, and the visual baselines have their own workflow).
    await testInfo.attach(`${id}-390.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.getAnimations().length === 0, { timeout: 300 });
    await testInfo.attach(`${id}-1280.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    await page.setViewportSize({ width: 390, height: 844 });

    // A-205: the same report in a right-to-left page, as a Hebrew workspace renders it.
    await page.evaluate(() => { document.documentElement.dir = 'rtl'; document.documentElement.lang = 'he'; });
    await expect(region).toBeVisible();
    await expectNoBrokenFigures(region);
    await expectBounded(page, 390, `${id} is wider than a 390 px phone in right-to-left layout`);
    // Any money or date cell that carries right-to-left text must isolate its direction, so the
    // number cannot be re-ordered by the surrounding Hebrew text.
    await testInfo.attach(`${id}-rtl-390.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    const cells = region.locator('td');
    const count = Math.min(await cells.count(), 40);
    for (let index = 0; index < count; index += 1) {
      const cell = cells.nth(index);
      if (!(await cell.isVisible())) continue;
      const mixed = await cell.evaluate(element => {
        const text = (element.textContent || '').trim();
        const hasDigit = /[0-9]/.test(text);
        // Hebrew letters, not punctuation or the shekel sign alone
        const hasHebrew = /[\u05D0-\u05EA]/.test(text);
        if (!hasDigit || !hasHebrew) return null;
        const isolated = [...element.querySelectorAll('bdi, [dir="auto"]')].length > 0
          || getComputedStyle(element).unicodeBidi === 'isolate';
        return { text: text.slice(0, 40), isolated };
      });
      if (mixed) expect(mixed.isolated, `"${mixed.text}" mixes Hebrew and digits without direction isolation`).toBe(true);
    }

    expect(errors).toEqual([]);
  });
}

/**
 * A-205 for the two screens this lane built that are not report tabs: Loans and Petty cash. They
 * have desktop axe coverage in `layout.spec.ts`; this is the 390 px right-to-left pass.
 */
for (const { tab, name } of [
  { tab: 'loans', name: 'Loans' },
  { tab: 'petty-cash', name: 'Petty cash' },
]) {
  test(`${tab}: draws, fits a 390 px right-to-left page and passes serious axe`, async ({ page }) => {
    test.setTimeout(90000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await signInAsGuest(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/#${tab}`);
    const main = page.locator('#main-content');
    await expect.poll(() => main.innerText().then(text => text.trim().length), { timeout: 30000 }).toBeGreaterThan(20);
    await page.evaluate(() => { document.documentElement.dir = 'rtl'; document.documentElement.lang = 'he'; });
    const text = await main.innerText();
    expect(text, name).not.toContain('NaN');
    expect(text, name).not.toContain('Invalid Date');
    await expectBounded(page, 390, `${tab} is wider than a 390 px phone in right-to-left layout`);
    const axe = await new AxeBuilder({ page }).include('#main-content').disableRules(['color-contrast']).analyze();
    const serious = axe.violations.filter(violation => violation.impact === 'serious' || violation.impact === 'critical');
    expect(serious.map(violation => `${violation.id} (${violation.impact}): ${violation.nodes.map(node => node.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([]);
    expect(errors).toEqual([]);
  });
}
