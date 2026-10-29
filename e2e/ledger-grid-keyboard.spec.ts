import { test, expect } from '@playwright/test';

/**
 * #104 browser re-check: the transaction grid is one keyboard region. The old code listened on
 * `window`, swallowed Tab everywhere (the keyboard could not leave the grid) and pointed the
 * highlight at rows the virtualized list had not drawn. The fix (#416) is pinned in jsdom by
 * `ledger-grid-keyboard-region.test.tsx` / `ledger-grid-nav.test.ts`; this spec walks the same
 * contract in a real browser on the real Transactions screen (guest demo books, two entries — the
 * 200-row scroll mechanics stay with the unit suites, which assert the `scrollToItem` call).
 */

test('ledger grid: arrows move the announced highlight, Tab leaves, Escape clears (#104)', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    localStorage.setItem('isGuest', 'true');
    localStorage.setItem('has_seen_onboarding', 'true');
    localStorage.setItem('ledgerflow-cookie-consent', 'accepted');
  });
  await page.goto('/#transactions');
  await expect(page.getByRole('heading', { name: 'Journal Entries', exact: true })).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(async () => {
    const { useLedgerStore } = await import('/src/stores/useLedgerStore.ts') as typeof import('../src/stores/useLedgerStore');
    return useLedgerStore.getState().transactions.length;
  }), { message: 'the demo entries are loaded' }).toBe(2);

  const region = page.getByRole('region', { name: 'Transaction list' });
  const status = region.getByRole('status');
  await region.focus();
  await expect(region, 'the grid region itself takes keyboard focus').toBeFocused();

  await page.keyboard.press('ArrowDown');
  await expect(status, 'the first arrow lands on the first row and says so').toContainText('Row 1 of 2');
  await page.keyboard.press('ArrowDown');
  await expect(status).toContainText('Row 2 of 2');
  await page.keyboard.press('ArrowUp');
  await expect(status).toContainText('Row 1 of 2');
  await page.keyboard.press('End');
  await expect(status).toContainText('Row 2 of 2');

  // The announced row is actually drawn on screen (its description, inside the grid's own box).
  const announcement = (await status.innerText()).trim();
  const description = announcement.match(/^Row 2 of 2, .+? column: .+?, (.+), /)?.[1];
  expect(description, `the announcement names the row (“${announcement}”)`).toBeTruthy();
  const cell = region.getByText(description!, { exact: true }).first();
  await expect(cell, 'the highlighted row is drawn').toBeVisible();
  await expect(cell).toBeInViewport();

  // Tab is the browser's again: one press moves focus off the region, Shift+Tab is equally free.
  await region.focus();
  await page.keyboard.press('Tab');
  expect(await region.evaluate((el) => document.activeElement === el), 'Tab is not swallowed by the grid').toBe(false);
  await region.focus();
  await page.keyboard.press('Shift+Tab');
  expect(await region.evaluate((el) => document.activeElement === el), 'Shift+Tab is not swallowed either').toBe(false);

  // Escape clears the highlight (the live region goes quiet) instead of leaving a stale row named.
  await region.focus();
  await page.keyboard.press('Escape');
  await expect(status).toHaveText('');

  expect(errors).toEqual([]);
});
