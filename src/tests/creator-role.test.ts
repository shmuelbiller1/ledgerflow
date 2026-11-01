/**
 * The person who created a workspace always counts as its owner (workspaceRole), so the role screen must not store
 * another role for them: a co-owner trying to make the creator a viewer is refused, and nothing is written.
 * Another co-owner can still be changed. (CodeRabbit on #463.)
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const hasDb = !!process.env.LF_TEST_DATABASE_URL;
type Db = { pool: { query: (q: string, p: unknown[]) => Promise<unknown> }; terminate: () => Promise<void>; collection: (n: string) => { doc: (id: string) => { set: (d: object) => Promise<unknown>; get: () => Promise<{ data: () => Record<string, unknown> | undefined }> } } };

describe('the workspace creator keeps the owner role', { skip: !hasDb && 'needs LF_TEST_DATABASE_URL' }, () => {
  const ws = `creator_${crypto.randomBytes(4).toString('hex')}`;
  let server: Server | undefined;
  let base = '';
  let db: Db;

  before(async () => {
    process.env.DATABASE_URL = process.env.LF_TEST_DATABASE_URL;
    const express = (await import('express')).default;
    const { workspaceRouter } = await import('../server/routes/workspaceRoutes');
    db = (await import('../server/db/firestore')).getDb() as unknown as Db;
    await db.collection('workspaces').doc(ws).set({ uid: 'creator-1', name: 'Creator', currency: 'USD', timezone: 'UTC', members: ['creator-1', 'co-1', 'co-2'], roles: { 'co-1': 'owner', 'co-2': 'owner' } });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string } }).user = { uid: String(req.header('x-test-uid')) }; next(); });
    app.use('/api/v1/workspaces', workspaceRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(async () => {
    server?.close();
    try {
      await db?.pool.query(`delete from public."auditLogs" where workspace_id = $1`, [ws]);
      await db?.pool.query(`delete from public."workspaces" where id = $1`, [ws]);
    } finally {
      await db?.terminate();
    }
  });

  const setRole = (target: string, role: string) => fetch(`${base}/api/v1/workspaces/${ws}/roles/${target}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', 'x-test-uid': 'co-1' }, body: JSON.stringify({ role }),
  });

  it('a co-owner cannot make the creator a viewer, and no role is stored for them', async () => {
    const res = await setRole('creator-1', 'viewer');
    assert.equal(res.status, 400);
    const roles = ((await db.collection('workspaces').doc(ws).get()).data()?.roles || {}) as Record<string, string>;
    assert.equal(roles['creator-1'], undefined);
  });

  it('another co-owner can still be changed', async () => {
    const res = await setRole('co-2', 'accountant');
    assert.equal(res.status, 200);
    const roles = ((await db.collection('workspaces').doc(ws).get()).data()?.roles || {}) as Record<string, string>;
    assert.equal(roles['co-2'], 'accountant');
  });
});
