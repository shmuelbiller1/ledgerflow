/**
 * A screen that has moved onto the shared list must not drift back to drawing its own table.
 *
 * `rawTables` in quality-baseline.json only ever counts down, but the number is a total: one screen
 * going back while another moves forward leaves the total unchanged, and CI stays green. This is the
 * per-screen lock — the files that have been moved are listed here, and each one must stay moved.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

/**
 * Screens on the shared list, and the shared list itself. Add a screen here in the PR that moves it;
 * never remove one. `TanStackDataGrid` is the only file allowed to draw a `<table>` for a list.
 */
const ON_THE_SHARED_LIST: Record<string, string> = {
  'src/components/sales/Sales.tsx': 'the customers list (columnScope sales-customers)',
  'src/components/purchases/Purchases.tsx': 'the vendors list',
  'src/components/inventory/Inventory.tsx': 'the items list',
  'src/components/reporting/BankClearanceReportView.tsx': 'the first report: row headers and a totals row',
};

describe('a moved screen stays on the shared list', () => {
  for (const [file, what] of Object.entries(ON_THE_SHARED_LIST)) {
    test(`${file} uses TanStackDataGrid and draws no table of its own (${what})`, () => {
      const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
      assert.match(source, /TanStackDataGrid/, `${file} must render the shared list`);
      assert.equal(
        (source.match(/<table\b/g) ?? []).length,
        0,
        `${file} draws its own <table> again: move it back onto TanStackDataGrid`,
      );
    });
  }

  test('the shared list itself is the one place a list <table> may be drawn', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src/components/ui/TanStackDataGrid.tsx'), 'utf8');
    assert.equal((source.match(/<table\b/g) ?? []).length, 1);
    // the two props the report screens need, so this cannot be dropped without a failure here
    assert.match(source, /rowHeaderColumn\?: string/);
    assert.match(source, /totals\?: \{/);
  });
});
