import { installSmallSample } from './helpers/sampleFixture';
import { test, expect } from '@playwright/test';
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
        localStorage.setItem('ledgerflow-cookie-consent', 'accepted');
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
