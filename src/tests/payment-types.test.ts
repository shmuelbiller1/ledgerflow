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
import { findPaymentType, newPaymentTypeId, normalizePaymentTypes, renamePaymentType } from '../lib/paymentTypes';

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

test('CC-09: a new type id is random, never derived from the name, and unique in the list', () => {
  const a = newPaymentTypeId([]);
  assert.match(a, /^pt_[0-9a-f]{16}$/);
  assert.notEqual(newPaymentTypeId([]), a, 'two new ids differ, so a removed type\'s id is not handed to a new one');
  assert.equal(normalizePaymentTypes([{ id: a, name: 'ביט', method: 'bank_transfer' }]).length, 1, 'the id passes the list rules');
});

test('CC-09: renaming keeps the id and method; an empty, long or taken name changes nothing', () => {
  const list = normalizePaymentTypes([{ id: 'pt_a', name: 'PayPal', method: 'card' }, { id: 'pt_b', name: 'Bit  App', method: 'bank_transfer' }]);
  assert.equal(list[1].name, 'Bit  App', 'a stored name keeps its spacing');
  assert.equal(renamePaymentType(list, 'pt_a', ' bit app '), list, 'a name equal but for case and spacing is taken');
  assert.deepEqual(renamePaymentType(list, 'pt_a', '  Pay  Pal '), [{ id: 'pt_a', name: 'Pay  Pal', method: 'card' }, list[1]], 'kept as typed, only trimmed');
  for (const bad of ['', '   ', 'x'.repeat(61), 'BIT   app']) assert.equal(renamePaymentType(list, 'pt_a', bad), list, bad);
  assert.deepEqual(renamePaymentType(list, 'pt_a', 'PAYPAL')[0].name, 'PAYPAL', 'its own name in another case is fine');
});

const url = process.env.LF_TEST_DATABASE_URL;
describe('Payment types on the payment route (database)', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_ptype_${crypto.randomBytes(4).toString('hex')}`;
  let server: Server;
  let base = '';
  let db: Firestore;
  const pay = async (body: Record<string, unknown>, headers: Record<string, string> = {}) => {
    const res = await fetch(`${base}/api/v1/payments`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-uid': 'owner-1', ...headers }, body: JSON.stringify({ workspaceId: ws, amountCents: 5000, paymentDate: '2026-06-01', customerId: 'c1', cashAccountId: `${ws}_bank`, allocations: [], ...body }) });
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

  test('a retry of a recorded payment is handed back even after its type was removed (not recorded twice)', async () => {
    await db.collection('workspaces').doc(ws).update({ paymentTypes: [{ id: 'paypal', name: 'PayPal', method: 'card' }, { id: 'bit', name: 'Bit', method: 'bank_transfer' }] });
    const op = { 'x-operation-id': `op-${crypto.randomBytes(4).toString('hex')}` };
    const first = await pay({ paymentTypeId: 'bit', amountCents: 1234 }, op);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const firstId = (first.body.data as { paymentId: string }).paymentId;
    const count = (await db.collection('payments').where('workspaceId', '==', ws).get()).size;
    await db.collection('workspaces').doc(ws).update({ paymentTypes: [{ id: 'paypal', name: 'PayPal', method: 'card' }] });
    const retry = await pay({ paymentTypeId: 'bit', amountCents: 1234 }, op);
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    const data = retry.body.data as { paymentId: string; replayed: boolean };
    assert.deepEqual([data.paymentId, data.replayed], [firstId, true]);
    assert.equal((await db.collection('payments').where('workspaceId', '==', ws).get()).size, count);
    // a new operation with the removed type is still refused
    assert.equal((await pay({ paymentTypeId: 'bit' }, { 'x-operation-id': 'op-other-1' })).status, 400);
    // the same operation id with different details is a conflict, not the old payment
    const changed = await pay({ paymentTypeId: 'bit', amountCents: 9999 }, op);
    assert.equal(changed.status, 409, JSON.stringify(changed.body));
  });

  test('renaming the type between a payment and its retry still hands back the same payment', async () => {
    const op = { 'x-operation-id': `op-${crypto.randomBytes(4).toString('hex')}` };
    const first = await pay({ paymentTypeId: 'paypal', amountCents: 777 }, op);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    await db.collection('workspaces').doc(ws).update({ paymentTypes: [{ id: 'paypal', name: 'PayPal Business', method: 'card' }] });
    const retry = await pay({ paymentTypeId: 'paypal', amountCents: 777 }, op);
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    const data = retry.body.data as { paymentId: string; replayed: boolean; payment: { paymentType: { name: string } } };
    assert.deepEqual([data.paymentId, data.replayed], [(first.body.data as { paymentId: string }).paymentId, true]);
    assert.equal(data.payment.paymentType.name, 'PayPal', 'the payment keeps the name it was recorded with');
  });

  test('changes are made by the server one at a time; two people adding at once both keep theirs', async () => {
    const { changePaymentTypes } = await import('../server/services/paymentTypeService');
    await db.collection('workspaces').doc(ws).update({ paymentTypes: [] });
    const as = (uid: string, change: Record<string, unknown>) => changePaymentTypes(db, { workspaceId: ws, uid, change: change as never });
    await Promise.all([as('owner-1', { op: 'add', name: 'Bit', method: 'bank_transfer' }), as('owner-1', { op: 'add', name: 'PayBox', method: 'bank_transfer' })]);
    const names = () => db.collection('workspaces').doc(ws).get().then(d => ((d.data()?.paymentTypes || []) as { name: string }[]).map(t => t.name).sort());
    assert.deepEqual(await names(), ['Bit', 'PayBox']);
    const bit = ((await db.collection('workspaces').doc(ws).get()).data()?.paymentTypes as { id: string; name: string }[]).find(t => t.name === 'Bit')!;
    assert.match(bit.id, /^pt_[0-9a-f]{16}$/);
    await assert.rejects(as('owner-1', { op: 'add', name: 'bit', method: 'card' }), /already a payment type/);
    await assert.rejects(as('owner-1', { op: 'rename', id: bit.id, name: 'PAYBOX' }), /already a payment type/);
    await assert.rejects(as('owner-1', { op: 'remove', id: 'pt_gone' }), /removed meanwhile/);
    await assert.rejects(as('owner-1', { op: 'add', name: 'X', method: 'bitcoin' }), /payment method/);
    await assert.rejects(as('someone-else', { op: 'add', name: 'X', method: 'card' }), /owners and accountants/);
    await as('owner-1', { op: 'rename', id: bit.id, name: 'Bit app' });
    await as('owner-1', { op: 'remove', id: bit.id });
    assert.deepEqual(await names(), ['PayBox']);
    await db.collection('workspaces').doc(ws).update({ paymentTypes: [{ id: 'paypal', name: 'PayPal', method: 'card' }] });
  });

  test('without a type, a payment is as before', async () => {
    const res = await pay({ paymentMethod: 'check' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const payment = (res.body.data as { payment: Record<string, unknown> }).payment;
    assert.equal(payment.method, 'check');
    assert.equal(payment.paymentType, undefined);
  });
});
