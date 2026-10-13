/** Real-Postgres regression for retry after the payment committed but its reply was lost.
 * Runs in CI with LF_TEST_DATABASE_URL. No network access outside the test DB.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { Firestore } from '../server/db/pgFirestore';
import { createPaymentIdempotent, type CreatePaymentPayload } from '../server/services/paymentService';

const url = process.env.LF_TEST_DATABASE_URL;
describe('payment idempotency under uncertain responses', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = 'ws_payretry_' + crypto.randomBytes(5).toString('hex');
  const id = (s: string) => `${ws}_${s}`;
  let db: Firestore;
  const payload: CreatePaymentPayload = {
    workspaceId: ws, uid: 'owner-1', paymentDate: '2026-10-13', amountCents: 1750,
    paymentMethod: 'bank_transfer', vendorId: 'vendor-1', entityName: 'Vendor',
    cashAccountId: id('bank'), offsetAccountId: id('ap'), allocations: [],
  };

  before(async () => {
    process.env.DATABASE_URL = url;
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({
      uid: 'owner-1', members: ['owner-1'], roles: {}, currency: 'USD', name: 'Retry tests',
    });
    await db.collection('chartAccounts').doc(id('bank')).set({
      workspaceId: ws, name: 'Bank', type: 'asset', category: 'Cash', code: '1000',
    });
    await db.collection('chartAccounts').doc(id('ap')).set({
      workspaceId: ws, name: 'Accounts Payable', type: 'liability', category: 'Payables', code: '2000',
    });
  });

  after(async () => {
    if (!db) return;
    for (const table of ['transactions', 'payments', 'auditLogs', 'numberingSeries', 'idempotencyKeys', 'chartAccounts', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]);
    }
    await db.terminate();
  });

  test('same operation after lost reply yields ONE payment and journal; changed request is rejected', async () => {
    const first = await createPaymentIdempotent(db, payload, 'retry-one');
    assert.equal(first.replayed, false);
    // Simulate the caller never receiving the first response and submitting the same action again.
    const second = await createPaymentIdempotent(db, { ...payload, allocations: [] }, 'retry-one');
    assert.equal(second.replayed, true);
    assert.equal(second.paymentId, first.paymentId);
    assert.equal(second.transactionId, first.transactionId);
    const payments = await db.collection('payments').where('workspaceId', '==', ws).get();
    const journals = await db.collection('transactions').where('workspaceId', '==', ws).get();
    assert.equal(payments.size, 1, 'must not create another payment');
    assert.equal(journals.size, 1, 'must not create another cash journal');
    await assert.rejects(
      () => createPaymentIdempotent(db, { ...payload, amountCents: 2000 }, 'retry-one'),
      /key reused/i,
    );
    assert.equal((await db.collection('payments').where('workspaceId', '==', ws).get()).size, 1);
  });
});
