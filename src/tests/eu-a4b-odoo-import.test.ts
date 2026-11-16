import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOdooCsv } from '../lib/odooImport';
import { guessMapping, applyMapping, prepareImport, type ImportKind } from '../lib/recordImport';

function prepared(kind: ImportKind, source: string[][]) {
  const table = normalizeOdooCsv(kind, source);
  return { table, result: prepareImport(kind, applyMapping(kind, table.slice(1), guessMapping(kind, table[0]))) };
}

test('EU-A4b Odoo chart: labels and technical values both translate; off-balance and current-year earnings are refused', () => {
  const { result } = prepared('accounts', [
    ['Code', 'Account Name', 'Type', 'Deprecated', 'Balance'],
    ['101401', 'Bank', 'Bank and Cash', 'False', '9,999.00'],
    ['121000', 'Account Receivable', 'asset_receivable', '', ''],
    ['211000', 'Account Payable', 'Payable', '', ''],
    ['201000', 'Company card', 'liability_credit_card', '', ''],
    ['400000', 'Product Sales', 'Income', '', ''],
    ['500000', 'Cost of Goods Sold', 'expense_direct_cost', '', ''],
    ['610000', 'Rent', 'Expenses', 'True', ''],
    ['999999', 'Undistributed Profits/Losses', 'Current Year Earnings', '', ''],
    ['999998', 'Memo', 'off_balance', '', ''],
  ]);
  const byCode = new Map(result.records.map(r => [r.data.code, r.data]));
  assert.equal(byCode.get('101401')?.category, 'Cash');
  assert.equal(byCode.get('121000')?.category, 'Accounts Receivable');
  assert.equal(byCode.get('211000')?.category, 'Accounts Payable');
  assert.equal(byCode.get('201000')?.type, 'liability');
  assert.equal(byCode.get('400000')?.type, 'revenue');
  assert.equal(byCode.get('500000')?.type, 'cost_of_goods');
  assert.equal(byCode.get('610000')?.type, 'expense');
  assert.deepEqual(result.errors.map(e => [e.row, e.field]), [[9, 'type'], [10, 'type']]);
  assert.ok(result.records.every(r => !('balanceCents' in r.data)), 'no balance is imported');
});

test('EU-A4b Odoo contacts and products: address joined, stock never staged', () => {
  const contacts = prepared('customers', [
    ['Name', 'Email', 'Phone', 'Street', 'City', 'Zip', 'Country', 'Tax ID', 'Active'],
    ['Azure Interior', 'azure@example.com', '+1 555 0100', '4557 De Silva St', 'Fremont', '94538', 'United States', 'US12345', 'True'],
  ]).result;
  assert.equal(contacts.records[0].data.name, 'Azure Interior');
  assert.match(String(contacts.records[0].data.address), /De Silva St.*Fremont/);
  assert.equal(contacts.records[0].data.taxId, 'US12345');
  const items = prepared('items', [
    ['Name', 'Internal Reference', 'Sales Price', 'Cost', 'Quantity On Hand', 'Unit of Measure'],
    ['Office Chair', 'FURN_7777', '70.00', '55.00', '12', 'Units'],
  ]);
  assert.equal(items.result.records[0].data.sku, 'FURN_7777');
  assert.equal(items.result.records[0].data.unitPriceCents, 7000);
  assert.ok(!items.result.records[0].data.quantityAtHand, 'quantity on hand is never imported');
});
