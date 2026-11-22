/**
 * Per-role dashboards on the server (BC-02): only owners give a role its starting layout; a bad
 * role or layout is refused; null takes it away; audited. Runs with LF_TEST_DATABASE_URL.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { DASHBOARD_WIDGETS } from '../lib/dashboardOverview';

describe('Per-role dashboards (database)', { skip: !process.env.LF_TEST_DATABASE_URL && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_roledash_${crypto.randomBytes(4).toString('hex')}`;
  let server: Server;
  let base = '';
  let db: import('../server/db/pgFirestore').Firestore;
  const put = async (uid: string, body: unknown) => {
    const res = await fetch(`${base}/api/v1/workspaces/${ws}/role-dashboards`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-test-uid': uid }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };
  before(async () => {
    process.env.DATABASE_URL = process.env.LF_TEST_DATABASE_URL;
    const express = (await import('express')).default;
    const { workspaceRouter } = await import('../server/routes/workspaceRoutes');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({ uid: 'owner-1', name: 'Dash', members: ['owner-1', 'acct-1'], roles: { 'acct-1': 'accountant' } });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string } }).user = { uid: String(req.header('x-test-uid')) }; next(); });
    app.use('/api/v1/workspaces', workspaceRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(async () => {
    server?.close();
    for (const table of ['auditLogs', 'workspaces']) await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]);
    await db.terminate();
  });

  test('owners only; checked; null takes it away; audited', async () => {
    const layout = { order: ['cash', 'recent'], hidden: ['scenario'] };
    assert.equal((await put('acct-1', { role: 'bookkeeper', layout })).status, 403);
    assert.equal((await put('owner-1', { role: 'boss', layout })).status, 400);
    assert.equal((await put('owner-1', { role: 'bookkeeper', layout: { order: ['nope'], hidden: [] } })).status, 400);
    const saved = await put('owner-1', { role: 'bookkeeper', layout });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal((await put('owner-1', { role: 'viewer', layout })).status, 200);
    const stored = (await db.collection('workspaces').doc(ws).get()).data()?.roleDashboards as Record<string, { order: string[]; hidden: string[] }>;
    assert.deepEqual(Object.keys(stored).sort(), ['bookkeeper', 'viewer']);
    assert.deepEqual(stored.bookkeeper.order.slice(0, 2), ['cash', 'recent']);
    assert.equal(stored.bookkeeper.order.length, DASHBOARD_WIDGETS.length, 'every widget is in the order');
    assert.equal((await put('owner-1', { role: 'viewer', layout: null })).status, 200);
    assert.deepEqual(Object.keys((await db.collection('workspaces').doc(ws).get()).data()?.roleDashboards as object), ['bookkeeper']);
    const audit = await db.pool.query(`select count(*)::int as n from public."auditLogs" where workspace_id = $1 and data->>'action' = 'ROLE_DASHBOARD_SET'`, [ws]);
    assert.equal(audit.rows[0].n, 3);
  });
});
