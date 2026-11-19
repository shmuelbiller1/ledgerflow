import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import type { Firestore } from '../server/db/firestore';
import type { RequestUser } from '../server/auth/requestUser';

const url = process.env.LF_TEST_DATABASE_URL;
describe('Consolidation verification (database)', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const primary = `ws_consol_${crypto.randomBytes(4).toString('hex')}`;
  const allowed = `${primary}_allowed`;
  const denied = `${primary}_denied`;
  let db: Firestore;
  let server: Server;
  let base: string;

  before(async () => {
    process.env.DATABASE_URL = url;
    const express = (await import('express')).default;
    const { getDb } = await import('../server/db/firestore');
    const { consolidationRouter } = await import('../server/routes/consolidationRoutes');
    db = getDb();
    await db.collection('workspaces').doc(primary).set({ uid: 'owner', name: 'Primary', currency: 'USD', members: ['owner', 'viewer'], roles: { viewer: 'viewer' } });
    await db.collection('workspaces').doc(allowed).set({ uid: 'other', name: 'Allowed', currency: 'USD', members: ['other', 'owner'], roles: { owner: 'bookkeeper' } });
    await db.collection('workspaces').doc(denied).set({ uid: 'other', name: 'Denied', currency: 'USD', members: ['other', 'owner'], roles: { owner: 'viewer' } });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const who = req.header('x-test-user');
      const user: RequestUser = who === 'admin' ? { uid: 'admin', admin: true }
        : who === 'key' ? { uid: 'owner', developerWorkspaceId: primary } : { uid: who || 'owner' };
      Object.assign(req, { user });
      next();
    });
    app.use('/api/v1/consolidation', consolidationRouter);
    app.use('/api/v1/commands', (await import('../server/routes/commandRoutes')).commandRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    for (const table of ['auditLogs', 'idempotencyKeys', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = any($1) or id = any($1)`, [[primary, allowed, denied]]);
    }
    await db.terminate();
  });

  const check = async (entities: string[], user = 'owner') => {
    const res = await fetch(`${base}/api/v1/consolidation/eliminate`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-test-user': user, 'idempotency-key': 'legacy-ignored' },
      body: JSON.stringify({ workspaceId: primary, entityWorkspaceIds: entities, asOfDate: '2026-10-31' }),
    });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };

  test('viewer, secondary-workspace role, scoped key and bad input stay refused', async () => {
    const roleError = { status: 403, body: { error: 'Only owners, accountants and bookkeepers can run intercompany eliminations' } };
    assert.deepEqual(await check([allowed], 'viewer'), roleError);
    assert.deepEqual(await check([denied]), roleError);
    assert.deepEqual(await check([allowed], 'key'), { status: 403, body: { error: `Forbidden: API key is scoped strictly to workspace ${primary}` } });
    const bad = await check([]);
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'Invalid elimination request');
    assert.deepEqual((await db.collection('auditLogs').where('workspaceId', '==', primary).get()).docs, []);
  });

  test('successful checks return the same figures on a repeat and audit each verification, including admin access', async () => {
    const first = await check([allowed, primary, allowed]);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.status, 'ok');
    assert.deepEqual(first, await check([allowed]));
    const report = first.body.report as { matchedCount: number; discrepancyCount: number; totalEliminatedCents: number };
    assert.deepEqual([report.matchedCount, report.discrepancyCount, report.totalEliminatedCents], [0, 0, 0]);
    assert.ok(first.body.closeStatus);
    assert.equal((await check([denied], 'admin')).status, 200);
    const audits = (await db.collection('auditLogs').where('workspaceId', '==', primary).where('action', '==', 'CONSOLIDATION_ELIMINATIONS_VERIFIED').get()).docs;
    assert.equal(audits.length, 3);
    const row = audits.find(d => d.data().uid === 'owner')?.data();
    assert.equal(row?.entityId, primary);
    assert.deepEqual(row?.details, {
      description: 'Verified intercompany eliminations across 2 entities as of 2026-10-31',
      entityWorkspaceIds: [primary, allowed], asOfDate: '2026-10-31', selfProving: true,
      matchedCount: 0, discrepancyCount: 0, totalEliminatedCents: 0,
    });
  });

  test('a cached command answer cannot be read after losing a role in a secondary workspace', async () => {
    const envelope = { workspaceId: primary, input: { entityWorkspaceIds: [allowed], asOfDate: '2026-10-31' } };
    const invoke = () => fetch(`${base}/api/v1/commands/consolidation.verify`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'secondary-scope' }, body: JSON.stringify(envelope),
    });
    const first = await invoke();
    assert.equal(first.status, 200, await first.text());
    const retry = await invoke();
    assert.equal((await retry.json()).replayed, true);
    await db.collection('workspaces').doc(allowed).update({ roles: { owner: 'viewer' } });
    const denied = await invoke();
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).code, 'ROLE_REQUIRED');
  });
});
