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
import { parseCsv, parseCsvChecked, sanitizeCsvCell, unguardCsvCell } from '../lib/csv';
import { csvMoney, toCsv } from '../lib/csvExport';
import { applyMapping, guessMapping, prepareImport } from '../lib/recordImport';
import { readOpenItemsCsv } from '../lib/openItemImport';
import { mapBankCsvRows } from '../lib/bankCsvRows';
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
    const prepared = prepareImport('customers', applyMapping('customers', cells.slice(1), guessMapping('customers', cells[0]), { csvGuarded: true }));

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
    const prepared = prepareImport('customers', applyMapping('customers', cells.slice(1), mapping, { csvGuarded: true }));
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

test('a source that never had the CSV guard keeps an apostrophe before @ + - = as data', () => {
  const rows = [["'@Home", 'a@x.test'], ['@Home', 'b@x.test']];
  const mapping = guessMapping('customers', ['Name', 'Email']);
  const prepared = prepareImport('customers', applyMapping('customers', rows, mapping));
  assert.deepEqual(prepared.errors, []);
  assert.deepEqual(prepared.records.map(record => record.data.name), ["'@Home", '@Home'], 'two different names stay two');
});

describe('J-1 every list with Export CSV exports columns accepted by its matching import', () => {
  test('customers, vendors, items, and chart of accounts list CSVs round-trip into an empty workspace', () => {
    // 1. Customers (Sales.tsx exportConfig)
    const customerCsv = toCsv(
      ['Customer', 'Email', 'Phone', 'Net Receivable'],
      [
        ['Acme, Inc.', 'ap@acme.example', '+1 555 0100', csvMoney(125_000)],
        ['חברת דוגמה בע"מ', 'info@example.co.il', '+972 3 555 0101', csvMoney(0)],
      ],
    );
    const custCells = parseCsv(customerCsv, ',');
    const custPrepared = prepareImport('customers', applyMapping('customers', custCells.slice(1), guessMapping('customers', custCells[0]), { csvGuarded: true }));
    assert.deepEqual(custPrepared.errors, []);
    assert.equal(custPrepared.records[0].data.name, 'Acme, Inc.');
    assert.equal(custPrepared.records[0].data.phone, '+1 555 0100');
    assert.equal(custPrepared.records[1].data.name, 'חברת דוגמה בע"מ');

    // 2. Vendors (Purchases.tsx exportConfig)
    const vendorCsv = toCsv(
      ['Vendor', 'Category', 'Email', 'Phone', 'Outstanding Balance'],
      [
        ['Paper Supply Co', 'Office', 'orders@paper.example', '+1 555 0199', csvMoney(45_000)],
        ['-Urgent Courier', 'Logistics', 'dispatch@courier.example', '555-0144', csvMoney(0)],
      ],
    );
    const vendCells = parseCsv(vendorCsv, ',');
    const vendPrepared = prepareImport('vendors', applyMapping('vendors', vendCells.slice(1), guessMapping('vendors', vendCells[0]), { csvGuarded: true }));
    assert.deepEqual(vendPrepared.errors, []);
    assert.equal(vendPrepared.records[0].data.name, 'Paper Supply Co');
    assert.equal(vendPrepared.records[0].data.category, 'Office');
    assert.equal(vendPrepared.records[0].data.phone, '+1 555 0199');
    assert.equal(vendPrepared.records[1].data.name, '-Urgent Courier');

    // 3. Items (Inventory.tsx exportConfig) — money columns export in major units and parse back to exact cents
    const itemCsv = toCsv(
      ['Name', 'SKU', 'Category', 'Quantity on hand', 'Cost', 'Sale price', 'Unit', 'Reorder point', 'Description'],
      [
        ['Oak Chair', 'CHR-01', 'Furniture', '12', csvMoney(4_550), csvMoney(12_999), 'each', '3', 'Solid oak\nFinish: matte'],
        ['Zero-Price Sample', 'SMP-0', 'Samples', '0', csvMoney(0), csvMoney(0), 'unit', '0', ''],
      ],
    );
    const itemCells = parseCsv(itemCsv, ',');
    const itemPrepared = prepareImport('items', applyMapping('items', itemCells.slice(1), guessMapping('items', itemCells[0]), { csvGuarded: true }));
    assert.deepEqual(itemPrepared.errors, []);
    assert.equal(itemPrepared.records[0].data.name, 'Oak Chair');
    assert.equal(itemPrepared.records[0].data.sku, 'CHR-01');
    assert.equal(itemPrepared.records[0].data.quantityAtHand, 12);
    assert.equal(itemPrepared.records[0].data.unitCostCents, 4_550);
    assert.equal(itemPrepared.records[0].data.unitPriceCents, 12_999);
    assert.equal(itemPrepared.records[0].data.measurementUnit, 'each');
    assert.equal(itemPrepared.records[0].data.reorderPoint, 3);
    assert.equal(itemPrepared.records[1].data.quantityAtHand, 0);
    assert.equal(itemPrepared.records[1].data.unitPriceCents, 0);

    // 4. Chart of Accounts (ChartOfAccountsView.tsx Export CSV) — including cost_of_goods type
    const coaCsv = toCsv(
      ['Code', 'Name', 'Type', 'Category', 'Description', 'Currency', 'Balance'],
      [
        ['1000', 'Operating Cash', 'asset', 'Cash', 'Main bank', 'USD', csvMoney(500_000)],
        ['5000', 'Direct Materials', 'cost_of_goods', 'COGS', 'Inventory cost', 'USD', csvMoney(120_000)],
        ['4000', 'הכנסות ממכירות', 'revenue', 'Sales', 'Revenue', 'ILS', csvMoney(300_000)],
      ],
    );
    const coaCells = parseCsv(coaCsv, ',');
    const coaPrepared = prepareImport('accounts', applyMapping('accounts', coaCells.slice(1), guessMapping('accounts', coaCells[0]), { csvGuarded: true }));
    assert.deepEqual(coaPrepared.errors, []);
    assert.deepEqual(
      coaPrepared.records.map(r => [r.data.code, r.data.name, r.data.type, r.data.currency]),
      [
        ['1000', 'Operating Cash', 'asset', 'USD'],
        ['5000', 'Direct Materials', 'cost_of_goods', 'USD'],
        ['4000', 'הכנסות ממכירות', 'revenue', 'ILS'],
      ],
    );
  });

  test('invoices and bills list CSVs are accepted unchanged by readOpenItemsCsv', () => {
    const contacts = [{ id: 'c1', name: 'Acme Ltd' }, { id: 'v1', name: 'Paper Co' }];
    // 5. Invoices (Sales.tsx exportConfig)
    const invCsv = '\uFEFF' + toCsv(
      ['Number', 'Customer', 'Date', 'Due Date', 'Status', 'Currency', 'Amount', 'Still Due'],
      [['INV-101', 'Acme Ltd', '2026-08-14', '2026-09-13', 'sent', 'USD', csvMoney(125_000), csvMoney(45_000)]],
    );
    const invRead = readOpenItemsCsv(invCsv, { cutOverDate: '2026-09-30', currency: 'USD', contacts: [contacts[0]] });
    assert.equal(invRead.fileProblem, null);
    assert.equal(invRead.rows.length, 1);
    assert.equal(invRead.rows[0].problem, null);
    assert.equal(invRead.rows[0].number, 'INV-101');
    assert.equal(invRead.rows[0].amountCents, 125_000);
    assert.equal(invRead.rows[0].openCents, 45_000);

    // 6. Bills (Purchases.tsx exportConfig)
    const billCsv = '\uFEFF' + toCsv(
      ['Vendor Name', 'Bill Number', 'Date', 'Due Date', 'Status', 'Amount', 'Amount Due', 'Currency'],
      [['Paper Co', 'B-77', '2026-08-20', '2026-09-19', 'unpaid', csvMoney(31_000), csvMoney(21_000), 'USD']],
    );
    const billRead = readOpenItemsCsv(billCsv, { cutOverDate: '2026-09-30', currency: 'USD', contacts: [contacts[1]] });
    assert.equal(billRead.fileProblem, null);
    assert.equal(billRead.rows.length, 1);
    assert.equal(billRead.rows[0].problem, null);
    assert.equal(billRead.rows[0].number, 'B-77');
    assert.equal(billRead.rows[0].amountCents, 31_000);
    assert.equal(billRead.rows[0].openCents, 21_000);
  });

  test('transactions list CSV is accepted unchanged by StatementImporter column mapping (mapBankCsvRows)', () => {
    // 7. Transactions (TransactionGridToolbar.tsx exportCsv)
    const txCsv = '\uFEFF' + toCsv(
      ['Date', 'Description', 'Amount', 'Currency', 'Account', 'Project', 'Notes'],
      [
        ['2026-10-05', 'Client retainer', csvMoney(250_000), 'USD', 'Operating Cash', 'Advisory', ''],
        ['2026-10-08', 'Cloud hosting', csvMoney(-12_550), 'USD', 'Cloud', '', 'Monthly'],
      ],
    );
    const parsed = parseCsvChecked(txCsv);
    const header = parsed[0].map(h => h.toLowerCase());
    const mapping = {
      date: header.findIndex(h => h.includes('date')),
      description: header.findIndex(h => h.includes('desc')),
      amount: header.findIndex(h => h.includes('amount')),
      debit: -1,
      credit: -1,
      memo: header.findIndex(h => h.includes('note')),
      skipRows: 1,
    };
    const mapped = mapBankCsvRows(parsed, mapping);
    assert.deepEqual(mapped.map(r => [r.date, r.description, r.amountCents]), [
      ['2026-10-05', 'Client retainer', 250_000],
      ['2026-10-08', 'Cloud hosting - Monthly', -12_550],
    ]);
  });
});
