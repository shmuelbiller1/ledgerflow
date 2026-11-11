/** Agent #11 probe J-1b: does the import's contact cleanup undo the export's formula guard? */
import { toCsv } from '../../../src/lib/csvExport';
import { parseCsv } from '../../../src/lib/csv';
import { guessMapping, applyMapping, prepareImport } from '../../../src/lib/recordImport';
import { recordExportTable } from '../../../src/lib/workspaceExports';
import { cleanupContactImportRows } from '../../../src/lib/contactImportCleanup';

const customers = [
  { id: 'c1', name: 'Acme Ltd', email: 'ap@acme.example', phone: '+1 555 0100', taxId: '12-3456789',
    notes: '-call first', address: '1 Main St', status: 'active' },
  { id: 'c2', name: 'דוגמה', email: 'info@example.co.il', phone: '+972-3-555-0101', status: 'active' },
  // A name that begins with a dash is legal; a spreadsheet would read it as a formula.
  { id: 'c3', name: '-Discount Customer', phone: '+44 20 7946 0000', status: 'active' },
];

const table = recordExportTable(customers);
const csv = toCsv(table.headers, table.rows);
const cells = parseCsv(csv, ',');
const mapping = guessMapping('customers', cells[0]);
const mapped = applyMapping('customers', cells.slice(1), mapping);

console.log('--- raw cells as exported (name / phone / notes):');
cells.slice(1).forEach((r, i) => console.log(i, JSON.stringify([r[5], r[8], r[6]])));

console.log('--- without contact cleanup:');
const a = prepareImport('customers', mapped);
a.records.forEach(r => console.log('  ', JSON.stringify({ name: r.data.name, phone: r.data.phone, notes: r.data.notes })));

console.log('--- with contact cleanup (the screen path):');
const cleanup = cleanupContactImportRows("customers", mapped);
console.log('   cleanup warnings:', cleanup.warnings.length, 'normalized emails/phones:', cleanup.normalizedEmails, cleanup.normalizedPhones);
const b = prepareImport('customers', cleanup.rows);
b.records.forEach(r => console.log('  ', JSON.stringify({ name: r.data.name, phone: r.data.phone, notes: r.data.notes })));
console.log('   issues:', JSON.stringify(b.errors));
