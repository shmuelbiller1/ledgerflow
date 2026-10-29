/**
 * AF-001 (#151): /plaid/sync stores the downloaded rows as bank lines in the same database transaction
 * that moves the connection's cursor. A failure keeps neither, so the next sync brings the same rows
 * again instead of skipping past them; a row that arrives twice is still one line.
 * Runs when LF_TEST_DATABASE_URL is set.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Firestore } from '../server/db/pgFirestore';

const url = process.env.LF_TEST_DATABASE_URL;

describe('AF-001: Plaid sync stores its rows before the cursor moves', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const suffix = crypto.randomBytes(4).toString('hex');
  const ws = `ws_af001_${suffix}`;
  let server: Server;
  let base = '';
  let db: Firestore;
  let pages: Record<string, { added: unknown[]; next: string }> = {};
  const cursorsAsked: Array<string | undefined> = [];

  const sync = async () => {
    const res = await fetch(`${base}/api/v1/plaid/sync`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-test-uid': 'owner-1' }, body: JSON.stringify({ workspaceId: ws }),
    });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };
  const lines = async () => (await db.collection('bankLines').where('workspaceId', '==', ws).get()).docs.map(d => d.data());
  const bank = async (id: string) => (await db.collection('banks').doc(id).get()).data() || {};

  before(async () => {
    process.env.DATABASE_URL = url;
    const express = (await import('express')).default;
    const { plaidRouter, setPlaidClientForTests } = await import('../server/routes/plaidRoutes');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    setPlaidClientForTests({
      linkTokenCreate: (async () => ({ data: { link_token: 'l' } })) as never,
      itemPublicTokenExchange: (async () => ({ data: { access_token: 'access-af001', item_id: 'item-af001' } })) as never,
      transactionsGet: (async () => ({ data: { transactions: [] } })) as never,
      transactionsSync: (async ({ cursor }: { cursor?: string }) => {
        cursorsAsked.push(cursor);
        const page = pages[cursor || 'start'] || { added: [], next: cursor || 'start' };
        return { data: { added: page.added, modified: [], removed: [], next_cursor: page.next, has_more: false } };
      }) as never,
    });
    await db.collection('workspaces').doc(ws).set({ uid: 'owner-1', name: 'AF-001', members: ['owner-1'] });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string } }).user = { uid: String(req.header('x-test-uid')) }; next(); });
    app.use('/api/v1/plaid', plaidRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    for (const table of ['banks', 'bankLines', 'auditLogs', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]);
    }
    await db.terminate();
  });

  let bankId = '';

  test('the rows become pending bank lines and the cursor moves with them', async () => {
    const res = await fetch(`${base}/api/v1/plaid/exchange_public_token`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-test-uid': 'owner-1' },
      body: JSON.stringify({ workspaceId: ws, public_token: 'p', institutionName: 'AF Bank' }),
    });
    bankId = String((await res.json() as Record<string, unknown>).bankId);
    await db.collection('banks').doc(bankId).update({ accountId: 'acc-checking' });
    pages = {
      start: { next: 'c1', added: [
        { transaction_id: 'tx-coffee', date: '2026-10-20', name: 'Coffee', amount: 4.5 },
        { transaction_id: 'tx-salary', date: '2026-10-21', name: 'Salary', amount: -2500 },
        { transaction_id: 'tx-hold', date: '2026-10-22', name: 'Card hold', amount: 10, pending: true },
      ] },
    };
    const r = await sync();
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const stored = await lines();
    assert.deepEqual(stored.map(l => [l.description, l.amountCents, l.status, l.accountId, l.importIdentity]).sort(), [
      ['Coffee', -450, 'pending', 'acc-checking', 'plaid:tx-coffee'],
      ['Salary', 250000, 'pending', 'acc-checking', 'plaid:tx-salary'],
    ], 'posted rows only, money out negative; a pending card hold is not a bank line');
    assert.equal((await bank(bankId)).syncCursor, 'c1');
  });

  test('a row Plaid sends again is still one line', async () => {
    pages.c1 = { next: 'c2', added: [{ transaction_id: 'tx-coffee', date: '2026-10-20', name: 'Coffee', amount: 4.5 }, { transaction_id: 'tx-rent', date: '2026-10-23', name: 'Rent', amount: 1200 }] };
    assert.equal((await sync()).status, 200);
    const stored = await lines();
    assert.equal(stored.length, 3);
    assert.equal(stored.filter(l => l.importIdentity === 'plaid:tx-coffee').length, 1);
    assert.equal((await bank(bankId)).syncCursor, 'c2');
  });

  test('when the rows cannot be stored, neither they nor the cursor are kept, and the next sync brings them again', async () => {
    const { storePlaidSync, plaidRowsAsBankLines } = await import('../server/services/plaidIngest');
    pages.c2 = { next: 'c3', added: [{ transaction_id: 'tx-late', date: '2026-10-25', name: 'Late', amount: 3 }] };
    // the cursor update fails (no such bank document): the line written before it in the same
    // transaction must not survive, or the connection would read past rows it never stored
    await assert.rejects(storePlaidSync(db, {
      workspaceId: ws, uid: 'owner-1', bankRef: { id: `missing_${suffix}` },
      lines: plaidRowsAsBankLines(pages.c2.added, { id: bankId }, ws), bankUpdate: { syncCursor: 'c3' },
    }));
    assert.equal((await lines()).some(l => l.importIdentity === 'plaid:tx-late'), false, 'no line without its cursor');
    assert.equal((await bank(bankId)).syncCursor, 'c2', 'the saved cursor did not move');
    // the next sync starts from the saved cursor and stores the row
    assert.equal((await sync()).status, 200);
    assert.equal(cursorsAsked.at(-1), 'c2');
    assert.equal((await lines()).filter(l => l.importIdentity === 'plaid:tx-late').length, 1);
    assert.equal((await bank(bankId)).syncCursor, 'c3');
  });
});
