/** #656: the demo-seed route is gone: a writer's POST /workspaces/:id/seed is a 404 and writes nothing into the books. */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

describe('Against the database', { skip: !process.env.LF_TEST_DATABASE_URL && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_seed_${crypto.randomBytes(4).toString('hex')}`;
  let server: Server;
  let base = '';
  let db: import('../server/db/pgFirestore').Firestore;

  before(async () => {
    process.env.DATABASE_URL = process.env.LF_TEST_DATABASE_URL;
    const express = (await import('express')).default;
    const { workspaceRouter } = await import('../server/routes/workspaceRoutes');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({ uid: 'owner-1', name: 'Seed', members: ['owner-1'], roles: {}, lockDate: '2026-09-30' });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string } }).user = { uid: String(req.header('x-test-uid')) }; next(); });
    app.use('/api/v1/workspaces', workspaceRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    for (const table of ['workspaces']) await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]);
    await db.terminate();
  });

  test('the owner sending the old request gets 404, and no entry, invoice or bill appears', async () => {
    const res = await fetch(`${base}/api/v1/workspaces/${ws}/seed`, { method: 'POST', headers: { 'x-test-uid': 'owner-1', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(res.status, 404);
    for (const table of ['transactions', 'invoices', 'bills']) {
      const { rows } = await db.pool.query(`select count(*)::int as n from public."${table}" where workspace_id = $1`, [ws]);
      assert.equal(rows[0].n, 0, `${table} untouched`);
    }
  });
});
