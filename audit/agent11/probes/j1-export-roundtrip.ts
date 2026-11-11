import { toCsv } from '../../../src/lib/csvExport';
import { parseCsv } from '../../../src/lib/csv';
import { guessMapping, applyMapping, prepareImport } from '../../../src/lib/recordImport';
import { recordExportTable, readExportedRecords } from '../../../src/lib/workspaceExports';

// A realistic customer record as the app stores it.
const customers = [
  { id: 'c1', workspaceId: 'w1', name: 'Acme, Inc.', email: 'ap@acme.example', phone: '+1 555 0100',
    taxId: '12-3456789', address: '1 Main St\nSpring Valley NY', website: 'https://acme.example',
    currency: 'USD', paymentTerms: 'Net 30', notes: 'Calls before 10am', status: 'active', createdAt: '2026-01-02' },
  { id: 'c2', workspaceId: 'w1', name: 'חברת דוגמה בע"מ', email: 'info@example.co.il', phone: '+972 3 555 0101',
    taxId: '515123456', address: 'רחוב הרצל 1, תל אביב', status: 'active' },
];

// 1) What the export writes (Settings → Backup & Export → customers)
const table = recordExportTable(customers);
const csv = toCsv(table.headers, table.rows);
console.log('EXPORT headers:', JSON.stringify(table.headers));

// 2) What Settings → Import data does with that file
const cells = parseCsv(csv, ',');
const header = cells[0];
const mapping = guessMapping('customers', header);
console.log('GUESSED mapping (import field -> column index):', JSON.stringify(mapping));
const rows = applyMapping('customers', cells.slice(1), mapping);
const prepared = prepareImport('customers', rows);
console.log('READY rows:', prepared.records.length, 'ISSUES:', JSON.stringify(prepared.errors));
console.log('FIRST record:', JSON.stringify(prepared.records[0]?.data));

// 3) The dedicated "Record JSON" round trip that the export also offers
console.log('RECORD-JSON round trip count:', readExportedRecords(csv).length);
