/**
 * Agent #7 probe A7-04f (review-only): does "a posted entry is never deleted" survive a status change?
 *
 * DELETE /transactions/:id on a posted entry answers 403 "Only draft documents can be deleted … Posted documents must
 * be voided, never deleted" for every role (probe A7-04). PUT /transactions/:id { partialUpdate: { status } } accepts
 * 'draft' among its statuses (crudRoutes.ts:296) and refuses the change only for an entry that is already certified or
 * void. This probe sends the two requests one after the other, as a bookkeeper:
 *   1. { partialUpdate: { status: 'draft' } } on a posted entry;   2. DELETE the same entry.
 * on (a) a journal typed by hand and (b) the ledger entry of a payment (invoice INV-9, 500.00, paid in full).
 * Expected for a correct system: step 1 refused for a posted entry (un-posting is a reversal, with its own entry),
 * or step 2 still refused.
 *
 * Run: LF_TEST_DATABASE_URL=… NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic \
 *      npx tsx --test --test-force-exit audit/agent7-2026-11-11/probes/a7-04f-unpost-then-delete.test.ts
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DB_URL, named, openBooks, type Books } from './harness';

describe('A7-04f a posted entry set back to draft, then deleted', { skip: !DB_URL && 'LF_TEST_DATABASE_URL not set' }, () => {
  let b: Books;
  const invoiceId = () => `${b.ws}_inv9`;
  const journalId = () => `${b.ws}_hand`;
  let paymentEntryId = '', paymentId = '';
  before(async () => { b = await openBooks('unpost'); });
  after(async () => { await b.close(); await b.db.terminate(); });
  const facts: Record<string, unknown> = {};

  test('setup: invoice 500.00 paid in full, and a hand journal of 70.00', async () => {
    await b.db.collection('customers').doc(`${b.ws}_c1`).set({ id: `${b.ws}_c1`, workspaceId: b.ws, name: 'Acme' } as never);
    const data = { id: invoiceId(), workspaceId: b.ws, number: 'INV-9', customerName: 'Acme', customerId: `${b.ws}_c1`, date: '2026-08-03', dueDate: '2026-09-02', status: 'sent', currency: 'USD',
      amountCents: 50_000, items: [{ id: 'l1', description: 'Work', quantity: 1, rateCents: 50_000, amountCents: 50_000 }] };
    const posted = await b.send(b.OWNER, 'POST', `/api/v1/documents/invoices/${invoiceId()}/post`, { workspaceId: b.ws, action: 'create', data }, { 'idempotency-key': 'a7-04f-inv' });
    assert.equal(posted.status, 200, JSON.stringify(posted.body));
    const paid = await b.send(b.OWNER, 'POST', '/api/v1/payments', { workspaceId: b.ws, amountCents: 50_000, paymentDate: '2026-08-10', cashAccountId: b.acct.bank, customerId: `${b.ws}_c1`,
      allocations: [{ documentId: invoiceId(), documentType: 'invoice', amountCents: 50_000 }] }, { 'x-operation-id': 'a7-04f-pay' });
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    paymentEntryId = paid.body.data.transactionId; paymentId = paid.body.data.paymentId;
    const hand = await b.send(b.BOOKKEEPER, 'POST', '/api/v1/transactions', { transaction: { id: journalId(), uid: b.BOOKKEEPER, workspaceId: b.ws, date: '2026-08-12', description: 'hand journal', currency: 'USD', type: 'journal', status: 'completed', totalAmountCents: 7_000,
      lines: [{ accountId: b.acct.supplies, amountCents: 7_000 }, { accountId: b.acct.bank, amountCents: -7_000 }] } }, { 'x-operation-id': 'a7-04f-hand' });
    assert.equal(hand.status, 200, JSON.stringify(hand.body));
    assert.deepEqual(named(b, await b.balances()), { bank: 43_000, sales: -50_000, supplies: 7_000 });
  });

  for (const [label, id] of [['(a) the hand journal', journalId], ['(b) the payment\'s entry', () => paymentEntryId]] as const) {
    test(`${label}: DELETE refused while posted; then status → draft; then DELETE`, async () => {
      const direct = await b.send(b.BOOKKEEPER, 'DELETE', `/api/v1/transactions/${id()}?workspaceId=${b.ws}`);
      console.log(`${label}: DELETE while posted -> ${direct.status} ${JSON.stringify(direct.body).slice(0, 150)}`);
      const toDraft = await b.send(b.BOOKKEEPER, 'PUT', `/api/v1/transactions/${id()}`, { workspaceId: b.ws, partialUpdate: { status: 'draft' } });
      console.log(`${label}: PUT … { partialUpdate: { status: 'draft' } } -> ${toDraft.status} ${toDraft.status === 200 ? '' : JSON.stringify(toDraft.body).slice(0, 150)}`);
      console.log(`${label}: books with the entry as a draft: ${JSON.stringify(named(b, await b.balances()))}`);
      const del = await b.send(b.BOOKKEEPER, 'DELETE', `/api/v1/transactions/${id()}?workspaceId=${b.ws}`);
      console.log(`${label}: DELETE after that -> ${del.status} ${JSON.stringify(del.body).slice(0, 150)}`);
      const still = (await b.db.collection('transactions').doc(id()).get()).exists;
      const audit = (await b.db.collection('auditLogs').where('workspaceId', '==', b.ws).get()).docs.map(d => d.data()).filter(l => l.entityId === id());
      console.log(`${label}: the entry still exists: ${still}; books now: ${JSON.stringify(named(b, await b.balances()))}`);
      console.log(`${label}: audit rows for it: ${audit.map(l => `${l.action}${l.details?.deleted ? ' (keeps a copy of what was deleted)' : ''}`).join(', ') || 'none'}`);
      facts[label] = { deleteWhilePosted: direct.status, toDraft: toDraft.status, deleteAfter: del.status, stillExists: still };
    });
  }

  test('what the documents and the app\'s own checks say afterwards', async () => {
    const invoice = (await b.db.collection('invoices').doc(invoiceId()).get()).data()!;
    const payment = (await b.db.collection('payments').doc(paymentId).get()).data()!;
    console.log(`invoice: status ${invoice.status}, paid ${invoice.amountPaidCents}; payment: status ${payment.status}, amount ${payment.amountCents}`);
    const health = await b.dataHealth();
    console.log(`Data Health: ${health.length ? health.map(f => `(${f.severity}) [${f.checkId}] ${f.title}`).join(' | ') : 'none'}`);
    console.log(JSON.stringify(facts));
    // what main does today
    assert.deepEqual(facts, {
      '(a) the hand journal': { deleteWhilePosted: 403, toDraft: 200, deleteAfter: 200, stillExists: false },
      '(b) the payment\'s entry': { deleteWhilePosted: 403, toDraft: 200, deleteAfter: 200, stillExists: false },
    });
    console.log('DEFECT A7-04f: a posted entry — a hand journal and a payment\'s entry — is deleted in two requests by a bookkeeper');
  });
});
