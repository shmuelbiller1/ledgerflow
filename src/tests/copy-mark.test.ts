/** Israeli tax documents: the first print is the original, later ones true copies (PLAN IL-2). */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { marksOriginals } from '../server/services/copyMarkService';
import { layoutDocumentPdf } from '../server/services/pdfService';

const israeli = { taxProfiles: { books: { place: { country: 'IL' } } } };

test('only Israeli books mark originals; the title says which', () => {
  assert.equal(marksOriginals(israeli), true);
  assert.equal(marksOriginals({ taxProfiles: { books: { place: { country: 'US' } } } }), false);
  assert.equal(marksOriginals({}), false);
  const doc = { number: 'INV-1', date: '2026-10-11', status: 'sent', customerName: 'Acme', amountCents: 11800, items: [] };
  assert.equal(layoutDocumentPdf('invoice', doc, { name: 'Acme Ltd', branding: { language: 'he' } }, { language: 'he', copyMark: 'original' }).title, 'חשבונית · מקור');
  assert.equal(layoutDocumentPdf('invoice', doc, { name: 'Acme Ltd' }, { language: 'en', copyMark: 'copy' }).title, 'INVOICE · TRUE COPY');
  assert.equal(layoutDocumentPdf('invoice', doc, { name: 'Acme Ltd' }, {}).title, 'INVOICE');
});

describe('Against the database', { skip: !process.env.LF_TEST_DATABASE_URL && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_copy_${crypto.randomBytes(4).toString('hex')}`;
  let db: import('../server/db/pgFirestore').Firestore;
  let takeCopyMark: typeof import('../server/services/copyMarkService').takeCopyMark;
  before(async () => {
    process.env.DATABASE_URL = process.env.LF_TEST_DATABASE_URL;
    ({ takeCopyMark } = await import('../server/services/copyMarkService'));
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('invoices').doc(`${ws}_i1`).set({ workspaceId: ws, uid: 'u1', number: 'INV-1', status: 'sent', amountCents: 11800 });
    await db.collection('invoices').doc(`${ws}_p1`).set({ workspaceId: ws, uid: 'u1', number: 'INV-3', status: 'sent', amountCents: 500 });
    await db.collection('invoices').doc(`${ws}_d1`).set({ workspaceId: ws, uid: 'u1', number: 'INV-2', status: 'draft', amountCents: 100 });
  });
  after(async () => {
    await db.pool.query(`delete from public."invoices" where workspace_id = $1`, [ws]);
    await db.terminate();
  });

  test('a preview never takes the original (#845)', async () => {
    assert.equal(await takeCopyMark(db, 'invoice', `${ws}_p1`, israeli, { preview: true }), undefined);
    assert.equal(await takeCopyMark(db, 'invoice', `${ws}_p1`, israeli, { preview: true }), undefined);
    assert.equal((await db.collection('invoices').doc(`${ws}_p1`).get()).data()?.originalIssuedAt, undefined);
    assert.equal(await takeCopyMark(db, 'invoice', `${ws}_p1`, israeli), 'original');
    assert.equal(await takeCopyMark(db, 'invoice', `${ws}_p1`, israeli, { preview: true }), 'copy');
  });

  test('two prints at once: one original, one copy; then copies; drafts and other countries get none', async () => {
    const marks = await Promise.all([takeCopyMark(db, 'invoice', `${ws}_i1`, israeli), takeCopyMark(db, 'invoice', `${ws}_i1`, israeli)]);
    assert.deepEqual(marks.sort(), ['copy', 'original']);
    assert.equal(await takeCopyMark(db, 'invoice', `${ws}_i1`, israeli), 'copy');
    assert.equal(await takeCopyMark(db, 'invoice', `${ws}_d1`, israeli), undefined);
    assert.equal(await takeCopyMark(db, 'invoice', `${ws}_i1`, {}), undefined);
    assert.equal(await takeCopyMark(db, 'estimate', `${ws}_i1`, israeli), undefined);
  });
});
