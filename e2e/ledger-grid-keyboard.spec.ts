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

  // The announced row is actually drawn on screen: exactly one cell carries the drawn keyboard
  // highlight (TransactionRow: ring-2 ring-inset ring-indigo-600 on the focused cell, the row
  // tinted brass), it is the date cell of the announced row (row 2 = data-row-index 1; with the
  // default layout the arrows start on `date` and Up/Down/End keep the field), and it sits
  // inside the viewport. (The announcement itself contains commas —
  // "Row 2 of 2, Oct 29, 2026, Acme …" — so the highlight, not comma-splitting, is the check.)
  await expect(region.locator('.ring-indigo-600'), 'exactly one cell carries the drawn keyboard highlight').toHaveCount(1);
  const cell = region.locator('[data-row-index="1"] [data-column="date"].ring-indigo-600');
  await expect(cell, 'the highlighted cell is the announced row 2 date cell').toHaveCount(1);
  await expect(cell, 'the highlighted cell is drawn').toBeVisible();
  await expect(cell).toBeInViewport({ ratio: 0.5 });

  // Tab is the browser's again: the region holds tabbable controls, so the proof is that tabbing
  // through them eventually leaves the region entirely — not just that one press moves focus
  // off the region element but onto a child. Shift+Tab walks out the other way, equally free.
  const focusOutside = () => region.evaluate((el) => !el.contains(document.activeElement));
  await region.focus();
  let left = false;
  for (let i = 0; i < 40 && !left; i += 1) {
    await page.keyboard.press('Tab');
    left = await focusOutside();
  }
  expect(left, 'Tab eventually leaves the grid').toBe(true);
  await region.focus();
  left = false;
  for (let i = 0; i < 40 && !left; i += 1) {
    await page.keyboard.press('Shift+Tab');
    left = await focusOutside();
  }
  expect(left, 'Shift+Tab eventually leaves the grid').toBe(true);

  // Escape clears the highlight (the live region goes quiet) instead of leaving a stale row named.
  await region.focus();
  await page.keyboard.press('Escape');
  await expect(status).toHaveText('');

  expect(errors).toEqual([]);
});
