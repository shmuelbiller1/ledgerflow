/**
 * AUD-09 step 3: the write routes registered on the app itself (not on a router), with real sign-in tokens.
 * API keys: only an owner makes one, and only an owner (or a platform admin) revokes one; before this, any member
 * who could post (accountant, bookkeeper) could revoke a workspace's key.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { SignJWT } from 'jose';

const url = process.env.LF_TEST_DATABASE_URL;
process.env.SUPABASE_URL = 'https://example-project.supabase.co';
process.env.SUPABASE_JWT_SECRET = 'test-jwt-secret-with-at-least-32-characters-long';
const token = (sub: string, admin = false) => new SignJWT({ role: 'authenticated', app_metadata: { provider: 'email', ...(admin ? { admin: true } : {}) }, sub, email: `${sub.slice(0, 8)}@example.com`, aal: 'aal2' })
  .setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setIssuer('https://example-project.supabase.co/auth/v1').setAudience('authenticated')
  .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET));

type Db = { pool: { query: (q: string, p: unknown[]) => Promise<unknown> }; terminate: () => Promise<void>; collection: (n: string) => { doc: (id: string) => { set: (d: object) => Promise<unknown>; get: () => Promise<{ exists: boolean }> } } };

describe('AUD-09 step 3: API keys (routes on the app)', { skip: !url && 'needs LF_TEST_DATABASE_URL' }, () => {
  const ws = `aud09k_${crypto.randomBytes(4).toString('hex')}`;
  const [owner, book, viewer, stranger, platformAdmin] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  let server: Server | undefined;
  let base = '';
  let db: Db;
  const call = async (uid: string, method: string, path: string, body?: object) =>
    { const r = await fetch(base + path, { method, headers: { "content-type": "application/json", authorization: `Bearer ${await token(uid, uid === platformAdmin)}` }, ...(body ? { body: JSON.stringify(body) } : {}) }); return r.status; };
  const seedKey = async (id: string) => db.collection('apiKeys').doc(id).set({ id, workspaceId: ws, uid: owner, name: 'k', hash: 'x', scopes: [] });

  before(async () => {
    process.env.DATABASE_URL = url;
    db = (await import('../server/db/firestore')).getDb() as unknown as Db;
    for (const id of [owner, book, viewer, stranger, platformAdmin]) {
      await db.pool.query('insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())', [id, `${id.slice(0, 8)}@example.com`]);
    }
    await db.collection('workspaces').doc(ws).set({ uid: owner, name: 'Keys', currency: 'USD', timezone: 'UTC', members: [owner, book, viewer], roles: { [book]: 'bookkeeper', [viewer]: 'viewer' }, bypassBilling: true });
    const express = (await import('express')).default;
    const { registerApiKeysRoutes } = await import('../server/routes/apiKeysRoutes');
    const app = express();
    app.use(express.json());
    registerApiKeysRoutes(app, {} as never);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(async () => {
    server?.close();
    try {
      for (const t of ['apiKeys', 'auditLogs']) await db?.pool.query(`delete from public."${t}" where workspace_id = $1`, [ws]);
      await db?.pool.query(`delete from public."workspaces" where id = $1`, [ws]);
      await db?.pool.query('delete from auth.users where id = any($1::uuid[])', [[owner, book, viewer, stranger, platformAdmin]]);
    } finally {
      await db?.terminate();
    }
  });

  it('only an owner makes a key', async () => {
    for (const uid of [stranger, viewer, book]) assert.equal(await call(uid, 'POST', '/api/v1/keys/provision', { workspaceId: ws, name: 'k' }), 403, `${uid} refused`);
    assert.equal(await call(owner, 'POST', '/api/v1/keys/provision', { workspaceId: ws, name: 'k' }), 201);
  });

  it('only an owner revokes a workspace key', async () => {
    const key = `lf_id_${ws}_test`;
    await seedKey(key);
    for (const uid of [stranger, viewer, book]) assert.equal(await call(uid, 'DELETE', `/api/v1/keys/revoke/${key}`), 403, `${uid} refused`);
    assert.equal((await db.collection('apiKeys').doc(key).get()).exists, true, 'the key is still there');
    assert.equal(await call(owner, 'DELETE', `/api/v1/keys/revoke/${key}`), 200);
    assert.equal((await db.collection('apiKeys').doc(key).get()).exists, false);
  });

  it('a platform admin who is not in the workspace can revoke its key', async () => {
    const key = `lf_id_${ws}_admin`;
    await seedKey(key);
    assert.equal(await call(platformAdmin, 'DELETE', `/api/v1/keys/revoke/${key}`), 200);
    assert.equal((await db.collection('apiKeys').doc(key).get()).exists, false);
  });
});
