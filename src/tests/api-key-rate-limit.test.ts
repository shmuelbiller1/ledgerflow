/**
 * Per-key rate limits (Z-02): requests made with an API key count against that key's own limit a
 * minute (chosen when the key is made, 10 to 10,000, 120 otherwise), not against the caller's IP,
 * so one busy integration does not use up another key's allowance.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { API_KEY_DEFAULT_PER_MINUTE, apiKeyLimit } from '../server/middleware/rateLimiters';
import type { Firestore } from '../server/db/pgFirestore';

const url = process.env.LF_TEST_DATABASE_URL;

test('a key\'s limit: 10 to 10,000 a minute, 120 when missing or out of range', () => {
  assert.equal(apiKeyLimit(15), 15);
  assert.equal(apiKeyLimit(undefined), API_KEY_DEFAULT_PER_MINUTE);
  assert.equal(apiKeyLimit(5), 120);
  assert.equal(apiKeyLimit(20_000), 120);
  assert.equal(apiKeyLimit(12.5), 120);
});

describe('Each API key has its own limit (database)', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_ratekey${crypto.randomBytes(4).toString('hex')}`;
  let db: Firestore;
  let server: Server;
  let base = '';
  const makeKey = async (limit: number, scopes: string[] = ['read:transactions']) => {
    const keyId = `lf_id_${ws}_${crypto.randomBytes(8).toString('hex')}`;
    const secret = crypto.randomBytes(32).toString('hex');
    await db.collection('apiKeys').doc(keyId).set({
      id: keyId, workspaceId: ws, uid: 'owner-1', name: 'Test key', keyHash: crypto.createHash('sha256').update(secret).digest('hex'),
      scopes, expiresAt: 'never', createdAt: new Date().toISOString(), rateLimitPerMinute: limit,
    });
    return `${keyId}.${secret}`;
  };
  const read = (key: string) => fetch(`${base}/api/v1/transactions?workspaceId=${ws}`, { headers: { 'x-api-key': key } });

  before(async () => {
    process.env.DATABASE_URL = url;
    db = (await import('../server/db/firestore')).getDb();
    await db.collection('workspaces').doc(ws).set({ uid: 'owner-1', name: 'Rate Co', currency: 'USD', members: ['owner-1'], bypassBilling: true });
    const express = (await import('express')).default;
    const { apiAuthenticate } = await import('../server/auth/apiAuthenticate');
    const { transactionRouter } = await import('../server/routes/transactionRoutes');
    const app = express();
    app.use(express.json());
    app.use('/api/v1/transactions', apiAuthenticate, transactionRouter);
    // CC-09: only the scope check matters here, so the workspace routes answer with a plain ok
    app.use('/api/v1/workspaces', apiAuthenticate, (_req, res) => { res.json({ status: 'success' }); });
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    for (const table of ['apiKeys', 'workspaces']) await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]);
    await db.terminate();
  });

  test('a key allowed 10 a minute gets the 11th refused; another key from the same caller is not affected', async () => {
    const busy = await makeKey(10);
    const other = await makeKey(10);
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await read(busy)).status);
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(200));
    const refused = await read(busy);
    assert.equal(refused.status, 429);
    assert.equal(refused.headers.get('ratelimit-limit') ?? refused.headers.get('ratelimit-policy')?.split(';')[0], '10');
    assert.equal((await read(other)).status, 200, 'its own allowance');
  });

  test('a key that may read workspaces cannot change their settings (CC-09: payment types)', async () => {
    const key = await makeKey(100, ['read:workspaces']);
    const get = await fetch(`${base}/api/v1/workspaces/${ws}/usage?workspaceId=${ws}`, { headers: { 'x-api-key': key } });
    assert.equal(get.status, 200);
    const post = await fetch(`${base}/api/v1/workspaces/${ws}/payment-types?workspaceId=${ws}`, {
      method: 'POST', headers: { 'x-api-key': key, 'content-type': 'application/json' }, body: JSON.stringify({ op: 'add', name: 'X', method: 'card' }),
    });
    assert.equal(post.status, 403);
    assert.match(String((await post.json() as { message?: string }).message), /write:workspaces/);
  });
});
