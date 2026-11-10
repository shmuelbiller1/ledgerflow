import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQuickBooksCsv } from '../lib/quickBooksCsvImport';
import { guessMapping, applyMapping, prepareImport, openingStockCents, type ImportKind } from '../lib/recordImport';

import { BRAND_NAME } from '../config/brand';
function prepared(kind: ImportKind, source: string[][]) {
  const table = normalizeQuickBooksCsv(kind, source);
  return prepareImport(kind, applyMapping(kind, table.slice(1), guessMapping(kind, table[0])));
}

test('E-20 QuickBooks Online Customer Contact List preserves contact and billing address', () => {
  const result = prepared('customers', [
    ['Customer', 'Company Name', 'Email', 'Phone Numbers', 'Billing Street', 'Billing City', 'Billing State', 'Billing ZIP', 'Billing Country'],
    ['Acme LLC', 'Acme Inc.', 'OFFICE@example.test', '555-1212', '11 Main St', 'Albany', 'NY', '12207', 'US'],
    ['רוני שירות', '', 'hebrew@example.test', '', '', 'Brooklyn', 'NY', '11211', 'US'],
  ]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.records[0].data.name, 'Acme LLC', 'QBO Customer display name outranks company');
  assert.equal(result.records[0].data.email, 'OFFICE@example.test', 'the shared importer preserves source email case unless cleanup is accepted');
  assert.equal(result.records[0].data.address, '11 Main St, Albany, NY, 12207, US');
  assert.equal(result.records[1].data.name, 'רוני שירות');
});

test('E-20 QBO vendor list uses the dedicated vendor name and existing safe importer', () => {
  const result = prepared('vendors', [
    ['Vendor', 'Company Name', 'Email', 'Phone Numbers', 'Vendor Address', 'City', 'State', 'Postal Code', 'Country'],
    ['Supplier One', 'Different Corp', 'billing@example.test', '555-0121', '11 Main St', 'Albany', 'NY', '12207', 'US'],
  ]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.records[0].data.name, 'Supplier One');
  assert.equal(result.records[0].data.email, 'billing@example.test');
  assert.equal(result.records[0].data.address, '11 Main St, Albany, NY, 12207, US');
  assert.ok(!('balance' in result.records[0].data));
});

test('E-20 QBO products and services keep prices but never stage an opening-stock entry', () => {
  const source = [
    ['Product/Service', 'SKU', 'Sales Description', 'Sales Price/Rate', 'Purchase Cost', 'Qty On Hand', 'Type'],
    ['Service A', 'SER-1', 'Hours', '125.50', '80.00', '999', 'Service'],
  ];
  const normalized = normalizeQuickBooksCsv('items', source);
  assert.equal(normalized[1][5], '', 'source stock balance ignored');
  const result = prepared('items', source);
  assert.deepEqual(result.errors, []);
  assert.equal(result.records[0].data.unitPriceCents, 12550);
  assert.equal(result.records[0].data.unitCostCents, 8000);
  assert.equal(result.records[0].data.quantityAtHand, 0);
  assert.equal(openingStockCents(result.records), 0);
});

test('E-20 QBO Account List maps account type and number but not the exported balance', () => {
  const source = [
    ['Account', 'Number', 'Type', 'Detail Type', 'Balance', 'Description'],
    ['Checking', '1000', 'Bank', 'Checking', '100,000.00', 'Main operating account'],
    ['Product sales', '4000', 'Income', 'Sales of Product Income', '250,000.00', 'Product income'],
  ];
  const table = normalizeQuickBooksCsv('accounts', source);
  assert.equal(table[0].includes('Balance'), false);
  const result = prepared('accounts', source);
  assert.deepEqual(result.errors, []);
  assert.equal(result.records[0].data.code, '1000');
  assert.equal(result.records[0].data.type, 'asset');
  assert.equal(result.records[0].data.category, 'Cash', `bank account must retain ${BRAND_NAME} cash role`);
  assert.equal(result.records[0].data.subtype, 'Checking', 'QBO detail type remains available for review');
  assert.equal(result.records[1].data.type, 'revenue');
  assert.ok(result.records.every(row => !('balance' in row.data)));
});

test('E-20 unsupported report and missing fields fail normal validation, duplicates never merge', () => {
  const unrecognized = prepared('accounts', [['Balance', 'Description'], ['20.00', 'Wrong export']]);
  assert.ok(unrecognized.errors.some(error => error.field === 'name'));
  assert.ok(unrecognized.errors.some(error => error.field === 'type'));
  const duplicate = prepared('customers', [
    ['Customer', 'Email'], ['Same Name', 'first@example.test'], ['Same Name', 'second@example.test'],
  ]);
  assert.ok(duplicate.errors.some(error => /same|duplicate/i.test(error.message)));
});

test('E-20 raw source tables are not modified, including Hebrew and quoted fields', () => {
  const source = Object.freeze([
    Object.freeze(['Customer', 'Email']),
    Object.freeze(['עץ חיים', 'hello@example.test']),
  ]);
  const copied = normalizeQuickBooksCsv('customers', source);
  assert.equal(copied[1][0], 'עץ חיים');
  assert.deepEqual(source[1], ['עץ חיים', 'hello@example.test']);
  assert.deepEqual(normalizeQuickBooksCsv('accounts', []), []);
});
