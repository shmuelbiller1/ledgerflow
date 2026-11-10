/**
 * J-2 (Agent #11): the QuickBooks Online migration wizard reads a CSV with the same reader as every
 * other import.
 *
 * Finding J-2 (fixed in this commit): `QBOMigrationWizard` hand-rolled a CSV parser instead of using
 * `src/lib/csv.ts`. Executed against the shared reader's own test inputs it was wrong four ways:
 *   - a memo containing a line break split into a second *row* (`first line` / `second line`),
 *     so the row after it received the wrong values;
 *   - a doubled quote was deleted instead of un-doubled (`He said ""paid""` → `He said paid`);
 *   - a semicolon (European) export stayed one column (`2026-01-05;Acme;paid`);
 *   - a truncated file (an unclosed quote) was accepted silently.
 * The probe that found this is `audit/agent11/probes/j2-qbo-wizard-csv.ts`.
 *
 * The wizard is a screen component, so this suite pins the contract both ways: the shared reader
 * answers these inputs correctly, and the wizard source no longer contains a CSV reader of its own.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseCsv, parseCsvChecked } from '../lib/csv';

describe('J-2 the QuickBooks migration wizard uses the shared CSV reader', () => {
  test('its source has no private CSV parser left', () => {
    const source = fs.readFileSync('src/components/migration/QBOMigrationWizard.tsx', 'utf8');
    assert.ok(source.includes("from '../../lib/csv'"), 'the wizard imports the shared reader');
    assert.ok(/parseCsvChecked\(data\)/.test(source), 'the CSV branch calls the shared reader');
    assert.ok(!/Simple CSV parser supporting quotes/.test(source), 'the hand-rolled parser is gone');
    assert.ok(!/data\.split\(\/\\r\?\\n\/\)/.test(source), 'no line-splitting CSV reader is left in the wizard');
  });

  test('the shared reader keeps a memo that contains a line break in one cell', () => {
    const rows = parseCsv('Date,Name,Memo\n2026-01-05,Acme,"first line\nsecond line"\n');
    assert.deepEqual(rows, [
      ['Date', 'Name', 'Memo'],
      ['2026-01-05', 'Acme', 'first line\nsecond line'],
    ]);
  });

  test('the shared reader un-doubles quotes instead of deleting them', () => {
    const rows = parseCsv('Date,Name,Memo\n2026-01-05,Acme,"He said ""paid"" today"\n');
    assert.equal(rows[1][2], 'He said "paid" today');
  });

  test('the shared reader takes a European semicolon export apart', () => {
    assert.deepEqual(parseCsv('Date;Name;Memo\n2026-01-05;Acme;paid\n'), [
      ['Date', 'Name', 'Memo'],
      ['2026-01-05', 'Acme', 'paid'],
    ]);
  });

  test('a truncated file is refused with a message instead of imported wrongly', () => {
    assert.throws(() => parseCsvChecked('Date,Name\n2026-01-05,"Acme\n2026-01-06,Beta\n'), /never closed|cut off/);
  });
});
