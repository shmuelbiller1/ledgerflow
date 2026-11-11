/**
 * Cleared by the bank (CA-04), through the server: owners, accountants and bookkeepers mark entries
 * cleared with the day the bank cleared them (never before the entry's own date) and can undo it;
 * viewers can't; another workspace's entries are refused. Runs when LF_TEST_DATABASE_URL is set.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Firestore } from '../server/db/pgFirestore';

const url = process.env.LF_TEST_DATABASE_URL;
describe('Marking entries cleared (database)', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_clr_${crypto.randomBytes(4).toString('hex')}`;
  const id = (name: string) => `${ws}_${name}`;
  let server: Server;
  let base = '';
  let db: Firestore;
  const clear = async (uid: string, body: Record<string, unknown>) => {
    const res = await fetch(`${base}/api/v1/transactions/reconciliation/clear`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-uid': uid }, body: JSON.stringify({ workspaceId: ws, ...body }) });
    return { status: res.status, body: await res.json() as { error?: string } };
  };
  const tx = async () => (await db.collection('transactions').doc(id('tx')).get()).data() || {};

  before(async () => {
    process.env.DATABASE_URL = url;
    const express = (await import('express')).default;
    const { transactionRouter } = await import('../server/routes/transactionRoutes');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({ uid: 'owner-1', name: 'Clr', currency: 'USD', members: ['owner-1', 'view-1', 'book-1'], roles: { 'view-1': 'viewer', 'book-1': 'bookkeeper' } });
    await db.collection('chartAccounts').doc(id('bank')).set({ id: id('bank'), workspaceId: ws, name: 'Bank', code: '1010', type: 'asset', currency: 'USD' });
    await db.collection('chartAccounts').doc(id('rent')).set({ id: id('rent'), workspaceId: ws, name: 'Rent', code: '5010', type: 'expense', currency: 'USD' });
    await db.collection('transactions').doc(id('tx')).set({ workspaceId: ws, date: '2026-05-03', description: 'Cheque 1042', totalAmountCents: 5000, status: 'completed', type: 'actual', lines: [{ accountId: id('bank'), amountCents: -5000 }, { accountId: id('rent'), amountCents: 5000 }] });
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
    for (const table of ['transactions', 'chartAccounts', 'auditLogs', 'workspaces']) await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]);
    await db.terminate();
  });

  test('a viewer cannot; a date before the entry is refused', async () => {
    assert.equal((await clear('view-1', { transactionIds: [id('tx')], clearanceDate: '2026-05-05' })).status, 403);
    const early = await clear('book-1', { transactionIds: [id('tx')], clearanceDate: '2026-05-01' });
    assert.deepEqual([early.status, early.body.error], [400, "It can't clear the bank before the entry's own date (2026-05-03)"]);
    assert.equal((await clear('book-1', { transactionIds: [id('tx')], clearanceDate: '5 May' })).status, 400);
    assert.equal((await tx()).isCleared, undefined);
  });

  test('cleared with the bank\'s day, then undone', async () => {
    assert.equal((await clear('book-1', { transactionIds: [id('tx')], clearanceDate: '2026-05-06' })).status, 200);
    assert.deepEqual([(await tx()).isCleared, (await tx()).clearanceDate, Boolean((await tx()).clearedAt)], [true, '2026-05-06', true]);
    assert.equal((await tx()).totalAmountCents, 5000, 'nothing else changes');
    assert.equal((await clear('owner-1', { transactionIds: [id('tx')], cleared: false })).status, 200);
    assert.deepEqual([(await tx()).isCleared, (await tx()).clearanceDate, (await tx()).clearedAt], [false, undefined, undefined]);
  });
});
