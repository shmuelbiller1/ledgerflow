/** #112 / #113 against the real database: POST /transactions/batch changes only allowed fields,
 * keeps the double-entry total and the workspace's own accounts, and is all-or-nothing. */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Firestore } from '../server/db/pgFirestore';

const url = process.env.LF_TEST_DATABASE_URL;
describe('batch edits are safe (database)', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_batch_${crypto.randomBytes(4).toString('hex')}`;
  const other = `${ws}x`;
  const id = (name: string) => `${ws}_${name}`;
  let server: Server;
  let base = '';
  let db: Firestore;
  const batch = async (updates: unknown[]) => {
    const res = await fetch(`${base}/api/v1/transactions/batch`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-uid': 'book-1' }, body: JSON.stringify({ workspaceId: ws, updates }) });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };
  const entry = async (name: string) => (await db.collection('transactions').doc(id(name)).get()).data() as Record<string, unknown> & { lines: Array<{ accountId: string; amountCents: number }> };

  before(async () => {
    process.env.DATABASE_URL = url;
    const express = (await import('express')).default;
    const { transactionRouter } = await import('../server/routes/transactionRoutes');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({ uid: 'owner-1', name: 'B', currency: 'USD', members: ['owner-1', 'book-1'], roles: { 'book-1': 'bookkeeper' } });
    const acct = (name: string, workspaceId = ws) => db.collection('chartAccounts').doc(workspaceId === ws ? id(name) : `${other}_${name}`).set({ workspaceId, name, code: name, type: name === 'bank' ? 'asset' : 'expense' });
    await acct('bank'); await acct('misc'); await acct('rent'); await acct('theirs', other);
    for (const name of ['a', 'b']) {
      await db.collection('transactions').doc(id(name)).set({
        workspaceId: ws, date: '2026-05-02', description: name, status: 'completed', totalAmountCents: 500, currency: 'USD', updatedAt: '2026-05-01T00:00:00.000Z',
        lines: [{ accountId: id('bank'), accountName: 'bank', amountCents: -500 }, { accountId: id('misc'), accountName: 'misc', amountCents: 500 }],
      });
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
    for (const table of ['transactions', 'chartAccounts', 'auditLogs', 'workspaces']) await db.pool.query(`delete from public."${table}" where workspace_id = any($1) or id = any($1)`, [[ws, other]]);
    await db.terminate();
  });

  test('#112: totals, dates and currency cannot be changed through a batch', async () => {
    for (const data of [{ totalAmountCents: 1 }, { date: '2026-01-01' }, { currency: 'EUR' }]) {
      assert.equal((await batch([{ id: id('a'), data }])).status, 400, JSON.stringify(data));
    }
    const e = await entry('a');
    assert.deepEqual([e.totalAmountCents, e.date, e.currency], [500, '2026-05-02', 'USD']);
  });

  test('#112: changed lines must balance, keep the total and use this workspace\'s accounts', async () => {
    const lines = (to: string, cents = 500) => [{ accountId: id('bank'), amountCents: -cents }, { accountId: to, amountCents: cents }];
    assert.equal((await batch([{ id: id('a'), data: { lines: lines(`${other}_theirs`) } }])).status, 400, 'another workspace\'s account');
    assert.equal((await batch([{ id: id('a'), data: { lines: lines(id('rent'), 900) } }])).status, 400, 'total changed');
    assert.equal((await entry('a')).lines[1].accountId, id('misc'));
    assert.equal((await batch([{ id: id('a'), data: { lines: lines(id('rent')) } }])).status, 200, 'moving between own accounts is allowed');
    assert.equal((await entry('a')).lines[1].accountId, id('rent'));
  });

  test('AUD-08: a month closed after the checks but before the save refuses the save', async () => {
    const original = db.runTransaction.bind(db);
    // close the month between the route's first read of the workspace and its transaction
    (db as unknown as { runTransaction: typeof db.runTransaction }).runTransaction = (async (fn: never) => {
      (db as unknown as { runTransaction: typeof db.runTransaction }).runTransaction = original;
      await db.collection('workspaces').doc(ws).set({ lockDate: '2026-12-31' }, { merge: true });
      return original(fn);
    }) as never;
    try {
      const r = await batch([{ id: id('b'), data: { description: 'after close' } }]);
      assert.notEqual(r.status, 200, JSON.stringify(r.body));
      assert.notEqual((await entry('b')).description, 'after close');
    } finally {
      (db as unknown as { runTransaction: typeof db.runTransaction }).runTransaction = original;
      await db.collection('workspaces').doc(ws).set({ lockDate: '' }, { merge: true });
    }
  });

  test('#113: one refused entry or a stale copy leaves every entry unchanged', async () => {
    const r = await batch([{ id: id('b'), data: { description: 'changed' } }, { id: id('missing'), data: { description: 'x' } }]);
    assert.equal(r.status, 400);
    assert.equal((await entry('b')).description, 'b', 'b must not change when another entry in the batch is refused');
    const stale = await batch([{ id: id('b'), data: { description: 'changed' } }, { id: id('a'), data: { description: 'y' }, expectedUpdatedAt: '2020-01-01T00:00:00.000Z' }]);
    assert.equal(stale.status, 409);
    assert.equal((await entry('b')).description, 'b');
  });

  test('cleared entries allow metadata/rule marks but not line or status rewrites', async () => {
    await db.collection('transactions').doc(id('a')).set({ isCleared: true }, { merge: true });
    assert.equal((await batch([{ id: id('a'), data: { description: 'cleared note' } }])).status, 200);
    assert.equal((await entry('a')).description, 'cleared note');
    const current = await entry('a');
    const lines = current.lines.map(line => ({ ...line }));
    assert.equal((await batch([{ id: id('a'), data: { lines } }])).status, 400, 'cleared line rewrites stay locked');
    assert.equal((await batch([{ id: id('a'), data: { status: 'reviewed' } }])).status, 400, 'cleared status rewrites stay locked');
  });

  test('#106: pairing two entries as a transfer is saved for both or for neither', async () => {
    const pair = (bTo: string) => [
      { id: id('a'), data: { isTransfer: true, transferDetails: { fromAccountId: 'x', toAccountId: 'y' } } },
      { id: id('b'), data: { isTransfer: true, lines: [{ accountId: id('bank'), amountCents: -500 }, { accountId: bTo, amountCents: 500 }] } },
    ];
    assert.equal((await batch(pair(`${other}_theirs`))).status, 400);
    assert.equal((await entry('a')).isTransfer, undefined, 'a must not be marked when b is refused');
    assert.equal((await batch(pair(id('rent')))).status, 200);
    assert.equal((await entry('a')).isTransfer, true);
    assert.equal((await entry('b')).isTransfer, true);
  });
});
