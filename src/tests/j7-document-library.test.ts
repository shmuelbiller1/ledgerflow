/**
 * J-7 (Agent #11): the Documents list filters by type and month, says which record a file belongs to,
 * and keeps "nothing here" apart from "nothing matches these filters".
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyDocumentFilters, documentCounts, documentFileType, documentMonth, documentMonths,
  documentOwnerLabel, DOCUMENT_LINK_KINDS,
} from '../lib/documentLibrary';

const rows = [
  { id: 'd1', name: 'contract.pdf', mimeType: 'application/pdf', sizeBytes: 2048, createdAt: '2026-03-04T09:00:00.000Z',
    linkedCollection: 'invoices', linkedId: 'inv1', linkedLabel: 'Invoice INV-1001', tags: ['Attachment'] },
  { id: 'd2', name: 'receipt.jpg', mimeType: 'image/jpeg', sizeBytes: 4096, createdAt: '2026-03-19T12:00:00.000Z',
    linkedTransactionId: 'tx9', tags: ['General'] },
  { id: 'd3', name: 'prices.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    sizeBytes: 9000, createdAt: '2026-02-01T08:30:00.000Z', tags: ['General'] },
  { id: 'd4', name: 'vendor-w9.pdf', mimeType: 'application/pdf', sizeBytes: 1000, createdAt: '2026-03-21T10:00:00.000Z',
    linkedCollection: 'vendors', linkedId: 'v1', linkedLabel: 'Office Depot' },
  { id: 'd5', name: 'undated.bin', mimeType: 'application/octet-stream', sizeBytes: 10 },
];

describe('J-7 Documents list', () => {
  test('a file-type filter uses the MIME type', () => {
    assert.deepEqual(applyDocumentFilters(rows, { fileType: 'pdf' }).rows.map(r => r.id), ['d4', 'd1'], 'newest first');
    assert.deepEqual(applyDocumentFilters(rows, { fileType: 'image' }).rows.map(r => r.id), ['d2']);
    assert.equal(applyDocumentFilters(rows, { fileType: 'spreadsheet' }).rows.length, 1);
    assert.equal(documentFileType('application/pdf; charset=binary'), 'pdf');
    assert.equal(documentFileType('APPLICATION/PDF'), 'pdf');
    assert.equal(documentFileType(undefined), 'other');
    assert.equal(documentFileType('application/msword'), 'document');
  });

  test('a month filter keeps the files of that month and never hides an undated one', () => {
    const march = applyDocumentFilters(rows, { month: '2026-03' });
    assert.deepEqual(march.rows.map(r => r.id), ['d4', 'd2', 'd1', 'd5'], 'newest first, undated last');
    assert.equal(march.undated, 1, 'the undated file is counted so the screen can say so');
    assert.deepEqual(applyDocumentFilters(rows, { month: '2026-02' }).rows.map(r => r.id), ['d3', 'd5'], 'undated last');
    assert.deepEqual(documentMonths(rows), ['2026-03', '2026-02']);
    assert.equal(documentMonth({ id: 'x', createdAt: 'not a date' }), null);
  });

  test('the list says which record each file belongs to', () => {
    assert.equal(documentOwnerLabel(rows[0]), 'Invoice INV-1001');
    assert.equal(documentOwnerLabel(rows[3]), 'Vendor Office Depot', 'the kind is added when the label lacks it');
    assert.equal(documentOwnerLabel(rows[1]), 'Entry tx9', 'a receipt linked to an entry says so');
    assert.equal(documentOwnerLabel(rows[2]), null, 'an unattached upload belongs to nothing yet');
    assert.equal(documentOwnerLabel({ id: 'x', linkedCollection: 'bills', linkedId: 'b1' }), 'Record b1');
    assert.ok(DOCUMENT_LINK_KINDS.includes('invoices'));
  });

  test('"belongs to a record" and "belongs to no record" are separate filters', () => {
    assert.deepEqual(applyDocumentFilters(rows, { linkedTo: 'unlinked' }).rows.map(r => r.id), ['d3', 'd5'], 'a receipt linked to an entry is not unlinked');
    assert.deepEqual(applyDocumentFilters(rows, { linkedTo: 'invoices' }).rows.map(r => r.id), ['d1']);
    assert.deepEqual(applyDocumentFilters(rows, { linkedTo: 'vendors' }).rows.map(r => r.id), ['d4']);
  });

  test('search covers the file name, the record it belongs to and the tags', () => {
    assert.deepEqual(applyDocumentFilters(rows, { search: 'office depot' }).rows.map(r => r.id), ['d4']);
    assert.deepEqual(applyDocumentFilters(rows, { search: 'INV-1001' }).rows.map(r => r.id), ['d1']);
    assert.deepEqual(applyDocumentFilters(rows, { search: 'general' }).rows.map(r => r.id), ['d2', 'd3'], 'newest first');
  });

  test('the counts behind the filter buttons are over the whole set', () => {
    const counts = documentCounts(rows);
    assert.equal(counts.all, 5);
    assert.equal(counts.pdf, 2);
    assert.equal(counts.image, 1);
    assert.equal(counts.invoices, 1);
    assert.equal(counts.unlinked, 2);
  });

  test('a filter that matches nothing returns no rows and says the set was not empty', () => {
    // the undated file is kept by the *month* filter only; a type filter still excludes it
    assert.deepEqual(applyDocumentFilters(rows, { fileType: 'pdf', month: '2026-01' }).rows, []);
    assert.deepEqual(applyDocumentFilters(rows, { month: '2026-01' }).rows.map(r => r.id), ['d5']);
    assert.deepEqual(applyDocumentFilters(rows, { search: 'zzz' }).rows, []);
    assert.deepEqual(applyDocumentFilters([], {}).rows, []);
    assert.equal(applyDocumentFilters([], {}).undated, 0);
  });
});
