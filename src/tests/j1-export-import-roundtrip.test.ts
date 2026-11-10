/**
 * J-1 (Agent #11): an export this app writes is accepted unchanged by the matching import.
 *
 * Queue item J-1: "every list with 'Export CSV' (customers, vendors, items, invoices, bills,
 * transactions, chart of accounts) exports columns that the matching import accepts unchanged;
 * a test exports then re-imports into an empty workspace and compares."
 *
 * This suite covers the half of that round trip that runs without the database: the file the
 * export writes (recordExportTable + toCsv, the same writer every "Export CSV" button uses) is
 * read back by the shared CSV reader and by the validated import (guessMapping → applyMapping →
 * prepareImport, the same three calls the Settings → Import data screen makes). The server save
 * is covered by record-import.test.ts against the test database.
 *
 * Finding J-1 (fixed in this commit): the export neutralises text a spreadsheet would run as a
 * formula by putting an apostrophe in front of it (`+1 555 0100` → `'+1 555 0100`). The import did
 * not take that guard off, so a customer's phone number, a note starting with a dash, or a name
 * starting with a dash came back changed. `unguardCsvCell` removes the guard and only the guard.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, sanitizeCsvCell, unguardCsvCell } from '../lib/csv';
import { toCsv } from '../lib/csvExport';
import { applyMapping, guessMapping, prepareImport } from '../lib/recordImport';
import { recordExportTable } from '../lib/workspaceExports';

const customers = [
  {
    id: 'c1', workspaceId: 'w1', name: 'Acme, Inc.', email: 'ap@acme.example', phone: '+1 555 0100',
    taxId: '12-3456789', address: '1 Main St\nSpring Valley NY 10977', website: 'https://acme.example',
    currency: 'USD', paymentTerms: 'Net 30', notes: '-call before 10am', status: 'active',
  },
  {
    id: 'c2', workspaceId: 'w1', name: 'חברת דוגמה בע"מ', email: 'info@example.co.il',
    phone: '+972 3 555 0101', taxId: '515123456', address: 'רחוב הרצל 1, תל אביב', status: 'active',
  },
  {
    // a legal name that a spreadsheet would read as a formula
    id: 'c3', workspaceId: 'w1', name: '-Discount Customer', phone: '0044 20 7946 0000', status: 'active',
  },
  {
    // a real leading apostrophe must survive untouched
    id: 'c4', workspaceId: 'w1', name: "'Round Table Ltd", phone: '555-0100', status: 'active',
  },
];

describe('J-1 export → import round trip', () => {
  test('the export file is read back by the import with the same values it wrote', () => {
    const table = recordExportTable(customers);
    const cells = parseCsv(toCsv(table.headers, table.rows), ',');
    const prepared = prepareImport('customers', applyMapping('customers', cells.slice(1), guessMapping('customers', cells[0])));

    assert.deepEqual(prepared.errors, [], 'every exported customer must be importable');
    assert.equal(prepared.records.length, customers.length);

    const byName = new Map(prepared.records.map(record => [String(record.data.name), record.data]));
    assert.equal(byName.get('Acme, Inc.')?.phone, '+1 555 0100', 'the exported phone comes back unchanged');
    assert.equal(byName.get('Acme, Inc.')?.notes, '-call before 10am', 'a note starting with a dash comes back unchanged');
    assert.equal(byName.get('Acme, Inc.')?.address, '1 Main St\nSpring Valley NY 10977', 'a two-line address keeps its break');
    assert.equal(byName.get('חברת דוגמה בע"מ')?.phone, '+972 3 555 0101', 'Hebrew name and international phone survive');
    assert.equal(byName.get('-Discount Customer')?.name, '-Discount Customer', 'a name starting with a dash comes back unchanged');
    assert.equal(byName.get("'Round Table Ltd")?.name, "'Round Table Ltd", 'a real leading apostrophe is not removed');
    for (const record of prepared.records) {
      assert.equal(typeof record.data.email === 'string' || record.data.email === undefined, true);
    }
  });

  test('every scalar field of every exported customer is identical after the round trip', () => {
    const table = recordExportTable(customers);
    const cells = parseCsv(toCsv(table.headers, table.rows), ',');
    const header = cells[0];
    const mapping = guessMapping('customers', header);
    const prepared = prepareImport('customers', applyMapping('customers', cells.slice(1), mapping));
    for (const original of customers) {
      const row = prepared.records.find(record => record.data.name === original.name);
      assert.ok(row, `${original.name} must be in the import`);
      for (const [key, value] of Object.entries(original)) {
        if (!(key in mapping) || mapping[key] < 0) continue;          // not an import column
        if (key === 'status') continue;                                // checked by its own rule below
        assert.equal(row.data[key], value, `${original.name}.${key} must survive the round trip`);
      }
      assert.equal(row.data.status, 'active');
    }
  });

  test('the guard is removed only where this app put it', () => {
    assert.equal(unguardCsvCell("'+1 555 0100"), '+1 555 0100');
    assert.equal(unguardCsvCell("'-call first"), '-call first');
    assert.equal(unguardCsvCell("'=SUM(A1)"), '=SUM(A1)');
    assert.equal(unguardCsvCell("'@SUM(A1)"), '@SUM(A1)');
    assert.equal(unguardCsvCell("'Round Table Ltd"), "'Round Table Ltd", 'not a guard: kept as typed');
    assert.equal(unguardCsvCell("'"), "'");
    assert.equal(unguardCsvCell('-1,000.00'), '-1,000.00', 'a plain number was never guarded');
    assert.equal(unguardCsvCell('Acme'), 'Acme');
  });

  test('the guard and its removal are inverses for the values a spreadsheet would run', () => {
    // sanitizeCsvCell wraps its result in quotes; the reader strips them, so compare the cell text.
    for (const value of ['+1 555 0100', '-call first', '=1+1', '@SUM(A1)', ' plain ', 'שם']) {
      const written = sanitizeCsvCell(value).replace(/^"|"$/g, '').replace(/""/g, '"');
      assert.equal(unguardCsvCell(written), value, `${value} must round-trip through the guard`);
    }
  });
});
