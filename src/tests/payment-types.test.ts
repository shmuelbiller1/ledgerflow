/**
 * CC-09: workspace payment types. The list rules, and (with LF_TEST_DATABASE_URL) the payment route:
 * a type's method and name come from the workspace, never from the client.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Firestore } from '../server/db/pgFirestore';
import { findPaymentType, newPaymentTypeId, normalizePaymentTypes } from '../lib/paymentTypes';

test('CC-09: payment types keep a valid id, a name and a known method, once each', () => {
  const list = normalizePaymentTypes([
    { id: 'paypal', name: '  PayPal ', method: 'card' },
    { id: 'paypal', name: 'PayPal again', method: 'card' }, // same id
    { id: 'pp2', name: 'paypal', method: 'other' }, // same name, any case
    { id: 'bit', name: 'Bit', method: 'bank_transfer' },
    { id: 'BAD ID', name: 'X', method: 'cash' },
    { id: 'crypto', name: 'Crypto', method: 'bitcoin' },
    { id: 'long', name: 'x'.repeat(61), method: 'cash' },
    { id: 'empty', name: '   ', method: 'cash' },
    null, 'paypal',
  ]);
  assert.deepEqual(list, [{ id: 'paypal', name: 'PayPal', method: 'card' }, { id: 'bit', name: 'Bit', method: 'bank_transfer' }]);
  assert.deepEqual(normalizePaymentTypes(undefined), []);
  assert.equal(findPaymentType(list, 'bit')?.method, 'bank_transfer');
  assert.equal(findPaymentType(list, 'nope'), undefined);
  assert.equal(findPaymentType(list, undefined), undefined);
});

test('CC-09: a new type id is a slug of its name, unique in the list', () => {
  assert.equal(newPaymentTypeId('Pay Pal!', []), 'pay-pal');
  assert.equal(newPaymentTypeId('Pay Pal', [{ id: 'pay-pal' }, { id: 'pay-pal-2' }]), 'pay-pal-3');
  assert.equal(newPaymentTypeId('ביט', []), 'type', 'a name with no Latin letters still gets an id');
  assert.equal(newPaymentTypeId('ביט', [{ id: 'type' }]), 'type-2');
});

const url = process.env.LF_TEST_DATABASE_URL;
describe('Payment types on the payment route (database)', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_ptype_${crypto.randomBytes(4).toString('hex')}`;
  let server: Server;
  let base = '';
  let db: Firestore;
  const pay = async (body: Record<string, unknown>) => {
    const res = await fetch(`${base}/api/v1/payments`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-uid': 'owner-1' }, body: JSON.stringify({ workspaceId: ws, amountCents: 5000, paymentDate: '2026-06-01', customerId: 'c1', cashAccountId: `${ws}_bank`, allocations: [], ...body }) });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };

  before(async () => {
    process.env.DATABASE_URL = url;
    const express = (await import('express')).default;
    const { paymentRouter } = await import('../server/routes/paymentRoutes');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({
      uid: 'owner-1', name: 'Types', currency: 'USD', members: ['owner-1'],
      paymentTypes: [{ id: 'paypal', name: 'PayPal', method: 'card' }],
    });
    const account = (name: string, fields: Record<string, unknown>) => db.collection('chartAccounts').doc(`${ws}_${name}`).set({ workspaceId: ws, ...fields });
    await account('bank', { name: 'Checking', type: 'asset', category: 'Cash', code: '1000' });
    await account('ar', { name: 'Accounts Receivable', type: 'asset', category: 'Receivables', code: '1100' });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string } }).user = { uid: String(req.header('x-test-uid')) }; next(); });
    app.use('/api/v1/payments', paymentRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    for (const table of ['transactions', 'payments', 'chartAccounts', 'auditLogs', 'numberingSeries', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]);
    }
    await db.terminate();
  });

  test('the type\'s method and name are taken from the workspace, whatever the client sent', async () => {
    const res = await pay({ paymentMethod: 'cash', paymentTypeId: 'paypal' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const payment = (res.body.data as { payment: Record<string, unknown> }).payment;
    assert.equal(payment.method, 'card');
    assert.deepEqual(payment.paymentType, { id: 'paypal', name: 'PayPal' });
  });

  test('a type that is not in the workspace is refused and nothing is recorded', async () => {
    const before = (await db.collection('payments').where('workspaceId', '==', ws).get()).size;
    const res = await pay({ paymentMethod: 'card', paymentTypeId: 'venmo' });
    assert.equal(res.status, 400);
    assert.match(String(res.body.message), /no longer in Settings/);
    assert.equal((await db.collection('payments').where('workspaceId', '==', ws).get()).size, before);
  });

  test('without a type, a payment is as before', async () => {
    const res = await pay({ paymentMethod: 'check' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const payment = (res.body.data as { payment: Record<string, unknown> }).payment;
    assert.equal(payment.method, 'check');
    assert.equal(payment.paymentType, undefined);
  });
});
