/**
 * Advance payments (BE-12, K-18): money received before an invoice waits in Customer Deposits, money
 * paid before a bill in Vendor Prepayments, and is applied to the document later (moved to A/R or
 * A/P that day). Without such an account the unapplied part stays on A/R or A/P, as before.
 * Runs when LF_TEST_DATABASE_URL is set.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Firestore } from '../server/db/pgFirestore';
import { advanceAccount } from '../lib/advancePayments';
import { makeChartAccount } from './fixtures';

test('which account an advance waits in', () => {
  const accounts = [
    makeChartAccount({ id: 'cash', name: 'Checking', type: 'asset', category: 'Cash' }),
    makeChartAccount({ id: 'udf', name: 'Undeposited Funds', type: 'asset', category: 'Current Assets' }),
    makeChartAccount({ id: 'dep', name: 'Customer Deposits', type: 'liability', category: 'Current Liabilities' }),
    makeChartAccount({ id: 'pre', name: 'Vendor Prepayments', type: 'asset', category: 'Current Assets' }),
  ];
  assert.deepEqual([advanceAccount(accounts, 'received')?.id, advanceAccount(accounts, 'made')?.id], ['dep', 'pre']);
  assert.equal(advanceAccount(accounts.slice(0, 2), 'received'), undefined, 'none: stays on A/R as before');
});

const url = process.env.LF_TEST_DATABASE_URL;
describe('Advance payments (database)', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_adv_${crypto.randomBytes(4).toString('hex')}`;
  const plain = `${ws}_plain`;
  const id = (name: string) => `${ws}_${name}`;
  let server: Server;
  let base = '';
  let db: Firestore;
  const call = async (uid: string, path: string, body: Record<string, unknown>) => {
    const res = await fetch(`${base}/api/v1/payments${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-uid': uid }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };
  const data = async (coll: string, docId: string) => (await db.collection(coll).doc(docId).get()).data() || {};
  const lines = (tx: Record<string, unknown>) => (tx.lines as { accountId: string; amountCents: number }[]).map(l => [l.accountId, l.amountCents]);

  before(async () => {
    process.env.DATABASE_URL = url;
    const express = (await import('express')).default;
    const { paymentRouter } = await import('../server/routes/paymentRoutes');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    for (const w of [ws, plain]) {
      await db.collection('workspaces').doc(w).set({ uid: 'owner-1', name: 'Adv', currency: 'USD', members: ['owner-1', 'view-1'], roles: { 'view-1': 'viewer' } });
      const account = (name: string, fields: Record<string, unknown>) => db.collection('chartAccounts').doc(`${w}_${name}`).set({ workspaceId: w, ...fields });
      await account('bank', { name: 'Checking', type: 'asset', category: 'Cash', code: '1000' });
      await account('ar', { name: 'Accounts Receivable', type: 'asset', category: 'Receivables', code: '1100' });
      await account('ap', { name: 'Accounts Payable', type: 'liability', category: 'Payables', code: '2000' });
      if (w === ws) {
        await account('dep', { name: 'Customer Deposits', type: 'liability', category: 'Current Liabilities', code: '2300' });
        await account('pre', { name: 'Vendor Prepayments', type: 'asset', category: 'Current Assets', code: '1400' });
      }
      await db.collection('invoices').doc(`${w}_inv`).set({ workspaceId: w, customerId: 'c1', number: 'INV-1', amountCents: 30000, status: 'sent', date: '2026-06-05', dueDate: '2026-07-05' });
      await db.collection('invoices').doc(`${w}_other`).set({ workspaceId: w, customerId: 'c2', number: 'INV-2', amountCents: 1000, status: 'sent', date: '2026-06-05' });
      await db.collection('bills').doc(`${w}_bill`).set({ workspaceId: w, vendorId: 'v1', number: 'B-1', amountCents: 8000, status: 'open', date: '2026-06-06' });
    }
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string } }).user = { uid: String(req.header('x-test-uid')) }; next(); });
    app.use('/api/v1/payments', paymentRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    for (const table of ['transactions', 'payments', 'invoices', 'bills', 'chartAccounts', 'auditLogs', 'numberingSeries', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = any($1) or id = any($1)`, [[ws, plain]]);
    }
    await db.terminate();
  });

  let depositId = '';
  test('a deposit before any invoice waits in Customer Deposits', async () => {
    const res = await call('owner-1', '', { workspaceId: ws, amountCents: 50000, paymentDate: '2026-06-01', customerId: 'c1', cashAccountId: id('bank'), allocations: [] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const result = res.body.data as { paymentId: string; payment: Record<string, unknown>; ledgerTransaction: Record<string, unknown> };
    depositId = result.paymentId;
    assert.deepEqual(lines(result.ledgerTransaction), [[id('bank'), 50000], [id('dep'), -50000]], 'no empty A/R line');
    assert.deepEqual([result.payment.unappliedCents, result.payment.advanceAccountId], [50000, id('dep')]);
  });

  test('applied to the invoice later: settled, and moved from deposits to A/R that day', async () => {
    assert.equal((await call('view-1', `/${depositId}/apply`, { workspaceId: ws, allocations: [{ documentId: id('inv'), documentType: 'invoice', amountCents: 30000 }] })).status, 403);
    assert.equal((await call('owner-1', `/${depositId}/apply`, { workspaceId: ws, allocations: [{ documentId: id('other'), documentType: 'invoice', amountCents: 1000 }] })).status, 400, 'another customer\'s invoice');
    const res = await call('owner-1', `/${depositId}/apply`, { workspaceId: ws, date: '2026-06-10', allocations: [{ documentId: id('inv'), documentType: 'invoice', amountCents: 30000 }] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const out = res.body.data as { unappliedCents: number; transactionId: string };
    assert.equal(out.unappliedCents, 20000);
    assert.deepEqual(lines(await data('transactions', out.transactionId)), [[id('dep'), 30000], [id('ar'), -30000]]);
    assert.equal((await data('transactions', out.transactionId)).date, '2026-06-10');
    assert.equal((await data('invoices', id('inv'))).status, 'paid');
    assert.equal((await data('payments', depositId)).unappliedCents, 20000);
  });

  test('not more than is left, not in a closed month', async () => {
    await db.collection('invoices').doc(id('inv3')).set({ workspaceId: ws, customerId: 'c1', number: 'INV-3', amountCents: 90000, status: 'sent', date: '2026-06-20' });
    const over = await call('owner-1', `/${depositId}/apply`, { workspaceId: ws, allocations: [{ documentId: id('inv3'), documentType: 'invoice', amountCents: 25000 }] });
    assert.equal(over.status, 409);
    assert.match(String(over.body.message), /Only \$200\.00 of this payment is still unapplied/);
    await db.collection('workspaces').doc(ws).update({ lockDate: '2026-06-30' });
    const locked = await call('owner-1', `/${depositId}/apply`, { workspaceId: ws, date: '2026-06-25', allocations: [{ documentId: id('inv3'), documentType: 'invoice', amountCents: 10000 }] });
    assert.equal(locked.status, 409);
    assert.equal((await data('payments', depositId)).unappliedCents, 20000, 'nothing changed');
    await db.collection('workspaces').doc(ws).update({ lockDate: null });
  });

  test('a vendor prepayment waits in Vendor Prepayments and is applied to the bill', async () => {
    const res = await call('owner-1', '', { workspaceId: ws, amountCents: 8000, paymentDate: '2026-06-02', vendorId: 'v1', cashAccountId: id('bank'), allocations: [] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const result = res.body.data as { paymentId: string; ledgerTransaction: Record<string, unknown> };
    assert.deepEqual(lines(result.ledgerTransaction), [[id('bank'), -8000], [id('pre'), 8000]]);
    const applied = await call('owner-1', `/${result.paymentId}/apply`, { workspaceId: ws, date: '2026-06-12', allocations: [{ documentId: id('bill'), documentType: 'bill', amountCents: 8000 }] });
    assert.equal(applied.status, 200, JSON.stringify(applied.body));
    // the same two lines; their order is not part of the rule
    assert.deepEqual(lines(await data('transactions', String((applied.body.data as { transactionId: string }).transactionId))).sort(), [[id('ap'), 8000], [id('pre'), -8000]].sort());
    assert.equal((await data('bills', id('bill'))).status, 'paid');
  });

  test('without a deposits account: on A/R as before, and applying moves no money', async () => {
    const res = await call('owner-1', '', { workspaceId: plain, amountCents: 30000, paymentDate: '2026-06-01', customerId: 'c1', cashAccountId: `${plain}_bank`, allocations: [] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const result = res.body.data as { paymentId: string; ledgerTransaction: Record<string, unknown> };
    assert.deepEqual(lines(result.ledgerTransaction), [[`${plain}_bank`, 30000], [`${plain}_ar`, -30000]]);
    const applied = await call('owner-1', `/${result.paymentId}/apply`, { workspaceId: plain, allocations: [{ documentId: `${plain}_inv`, documentType: 'invoice', amountCents: 30000 }] });
    assert.equal(applied.status, 200, JSON.stringify(applied.body));
    assert.equal((applied.body.data as { transactionId: string | null }).transactionId, null);
    assert.equal((await data('invoices', `${plain}_inv`)).status, 'paid');
  });
});
