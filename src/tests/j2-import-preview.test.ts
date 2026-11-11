/**
 * J-2 (Agent #11): the import preview shows the first 20 rows as they will be saved, with the rows
 * that will be refused marked in place and the reason given, before anything is written.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { importPreviewRows, PREVIEW_ROWS } from '../lib/importPreview';
import { IMPORT_DEFINITIONS, prepareImport } from '../lib/recordImport';

const good = (n: number) => ({ name: `Customer ${n}`, email: `c${n}@example.com` });

describe('J-2 import preview', () => {
  test('the preview is 20 rows, not the five the screen used to show', () => {
    assert.equal(PREVIEW_ROWS, 20);
    const rows = Array.from({ length: 30 }, (_, i) => good(i + 1));
    const prepared = prepareImport('customers', rows);
    const preview = importPreviewRows(prepared.records, prepared.errors);
    assert.equal(preview.length, 20);
    assert.equal(preview[0].row, 2, 'the header is row 1, so the first data row is row 2');
    assert.equal(preview[19].row, 21);
  });

  test('a refused row is marked in place with its reason and keeps its values', () => {
    const rows = [
      good(1),
      { name: '', email: 'not-an-email' },     // row 3: two problems
      good(3),
    ];
    const prepared = prepareImport('customers', rows);
    const preview = importPreviewRows(prepared.records, prepared.errors);
    assert.equal(preview.length, 3, 'a refused row still appears in the preview');
    const refused = preview.find(row => row.row === 3);
    assert.ok(refused, 'row 3 is in the preview');
    assert.deepEqual(refused.problems.length, 2, 'both problems are reported for the row');
    assert.match(refused.problems.join(' | '), /Name is missing/);
    assert.match(refused.problems.join(' | '), /not an email address/);
    assert.deepEqual(preview.filter(row => row.problems.length === 0).map(row => row.row), [2, 4]);
  });

  test('a duplicate inside the file is marked on the second row, not the first', () => {
    const prepared = prepareImport('customers', [good(1), good(1)]);
    const preview = importPreviewRows(prepared.records, prepared.errors);
    assert.deepEqual(preview.map(row => [row.row, row.problems.length]), [[2, 0], [3, 1]]);
    assert.match(preview[1].problems[0], /Same name as row 2/);
  });

  test('the preview shows only the fields the import will save', () => {
    const prepared = prepareImport('items', [{ name: 'Widget', 'unitPriceCents': '19.99', quantityAtHand: '4' }]);
    const values = importPreviewRows(prepared.records, prepared.errors)[0].values;
    assert.equal(values.name, 'Widget');
    assert.equal(values.unitPriceCents, 1999, 'money is shown as the cents it will be saved as');
    assert.equal(values.quantityAtHand, 4);
    assert.ok(Object.keys(values).every(key => IMPORT_DEFINITIONS.items.fields.some(field => field.key === key)),
      'no field outside the import definition leaks into the preview');
  });

  test('nothing to preview is an empty list, not an error', () => {
    assert.deepEqual(importPreviewRows([], []), []);
  });
});
