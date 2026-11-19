/**
 * P0 regression: privileged workspace/account create endpoints may not replace existing
 * tenant records, even when a client supplies an ID. The database-backed cases execute
 * real Express routes and verify protected records remain unchanged.
 */
import { before, after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { SignJWT } from 'jose';

test('tenant creation routes are create-only and ignore caller workspace identities', () => {
  const workspace = fs.readFileSync('src/server/routes/workspaceApiRoutes.ts', 'utf8');
  const ledger = fs.readFileSync('src/server/routes/developerApiRoutes.ts', 'utf8');
  const creation = workspace.slice(workspace.indexOf('app.post("/api/v1/workspaces"'), workspace.indexOf('// --- Workspace Member Management Endpoints ---'));
  const account = ledger.slice(ledger.indexOf('app.post("/api/v1/ledger"'), ledger.indexOf('app.get("/api/v1/ledger/diagnostics"'));
  assert.match(creation, /id: undefined,/);
  assert.match(creation, /developerWorkspaceId/);
  assert.match(creation, /definition: workspaceApiCreateCommand/);
  const command = fs.readFileSync('src/server/commands/workspaceApi.ts', 'utf8');
  assert.match(command, /tx\.create\(ref, workspace\)/);
  assert.match(command, /denyWorkspaceApiKey: true/);
  assert.doesNotMatch(creation, /doc\(newId\)\.set\(/);
  assert.match(account, /await executeCommand\(req, res, \{\s*definition: chartAccountRegisterCommand,/);
  assert.doesNotMatch(account, /doc\(newId\)\.set\(/);
  const chart = fs.readFileSync('src/server/commands/chartAccounts.ts', 'utf8');
  const register = chart.slice(chart.indexOf('export const chartAccountRegisterCommand'));
  assert.match(register, /tx\.create\(ref, account\)/);
  assert.match(register, /workspaceId: ctx\.workspaceId/);
  assert.doesNotMatch(register, /tx\.(?:set|update)\(ref\b/);
});

const databaseUrl = process.env.LF_TEST_DATABASE_URL;
type Db = {
  pool: { query: (sql: string, params?: unknown[]) => Promise<unknown> };
  terminate: () => Promise<void>;
  collection: (table: string) => {
    doc: (id: string) => {
      get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> }>;
      set: (value: object) => Promise<unknown>;
    };
  };
};

describe('P0 tenant creation boundaries against live PostgreSQL', { skip: !databaseUrl && 'requires LF_TEST_DATABASE_URL' }, () => {
  const prefix = crypto.randomBytes(5).toString('hex');
  const owner = crypto.randomUUID();
  const anotherOwner = crypto.randomUUID();
  const victimWorkspaceId = `ws_create_victim_${prefix}`;
  const ownWorkspaceId = `ws_create_owner_${prefix}`;
  const victimAccountId = `acc_create_victim_${prefix}`;
  const systemAccountId = `acc_create_system_${prefix}`;
  const newAccountId = `acc_create_new_${prefix}`;
  let freshWorkspaceId = '';
  let db: Db;
  let server: Server;
  let base: string;

  const token = (uid: string) => new SignJWT({
    role: 'authenticated', app_metadata: { provider: 'email' }, sub: uid,
    email: `${uid.slice(0, 8)}@example.com`, aal: 'aal2',
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer('https://example-project.supabase.co/auth/v1')
    .setAudience('authenticated')
    .setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET));

  const post = async (uid: string, path: string, body: object, key?: string) => {
    const response = await fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${await token(uid)}`, ...(key ? { 'idempotency-key': key } : {}) },
      body: JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() as Record<string, unknown> };
  };

  before(async () => {
    process.env.SUPABASE_URL = 'https://example-project.supabase.co';
    process.env.SUPABASE_JWT_SECRET = 'test-jwt-secret-with-at-least-32-characters-long';
    process.env.DATABASE_URL = databaseUrl;
    const { getDb } = await import('../server/db/firestore');
    db = getDb() as unknown as Db;
    for (const uid of [owner, anotherOwner]) {
      await db.pool.query('insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())', [uid, `${uid.slice(0, 8)}@example.com`]);
    }
    await db.collection('workspaces').doc(victimWorkspaceId).set({
      uid: anotherOwner, name: 'Protected Books', currency: 'USD',
      lockDate: '2026-10-31', requireTwoStep: true, bypassBilling: true,
    });
    await db.collection('workspaces').doc(ownWorkspaceId).set({
      uid: owner, name: 'Owner Books', currency: 'USD', bypassBilling: true,
    });
    await db.collection('chartAccounts').doc(victimAccountId).set({
      id: victimAccountId, workspaceId: victimWorkspaceId, uid: anotherOwner,
      name: 'Victim Account', type: 'asset', code: '1000', isSystem: false,
    });
    await db.collection('chartAccounts').doc(systemAccountId).set({
      id: systemAccountId, workspaceId: ownWorkspaceId, uid: owner,
      name: 'Owner System Account', type: 'asset', code: '1200', isSystem: true,
    });
    const express = (await import('express')).default;
    const { registerWorkspaceApiRoutes } = await import('../server/routes/workspaceApiRoutes');
    const { registerDeveloperApiRoutes } = await import('../server/routes/developerApiRoutes');
    const app = express();
    app.use(express.json());
    registerWorkspaceApiRoutes(app, {} as never);
    registerDeveloperApiRoutes(app, {} as never);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    if (!db) return;
    const workspaceIds = [ownWorkspaceId, victimWorkspaceId, freshWorkspaceId].filter(Boolean);
    try {
      await db.pool.query('delete from public."idempotencyKeys" where workspace_id = any($1::text[])', [[...workspaceIds, `person:${owner}`]]);
      await db.pool.query('delete from public."auditLogs" where workspace_id = any($1::text[])', [workspaceIds]);
      await db.pool.query('delete from public."chartAccounts" where workspace_id = any($1::text[])', [workspaceIds]);
      await db.pool.query('delete from public."workspaces" where id = any($1::text[])', [workspaceIds]);
      await db.pool.query('delete from auth.users where id = any($1::uuid[])', [[owner, anotherOwner]]);
    } finally {
      await db.terminate();
    }
  });

  test('a caller-supplied workspace ID cannot replace an existing tenant or set privileged state', async () => {
    const result = await post(owner, '/api/v1/workspaces', {
      id: victimWorkspaceId, uid: anotherOwner, name: 'New Books', currency: 'USD',
      isClosed: true, admins: { [owner]: true }, createdAt: '2020-01-01',
    });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    const created = result.data.workspace as Record<string, unknown>;
    assert.notEqual(created.id, victimWorkspaceId);
    assert.equal(created.uid, owner);
    assert.equal(created.isClosed, false);
    assert.equal(created.admins, undefined);
    assert.notEqual(created.createdAt, '2020-01-01');
    freshWorkspaceId = String(created.id);
    const protectedRow = (await db.collection('workspaces').doc(victimWorkspaceId).get()).data();
    assert.equal(protectedRow.uid, anotherOwner);
    assert.equal(protectedRow.lockDate, '2026-10-31');
    assert.equal(protectedRow.requireTwoStep, true);
  });

  test('an existing chart account cannot be replaced across tenants or within the same tenant', async () => {
    for (const id of [victimAccountId, systemAccountId]) {
      const result = await post(owner, '/api/v1/ledger', {
        workspaceId: ownWorkspaceId, id, name: 'Unexpected Replacement', type: 'asset',
      });
      assert.equal(result.status, 409, `ID ${id}: ${JSON.stringify(result.data)}`);
    }
    assert.equal((await db.collection('chartAccounts').doc(victimAccountId).get()).data().name, 'Victim Account');
    assert.equal((await db.collection('chartAccounts').doc(systemAccountId).get()).data().name, 'Owner System Account');

    const inserted = await post(owner, '/api/v1/ledger', {
      workspaceId: ownWorkspaceId, id: newAccountId, name: 'New Asset', type: 'asset',
    });
    assert.equal(inserted.status, 201, JSON.stringify(inserted.data));
    assert.equal((await db.collection('chartAccounts').doc(newAccountId).get()).data().workspaceId, ownWorkspaceId);
  });
  test('membership and restore routes keep their legacy answers and replay safely', async () => {
    const path = `/api/v1/workspaces/${ownWorkspaceId}`;
    const add = await post(owner, `${path}/members`, { memberUid: anotherOwner }, `add-${prefix}`);
    assert.equal(add.status, 200, JSON.stringify(add.data));
    assert.deepEqual(add.data, { status: 'success', message: `Member ${anotherOwner} added to workspace.`, workspaceId: ownWorkspaceId, members: [anotherOwner] });
    const addReplay = await post(owner, `${path}/members`, { memberUid: anotherOwner }, `add-${prefix}`);
    assert.deepEqual(addReplay, add);
    const del = async (uid: string, target: string, key: string) => {
      const response = await fetch(`${base}${path}/members/${target}`, { method: 'DELETE', headers: { authorization: `Bearer ${await token(uid)}`, 'idempotency-key': key } });
      return { status: response.status, data: await response.json() as Record<string, unknown> };
    };
    const lastOwner = await del(owner, owner, `last-${prefix}`);
    assert.equal(lastOwner.status, 400);
    assert.equal(lastOwner.data.message, 'Cannot demote or remove the last owner of the workspace.');
    const removed = await del(owner, anotherOwner, `remove-${prefix}`);
    assert.deepEqual(removed, { status: 200, data: { status: 'success', message: `Member ${anotherOwner} removed from workspace.`, workspaceId: ownWorkspaceId, members: [] } });
    assert.deepEqual(await del(owner, anotherOwner, `remove-${prefix}`), removed);
    const backup = { schemaVersion: 1, accounts: [{ id: `restored_${prefix}`, name: 'Restored', type: 'asset' }] };
    const restored = await post(owner, `${path}/restore`, backup, `restore-${prefix}`);
    assert.equal(restored.status, 200, JSON.stringify(restored.data));
    assert.equal(restored.data.success, true);
    assert.equal(restored.data.message, 'General ledger workspace successfully restored from backup.');
    assert.deepEqual(await post(owner, `${path}/restore`, backup, `restore-${prefix}`), restored);
    assert.equal((await db.collection('chartAccounts').doc(`restored_${prefix}`).get()).data().name, 'Restored');
    const refusal = await post(owner, `${path}/restore`, { workspace: { id: victimWorkspaceId } });
    assert.equal(refusal.status, 400);
    assert.equal(refusal.data.message, 'Backup workspace ID does not match target workspace ID');
  });

  test('adding the last seat replays before the capacity gate and a new request keeps the 402 body', async () => {
    await db.collection('workspaces').doc(ownWorkspaceId).set({ uid: owner, name: 'Owner Books', currency: 'USD', maxSeats: 1, members: [] });
    const path = `/api/v1/workspaces/${ownWorkspaceId}/members`;
    const first = await post(owner, path, { memberUid: anotherOwner }, `last-seat-${prefix}`);
    assert.equal(first.status, 200, JSON.stringify(first.data));
    assert.deepEqual(await post(owner, path, { memberUid: anotherOwner }, `last-seat-${prefix}`), first);
    const full = await post(owner, path, { memberUid: 'someone-else' }, `over-cap-${prefix}`);
    assert.equal(full.status, 402);
    assert.deepEqual(full.data, { status: 'error', message: 'Payment Required: Plan user seat limit reached (1/1). Upgrade workspace plan to invite more team members.', code: 'SEAT_CAPACITY_EXCEEDED', cap: 1, current: 1 });
  });

});
