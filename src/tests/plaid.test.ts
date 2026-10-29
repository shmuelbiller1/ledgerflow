/**
 * Plaid bank connections (src/server/routes/plaidRoutes.ts) with a fake Plaid client and a real
 * database: connections belong to one workspace, only writers connect, a sync returns only that
 * workspace's banks, an expired login is flagged for "Reconnect" instead of failing the sync, and a
 * disconnect tells the bank to stop and removes the token but keeps the imported lines.
 * Runs when LF_TEST_DATABASE_URL is set.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Firestore } from '../server/db/pgFirestore';

const url = process.env.LF_TEST_DATABASE_URL;

describe('Plaid bank connections', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const suffix = crypto.randomBytes(4).toString('hex');
  const ws = `ws_plaid_${suffix}`;
  const other = `ws_plaid_other_${suffix}`;
  let server: Server;
  let base = '';
  let db: Firestore;
  const linkCalls: Record<string, unknown>[] = [];
  let nextAccessToken = 'access-good';
  const removed: string[] = [];

  const call = async (uid: string, method: 'GET' | 'POST', path: string, body?: Record<string, unknown>) => {
    const res = await fetch(`${base}/api/v1/plaid/${path}`, {
      method, headers: { 'content-type': 'application/json', 'x-test-uid': uid },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };

  before(async () => {
    process.env.DATABASE_URL = url;
    const express = (await import('express')).default;
    const { plaidRouter, setPlaidClientForTests } = await import('../server/routes/plaidRoutes');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    setPlaidClientForTests({
      linkTokenCreate: (async (args: Record<string, unknown>) => { linkCalls.push(args); return { data: { link_token: 'link-1' } }; }) as never,
      itemPublicTokenExchange: (async () => ({ data: { access_token: nextAccessToken, item_id: `item-${nextAccessToken}` } })) as never,
      itemRemove: (async ({ access_token }: { access_token: string }) => {
        removed.push(access_token);
        if (access_token === 'access-down') throw Object.assign(new Error('down'), { response: { data: { error_code: 'INTERNAL_SERVER_ERROR' } } });
        if (access_token === 'access-gone') throw Object.assign(new Error('gone'), { response: { data: { error_code: 'ITEM_NOT_FOUND' } } });
        return { data: {} };
      }) as never,
      transactionsGet: (async ({ access_token }: { access_token: string }) => {
        if (access_token === 'access-expired') throw Object.assign(new Error('login'), { response: { data: { error_code: 'ITEM_LOGIN_REQUIRED' } } });
        if (access_token === 'access-broken') throw Object.assign(new Error('down'), { response: { data: { error_code: 'INSTITUTION_DOWN' } } });
        return { data: { transactions: [{ transaction_id: `tx-${access_token}` }] } };
      }) as never,
    });
    await db.collection('workspaces').doc(ws).set({ uid: 'owner-1', name: 'Mine', members: ['owner-1', 'view-1', 'book-1'], roles: { 'view-1': 'viewer', 'book-1': 'bookkeeper' } });
    await db.collection('workspaces').doc(other).set({ uid: 'owner-2', name: 'Theirs', members: ['owner-2'] });

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
      await db.pool.query(`delete from public."${table}" where workspace_id in ($1, $2) or id in ($1, $2)`, [ws, other]);
    }
    await db.terminate();
  });

  let goodBankId = '';
  let expiredBankId = '';

  test('only owner/accountant/bookkeeper can connect a bank', async () => {
    assert.equal((await call('view-1', 'POST', 'create_link_token', { workspaceId: ws })).status, 403);
    assert.equal((await call('owner-2', 'POST', 'create_link_token', { workspaceId: ws })).status, 403);
    assert.equal((await call('owner-1', 'POST', 'create_link_token', { workspaceId: ws })).status, 200);
    assert.deepEqual(linkCalls.at(-1)?.products, ['transactions']);
  });

  test('a connection is saved for the workspace with an encrypted token', async () => {
    nextAccessToken = 'access-good';
    const res = await call('owner-1', 'POST', 'exchange_public_token', { workspaceId: ws, public_token: 'p1', institutionName: 'First Bank' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    goodBankId = String(res.body.bankId);
    const bank = (await db.collection('banks').doc(goodBankId).get()).data();
    assert.equal(bank?.workspaceId, ws);
    assert.match(String(bank?.access_token), /^enc:/);
    nextAccessToken = 'access-expired';
    expiredBankId = String((await call('owner-1', 'POST', 'exchange_public_token', { workspaceId: ws, public_token: 'p2', institutionName: 'Old Bank' })).body.bankId);
    nextAccessToken = 'access-theirs';
    await call('owner-2', 'POST', 'exchange_public_token', { workspaceId: other, public_token: 'p3' });
  });

  test("sync returns only this workspace's banks and flags the expired login", async () => {
    // AF-001: a sync stores bank lines, so a viewer may not run it (Codex on #439)
    assert.equal((await call('view-1', 'POST', 'sync', { workspaceId: ws })).status, 403);
    const res = await call('book-1', 'POST', 'sync', { workspaceId: ws });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual((res.body.transactions as { transaction_id: string }[]).map(t => t.transaction_id), ['tx-access-good']);
    assert.deepEqual(res.body.needsReconnect, [{ bankId: expiredBankId, institutionName: 'Old Bank' }]);
    assert.equal((await db.collection('banks').doc(expiredBankId).get()).data()?.status, 'login_required');
    // BC-11: the time of the last sync that worked; an expired login doesn't move it
    assert.match(String((await db.collection('banks').doc(goodBankId).get()).data()?.lastSyncedAt), /^\d{4}-\d{2}-\d{2}T/);
    assert.equal((await db.collection('banks').doc(expiredBankId).get()).data()?.lastSyncedAt, undefined);
    assert.equal((await call('owner-2', 'POST', 'sync', { workspaceId: ws })).status, 403);
    assert.equal((await call('owner-1', 'POST', 'sync', {})).status, 400);
  });

  test('reconnect uses update mode for that connection, then marks it active', async () => {
    const res = await call('owner-1', 'POST', 'create_link_token', { workspaceId: ws, bankId: expiredBankId });
    assert.equal(res.status, 200);
    assert.equal(linkCalls.at(-1)?.access_token, 'access-expired');
    assert.equal(linkCalls.at(-1)?.products, undefined);
    assert.equal((await call('owner-1', 'POST', 'create_link_token', { workspaceId: other, bankId: expiredBankId })).status, 403);
    assert.equal((await call('owner-1', 'POST', 'reconnected', { workspaceId: ws, bankId: expiredBankId })).status, 200);
    assert.equal((await db.collection('banks').doc(expiredBankId).get()).data()?.status, 'active');
  });

  test('the connection list never includes tokens', async () => {
    const res = await call('view-1', 'GET', `banks?workspaceId=${ws}`);
    assert.equal(res.status, 200);
    const banks = res.body.banks as Record<string, unknown>[];
    assert.equal(banks.length, 2);
    assert.ok(banks.every(b => !('access_token' in b)));
    assert.deepEqual(banks.map(b => typeof b.lastSyncedAt).sort(), ['object', 'string'], 'last successful sync shown (null for the expired one)');
    assert.equal(goodBankId.length > 0, true);
  });

  test('each sync is kept in the connection\'s log; a bank that fails is said and the others still sync (Z-28, Z-29)', async () => {
    nextAccessToken = 'access-broken';
    const broken = String((await call('owner-1', 'POST', 'exchange_public_token', { workspaceId: ws, public_token: 'p6', institutionName: 'Broken Bank', accountId: 'acc-broken' })).body.bankId);
    const res = await call('owner-1', 'POST', 'sync', { workspaceId: ws });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.failed, [{ bankId: broken, institutionName: 'Broken Bank', error: 'INSTITUTION_DOWN' }]);
    assert.deepEqual((res.body.transactions as { transaction_id: string }[]).map(t => t.transaction_id), ['tx-access-good'], 'the good one still came');
    const list = (await call('view-1', 'GET', `banks?workspaceId=${ws}`)).body.banks as Array<{ id: string; status: string; syncLog: Array<{ result: string; lines?: number; error?: string }> }>;
    const good = list.find(b => b.id === goodBankId)!;
    assert.deepEqual(good.syncLog.map(e => [e.result, e.lines]), [['ok', 1], ['ok', 1]], 'newest first');
    const bad = list.find(b => b.id === broken)!;
    assert.equal(bad.status, 'error');
    assert.deepEqual(bad.syncLog.map(e => [e.result, e.error]), [['error', 'INSTITUTION_DOWN']]);
    assert.deepEqual(list.find(b => b.id === expiredBankId)!.syncLog.map(e => e.result), ['login_required', 'login_required']);
    // only the failing one asked for: the sync fails, and says so in the log
    assert.equal((await call('owner-1', 'POST', 'sync', { workspaceId: ws, accountId: 'acc-broken' })).status, 502);
    assert.equal(((await db.collection('banks').doc(broken).get()).data()?.syncLog as unknown[]).length, 2);
    await db.collection('banks').doc(broken).delete();
  });

  test('disconnecting tells the bank to stop, deletes the connection and its token, and keeps the imported lines (Z-30)', async () => {
    await db.collection('bankLines').doc(`${ws}_line1`).set({ workspaceId: ws, date: '2026-10-01', amountCents: 500, description: 'Imported', status: 'pending', bankId: goodBankId });
    assert.equal((await call('book-1', 'POST', 'disconnect', { workspaceId: ws, bankId: goodBankId })).status, 403, 'owners and accountants only');
    assert.equal((await call('owner-2', 'POST', 'disconnect', { workspaceId: other, bankId: goodBankId })).status, 404, 'not another workspace\'s');
    assert.equal((await call('owner-1', 'POST', 'disconnect', { workspaceId: ws })).status, 400);
    const res = await call('owner-1', 'POST', 'disconnect', { workspaceId: ws, bankId: goodBankId });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(removed.at(-1), 'access-good', 'the bank was told with the real token');
    assert.equal((await db.collection('banks').doc(goodBankId).get()).exists, false);
    assert.equal((await db.collection('bankLines').doc(`${ws}_line1`).get()).exists, true, 'imported lines stay');
    const audit = await db.pool.query(`select data->'details'->>'description' as d from public."auditLogs" where workspace_id = $1 and data->>'action' = 'BANK_DISCONNECTED'`, [ws]);
    assert.deepEqual(audit.rows.map(r => r.d), ['First Bank disconnected; its imported bank lines are kept']);
    assert.deepEqual(((await call('view-1', 'GET', `banks?workspaceId=${ws}`)).body.banks as unknown[]).length, 1);
  });

  test('if the bank can\'t be told, nothing is removed; one the bank no longer knows is removed here', async () => {
    nextAccessToken = 'access-down';
    const down = String((await call('owner-1', 'POST', 'exchange_public_token', { workspaceId: ws, public_token: 'p4', institutionName: 'Down Bank' })).body.bankId);
    const res = await call('owner-1', 'POST', 'disconnect', { workspaceId: ws, bankId: down });
    assert.equal(res.status, 502);
    assert.match(String(res.body.message), /nothing was removed/);
    assert.equal((await db.collection('banks').doc(down).get()).exists, true);
    nextAccessToken = 'access-gone';
    const gone = String((await call('owner-1', 'POST', 'exchange_public_token', { workspaceId: ws, public_token: 'p5', institutionName: 'Gone Bank' })).body.bankId);
    assert.equal((await call('owner-1', 'POST', 'disconnect', { workspaceId: ws, bankId: gone })).status, 200);
    assert.equal((await db.collection('banks').doc(gone).get()).exists, false);
  });
});
