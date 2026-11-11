/** Agent #11 probe J-1c: does the IIF list export read back through the IIF reader unchanged? */
import { buildIifExport } from '../../../src/lib/iifExport';
import { readIif } from '../../../src/lib/iifImport';

const accounts = [
  { id: 'a1', name: 'Checking', code: '1010', type: 'asset', category: 'Cash' },
  { id: 'a2', name: 'Accounts Receivable', code: '1100', type: 'asset', category: 'Receivables' },
];
const customers = [
  { id: 'c1', name: 'Acme, Inc.', email: 'ap@acme.example', phone: '+1 555 0100', address: 'Line1\nLine2' },
  { id: 'c2', name: 'חברת דוגמה', email: 'info@example.co.il', phone: '+972 3 555 0101' },
];
const vendors = [{ id: 'v1', name: 'Office Depot', email: 'billing@od.example' }];
const items = [{ id: 'i1', name: 'Widget', sku: 'W-1', unitPriceCents: 1999, unitCostCents: 900, quantityAtHand: 4 }];

const out = buildIifExport({ accounts, customers, vendors, items } as never);

console.log('--- IIF text ---');
console.log(out.text ?? JSON.stringify(out).slice(0, 200));
const read = readIif(out.text);
console.log('--- read back, per section counts ---', JSON.stringify(read.counts));
for (const kind of ['accounts','customers','vendors','items']) {
  const table = (read.tables as Record<string, string[][]>)[kind] ?? [];
  console.log(kind, 'header:', JSON.stringify(table[0]), 'rows:', JSON.stringify(table.slice(1)));
}
