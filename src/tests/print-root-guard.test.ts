/**
 * H-7 (AI #10): a screen with a Print button must tell the print stylesheet *what* to print.
 *
 * The print rules in `src/index.css` narrow the paper to the nearest `[data-print-root]`:
 *
 *   body:has([data-print-root]) * { visibility: hidden; }
 *   body:has([data-print-root]) [data-print-root] * { visibility: visible; }
 *
 * When a screen calls `window.print()` without a root, nothing is hidden and the paper gets the
 * whole application shell — sidebar, header, pinned-page bar, banners, and the on-screen filters —
 * around and partly over the document. On screen the defect is invisible, because the print button
 * itself carries `print:hidden` / `data-print-hide`, so no browser test that only looked at the
 * screen ever failed: nine surfaces shipped that way (general ledger, account statement, Israel VAT
 * report, delivery notes, period-closing document, access review, invoice form, warehouse packing
 * slip, report pack).
 *
 * This guard is source-level and deterministic. For every component, it finds the `window.print()`
 * calls and the `printElement(...)`/`printElementById(...)` calls:
 *
 *   - `window.print()` is allowed only in a file that marks a print root itself; otherwise the
 *     verdict is "prints the shell".
 *   - `printElementById('x')` must be paired with `id="x"` on a `data-print-root` element in the
 *     same file — a typo in the id would silently print the application shell again.
 *
 * It is a guard, not a proof: it cannot know that the root contains the right figures. The browser
 * evidence for these surfaces lives in `e2e/print-styles.spec.ts`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

function walkTsx(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', 'dist', 'tests', '__screenshots__'].includes(entry.name)) walkTsx(full, found);
    } else if (entry.name.endsWith('.tsx')) {
      found.push(full);
    }
  }
  return found;
}

/** Strip line and block comments so an example in a comment is never read as a call. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const files = walkTsx(path.join(ROOT, 'src')).map(file => ({
  file: path.relative(ROOT, file),
  code: codeOnly(fs.readFileSync(file, 'utf8')),
}));

test('H-7: every `window.print()` call sits in a file that declares its print root', () => {
  const offenders: string[] = [];
  for (const { file, code } of files) {
    const calls = [...code.matchAll(/window\.print\s*\(/g)];
    if (!calls.length) continue;
    const declaresRoot = /data-print-root/.test(code);
    if (!declaresRoot) {
      const lines = calls.map(m => code.slice(0, m.index).split('\n').length);
      offenders.push(`${file}: window.print() at line ${lines.join(', ')} and no data-print-root in the file`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'these screens print the whole application shell instead of their own document '
      + '(mark the sheet `data-print-root` and call `printElementById(<its id>)`):\n'
      + offenders.join('\n'),
  );
});

test('H-7: every `printElementById(id)` names an id that is a print root in the same file', () => {
  const problems: string[] = [];
  for (const { file, code } of files) {
    for (const match of code.matchAll(/printElementById\(\s*['"]([^'"]+)['"]/g)) {
      const id = match[1];
      // the JSX tag holding the id also has to carry data-print-root, in either attribute order
      const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const tagged = new RegExp(`<[a-zA-Z][^>]*id=["']${escaped}["'][^>]*data-print-root|<[a-zA-Z][^>]*data-print-root[^>]*id=["']${escaped}["']`);
      if (!tagged.test(code)) problems.push(`${file}: printElementById('${id}') but no element has that id and data-print-root`);
    }
  }
  assert.deepEqual(problems, []);
});

test('H-7: the printing surfaces known to have been missing a root all have one now', () => {
  // the nine surfaces named in the finding; each is a file the audit recorded as printing the shell
  const expected: Record<string, string> = {
    'src/components/ledger/GeneralLedgerView.tsx': 'general-ledger-sheet',
    'src/components/reporting/StatementView.tsx': 'statement-sheet',
    'src/components/reporting/IsraelVatReportView.tsx': 'israel-vat-return',
    'src/components/reporting/DeliveryNotesReportView.tsx': 'delivery-note-sheet',
    'src/components/ledger/PeriodClosingPanel.tsx': 'period-closing-sheet',
    'src/components/platform/settings/AccessReviewPanel.tsx': 'access-review-sheet',
    'src/components/sales/InvoiceModal.tsx': 'invoice-form-sheet',
    'src/components/reporting/reportPack/ReportPackDialog.tsx': 'report-pack-sheet',
    'src/components/reporting/PickPackShipPanel.tsx': 'warehouse-packing-slip',
  };
  const missing: string[] = [];
  for (const [file, id] of Object.entries(expected)) {
    const source = files.find(entry => entry.file === file)?.code;
    if (!source) { missing.push(`${file}: not found`); continue; }
    if (!new RegExp(`id=["']${id}["']`).test(source)) missing.push(`${file}: no element with id "${id}"`);
    if (!/data-print-root/.test(source)) missing.push(`${file}: no data-print-root`);
  }
  assert.deepEqual(missing, []);
});

test('H-7: the print stylesheet releases the dialog boxes a sheet can live inside', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src/index.css'), 'utf8');
  // the ancestor rule: every element that contains the print root releases its scroll box, so a
  // statement inside a dialog is not cut off after one screen-height
  assert.match(css, /body:has\(\[data-print-root\]\)\s*:has\(\[data-print-root\]\)\s*\{[^}]*overflow:\s*visible\s*!important/);
  assert.match(css, /body:has\(\[data-print-root\]\)\s*:has\(\[data-print-root\]\)\s*\{[^}]*max-height:\s*none\s*!important/);
});
