import { checkComparisonReports } from './support/reportRowTableJourney';
import { installSmallSample } from './helpers/sampleFixture';
import { hebrewSample, installHebrewVisualSample } from './helpers/hebrewVisualSample';
import { test, expect, type Locator } from '@playwright/test';
import { waitForFiniteAnimations } from './support/a11yGate';
import type { PurchaseOrder } from '../src/types';

const order: PurchaseOrder = {
  id: 'visual-order', uid: 'usr_demo', workspaceId: 'guest', poNumber: 'PO-2026-001',
  vendorId: 'vend_demo_1_guest', vendorName: 'Amazon Web Services',
  issueDate: '2026-09-09', expectedDeliveryDate: '2026-10-02', status: 'approved', currency: 'USD',
  totalAmountCents: 72500, createdAt: '2026-09-09T12:00:00Z',
  items: [{ id: 'visual-line', description: 'Backup storage and support', quantity: 5, unitPriceCents: 14500, totalCents: 72500 }],
};

// Fixed civil date, seeded guest records, real UI and real fonts. Nothing financial is masked.
test.use({ locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'reduce' });
const screens = [
  ['dashboard', '/#dashboard', 'Dashboard'],
  ['transactions', '/#transactions', 'Journal Entries'],
  ['sales', '/#sales', 'Sales'],
  ['purchases', '/#purchases', 'Purchases & AP'],
  ['reconcile', '/#reconciliation', 'Smart Matching & Bank Reconciliation'],
  ['pnl', '/?report=pnl&start=2026-09-01&end=2026-09-30&cmp=none#reports', 'Reports'],
  ['balance-sheet', '/?report=balance-sheet&start=2026-09-01&end=2026-09-30&cmp=none#reports', 'Reports'],
  ['settings', '/#settings', 'Settings'],
  ['tasks', '/#tasks', 'Tasks'],
  ['time', '/#time', 'Time'],
  ['purchase-orders', '/#purchase-orders', 'Purchase orders'],
  ['journal-record', '/#transactions/transaction/tx_demo_1_guest', 'Journal Entries'],
  ['reports-picker', '/?report=pnl&start=2026-09-01&end=2026-09-30&cmp=none#reports', 'Reports'],
] as const;

for (const width of [1280, 390]) for (const theme of ['light', 'dark'] as const) {
  for (const [screen, url, heading] of screens) {
    test(`visual ${screen} ${width === 390 ? 'phone' : 'desktop'} ${theme}`, async ({ page }) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width, height: 850 });
      await page.clock.setFixedTime(new Date('2026-09-30T12:00:00Z'));
      await page.addInitScript(selectedTheme => {
        localStorage.setItem('isGuest', 'true');
        localStorage.setItem('has_seen_onboarding', 'true');
        localStorage.setItem('ledgerflow-cookie-consent', 'essential');
        localStorage.setItem('lf_theme', selectedTheme);
      }, theme);
      await installSmallSample(page, false, screen === 'purchase-orders' ? { purchaseOrders: { [order.id]: order } } : {});
      await page.goto(url);
      const main = page.locator('#main-content');
      await expect(main.getByRole('heading', { name: heading, exact: true })).toBeVisible({ timeout: 20_000 });
      await expect.poll(() => page.evaluate(async () => {
        const modulePath = '/src/stores/useLedgerStore.ts';
        const { useLedgerStore } = await import(/* @vite-ignore */ modulePath) as typeof import('../src/stores/useLedgerStore');
        return useLedgerStore.getState().transactions.length;
      })).toBe(2);
      if (screen === 'pnl' || screen === 'reports-picker') await expect(main.getByLabel('Reporting period start date')).toHaveValue('2026-09-01');
      if (screen === 'balance-sheet') await expect(main.getByRole('heading', { name: 'Assets', exact: true })).toBeVisible();
      if (screen === 'purchase-orders') {
        const lines = main.getByRole('button', { name: `Lines of ${order.poNumber}` });
        await lines.click();
        await expect(main.getByText(order.items[0].description, { exact: true })).toBeVisible();
      }
      if (screen === 'journal-record') {
        const record = page.getByRole('dialog', { name: 'Edit Ledger Entry details', exact: true });
        await expect(record.getByLabel('Description', { exact: true })).toHaveValue('Acme Enterprise Software Renewal');
      }
      if (screen === 'reports-picker') {
        const picker = main.getByRole('navigation', { name: 'Report pages', exact: true });
        await picker.locator('summary').click();
        await expect(picker.getByLabel('Choose report', { exact: true })).toHaveValue('pnl');
      }
      await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*\bdark\b)/);
      await page.evaluate(() => document.fonts.ready);
      await expect(main).not.toContainText('Something went wrong');
      // The list of report tabs and the shared total-explainer footer are not what these statement shots check.
      if (screen !== 'reports-picker') {
        await page.addStyleTag({ content: '[data-testid="report-tabs"],[data-testid="report-total-explainer"]{display:none !important}' });
      }
      // The app scrolls inside main, so fullPage alone would clip the report body.
      // Keep the real responsive width and expand only the capture height to fit it.
      const entryGrid = screen === 'transactions' || screen === 'journal-record';
      if (entryGrid) {
        // A virtual grid grows with its viewport. Keep the actual phone/desktop height for the
        // viewport-bound editor; use a taller capture for the overview so both rows are visible.
        if (screen === 'transactions') await page.setViewportSize({ width, height: 1600 });
        const descriptions = main.locator('[role="presentation"] > [data-column="description"]');
        await expect(descriptions).toHaveCount(2);
        if (screen === 'transactions') await expect.poll(async () => {
          const cell = await descriptions.last().boundingBox(), frame = await main.boundingBox();
          return !!cell && !!frame && cell.y >= frame.y && cell.y + cell.height <= frame.y + frame.height;
        }).toBe(true);
      } else {
        // Content that arrives after the first measure (Settings loads a section a moment later) made
        // this loop stop one step early on some runs, so the shot was 305px shorter than the baseline.
        // Wait for the page to stop fetching, then re-measure until two consecutive reads agree.
        await page.waitForLoadState('networkidle');
        for (let attempt = 0; attempt < 6; attempt++) {
          const overflow = await main.evaluate(element => element.scrollHeight - element.clientHeight);
          if (overflow <= 1 && attempt > 0) break;
          if (overflow <= 1) {
            await page.waitForTimeout(250);
            continue;
          }
          const height = page.viewportSize()!.height + overflow;
          expect(height).toBeLessThan(16_000);
          await page.setViewportSize({ width, height });
        }
      }
      if (!entryGrid) await expect.poll(() => main.evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
      await page.mouse.move(0, 0);
      // Cards that animate in on mount (the sales aging tiles, the dashboard widgets) are still moving
      // when the shot is taken: `animations: 'disabled'` only settles CSS animations and transitions, so
      // the capture and its verification re-run disagreed by a few hundred pixels on one screen. Wait
      // for the page's own finite animations to finish first, with motion reduced as the rest of the
      // suite does.
      await waitForFiniteAnimations(page);
      // A tight absolute pixel allowance catches small regressions even on tall screens.
      await expect(page).toHaveScreenshot(`${screen}-${width}-${theme}.png`, {
        fullPage: true, animations: 'disabled', caret: 'hide', scale: 'css',
        threshold: 0.1, maxDiffPixels: 100,
      });
    });
  }
}

// Include the open chooser, translated table headings and a non-first row header in baseline review.
for (const width of [390, 1280]) for (const theme of ['light', 'dark'] as const) {
  test(`visual comparison reports ${width} ${theme}`, async ({ page }) => {
    await checkComparisonReports(page, width, theme);
  });
}

const reportUrl = (id: string) => `/?report=${id}&start=${hebrewSample.from}&end=${hebrewSample.to}&cmp=none#reports`;
const headline = (name: string) => (main: Locator) => main.getByRole('heading', { name, exact: true });
const documentNumber = (scope: string, number: string) => (main: Locator) => (
  main.locator(`[data-list-columns="${scope}"]`).getByText(number, { exact: true })
);
const hebrewScreens = [
  { id: 'overview', url: '/#dashboard', ready: (main: Locator) => main.locator('#books-safe-title') },
  { id: 'invoices', url: '/#sales', ready: documentNumber('sales-invoices', hebrewSample.invoiceNumber) },
  { id: 'bills', url: '/#purchases', ready: documentNumber('purchase-bills', hebrewSample.billNumber) },
  { id: 'banking', url: '/#banking', ready: headline(hebrewSample.bankName) },
  { id: 'reconcile', url: '/#reconciliation', ready: (main: Locator) => main.getByText(hebrewSample.bankLine, { exact: true }) },
  { id: 'pnl', url: reportUrl('pnl'), ready: headline('דוח רווח והפסד') },
  { id: 'balance-sheet', url: reportUrl('balance-sheet'), ready: headline('Assets') },
  { id: 'trial-balance', url: '/#ledger', ready: (main: Locator) => main.getByRole('region', { name: 'טבלת מאזן בוחן' }) },
  { id: 'vat-report', url: reportUrl('israel-vat-report'), ready: (main: Locator) => (
    main.getByRole('region', { name: 'דוח מע״מ ישראל', exact: true }).getByText(hebrewSample.vatNumber, { exact: true })
  ) },
  { id: 'settings', url: '/#settings', ready: headline('Layout Density & Regional Preferences') },
];

test.describe('H-1 Hebrew screen baselines', () => {
  test.use({ locale: 'he-IL' });
  for (const width of [390, 1280]) for (const screen of hebrewScreens) {
    test(`visual h1-hebrew ${screen.id} ${width}`, async ({ page }) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width, height: 850 });
      await page.clock.setFixedTime(new Date(`${hebrewSample.to}T12:00:00Z`));
      await page.addInitScript(() => {
        localStorage.setItem('isGuest', 'true');
        localStorage.setItem('has_seen_onboarding', 'true');
        localStorage.setItem('ledgerflow-cookie-consent', 'accepted');
        localStorage.setItem('lf_theme', 'light');
        localStorage.setItem('lf_language', 'he');
      });
      await installHebrewVisualSample(page);
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(screen.url);
      const main = page.locator('#main-content');
      if (screen.id === 'trial-balance') {
        await main.getByRole('button', { name: 'Accountant Lens', exact: true }).click();
        await main.getByRole('button', { name: /^(Trial Balance|מאזן בוחן)$/ }).click();
      }
      if (screen.id === 'settings') await main.getByRole('button', { name: 'מראה ותצוגה', exact: true }).click();
      await expect(screen.ready(main)).toBeVisible({ timeout: 20_000 });
      // Trial Balance and its date control mount together after the lazy report loads.
      if (screen.id === 'trial-balance') await expect(main.getByLabel('נכון לתאריך')).toHaveValue(hebrewSample.to);
      await expect(page.locator('html')).toHaveAttribute('lang', 'he');
      await expect(main).toHaveCSS('direction', 'rtl');
      await expect(main.locator('[data-screen-data-notice]')).toHaveCount(0);
      if (screen.id === 'pnl') {
        await expect(main.getByLabel('תאריך תחילת תקופת הדוח')).toHaveValue(hebrewSample.from);
        await expect(main.getByText(hebrewSample.expenseName, { exact: true }).first()).toBeVisible();
        await expect(main.getByText(/[-−][^\d]*200\.00/).first()).toBeVisible();
      }
      if (screen.id === 'reconcile') {
        const debit = main.locator('bdi').filter({ hasText: /[-−][^\d]*1,416\.00/ });
        await expect(debit).toBeVisible();
        await expect(debit).toHaveCSS('unicode-bidi', 'isolate');
        // DOM visibility alone misses rows cut off by the fixed-height matching panes. Scroll at
        // the real phone height; don't use scrollIntoView, which can also scroll clipped elements.
        if (width === 390) {
          await page.mouse.move(12, 400);
          await page.mouse.wheel(0, 2_000);
        }
        await expect(main.getByRole('button', { name: new RegExp(hebrewSample.bankLine) })).toBeInViewport({ ratio: 1 });
        await expect(debit).toBeInViewport({ ratio: 1 });
        await expect(main.getByRole('button', { name: new RegExp(hebrewSample.billNumber) })).toBeInViewport({ ratio: 1 });
      }
      if (screen.id === 'vat-report') {
        await expect(main.getByLabel('תאריך התחלה', { exact: true })).toHaveValue(hebrewSample.from);
        await expect(main.getByTestId('il-vat-empty-period')).toHaveCount(0);
      }
      await page.evaluate(() => document.fonts.ready);
      await waitForFiniteAnimations(page);
      await expect.poll(() => main.evaluate(el => Math.max(
        el.scrollWidth - el.clientWidth, document.documentElement.scrollWidth - innerWidth,
      ))).toBeLessThanOrEqual(1);

      // The app scrolls inside main, so fullPage alone does not capture the whole screen.
      // Reconcile's matching panes are viewport-bound; give the stacked phone panes extra room
      // rather than measuring them in a resize loop. Keep the actual width in either case.
      if (screen.id === 'reconcile') {
        if (width === 390) await page.setViewportSize({ width, height: 1_500 });
      } else {
        for (let attempt = 0; attempt < 6; attempt++) {
          const overflow = await main.evaluate(element => element.scrollHeight - element.clientHeight);
          if (overflow <= 1) break;
          const height = page.viewportSize()!.height + overflow;
          expect(height).toBeLessThan(16_000);
          await page.setViewportSize({ width, height });
        }
        await expect.poll(() => main.evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
      }
      await main.evaluate(element => { element.scrollTop = 0; });
      await page.mouse.move(0, 0);
      await waitForFiniteAnimations(page);
      if (screen.id === 'reconcile') {
        await expect(screen.ready(main)).toBeInViewport({ ratio: 1 });
        await expect(main.getByRole('button', { name: new RegExp(hebrewSample.billNumber) })).toBeInViewport({ ratio: 1 });
      }
      await expect(page).toHaveScreenshot(`h1-hebrew-${screen.id}-${width}.png`, {
        fullPage: true, animations: 'disabled', caret: 'hide', scale: 'css',
        threshold: 0.1, maxDiffPixels: 100,
      });
      expect(errors).toEqual([]);
    });
  }
});
