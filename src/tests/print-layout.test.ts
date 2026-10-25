/**
 * A-218: paper sizes and a printed table that keeps every column.
 *
 * The rules are checked as text (the `@page` rule the screen injects) and as CSS (the print block in
 * src/index.css), so a regression in either is caught without opening a browser. The component test
 * mounts the control, chooses a paper and proves the rule reaches the document head.
 */
import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import {
  PORTRAIT_COLUMN_LIMIT,
  PRINT_MARGIN_MM,
  PRINT_PAPER_STORAGE_KEY,
  PRINT_PAPER_SIZES,
  choosePrintOrientation,
  countPrintedColumns,
  paperSize,
  printLayoutSummary,
  printPageRule,
  printableWidthMm,
  readPrintPaper,
  savePrintPaper,
} from '../lib/printLayout';
import { PrintLayoutControl } from '../components/reporting/PrintLayoutControl';

afterEach(() => {
  cleanup();
  localStorage.removeItem(PRINT_PAPER_STORAGE_KEY);
  for (const style of Array.from(document.querySelectorAll('style[data-print-page-rule]'))) style.remove();
});

const indexCss = fs.readFileSync('src/index.css', 'utf8');

/** The bodies of every `@media print { ... }` block in the app stylesheet, brace-matched. */
function printBlocks(css: string): string {
  const bodies: string[] = [];
  let from = 0;
  for (;;) {
    const at = css.indexOf('@media print', from);
    if (at === -1) break;
    const open = css.indexOf('{', at);
    let depth = 0;
    let i = open;
    for (; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    bodies.push(css.slice(open + 1, i));
    from = i + 1;
  }
  return bodies.join('\n');
}
const printCss = printBlocks(indexCss);

test('A-218: the two paper sizes carry their real measurements', () => {
  assert.deepEqual(PRINT_PAPER_SIZES.map(p => p.value), ['a4', 'letter']);
  const a4 = paperSize('a4');
  assert.equal(a4.cssName, 'A4');
  assert.equal(a4.widthMm, 210);
  assert.equal(a4.heightMm, 297);
  const letter = paperSize('letter');
  assert.equal(letter.cssName, 'Letter');
  // US Letter is 8.5 × 11 inches = 215.9 × 279.4 mm
  assert.equal(letter.widthMm, 215.9);
  assert.equal(letter.heightMm, 279.4);
  // an unknown value falls back to A4 rather than printing nothing
  assert.equal(paperSize('legal' as never).value, 'a4');
});

test('A-218: the page rule names the sheet, its turn and the 12 mm margin every screen already uses', () => {
  assert.equal(printPageRule('a4'), `@page { size: A4 portrait; margin: ${PRINT_MARGIN_MM}mm; }`);
  assert.equal(printPageRule('letter'), '@page { size: Letter portrait; margin: 12mm; }');
  assert.equal(printPageRule('a4', 'landscape'), '@page { size: A4 landscape; margin: 12mm; }');
  assert.equal(printPageRule('letter', 'landscape'), '@page { size: Letter landscape; margin: 12mm; }');
});

test('A-218: a table wider than a portrait sheet turns the sheet instead of losing columns', () => {
  assert.equal(PORTRAIT_COLUMN_LIMIT, 6);
  assert.equal(choosePrintOrientation(0), 'portrait');
  assert.equal(choosePrintOrientation(3), 'portrait');
  assert.equal(choosePrintOrientation(6), 'portrait');
  // trial balance with a comparison column, balance sheet with prior year: 7+ columns
  assert.equal(choosePrintOrientation(7), 'landscape');
  assert.equal(choosePrintOrientation(11), 'landscape');
  // nonsense input never turns a sheet by accident
  assert.equal(choosePrintOrientation(-4), 'portrait');
  assert.equal(choosePrintOrientation(Number.NaN), 'portrait');
});

test('A-218: the printed width is the sheet minus both margins, worked by hand', () => {
  // A4 portrait: 210 − 24 = 186 mm; A4 landscape: 297 − 24 = 273 mm
  assert.equal(printableWidthMm('a4'), 186);
  assert.equal(printableWidthMm('a4', 'landscape'), 273);
  // Letter portrait: 215.9 − 24 = 191.9 mm; landscape: 279.4 − 24 = 255.4 mm
  assert.equal(printableWidthMm('letter'), 191.9);
  assert.equal(printableWidthMm('letter', 'landscape'), 255.4);
  assert.equal(printLayoutSummary('a4', 'portrait'), 'A4 portrait · 186 mm wide');
  assert.equal(printLayoutSummary('letter', 'landscape'), 'Letter landscape · 255.4 mm wide');
});

test('A-218: the chosen paper is remembered per browser and defaults to A4', () => {
  assert.equal(readPrintPaper(), 'a4');
  assert.equal(savePrintPaper('letter'), 'letter');
  assert.equal(localStorage.getItem(PRINT_PAPER_STORAGE_KEY), 'letter');
  assert.equal(readPrintPaper(), 'letter');
  // an unrelated stored value is not trusted
  localStorage.setItem(PRINT_PAPER_STORAGE_KEY, 'A3');
  assert.equal(readPrintPaper(), 'a4');
  assert.equal(savePrintPaper('xx' as never), 'a4');
});

test('A-218: the paper rule is injected while the control is mounted and removed with it', () => {
  const { unmount } = render(React.createElement(PrintLayoutControl, { columnCount: 3 }));
  const style = document.querySelector('style[data-print-page-rule]');
  assert.ok(style, 'a print page rule is in the document');
  assert.equal(style!.textContent, '@page { size: A4 portrait; margin: 12mm; }');
  assert.match(screen.getByTestId('print-layout-summary').textContent || '', /A4 portrait · 186 mm wide/);

  fireEvent.change(screen.getByLabelText('Paper size for printing'), { target: { value: 'letter' } });
  assert.equal(localStorage.getItem(PRINT_PAPER_STORAGE_KEY), 'letter');
  const updated = document.querySelector('style[data-print-page-rule]');
  assert.equal(updated!.textContent, '@page { size: Letter portrait; margin: 12mm; }');
  assert.match(screen.getByTestId('print-layout-summary').textContent || '', /Letter portrait · 191\.9 mm wide/);

  unmount();
  assert.equal(document.querySelector('style[data-print-page-rule]'), null);
});

test('A-218: a wide table reports landscape and says why', () => {
  render(React.createElement(PrintLayoutControl, { columnCount: 9 }));
  assert.equal(
    document.querySelector('style[data-print-page-rule]')!.textContent,
    '@page { size: A4 landscape; margin: 12mm; }',
  );
  assert.match(screen.getByTestId('print-layout-summary').textContent || '', /no column is cut/);
});

test('A-218: the printed column count follows the widest header row on screen', () => {
  const root = document.createElement('div');
  root.innerHTML = `
    <table><caption>Profit and loss</caption>
      <thead><tr><th>Account</th><th>This period</th><th>Last period</th></tr></thead>
      <tbody><tr><td>Sales</td><td>300.00</td><td>250.00</td></tr></tbody>
    </table>
    <table>
      <thead><tr><th>Code</th><th>Account</th><th>Debit</th><th>Credit</th><th>Balance</th><th>Prior</th><th>Change</th></tr></thead>
      <tbody><tr><td>1000</td><td>Bank</td><td>5,000.00</td><td>0.00</td><td>5,000.00</td><td>4,800.00</td><td>200.00</td></tr></tbody>
    </table>`;
  assert.equal(countPrintedColumns(root), 7);
  assert.equal(choosePrintOrientation(countPrintedColumns(root)), 'landscape');
  assert.equal(countPrintedColumns(null), 0);
  assert.equal(countPrintedColumns(document.createElement('div')), 0);
});

test('A-218: the print stylesheet keeps every column and hides navigation, buttons and controls', () => {
  // navigation, the header and buttons never print (the screen's own content does)
  assert.match(printCss, /\[role="navigation"\][^{]*\{[^}]*display:\s*none\s*!important/);
  assert.match(printCss, /\bbutton\s*\{[^}]*display:\s*none\s*!important/);
  // a scroll box prints in full instead of being clipped at its on-screen width
  assert.match(printCss, /\[data-print-root\]\s*\{[^}]*overflow:\s*visible\s*!important/);
  assert.match(printCss, /\[class\*="overflow-x"\][^{]*\{[^}]*overflow:\s*visible\s*!important/);
  // the table fills the paper and a long name wraps inside its cell
  assert.match(printCss, /\[data-print-root\] table\s*\{[^}]*width:\s*100%\s*!important/);
  assert.match(printCss, /\[data-print-root\] th,\s*\[data-print-root\] td\s*\{[^}]*white-space:\s*normal\s*!important/);
  assert.match(printCss, /\[data-print-root\] th,\s*\[data-print-root\] td\s*\{[^}]*overflow-wrap:\s*anywhere/);
  // amounts never split across lines
  // Codex review on PR #403: the no-wrap rule must sit on the monetary cells themselves (the
  // `whitespace-nowrap` class every amount cell in StatementColumns carries, and right-aligned
  // figure cells), because an inherited value cannot beat the explicit `normal` set on each td
  assert.match(printCss, /\[data-print-root\] td\.whitespace-nowrap[\s\S]{0,400}white-space:\s*nowrap\s*!important/);
  assert.match(printCss, /\[data-print-root\] td\.text-right[\s\S]{0,400}white-space:\s*nowrap\s*!important/);
  // and that rule comes after the general wrapping rule, so it wins at equal or higher specificity
  assert.ok(printCss.indexOf('td { white-space: normal !important') < printCss.indexOf('td.whitespace-nowrap'));
  // rows and their headings stay whole across a page break
  assert.match(printCss, /thead\s*\{[^}]*display:\s*table-header-group/);
  assert.match(printCss, /tr,\s*img,\s*svg\s*\{[^}]*break-inside:\s*avoid/);
});

test('A-218 review: spanning header cells count as the columns they cover', () => {
  const root = document.createElement('div');
  // the comparative P&L with "% of total": Account and Code span two rows above five grouped columns
  root.innerHTML = `
    <table class="tabular-nums">
      <thead>
        <tr><th rowspan="2">Account</th><th rowspan="2">Code</th><th colspan="2">This period</th><th colspan="2">Last period</th><th rowspan="2">Change</th></tr>
        <tr><th>Amount</th><th>%</th><th>Amount</th><th>%</th></tr>
      </thead>
      <tbody><tr><td>Sales</td><td>4000</td><td>300.00</td><td>60%</td><td>250.00</td><td>55%</td><td>50.00</td></tr></tbody>
    </table>`;
  assert.equal(countPrintedColumns(root), 7);
  assert.equal(choosePrintOrientation(countPrintedColumns(root)), 'landscape');

  // a plain two-row header with no spans still counts its widest row
  const plain = document.createElement('div');
  plain.innerHTML = `<table><thead><tr><th>A</th><th>B</th></tr><tr><th>A</th><th>B</th><th>C</th></tr></thead></table>`;
  assert.equal(countPrintedColumns(plain), 3);
  // a nonsense colspan counts as one column
  const odd = document.createElement('div');
  odd.innerHTML = `<table><thead><tr><th colspan="0">A</th><th colspan="x">B</th></tr></thead></table>`;
  assert.equal(countPrintedColumns(odd), 2);
});
