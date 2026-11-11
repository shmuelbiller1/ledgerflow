/**
 * Agent #11 probe J-1d: the IIF list round trip writes an item's QuickBooks type code into the
 * ACCNT-independent ITEM section, and the reader puts it in the *Category* column. The generic
 * item import then checks Category with the plain text rule... and the account-type rule is what
 * items never get. Question: does "INVENTORY" survive into the saved item, and does the item
 * import accept it at all?
 */
import { buildIifExport } from '../../../src/lib/iifExport';
import { readIif } from '../../../src/lib/iifImport';
import { guessMapping, applyMapping, prepareImport } from '../../../src/lib/recordImport';

const items = [
  { id: 'i1', name: 'Widget', sku: 'W-1', unitPriceCents: 1999, unitCostCents: 900, quantityAtHand: 4, category: 'Hardware' },
  { id: 'i2', name: 'Service hour', sku: '', unitPriceCents: 12000, unitCostCents: 0, quantityAtHand: 0 },
  { id: 'i3', name: 'Dup name', sku: '', unitPriceCents: 100, unitCostCents: 0 },
];
const out = buildIifExport({ items } as never);
console.log('IIF ITEM lines:\n' + out.text.split('\n').filter(l => l.startsWith('ITEM') || l.startsWith('!ITEM')).join('\n'));
const read = readIif(out.text);
const table = read.tables.items;
const mapping = guessMapping('items', table[0]);
const prepared = prepareImport('items', applyMapping('items', table.slice(1), mapping));
console.log('mapping:', JSON.stringify(mapping));
console.log('rows ready:', prepared.records.length, 'issues:', JSON.stringify(prepared.errors));
prepared.records.forEach(r => console.log('  ->', JSON.stringify(r.data)));
console.log('skipped by the writer:', JSON.stringify(out.skipped));
