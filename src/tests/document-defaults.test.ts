import test from 'node:test';
import assert from 'node:assert/strict';
import { availableDocumentDefaults, cleanDocumentDefaults, defaultsMetadata, documentDefaultsOf, fillLineDefaults, vendorHistoryDefaults } from '../lib/documentDefaults';
import { displayDimensionName } from '../lib/dimensionUtils';
import type { Bill } from '../types';
const accounts = [{ id: 'exp' }, { id: 'old', isArchived: true }];
const hints = { accountId: 'exp', dimensions: { project: 'P1', location: 'L1' } };

test('defaults sanitize untrusted metadata without turning values or prototype keys into accounts', () => {
  for (const value of [null, [], 'exp', 42]) assert.deepEqual(cleanDocumentDefaults(value), {});
  assert.deepEqual(cleanDocumentDefaults(JSON.parse('{"accountId":44,"taxCodeId":" gst ","dimensions":{"__proto__":"x","constructor":"x","Category":"x","Project":" P1 ","location":3}}')), { taxCodeId: 'gst', dimensions: { project: 'P1' } });
});
test('old item tax field wins and unrelated metadata is preserved, including clearing defaults', () => {
  assert.deepEqual(documentDefaultsOf({ defaultTaxCodeId: 'gst', metadata: { documentDefaults: { taxCodeId: 'other' } } }), { taxCodeId: 'gst' });
  assert.deepEqual(defaultsMetadata({ note: 'שלום', documentDefaults: hints }, {}), { note: 'שלום' });
  assert.deepEqual(defaultsMetadata({ note: 'n' }, hints), { note: 'n', documentDefaults: hints });
});
test('only empty eligible account/labels fill; amount, currency, stock, typed and cleared values stay exact', () => {
  const line = { accountId: '', amountCents: 121, currency: 'ILS', itemId: 'stock', dimensions: { location: '', unit: 'דירה א' } };
  assert.deepEqual(fillLineDefaults(line, hints, accounts), { ...line, accountId: 'exp', dimensions: { ...line.dimensions, project: 'P1' } });
  assert.equal(fillLineDefaults({ accountId: 'typed' }, hints, accounts).accountId, 'typed');
  assert.equal(fillLineDefaults({ accountId: '' }, { accountId: 'old' }, accounts).accountId, '');
  assert.equal(fillLineDefaults({ accountId: '' }, { accountId: 'unknown' }, accounts).accountId, '');
  assert.deepEqual(fillLineDefaults({ accountId: '' }, hints, accounts, new Set(['account', 'label:project', 'label:location'])), { accountId: '' });
  assert.deepEqual(line.dimensions, { location: '', unit: 'דירה א' }, 'input not mutated');
});
test('unknown axes/category and archived IDs never autofill, while free-text labels remain supported', () => {
  const allowed = availableDocumentDefaults({ dimensions: { category: 'x', project: 'archived', unit: 'דירה א', ghost: 'g' } }, [{ id: 'project', name: 'Project' }, { id: 'unit', name: 'Unit' }], [{ id: 'archived', dimensionId: 'project', description: 'Old', status: 'archived' }]);
  assert.deepEqual(allowed.dimensions, { unit: 'דירה א' });
});
const bill = (id: string, date: string, accountId = 'exp', project = 'P1'): Bill => ({ id, date, uid: 'u', workspaceId: 'w', amountCents: 999, dueDate: date, vendorId: 'v', status: 'paid', splits: [{ accountId, dimensions: { project }, amountCents: 999 }] } as Bill);
test('three newest loaded bills, not source order, establish a suggestion without copying amounts', () => {
  const bills = [bill('old', '2025-01-01', 'other', 'P2'), bill('b', '2026-02-01'), bill('d', '2026-04-01'), bill('c', '2026-03-01')];
  assert.deepEqual(vendorHistoryDefaults(bills, 'v'), { accountId: 'exp', dimensions: { project: 'P1' } });
  assert.deepEqual(bills.map(b => b.id), ['old', 'b', 'd', 'c']);
  assert.equal(vendorHistoryDefaults(bills, 'different'), null);
  assert.equal(vendorHistoryDefaults(bills.slice(0, 2), 'v'), null);
});
test('mixed splits never imply one account; missing latest lines cannot fall back to older bills', () => {
  const bills = [bill('1', '2026-01-01'), bill('2', '2026-02-01'), bill('3', '2026-03-01')];
  bills[2].splits!.push({ accountId: 'other', amountCents: 50, dimensions: { project: 'P1' } });
  assert.deepEqual(vendorHistoryDefaults(bills, 'v'), { dimensions: { project: 'P1' } });
  assert.equal(vendorHistoryDefaults([...bills, { ...bill('4', '2026-04-01'), splits: [] }], 'v'), null);
  for (const status of ['draft', 'void', 'cancelled', 'rejected'] as const) assert.deepEqual(vendorHistoryDefaults([...bills, { ...bill('5', '2026-05-01', 'wrong', 'P2'), status }], 'v'), { dimensions: { project: 'P1' } });
});
test('legacy Company name is a display adapter only, not a stored-key or custom-name rewrite', () => {
  assert.equal(displayDimensionName({ id: 'world', name: 'World / Entity' }), 'Company');
  assert.equal(displayDimensionName({ id: 'world', name: 'חברה שלי' }), 'חברה שלי');
  assert.equal(displayDimensionName({ id: 'project', name: 'World / Entity' }), 'World / Entity');
});
