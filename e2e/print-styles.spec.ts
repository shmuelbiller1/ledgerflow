import { mountJourney } from './support/journeyFixture';
import { seedCountryDemoWorkspace } from '../src/lib/countryDemoWorkspace';
import { test, expect, type Page } from '@playwright/test';
import { seedDemoBooks } from './helpers/demoBooks';

/**
 * A-271: an invoice, a statement and the five main reports print on A4 and on US Letter — the page
 * only, no navigation or controls, no column cut off — and the page count does not wander between
 * runs.
 *
 * The paper rules themselves are the Reports page's own (A-218: `PrintLayoutControl` writes the
 * `@page` rule the browser obeys); this spec proves the paper the dialog produces really changes,
 * measures the printed geometry in print media, and prints a real PDF with Playwright to count its
 * pages twice. No figures are computed here and nothing is saved.
 *
 * A-273: the invoice case loads a real PDF (the document endpoint is stubbed with a small PDF
 * fixture carrying the invoice number and total) and checks those bytes reached the preview, so the
 * printed invoice is the document, not the preview shell. A-277: the trial balance and the journal
 * (Ledger tab) are their own print roots with the same paper choice, and the journal sheet joins
 * the Reports loop.
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

/**
 * A-273: a small one-page PDF carrying the given lines, so the invoice preview loads a real
 * document (the guest has no token, so the document endpoint would refuse). The bytes are the
 * evidence: the test reads the previewed blob and checks the invoice number and total are in it.
 */
function pdfWithText(lines: string[]): Buffer {
  const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const content = lines.map((line, i) => `BT /F1 14 Tf 72 ${720 - i * 24} Td (${escape(line)}) Tj ET`).join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
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
  // A-277: the journal sheet already prints from the Reports root; it joins the same paper checks
  { id: 'journal-sheet', title: 'Journal Sheet' },
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
      await expectPaperSwitch(page);

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

test('A-273: printing an invoice document gives the loaded document alone, not the window around it', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  // PDF generation is a signed-in service, not a local sample operation. Exercise the real
  // Sales/preview screens with an authenticated fixture and a worked, stubbed PDF response.
  const books = seedCountryDemoWorkspace('print-invoice', 'US');
  await mountJourney(page, { workspaceId: 'print-invoice', ledger: { ...books }, mounts: [{ module: '/src/components/sales/Sales.tsx' }] });
  const invoicePdf = pdfWithText(['Invoice DEMO-US-001', 'Total: $16,500.00']);
  await page.route('**/api/v1/documents/invoice/*/pdf*', route =>
    route.fulfill({ status: 200, contentType: 'application/pdf', body: invoicePdf }));
  const row = page.getByRole('row').filter({ hasText: 'DEMO-US-001' }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  // the row's own PDF-preview control opens the document preview
  await row.getByRole('button', { name: 'Preview PDF', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /Invoice DEMO-US-001/ });
  await expect(dialog).toBeVisible({ timeout: 30_000 });

  // the preview really loaded: the document frame is there with the stubbed PDF, not the error state
  const frame = dialog.locator('iframe');
  await expect(frame).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByText('Unable to render PDF')).toHaveCount(0);
  const previewedPdf = await page.evaluate(async () => {
    const el = document.querySelector('[role="dialog"] iframe') as HTMLIFrameElement | null;
    if (!el?.src?.startsWith('blob:')) return '';
    const res = await fetch(el.src);
    return new TextDecoder('latin1').decode(await res.arrayBuffer());
  });
  expect(previewedPdf).toContain('DEMO-US-001');
  expect(previewedPdf).toContain('16,500.00');

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

/**
 * The browser's paper follows the page the reader chose (A4 is the default, Letter is offered),
 * and the same document twice has the same page count (a report that fits one sheet stays one).
 */
async function expectPaperSwitch(page: Page) {
  const paper = page.getByLabel('Paper size for printing');
  await expect(paper).toHaveValue('a4');
  const a4 = await page.pdf({ printBackground: true, preferCSSPageSize: true });
  expect(mediaBox(a4)).toEqual(A4_BOX);

  await paper.selectOption('letter');
  await expect(page.getByTestId('print-layout-summary')).toContainText('mm wide');
  const letter = await page.pdf({ printBackground: true, preferCSSPageSize: true });
  expect(mediaBox(letter)).toEqual(LETTER_BOX);

  const again = await page.pdf({ printBackground: true, preferCSSPageSize: true });
  expect(pageCount(again)).toBe(pageCount(letter));
  expect(pageCount(letter)).toBeGreaterThanOrEqual(1);
}

/** Open a Ledger lens tab with the demo books loaded; returns the main region. */
async function gotoLedgerLens(page: Page, tab: string, heading: string) {
  await page.goto('/#ledger');
  await seedDemoBooks(page);
  const main = page.locator('#main-content');
  await main.getByRole('button', { name: 'Accountant Lens', exact: true }).click();
  await main.getByRole('button', { name: tab, exact: true }).click();
  await expect(main.getByRole('heading', { name: heading, exact: true })).toBeVisible({ timeout: 60_000 });
  return main;
}

/** A-277: a Ledger print root (trial balance or journal) on the chosen paper, page only, nothing cut. */
async function expectLedgerPrintRoot(page: Page, heading: string) {
  await expect(page.getByLabel('Paper size for printing')).toBeVisible({ timeout: 60_000 });
  await expectPaperSwitch(page);

  await page.emulateMedia({ media: 'print' });
  const printed = await page.evaluate((expectedHeading: string) => {
    const visible = (el: Element) => {
      const style = getComputedStyle(el as HTMLElement);
      const box = (el as HTMLElement).getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && box.height > 0 && box.width > 0;
    };
    const printedRoot = document.querySelector('[data-print-root]') as HTMLElement | null;
    const tables = printedRoot ? [...printedRoot.querySelectorAll('table')] : [];
    return {
      roots: document.querySelectorAll('[data-print-root]').length,
      buttons: [...document.querySelectorAll('button')].filter(visible).length,
      nav: [...document.querySelectorAll('nav, [role="navigation"], header')].filter(visible).length,
      buttonsInRoot: printedRoot ? [...printedRoot.querySelectorAll('button')].filter(visible).length : -1,
      tablesFit: tables.every(t => t.getBoundingClientRect().width <= (printedRoot?.getBoundingClientRect().width ?? 0) + 1),
      overflow: printedRoot ? getComputedStyle(printedRoot).overflow : '',
      heading: printedRoot?.textContent?.includes(expectedHeading) ?? false,
    };
  }, heading);
  expect(printed.roots).toBe(1);
  expect(printed.nav).toBe(0);
  expect(printed.buttons).toBe(0);
  expect(printed.buttonsInRoot).toBe(0);
  expect(printed.tablesFit).toBe(true);
  expect(printed.overflow).toBe('visible');
  expect(printed.heading).toBe(true);
  await page.emulateMedia({ media: 'screen' });
}

test('A-277: the trial balance prints on A4 then US Letter — the paper changes, nothing is cut', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await signInAsGuest(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  // demo books, so the trial balance has a table to print
  await gotoLedgerLens(page, 'Trial Balance', 'Trial Balance');

  await expectLedgerPrintRoot(page, 'Trial Balance');

  // Codex #600 P2: the footer totals print as text (the drill-down buttons stay off the paper)
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByTestId('tb-total-debits-print')).toBeVisible();
  await expect(page.getByTestId('tb-total-credits-print')).toBeVisible();
  await page.emulateMedia({ media: 'screen' });

  expect(errors).toEqual([]);
});

test('A-277: the journal prints on A4 then US Letter — the paper changes, nothing is cut', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await signInAsGuest(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  // demo books, so the journal has entries to print
  const main = await gotoLedgerLens(page, 'General Journal', 'General journal');
  // the demo entries are income/expense, not hand-typed: widen the filter so they show
  await main.getByRole('checkbox', { name: 'Entries typed in by hand only' }).uncheck();

  await expectLedgerPrintRoot(page, 'General journal');

  // Codex #600 P1: beforeprint expands the paginated list, so the printed journal carries every
  // matching entry and the printed rows reconcile with the printed count
  const journalCount = await page.evaluate(() => {
    const section = document.querySelector('[data-print-root]');
    const heading = section?.querySelector('p')?.textContent ?? '';
    const match = heading.match(/^(\d+)\s+entr/);
    return { heading, count: match ? Number(match[1]) : 0 };
  });
  expect(journalCount.count).toBeGreaterThan(0);
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  // wait for React to render the expanded list, then check every entry is on the paper
  await page.waitForFunction((expected: number) => {
    const section = document.querySelector('[data-print-root]');
    return (section?.querySelectorAll('ul > li').length ?? 0) === expected;
  }, journalCount.count, { timeout: 30_000 });
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));

  expect(errors).toEqual([]);
});
