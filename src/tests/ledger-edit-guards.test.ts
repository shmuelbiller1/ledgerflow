/**
 * #652 / #662: the generic entry routes must not edit or reverse an entry that belongs to a document or a
 * system run, and must not un-post a posted entry in place.
 *
 * The browser already applies this rule (`src/lib/transactionEdits.ts` `isDocumentEntry`, used by the
 * transaction row and the ledger list); before this change the server enforced none of it, so a
 * bookkeeper could PUT an invoice's or a payment's entry (status → void/failed) or reverse it and the
 * document kept saying `paid` while the books said something else. Setting the status to `failed`
 * dropped a posted entry out of every report while "Undo" answered 200.
 *
 * The guard functions are checked here against the real metadata shapes the product writes, and the
 * routes are checked to call them (a source check: this sandbox has no PostgreSQL, so the endpoint
 * cases live in the PR's CI run rather than being claimed here).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  auditSnapshot,
  documentEntryRefusal,
  isPostedEntry,
  postedStatusRefusal,
} from '../server/services/ledgerEditGuards';

test('a document entry is refused, with a pointer to the document', () => {
  const shapes = [
    { type: 'invoice-accrual', invoiceId: 'inv1' },
    { type: 'bill-accrual', billId: 'b1' },
    { type: 'payment-posting', paymentId: 'p1' },
    { type: 'credit-note-issuance', creditNoteId: 'cn1' },
    { type: 'depreciation' },
    { isReversal: true, reversesTxId: 'tx1' },
  ];
  for (const metadata of shapes) {
    const refusal = documentEntryRefusal({ metadata });
    assert.ok(refusal, `${JSON.stringify(metadata)} must be refused`);
    assert.match(refusal, /through that document/);
  }
});

test('a hand entry, a bank line and an import batch are still editable', () => {
  assert.equal(documentEntryRefusal({ metadata: undefined }), null);
  assert.equal(documentEntryRefusal({ metadata: {} }), null);
  assert.equal(documentEntryRefusal({ metadata: { bankLineId: 'bl1' } }), null, 'a matched bank line alone does not make it a document entry');
  assert.equal(documentEntryRefusal({ metadata: { importBatchId: 'ib1' } }), null, 'an import batch alone does not either');
  // the journal screen's own marker: an adjusting manual journal
  assert.equal(documentEntryRefusal({ metadata: { adjusting: true } }), null);
});

test('a platform admin keeps the existing override', () => {
  assert.equal(documentEntryRefusal({ metadata: { invoiceId: 'inv1' } }, true), null);
  assert.equal(postedStatusRefusal({ status: 'completed' }, 'failed', true), null);
});

test('a posted entry is not un-posted in place', () => {
  for (const status of ['failed', 'draft']) {
    const refusal = postedStatusRefusal({ status: 'completed' }, status);
    assert.ok(refusal, `completed → ${status} must be refused`);
    assert.match(refusal, /reversing entry/);
  }
  // the same transition on an entry that is not posted yet is how a draft is saved
  assert.equal(postedStatusRefusal({ status: 'draft' }, 'completed'), null);
  // cleared and reconciled entries count as posted even when their status is not `completed`
  assert.ok(postedStatusRefusal({ status: 'reconciled', isCleared: true }, 'failed'));
  // flags and review marks are not un-posting
  assert.equal(postedStatusRefusal({ status: 'completed' }, 'flagged'), null);
  assert.equal(postedStatusRefusal({ status: 'completed' }, 'reviewed'), null);
  // nothing to compare against: not a refusal
  assert.equal(postedStatusRefusal({ status: 'completed' }, undefined), null);
  assert.equal(postedStatusRefusal(null, 'failed'), null);
});

test('isPostedEntry and auditSnapshot read the fields an auditor asks about', () => {
  assert.equal(isPostedEntry({ status: 'completed' }), true);
  assert.equal(isPostedEntry({ status: 'void' }), false);
  assert.equal(isPostedEntry({ status: 'void', reconciled: true }), true);
  const snapshot = auditSnapshot({
    status: 'completed', date: '2026-10-31', totalAmountCents: 12500, description: 'Sales',
    currency: 'EUR', exchangeRate: 1.0842, lines: [{ accountId: 'a', amountCents: 12500 }, { accountId: 'b', amountCents: -12500 }],
  });
  assert.deepEqual(snapshot, {
    status: 'completed', date: '2026-10-31', totalAmountCents: 12500, description: 'Sales',
    lineCount: 2, currency: 'EUR', exchangeRate: 1.0842,
  });
  assert.equal(auditSnapshot(undefined), null);
});

test('both generic entry routes call the guards (wiring, not only the helper)', () => {
  const read = (file: string) => fs.readFileSync(path.join(process.cwd(), 'src', 'server', 'routes', 'transactions', file), 'utf8');
  const crud = read('crudRoutes.ts');
  const reverse = read('reverseRoutes.ts');
  // the partial update branch, the full update branch and the reverse route each refuse a document entry
  assert.equal((crud.match(/documentEntryRefusal\(/g) || []).length, 2, 'PUT /:id must guard both branches');
  assert.equal((crud.match(/postedStatusRefusal\(/g) || []).length, 2, 'PUT /:id must refuse un-posting in both branches');
  assert.equal((reverse.match(/documentEntryRefusal\(/g) || []).length, 1, 'POST /:id/reverse must refuse a document entry');
  // and the audit rows now carry before/after
  assert.match(crud, /before: beforeEdit/);
  assert.match(crud, /after: afterEdit/);
});
