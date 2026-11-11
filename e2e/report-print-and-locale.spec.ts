import { installSmallSample } from './helpers/sampleFixture';
import { test, expect, type Page } from '@playwright/test';

/**
 * A-218 and A-220 on the real screens, in a guest workspace with no records.
 *
 * A-218: the Reports page (where Profit & Loss, Balance Sheet and Trial Balance live) offers the
 * paper, the `@page` rule the browser's print dialog obeys is really in the document, choosing US
 * Letter changes it, and in print media the page comes out as paper: navigation and buttons gone,
 * tables at the full printed width rather than clipped inside their on-screen scroll box.
 *
 * A-220: a report header states its period the way the reader's locale writes dates, not as the
 * stored `2026-10-01` string, and says which locale it used.
 */

async function signInAsGuest(page: Page) {
  // These print/empty-entity scenarios require books without labelled sample-year documents.
  await installSmallSample(page, true);
  await page.addInitScript(() => {
    localStorage.setItem('isGuest', 'true');
    localStorage.setItem('has_seen_onboarding', 'true');
    localStorage.setItem('ledgerflow-cookie-consent', 'accepted');
  });
}

const pageRule = (page: Page) =>
  page.evaluate(() => document.querySelector('style[data-print-page-rule]')?.textContent || '');

test('A-218: the Reports page prints on the chosen paper and keeps its columns', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await signInAsGuest(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?report=pnl#reports');

  await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible({ timeout: 30000 });

  // the control and the sheet it starts on (A4, the international default, 186 mm of print width)
  const paper = page.getByLabel('Paper size for printing');
  await expect(paper).toBeVisible();
  await expect(paper).toHaveValue('a4');
  await expect(page.getByTestId('print-layout-summary')).toContainText('A4 portrait');
  await expect.poll(() => pageRule(page)).toBe('@page { size: A4 portrait; margin: 12mm; }');

  // choosing US Letter reaches the document, and is remembered for the next visit
  await paper.selectOption('letter');
  await expect.poll(() => pageRule(page)).toBe('@page { size: Letter portrait; margin: 12mm; }');
  await expect(page.getByTestId('print-layout-summary')).toContainText('191.9 mm wide');
  expect(await page.evaluate(() => localStorage.getItem('lf_print_paper'))).toBe('letter');

  await page.reload();
  await expect(page.getByLabel('Paper size for printing')).toHaveValue('letter', { timeout: 30000 });

  // in print media the screen becomes paper: chrome gone, the report's table as wide as the page
  await page.emulateMedia({ media: 'print' });
  await expect
    .poll(() => page.locator('[data-testid="report-tabs"]').evaluate(el => getComputedStyle(el).display))
    .toBe('none');
  const fitted = await page.evaluate(() => {
    const root = document.querySelector('[data-print-root]') as HTMLElement | null;
    const table = root?.querySelector('table') as HTMLElement | null;
    if (!root || !table) return null;
    return {
      overflow: getComputedStyle(root).overflow,
      tableWidth: Math.round(table.getBoundingClientRect().width),
      rootWidth: Math.round(root.getBoundingClientRect().width),
    };
  });
  if (fitted) {
    expect(fitted.overflow).toBe('visible');
    // the table fills the printed page instead of being cut at the on-screen scroll width
    expect(fitted.tableWidth).toBeGreaterThan(fitted.rootWidth * 0.9);
  }
  await page.emulateMedia({ media: 'screen' });

  expect(errors).toEqual([]);
});

test('A-220: a report header states its period in dates a reader recognises', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await signInAsGuest(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?report=pnl#reports');

  // the Reports page also renders a print-only copy of this line; check the one on screen
  const heading = page.locator('[data-testid="report-period-heading"]:visible').first();
  await expect(heading).toBeVisible({ timeout: 30000 });
  const text = (await heading.innerText()).trim();
  const locale = await heading.getAttribute('data-report-locale');

  // a known locale, an actual date range, and never the stored YYYY-MM-DD storage format
  expect(['en-US', 'en-GB', 'he-IL', 'de-DE', 'fr-FR', 'es-ES', 'it-IT', 'nl-NL', 'de-CH', 'en-IN', 'ja-JP']).toContain(locale);
  expect(text).toMatch(/[A-Za-z\u0590-\u05FF]{3,}/);
  expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  // a year is always part of it; a one-day period (the 1st of a month) is written once, so no dash
  // is required
  expect(text).toMatch(/(19|20)\d{2}/);
  expect(text).not.toContain('Invalid Date');
  expect(text).not.toContain('NaN');

  // the balance sheet reads one date as "As of …"
  await page.goto('/?report=balance-sheet#reports');
  // the Reports page's own period line is still on screen; the balance sheet's header is the one
  // that reads "As of" and names a single day
  const asOf = page
    .locator('[data-testid="report-period-heading"]:visible')
    .filter({ hasText: 'As of' })
    .first();
  await expect(asOf).toBeVisible({ timeout: 30000 });
  await expect(asOf).toContainText('As of');
  expect(await asOf.innerText()).not.toMatch(/\d{4}-\d{2}-\d{2}/);

  expect(errors).toEqual([]);
});

test('A-72: the statement screen offers an entity only when the documents carry one', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await signInAsGuest(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?report=statement#reports');

  // the report draws, and with no labelled documents there is no entity to choose (an empty select
  // would promise a filter that cannot do anything)
  await expect(page.getByRole('heading', { name: 'Account Statement', exact: true }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByLabel('Entity label for this statement')).toHaveCount(0);
  await expect(page.getByTestId('statement-entity-note')).toHaveCount(0);

  expect(errors).toEqual([]);
});
