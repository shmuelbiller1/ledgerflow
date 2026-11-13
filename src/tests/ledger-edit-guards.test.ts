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
  postedDeletionRefusal,
  postedStatusRefusal,
  touchesFinancialField,
} from '../server/services/ledgerEditGuards';

test('a document entry is refused, with a pointer to the document', () => {
  const shapes = [
    { type: 'invoice-accrual', invoiceId: 'inv1' },
    { type: 'bill-accrual', billId: 'b1' },
    { type: 'payment-posting', paymentId: 'p1' },
    { type: 'credit-note-issuance', creditNoteId: 'cn1' },
    { invoiceId: 'inv-old' },
  ];
  for (const metadata of shapes) {
    const refusal = documentEntryRefusal({ metadata });
    assert.ok(refusal, `${JSON.stringify(metadata)} must be refused`);
    assert.match(refusal, /through that document/);
  }
});

test("a system run's entry that names a document is not the document's posting: stock and payroll undo it there", () => {
  // cost of goods sold names the invoice, but reversing it is how the stock comes back
  assert.equal(documentEntryRefusal({ metadata: { invoiceId: 'inv1', type: 'invoice-cogs' } }), null);
  // a payroll import is undone by reversing its entry so a corrected file can post
  assert.equal(documentEntryRefusal({ metadata: { type: 'payroll-import' } }), null);
  // landed cost and depreciation runs the same
  assert.equal(documentEntryRefusal({ metadata: { type: 'landed-cost', billId: 'b1' } }), null);
  assert.equal(documentEntryRefusal({ metadata: { type: 'depreciation-run' } }), null);
  // but the invoice's own accrual, the payment posting and the credit issuance stay refused
  for (const metadata of [
    { invoiceId: 'i', type: 'invoice-accrual' }, { invoiceId: 'i', type: 'invoice-payment' },
    { billId: 'b', type: 'bill-accrual' }, { paymentId: 'p', type: 'payment-posting' },
    { creditNoteId: 'c', type: 'credit-note-issuance' }, { vendorCreditId: 'v', type: 'vendor-credit-issuance' },
  ]) assert.ok(documentEntryRefusal({ metadata }), `${JSON.stringify(metadata)} must be refused`);
});

test('document reversals and standalone-payment postings cannot be edited via generic ledger routes', () => {
  const lifecycleEntries = [
    { type: 'invoice-reversal', invoiceId: 'inv1', isReversal: true },
    { type: 'bill-reversal', billId: 'bill1', isReversal: true },
    { type: 'payment-reversal', paymentId: 'pay1', isReversal: true },
    { type: 'credit-note-reversal', creditNoteId: 'cn1', isReversal: true },
    { type: 'vendor-credit-reversal', vendorCreditId: 'vc1', isReversal: true },
    { type: 'standalone-payment', paymentId: 'pay2' },
  ];
  for (const metadata of lifecycleEntries) {
    assert.ok(documentEntryRefusal({ metadata }), `${metadata.type}: generic full edit must be refused`);
    assert.ok(documentEntryRefusal({ metadata }, false, ['status']), `${metadata.type}: status mutation must be refused`);
    assert.ok(documentEntryRefusal({ metadata }, false, ['lines']), `${metadata.type}: posting amounts must be protected`);
    assert.equal(documentEntryRefusal({ metadata }, false, ['isFlagged', 'notes']), null,
      `${metadata.type}: nonfinancial annotations remain allowed`);
  }
});

test('flagging or annotating a document entry stays allowed; its figures, status and link do not', () => {
  const invoiceEntry = { metadata: { type: 'invoice-accrual', invoiceId: 'inv1' } };
  // the ledger list's "flag for review" button works on every row, document entries included
  assert.equal(documentEntryRefusal(invoiceEntry, false, ['isFlagged']), null);
  assert.equal(documentEntryRefusal(invoiceEntry, false, ['isFlagged', 'notes']), null);
  // anything that changes the books, the period or the document link is refused
  for (const keys of [['status'], ['lines'], ['amountCents'], ['date'], ['metadata.invoiceId'], ['isCleared'], ['reconciled'], ['exchangeRate'], ['currency'], ['deletedAt']]) {
    assert.ok(documentEntryRefusal(invoiceEntry, false, keys), `${keys.join(',')} must be refused on a document entry`);
  }
  // mixed: a flag plus a status change is a status change
  assert.ok(documentEntryRefusal(invoiceEntry, false, ['isFlagged', 'status']));
  // a whole-record rewrite is refused whether or not it names a financial field
  assert.ok(documentEntryRefusal(invoiceEntry, false));
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
  for (const status of ['failed', 'draft', 'void']) {
    const refusal = postedStatusRefusal({ status: 'completed' }, status);
    assert.ok(refusal, `completed → ${status} must be refused`);
    assert.match(refusal, /reversing entry/);
  }
  // the same transition on an entry that is not posted yet is how a draft is saved
  assert.equal(postedStatusRefusal({ status: 'draft' }, 'completed'), null);
  // cleared and reconciled entries count as posted even when their status is not `completed`
  assert.ok(postedStatusRefusal({ status: 'reconciled', isCleared: true }, 'failed'));
  assert.ok(postedStatusRefusal({ status: 'reconciled' }, 'failed'), 'status reconciled alone is posted');
  assert.ok(postedStatusRefusal({ status: 'pending', isReconciled: true }, 'void'), 'reconciliation flag alone is posted');
  // flags and review marks are not un-posting
  assert.equal(postedStatusRefusal({ status: 'completed' }, 'flagged'), null);
  assert.equal(postedStatusRefusal({ status: 'completed' }, 'reviewed'), null);
  // nothing to compare against: not a refusal
  assert.equal(postedStatusRefusal({ status: 'completed' }, undefined), null);
  assert.equal(postedStatusRefusal(null, 'failed'), null);
});


test('posted entry cannot acquire deletion marker without reversing; an admin retains override', () => {
  const tx = { status: 'completed' } as const;
  assert.match(postedDeletionRefusal(tx, { deletedAt: '2026-11-13T00:00:00Z' }) || '', /reversing entry/);
  assert.ok(postedDeletionRefusal(tx, { isDeleted: true } as never));
  assert.ok(postedDeletionRefusal({ status: 'reconciled' }, { deletedAt: '2026-11-13T00:00:00Z' }));
  assert.equal(postedDeletionRefusal(tx, { isFlagged: true }), null);
  assert.equal(postedDeletionRefusal(tx, { deletedAt: '2026-11-13T00:00:00Z' }, true), null);
  assert.equal(postedDeletionRefusal({ status: 'draft' }, { deletedAt: '2026-11-13T00:00:00Z' }), null);
  for (const status of ['flagged', 'pending', 'reviewed', 'approved', 'overdue'] as const) {
    assert.ok(postedDeletionRefusal({ status }, { deletedAt: '2026-11-13T00:00:00Z' }),
      `${status} cannot be deleted after a status-only change`);
    assert.ok(postedStatusRefusal({ status }, 'void'), `${status} cannot be voided in place`);
  }
});

test('two-request status bypass cannot un-post a journal counted in reports', () => {
  // A generic status change can preserve postability, but it must not remove
  // the protection that refuses the next request to void or soft-delete the row.
  for (const intermediateStatus of ['flagged', 'pending', 'approved', 'reviewed', 'overdue'] as const) {
    const intermediate = { status: intermediateStatus };
    assert.equal(isPostedEntry(intermediate), true);
    assert.ok(postedStatusRefusal(intermediate, 'failed'));
    assert.ok(postedStatusRefusal(intermediate, 'void'));
    assert.ok(postedDeletionRefusal(intermediate, { deletedAt: '2026-11-13T00:00:00Z' }));
  }
});

test('partial audit snapshots retain the same keys and show annotation changes', () => {
  const original = { status: 'completed' as const, description: 'Memo', isFlagged: false };
  const before = auditSnapshot(original);
  const after = auditSnapshot({ ...original, isFlagged: true });
  assert.deepEqual(Object.keys(before || {}), Object.keys(after || {}));
  assert.equal(before?.isFlagged, false);
  assert.equal(after?.isFlagged, true);
});

test('isPostedEntry and auditSnapshot read the fields an auditor asks about', () => {
  assert.equal(isPostedEntry({ status: 'completed' }), true);
  assert.equal(isPostedEntry({ status: 'reconciled' }), true);
  assert.equal(isPostedEntry({ status: 'pending', isReconciled: true }), true);
  assert.equal(isPostedEntry({ status: 'pending', isCleared: true }), true);
  assert.equal(isPostedEntry({ status: 'pending', reconciled: true }), true);
  for (const status of ['pending', 'flagged', 'reviewed', 'approved', 'overdue', 'certified'] as const) {
    assert.equal(isPostedEntry({ status }), true, `${status} remains in financial reports`);
  }
  assert.equal(isPostedEntry({ status: 'draft' }), false);
  assert.equal(isPostedEntry({ status: 'void' }), false);
  assert.equal(isPostedEntry({ status: 'failed' }), false);
  assert.equal(isPostedEntry({ status: 'void' }), false);
  assert.equal(isPostedEntry({ status: 'void', reconciled: true }), true);
  const snapshot = auditSnapshot({
    status: 'completed', date: '2026-10-31', totalAmountCents: 12500, description: 'Sales',
    currency: 'EUR', exchangeRate: 1.0842, lines: [{ accountId: 'a', amountCents: 12500 }, { accountId: 'b', amountCents: -12500 }],
  });
  assert.deepEqual(snapshot, {
    status: 'completed', date: '2026-10-31', totalAmountCents: 12500, description: 'Sales',
    lineCount: 2, currency: 'EUR', exchangeRate: 1.0842, isFlagged: null, notes: null,
  });
  assert.equal(auditSnapshot(undefined), null);
});

test('touchesFinancialField classifies the partial-update keys', () => {
  assert.equal(touchesFinancialField(['isFlagged', 'notes']), false);
  assert.equal(touchesFinancialField(['status']), true);
  assert.equal(touchesFinancialField(['metadata.anything']), true, 'a metadata path can strip the document link');
});

test('both generic entry routes call the guards (wiring, not only the helper)', () => {
  const read = (file: string) => fs.readFileSync(path.join(process.cwd(), 'src', 'server', 'routes', 'transactions', file), 'utf8');
  const crud = read('crudRoutes.ts');
  const reverse = read('reverseRoutes.ts');
  // the partial update branch, the full update branch and the reverse route each refuse a document entry
  assert.equal((crud.match(/documentEntryRefusal\(/g) || []).length, 3, 'PUT /:id must recheck full updates inside the database transaction');
  assert.equal((crud.match(/postedStatusRefusal\(/g) || []).length, 2, 'PUT /:id must refuse un-posting in both branches');
  assert.equal((crud.match(/postedDeletionRefusal\(/g) || []).length, 2, 'PUT /:id must refuse in-place deletion on both update paths');
  assert.equal((crud.match(/isPostedEntry\(/g) || []).length, 2, 'DELETE /:id must protect postable entries both before and inside its transaction');
  assert.equal((reverse.match(/documentEntryRefusal\(/g) || []).length, 1, 'POST /:id/reverse must refuse a document entry');
  // and the audit rows now carry before/after
  assert.match(crud, /before: beforeEdit/);
  assert.match(crud, /after: afterEdit/);
  assert.match(crud, /afterEdit = auditSnapshot\(\{ \.\.\.txData, \.\.\.safePartial \}/, 'partial-update audit fields must match before snapshot');
});
