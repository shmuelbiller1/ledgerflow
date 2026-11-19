import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import type { Firestore } from '../server/db/firestore';
import { requestPayloadHash } from '../server/utils/idempotency';

const url = process.env.LF_TEST_DATABASE_URL;
describe('Bulk and document command compatibility (database)', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_post_${crypto.randomBytes(4).toString('hex')}`;
  const id = (suffix: string) => `${ws}_${suffix}`;
  let db: Firestore;
  let server: Server;
  let base: string;
  let failBulkAudit = false;
  const bulk = '/api/v1/transactions/bulk';
  const invoice = `/api/v1/documents/invoices/${id('invoice')}/post`;
  const journal = (name: string) => ({
    id: id(name), workspaceId: ws, date: '2026-10-15', description: name, status: 'completed', type: 'journal',
    lines: [{ accountId: id('rent'), amountCents: 8000 }, { accountId: id('bank'), amountCents: -8000 }],
  });
  const call = async (path: string, input: unknown, key?: string, uid = 'owner') => {
    const res = await fetch(`${base}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-test-uid': uid, ...(key ? { 'idempotency-key': key } : {}) },
      body: JSON.stringify(input),
    });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };

  before(async () => {
    process.env.DATABASE_URL = url;
    const express = (await import('express')).default;
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({ uid: 'owner', currency: 'USD', name: 'Retry parity', members: ['owner', 'bk'], roles: { bk: 'bookkeeper' } });
    for (const [name, type] of [['bank', 'asset'], ['rent', 'expense']]) {
      await db.collection('chartAccounts').doc(id(name)).set({ workspaceId: ws, name, type, code: name });
    }
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { Object.assign(req, { user: { uid: req.header('x-test-uid') } }); next(); });
    const { createCommandRouter } = await import('../server/routes/commandRoutes');
    const { writeServerAuditLog } = await import('../server/services/auditLogService');
    app.use('/api/v1/commands', createCommandRouter(undefined, { auditWriter(entry, options) {
      if (failBulkAudit && entry.action === 'LEDGER_BULK_POSTED') throw new Error('Test audit failure');
      return writeServerAuditLog(entry, options);
    } }));
    app.use('/api/v1/transactions', (await import('../server/routes/transactionRoutes')).transactionRouter);
    app.use('/api/v1/documents', (await import('../server/routes/documentPostRoutes')).documentPostRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    for (const table of ['transactions', 'bankLines', 'chartAccounts', 'invoices', 'auditLogs', 'idempotencyKeys', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]);
    }
    await db.terminate();
  });

  test('bulk retries use the original key/actor/hash, forget postingDay, and return no new entries', async () => {
    // The old route infers the workspace from the first entry when the top-level field is absent.
    const input = { transactions: [journal('rent-posting')] };
    const key = 'paid rent'; // legacy key need not satisfy the command envelope's operation-ID regex
    const first = await call(bulk, { ...input, postingDay: '2026-10-15' }, key);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.deepEqual([first.body.status, first.body.count, (first.body.transactions as Array<{ id: string }>).map(tx => tx.id)], ['ok', 1, [id('rent-posting')]]);
    const record = (await db.collection('idempotencyKeys').doc(id(key)).get()).data();
    assert.equal(record?.payloadHash, requestPayloadHash(input));
    await db.collection('workspaces').doc(ws).update({ lockDate: '2026-10-31' });
    try {
      assert.deepEqual(await call(bulk, { ...input, postingDay: '2026-10-16' }, key), { status: 200, body: { status: 'ok', count: 1, transactions: [] } });
      assert.deepEqual(await call(bulk, input, key, 'bk'), { status: 409, body: { error: 'This operation id was already used by another user' } });
      assert.deepEqual(await call(invoice, { workspaceId: ws, action: 'create' }, key), { status: 409, body: { error: 'This operation id was already used for a different request' } });
    } finally { await db.collection('workspaces').doc(ws).update({ lockDate: null }); }
  });

  test('an existing legacy document result is returned before building or applying its posting', async () => {
    const key = 'existing-doc';
    const hash = requestPayloadHash({ collection: 'invoices', docId: id('invoice'), workspaceId: ws, action: 'delete', data: {} });
    await db.collection('idempotencyKeys').doc(id(key)).set({ workspaceId: ws, actor: 'owner', payloadHash: hash, code: 200, body: { status: 'ok', count: 2 } });
    const first = await call(invoice, { workspaceId: ws, action: 'delete', postingDay: '2026-10-16' }, key);
    assert.deepEqual(first, { status: 200, body: { status: 'ok', count: 2, transactions: [] } });
    assert.equal((await db.collection('invoices').doc(id('invoice')).get()).exists, false);
  });

  test('statement fingerprints deduplicate before replay lookup, and no second entry is posted', async () => {
    const input = { workspaceId: ws, bankLines: [{ id: id('line'), importIdentity: 'fingerprint-one', date: '2026-10-15', amountCents: -8000, matchedTransactionId: id('bank-posting'), status: 'matched' }], transactions: [journal('bank-posting')] };
    assert.equal((await call(bulk, input, 'import')).status, 200);
    assert.deepEqual(await call(bulk, input, 'import'), { status: 200, body: { status: 'ok', count: 0, skippedDuplicates: 1, transactions: [] } });
    const result = await call(bulk, { workspaceId: ws, transactions: [{ ...journal('forged'), metadata: { invoiceId: id('invoice') } }] });
    assert.equal(result.status, 400);
    assert.match(String(result.body.error), /Invoices are saved and posted by the server/);
    assert.equal((await db.collection('transactions').doc(id('forged')).get()).exists, false);
  });

  test('named bulk previews without writes, rolls back on audit failure, and safely replays a successful save', async () => {
    const path = '/api/v1/commands/journal.bulk';
    const entry = journal('named-bulk');
    const request = { workspaceId: ws, input: { transactions: [entry], postingDay: '2026-10-15' } };
    const key = 'named-bulk-retry';
    const preview = await call(`${path}/preview`, request);
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.deepEqual((preview.body.preview as { accounts: Array<{ amountCents: number }> }).accounts.map(a => a.amountCents), [8000, -8000]);
    const row = db.collection('transactions').doc(entry.id);
    assert.equal((await row.get()).exists, false);
    failBulkAudit = true;
    try {
      assert.equal((await call(path, request, key)).status, 500);
      assert.equal((await row.get()).exists, false);
      assert.equal((await db.collection('idempotencyKeys').doc(`${ws}:journal.bulk:${key}`).get()).exists, false);
    } finally { failBulkAudit = false; }
    assert.equal((await call(path, request, key)).status, 200);
    const replay = await call(path, { ...request, input: { ...request.input, postingDay: '2026-10-16' } }, key);
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    assert.equal(replay.body.replayed, true);
    assert.equal((await db.collection('auditLogs').where('workspaceId', '==', ws).where('entityId', '==', entry.id).get()).size, 1);
  });

  test('named bulk run and preview refuse malformed rows before writing anything', async () => {
    const path = '/api/v1/commands/journal.bulk';
    const entry = journal('bad-bulk');
    const invalid = [
      { transactions: [{ ...entry, date: 'not-a-date' }] },
      { transactions: [{ ...entry, lines: [{ accountId: id('rent'), amountCents: '8000' }] }] },
      { transactions: [{ ...entry, lines: [entry.lines[0], { ...entry.lines[1], amountCents: -7999 }] }] },
      { transactions: [entry], bankLines: [{ date: '2026-10-15', amountCents: -8000 }] },
      { transactions: [entry], entityMutation: { collection: 'orders', docId: id('order'), action: 'rename' } },
    ];
    for (const input of invalid) {
      for (const suffix of ['', '/preview']) {
        const result = await call(`${path}${suffix}`, { workspaceId: ws, input }, 'bad-bulk');
        assert.equal(result.status, 400, JSON.stringify(result.body));
        assert.equal(result.body.code, 'INVALID_INPUT');
      }
    }
    const wrongWorkspace = await call(path, { workspaceId: ws, input: { transactions: [{ ...entry, workspaceId: `${ws}_other` }] } }, 'bad-bulk');
    assert.equal(wrongWorkspace.status, 400);
    assert.equal(wrongWorkspace.body.code, 'WORKSPACE_MISMATCH');
    assert.equal((await db.collection('transactions').doc(entry.id).get()).exists, false);
    assert.equal((await db.collection('idempotencyKeys').doc(`${ws}:journal.bulk:bad-bulk`).get()).exists, false);
  });
});
