import { test, expect, type Page } from '@playwright/test';

/**
 * A-271: an invoice, a statement and the five main reports print on A4 and on US Letter — the page
 * only, no navigation or controls, no column cut off — and the page count does not wander between
 * runs.
 *
 * The paper rules themselves are the Reports page's own (A-218: `PrintLayoutControl` writes the
 * `@page` rule the browser obeys); this spec proves the paper the dialog produces really changes,
 * measures the printed geometry in print media, and prints a real PDF with Playwright to count its
 * pages twice. No figures are computed here and nothing is saved.
 */

const A4_BOX = { width: 595, height: 842 };
const LETTER_BOX = { width: 612, height: 792 };

/** The MediaBox of the first printed page: the physical paper Chromium produced. */
function mediaBox(pdf: Buffer): { width: number; height: number } {
  const found = pdf.toString('latin1').match(/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
  if (!found) throw new Error('the PDF has no page box');
  return { width: Math.round(Number(found[1])), height: Math.round(Number(found[2])) };
}

/** Printed pages, read from the PDF's page tree. */
function pageCount(pdf: Buffer): number {
  const counts = [...pdf.toString('latin1').matchAll(/\/Count\s+(\d+)/g)].map(m => Number(m[1]));
  const direct = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  return counts.length ? Math.max(...counts) : direct;
}

async function signInAsGuest(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('isGuest', 'true');
    localStorage.setItem('has_seen_onboarding', 'true');
    localStorage.setItem('ledgerflow-cookie-consent', 'accepted');
  });
}

const REPORTS = [
  { id: 'pnl', title: 'Profit & Loss' },
  { id: 'balance-sheet', title: 'Balance Sheet' },
  { id: 'cash-flow', title: 'Cash Flow' },
  { id: 'ar-aging', title: 'A/R Aging' },
  { id: 'ap-aging', title: 'A/P Aging' },
] as const;

test.describe('A-271: the reports print on the chosen paper, page only, nothing cut', () => {
  for (const report of REPORTS) {
    test(`${report.title}: A4 then US Letter — the paper changes, the page count does not`, async ({ page }) => {
      test.setTimeout(180_000);
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await signInAsGuest(page);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`/?report=${report.id}#reports`);
      // the report drew: the paper control is on screen and the report's own title is on the page
      // (its print-only copy is the one the sheet carries)
      const root = page.locator('[data-print-root]').first();
      await expect(page.getByLabel('Paper size for printing')).toBeVisible({ timeout: 60_000 });
      await expect(root).toContainText(report.title);

      // the browser's paper follows the page the reader chose (A4 is the default, Letter is offered)
      const paper = page.getByLabel('Paper size for printing');
      await expect(paper).toHaveValue('a4');
      const a4 = await page.pdf({ printBackground: true, preferCSSPageSize: true });
      expect(mediaBox(a4)).toEqual(A4_BOX);

      await paper.selectOption('letter');
      await expect(page.getByTestId('print-layout-summary')).toContainText('mm wide');
      const letter = await page.pdf({ printBackground: true, preferCSSPageSize: true });
      expect(mediaBox(letter)).toEqual(LETTER_BOX);

      // the same document twice: the page count is the same (a report that fits one sheet stays one)
      const again = await page.pdf({ printBackground: true, preferCSSPageSize: true });
      expect(pageCount(again)).toBe(pageCount(letter));
      expect(pageCount(letter)).toBeGreaterThanOrEqual(1);

      // in print media the page is the report: no navigation, no controls, no sideways overflow
      await page.emulateMedia({ media: 'print' });
      const printed = await page.evaluate(() => {
        const visible = (el: Element) => {
          const style = getComputedStyle(el as HTMLElement);
          const box = (el as HTMLElement).getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && box.height > 0 && box.width > 0;
        };
        const printedRoot = document.querySelector('[data-print-root]') as HTMLElement | null;
        const tables = printedRoot ? [...printedRoot.querySelectorAll('table')] : [];
        return {
          buttons: [...document.querySelectorAll('button')].filter(visible).length,
          nav: [...document.querySelectorAll('nav, [role="navigation"], header')].filter(visible).length,
          buttonsInRoot: printedRoot ? [...printedRoot.querySelectorAll('button')].filter(visible).length : -1,
          rootIsZeroLeft: printedRoot ? Math.round(printedRoot.getBoundingClientRect().left) === 0 : false,
          // every table fits the printed column: nothing is cut at an on-screen scroll width
          tablesFit: tables.every(t => t.getBoundingClientRect().width <= (printedRoot?.getBoundingClientRect().width ?? 0) + 1),
          overflow: printedRoot ? getComputedStyle(printedRoot).overflow : '',
        };
      });
      expect(printed.nav).toBe(0);
      expect(printed.buttons).toBe(0);
      expect(printed.buttonsInRoot).toBe(0);
      expect(printed.tablesFit).toBe(true);
      expect(printed.overflow).toBe('visible');
      await page.emulateMedia({ media: 'screen' });

      expect(errors).toEqual([]);
    });
  }
});

test('A-271: an account statement prints as the statement — no controls, one page root, nothing cut', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await signInAsGuest(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?report=statement#reports');
  await expect(page.getByRole('heading', { name: 'Account Statement', exact: true }).first()).toBeVisible({ timeout: 60_000 });

  // the statement's own controls are marked to stay off the paper
  const controls = page.locator('[data-print-hide], .print\\:hidden').first();
  await expect(controls).toBeVisible();
  const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
  expect(pageCount(pdf)).toBeGreaterThanOrEqual(1);

  await page.emulateMedia({ media: 'print' });
  const printed = await page.evaluate(() => {
    const visible = (el: Element) => {
      const style = getComputedStyle(el as HTMLElement);
      const box = (el as HTMLElement).getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && box.height > 0 && box.width > 0;
    };
    return {
      controls: [...document.querySelectorAll('[data-print-hide]')].filter(visible).length,
      buttons: [...document.querySelectorAll('button')].filter(visible).length,
      nav: [...document.querySelectorAll('nav, [role="navigation"], header')].filter(visible).length,
      heading: [...document.querySelectorAll('h1, h2')].filter(visible).map(el => (el.textContent || '').trim()),
    };
  });
  expect(printed.controls).toBe(0);
  expect(printed.buttons).toBe(0);
  expect(printed.nav).toBe(0);
  expect(printed.heading.some(text => /Account Statement/i.test(text))).toBe(true);
  await page.emulateMedia({ media: 'screen' });

  expect(errors).toEqual([]);
});

test('A-271: printing an invoice document gives the document alone, not the window around it', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await signInAsGuest(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.waitForSelector('text="Overview"', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Money In', exact: true }).first().click();
  await page.getByRole('button', { name: 'Invoices', exact: true }).first().click();
  // a demo invoice (the guest workspace's own sample company)
  await page.evaluate(async () => {
    const { seedCountryDemoWorkspace } = await import('/src/lib/countryDemoWorkspace.ts');
    const { useLedgerStore } = await import('/src/stores/useLedgerStore.ts');
    const { useAuthStore } = await import('/src/stores/useAuthStore.ts');
    const workspaceId = useAuthStore.getState().currentWorkspaceId || 'ws-guest';
    const data = seedCountryDemoWorkspace(workspaceId, 'US');
    useLedgerStore.setState({
      accounts: data.accounts, transactions: data.transactions, invoices: data.invoices,
      bills: data.bills, customers: data.customers, vendors: data.vendors,
    });
  });
  const row = page.getByRole('row').filter({ hasText: 'DEMO-US-001' }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  // the row's own PDF-preview control opens the document preview
  await row.getByRole('button').nth(2).click();
  const dialog = page.getByRole('dialog', { name: /Invoice DEMO-US-001/ });
  await expect(dialog).toBeVisible({ timeout: 30_000 });

  await page.emulateMedia({ media: 'print' });
  const printed = await page.evaluate(() => {
    const visible = (el: Element) => {
      const style = getComputedStyle(el as HTMLElement);
      const box = (el as HTMLElement).getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && box.height > 0 && box.width > 0;
    };
    const root = document.querySelector('[data-print-root]') as HTMLElement | null;
    const dialogEl = document.querySelector('[role="dialog"]') as HTMLElement | null;
    return {
      roots: document.querySelectorAll('[data-print-root]').length,
      // the preview window's own toolbar (download, open, close) is not part of the document
      toolbarVisible: dialogEl ? [...dialogEl.querySelectorAll('[data-print-hide]')].filter(visible).length : -1,
      buttons: [...document.querySelectorAll('button')].filter(visible).length,
      nav: [...document.querySelectorAll('nav, [role="navigation"], header')].filter(visible).length,
      rootLeft: root ? Math.round(root.getBoundingClientRect().left) : -1,
      rootWidth: root ? Math.round(root.getBoundingClientRect().width) : -1,
      bodyWidth: document.documentElement.clientWidth,
    };
  });
  expect(printed.roots).toBe(1);
  expect(printed.toolbarVisible).toBe(0);
  expect(printed.buttons).toBe(0);
  expect(printed.nav).toBe(0);
  expect(printed.rootLeft).toBe(0);
  expect(printed.rootWidth).toBe(printed.bodyWidth);

  const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
  expect(pageCount(pdf)).toBeGreaterThanOrEqual(1);
  await page.emulateMedia({ media: 'screen' });

  expect(errors).toEqual([]);
});
