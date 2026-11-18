/**
 * Bank statement lines against a real database: importing them with their ledger entries
 * (POST /api/v1/transactions/bulk), paying invoices from a deposit and splitting a line
 * (POST /api/v1/transactions/bank-lines/:id/pay|split, src/server/services/bankLineService.ts).
 * Runs when LF_TEST_DATABASE_URL is set.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Firestore } from '../server/db/pgFirestore';

const url = process.env.LF_TEST_DATABASE_URL;

describe('Banking', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const suffix = crypto.randomBytes(4).toString('hex');
  const ws = `ws_bank_${suffix}`;
  const id = (name: string) => `${ws}_${name}`;
  let server: Server;
  let base = '';
  let db: Firestore;

  const post = async (uid: string, path: string, body: Record<string, unknown>) => {
    const res = await fetch(`${base}/api/v1/transactions${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-test-uid': uid },
      body: JSON.stringify({ workspaceId: ws, ...body }),
    });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };
  const data = async (coll: string, docId: string) => (await db.collection(coll).doc(docId).get()).data() || {};
  const lines = (tx: Record<string, unknown>) => (tx.lines as { accountId: string; amountCents: number }[]).map(l => [l.accountId, l.amountCents]);
  const pendingLine = (name: string, amountCents: number) => db.collection('bankLines').doc(id(name)).set({
    workspaceId: ws, uid: 'owner-1', date: '2026-06-10', description: `Line ${name}`, amountCents, status: 'pending', matchedTransactionId: null,
  });

  before(async () => {
    process.env.DATABASE_URL = url;
    const express = (await import('express')).default;
    const { transactionRouter } = await import('../server/routes/transactionRoutes');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({ uid: 'owner-1', name: 'Bank', currency: 'USD', members: ['owner-1', 'view-1'], roles: { 'view-1': 'viewer' } });
    const account = (name: string, fields: Record<string, unknown>) => db.collection('chartAccounts').doc(id(name)).set({ workspaceId: ws, ...fields });
    await account('bank', { name: 'Checking', type: 'asset', category: 'Cash', code: '1000' });
    await account('ar', { name: 'Accounts Receivable', type: 'asset', category: 'Receivables', code: '1100' });
    await account('sales', { name: 'Sales', type: 'revenue', category: 'Revenue', code: '4000' });
    await account('supplies', { name: 'Supplies', type: 'expense', category: 'Supplies', code: '6100' });
    await account('fuel', { name: 'Fuel', type: 'expense', category: 'Travel', code: '6200' });
    for (const [name, customerId, cents] of [['inv1', 'c1', 10000], ['inv2', 'c1', 8000], ['inv3', 'c2', 5000]] as const) {
      await db.collection('invoices').doc(id(name)).set({ workspaceId: ws, customerId, customerName: customerId, amountCents: cents, amountPaidCents: 0, status: 'sent', dueDate: '2026-07-01', currency: 'USD' });
    }

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string } }).user = { uid: String(req.header('x-test-uid')) }; next(); });
    app.use('/api/v1/transactions', transactionRouter);
    app.use('/api/v1/documents', (await import('../server/routes/documentPostRoutes')).documentPostRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    for (const table of ['transactions', 'bankLines', 'payments', 'invoices', 'chartAccounts', 'auditLogs', 'idempotencyKeys', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]);
    }
    await db.terminate();
  });

  test('import: bank lines and their entries are saved together by the server', async () => {
    const tx = {
      id: id('imp-tx'), date: '2026-06-01', description: 'Coffee', totalAmountCents: 450, currency: 'USD', status: 'completed', type: 'bank_import',
      lines: [{ accountId: id('supplies'), amountCents: 450 }, { accountId: id('bank'), amountCents: -450 }],
    };
    const bankLines = [
      { id: id('imp-1'), date: '2026-06-01', description: 'Coffee', amountCents: -450, status: 'matched', matchedTransactionId: id('imp-tx') },
      { id: id('imp-2'), date: '2026-06-02', description: 'Unknown', amountCents: -1200, status: 'pending' },
    ];
    assert.equal((await post('view-1', '/bulk', { transactions: [tx], bankLines })).status, 403);
    const res = await post('owner-1', '/bulk', { transactions: [tx], bankLines });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal((await data('bankLines', id('imp-1'))).matchedTransactionId, id('imp-tx'));
    assert.equal((await data('bankLines', id('imp-2'))).status, 'pending');
    assert.equal((await data('bankLines', id('imp-2'))).workspaceId, ws);
    // Same line again, or a line pointing at an entry outside the request: refused
    assert.equal((await post('owner-1', '/bulk', { transactions: [], bankLines: [bankLines[1]] })).status, 409);
    assert.equal((await post('owner-1', '/bulk', { transactions: [], bankLines: [{ ...bankLines[0], id: id('imp-3') }] })).status, 400);
  });

  test('a deposit pays two invoices of one customer: payment record, ledger entry, line matched', async () => {
    await pendingLine('dep', 18000);
    const res = await post('owner-1', `/bank-lines/${id('dep')}/pay`, {
      bankAccountId: id('bank'), allocations: [{ documentId: id('inv1'), amountCents: 10000 }, { documentId: id('inv2'), amountCents: 8000 }],
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const payment = await data('payments', String(res.body.paymentId));
    assert.equal(payment.direction, 'received');
    assert.equal(payment.status, 'posted');
    assert.equal(payment.contactId, 'c1');
    assert.equal(payment.unappliedCents, 0);
    assert.deepEqual(lines(await data('transactions', String(res.body.transactionId))), [[id('bank'), 18000], [id('ar'), -18000]]);
    assert.equal((await data('invoices', id('inv1'))).status, 'paid');
    assert.equal((await data('invoices', id('inv2'))).settledByRecordsCents, 8000);
    const line = await data('bankLines', id('dep'));
    assert.equal(line.status, 'matched');
    assert.equal(line.matchedTransactionId, res.body.transactionId);
    // A matched line can't be used again
    assert.equal((await post('owner-1', `/bank-lines/${id('dep')}/pay`, { bankAccountId: id('bank'), allocations: [{ documentId: id('inv3'), amountCents: 1 }] })).status, 409);
  });

  test('refused: invoices of two customers, more than the line, a non-bank account', async () => {
    await pendingLine('dep2', 5000);
    assert.equal((await post('owner-1', `/bank-lines/${id('dep2')}/pay`, { bankAccountId: id('bank'), allocations: [{ documentId: id('inv3'), amountCents: 5001 }] })).status, 400);
    assert.equal((await post('owner-1', `/bank-lines/${id('dep2')}/pay`, { bankAccountId: id('sales'), allocations: [{ documentId: id('inv3'), amountCents: 5000 }] })).status, 400);
    await db.collection('invoices').doc(id('inv4')).set({ workspaceId: ws, customerId: 'c3', amountCents: 100, status: 'sent', dueDate: '2026-07-01' });
    assert.equal((await post('owner-1', `/bank-lines/${id('dep2')}/pay`, { bankAccountId: id('bank'), allocations: [{ documentId: id('inv3'), amountCents: 4900 }, { documentId: id('inv4'), amountCents: 100 }] })).status, 400);
    assert.equal((await data('bankLines', id('dep2'))).status, 'pending');
  });

  test('split a card payment over two expense accounts', async () => {
    await pendingLine('card', -8000);
    assert.equal((await post('owner-1', `/bank-lines/${id('card')}/split`, { bankAccountId: id('bank'), splits: [{ accountId: id('supplies'), amountCents: 5000 }] })).status, 400);
    const res = await post('owner-1', `/bank-lines/${id('card')}/split`, {
      bankAccountId: id('bank'), splits: [{ accountId: id('supplies'), amountCents: 5000 }, { accountId: id('fuel'), amountCents: 3000, description: 'Fuel' }],
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(lines(await data('transactions', String(res.body.transactionId))), [[id('bank'), -8000], [id('supplies'), 5000], [id('fuel'), 3000]]);
    assert.equal((await data('bankLines', id('card'))).status, 'matched');
  });

  test('a viewer cannot clear bank lines', async () => {
    await pendingLine('v', 100);
    assert.equal((await post('view-1', `/bank-lines/${id('v')}/split`, { bankAccountId: id('bank'), splits: [{ accountId: id('sales'), amountCents: 100 }] })).status, 403);
  });

  test('#830: only a ledger writer changes a bank line, in an open period, matched to an entry of this workspace', async () => {
    const patch = async (uid: string, lineId: string, data: Record<string, unknown>) => {
      const res = await fetch(`${base}/api/v1/transactions/bank-lines/${lineId}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json', 'x-test-uid': uid }, body: JSON.stringify({ workspaceId: ws, ...data }),
      });
      return res.status;
    };
    await pendingLine('p830', -5000);
    await db.collection('transactions').doc(id('own-tx')).set({ workspaceId: ws, uid: 'owner-1', date: '2026-06-10', status: 'completed', totalAmountCents: 5000, lines: [{ accountId: id('bank'), amountCents: -5000 }, { accountId: id('supplies'), amountCents: 5000 }] });
    await db.collection('transactions').doc(`other_${suffix}`).set({ workspaceId: `other_${suffix}`, uid: 'x', date: '2026-06-10', status: 'draft', totalAmountCents: 0, lines: [] });
    assert.equal(await patch('view-1', id('p830'), { status: 'matched', matchedTransactionId: id('own-tx') }), 403);
    assert.equal(await patch('owner-1', id('p830'), { status: 'matched', matchedTransactionId: `other_${suffix}` }), 404);
    assert.equal((await data('bankLines', id('p830'))).status, 'pending');
    assert.equal(await patch('owner-1', id('p830'), { status: 'matched', matchedTransactionId: id('own-tx') }), 200);
    assert.equal((await data('bankLines', id('p830'))).matchedTransactionId, id('own-tx'));
    // a line in a closed period stays as it is
    await pendingLine('closed830', -100);
    await db.collection('workspaces').doc(ws).update({ lockDate: '2026-06-30' });
    try {
      assert.equal(await patch('owner-1', id('closed830'), { status: 'ignored' }), 409);
      assert.equal((await data('bankLines', id('closed830'))).status, 'pending');
    } finally {
      await db.collection('workspaces').doc(ws).update({ lockDate: null });
      await db.collection('transactions').doc(`other_${suffix}`).delete();
    }
  });
});
