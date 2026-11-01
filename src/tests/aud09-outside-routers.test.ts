/**
 * AUD-09 step 2: the write routes mounted outside /api/v1/workspaces (they take the workspace from the body or
 * the query) refuse someone outside the workspace, and the two that posted a journal for a viewer now refuse one.
 * A refusal is a 4xx; a 2xx is a hole and a 5xx means work was done before the check. Routes listed in
 * VALIDATES_FIRST read the body before they check membership (each service checks it afterwards), so an empty
 * body gets 400 there instead of 403. The account routes are per user, not per workspace, and are left out.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { recordRouters, writeRoutes } from './helpers/routeRecorder';

const hasDb = !!process.env.LF_TEST_DATABASE_URL;
const VALIDATES_FIRST = new Set([
  'post /api/v1/revenue/recognize', 'post /api/v1/lease/capitalize', 'post /api/v1/payments/', 'post /api/v1/payments/:paymentId/apply',
  'post /api/v1/documents/zip', 'post /api/v1/documents/:type/:id/pdf', 'post /api/v1/open-items/preview', 'post /api/v1/open-items/confirm',
  'post /api/v1/reports/explain', 'post /api/v1/billing/verify-session', 'post /api/v1/billing/record-compute',
]);
/** Answers "not built yet" to everyone before any check; nothing is written. */
const NOT_BUILT = new Set(['post /api/v1/consolidation/eliminate']);

type Db = { pool: { query: (q: string, p: unknown[]) => Promise<unknown> }; terminate: () => Promise<void>; collection: (n: string) => { doc: (id: string) => { set: (d: object) => Promise<unknown> } } };

describe('AUD-09 step 2: write routes outside /workspaces', { skip: !hasDb && 'needs LF_TEST_DATABASE_URL' }, () => {
  const ws = `aud09o_${crypto.randomBytes(4).toString('hex')}`;
  let server: Server | undefined;
  let base = '';
  let db: Db;
  const routes: { method: string; path: string }[] = [];

  before(async () => {
    process.env.DATABASE_URL = process.env.LF_TEST_DATABASE_URL;
    recordRouters();
    const express = (await import('express')).default;
    const mounts: [string, object][] = [
      ['/api/v1/transactions', (await import('../server/routes/transactionRoutes')).transactionRouter],
      ['/api/v1/revenue', (await import('../server/routes/revenueRoutes')).revenueRouter],
      ['/api/v1/consolidation', (await import('../server/routes/consolidationRoutes')).consolidationRouter],
      ['/api/v1/lease', (await import('../server/routes/leaseRoutes')).leaseRouter],
      ['/api/v1/inventory', (await import('../server/routes/inventoryRoutes')).inventoryRouter],
      ['/api/v1/repost', (await import('../server/routes/repostRoutes')).repostRouter],
      ['/api/v1/fx', (await import('../server/routes/fxRoutes')).fxRouter],
      ['/api/v1/payments', (await import('../server/routes/paymentRoutes')).paymentRouter],
      ['/api/v1/documents', (await import('../server/routes/documentRoutes')).documentRouter],
      ['/api/v1/open-items', (await import('../server/routes/openItemImportRoutes')).openItemImportRouter],
      ['/api/v1/reports', (await import('../server/routes/reportRoutes')).reportRouter],
      ['/api/v1/billing', (await import('../server/routes/billingRoutes')).billingRouter],
    ];
    db = (await import('../server/db/firestore')).getDb() as unknown as Db;
    await db.collection('workspaces').doc(ws).set({ uid: 'owner-1', name: 'AUD-09b', currency: 'USD', timezone: 'UTC', members: ['owner-1', 'view-1', 'acct-1', 'book-1'], roles: { 'view-1': 'viewer', 'acct-1': 'accountant', 'book-1': 'bookkeeper' } });
    for (const [id, type] of [['a1', 'liability'], ['a2', 'revenue']]) {
      await db.collection('chartAccounts').doc(`${ws}_${id}`).set({ id: `${ws}_${id}`, workspaceId: ws, name: id, code: id, type, currency: 'USD', isActive: true });
    }
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const uid = String(req.header('x-test-uid'));
      (req as unknown as { user: { uid: string; admin: boolean } }).user = { uid, admin: uid === 'platform-admin-1' };
      next();
    });
    for (const [mount, router] of mounts) {
      app.use(mount, router as never);
      for (const r of writeRoutes(router)) routes.push({ method: r.method, path: mount + r.path });
    }
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(async () => {
    server?.close();
    try {
      for (const t of ['transactions', 'chartAccounts', 'auditLogs', 'idempotencyKeys']) await db?.pool.query(`delete from public."${t}" where workspace_id = $1`, [ws]);
      await db?.pool.query(`delete from public."workspaces" where id = $1`, [ws]);
    } finally {
      await db?.terminate();
    }
  });

  const send = async (method: string, path: string, uid: string, body: object = { workspaceId: ws }) => {
    const url = base + path.replace(/:[A-Za-z]+/g, 'x1') + `?workspaceId=${ws}`;
    const res = await fetch(url, { method: method.toUpperCase(), headers: { 'content-type': 'application/json', 'x-test-uid': uid, 'idempotency-key': crypto.randomUUID() }, body: method === 'delete' ? undefined : JSON.stringify(body) });
    return res.status;
  };

  it('finds the write routes', () => {
    // a floor that only goes up: raise it when routes are added, lower it only when one is removed on purpose
    assert.ok(routes.length >= 45, `only ${routes.length} of at least 45 write routes found`);
  });

  for (const who of ['stranger-1', 'view-1']) {
    it(`every write route refuses ${who === 'view-1' ? 'a viewer' : 'a non-member'} (empty body)`, async () => {
      const holes: string[] = [];
      for (const r of routes) {
        const key = `${r.method} ${r.path}`;
        const status = await send(r.method, r.path, who);
        if (NOT_BUILT.has(key) && status === 501) continue;
        const refused = who === 'stranger-1' && !VALIDATES_FIRST.has(key) ? status === 403 : status >= 400 && status < 500;
        if (!refused) holes.push(`${key} → ${status}`);
      }
      assert.deepEqual(holes, []);
    });
  }

  it('a viewer with a valid body cannot post revenue or a lease; owner, accountant and bookkeeper can', async () => {
    const revenue = { workspaceId: ws, amountCents: 100, deferredAccountId: `${ws}_a1`, revenueAccountId: `${ws}_a2`, date: '2026-10-01' };
    const lease = { workspaceId: ws, pvAmountCents: 100, rouAssetAccountId: `${ws}_a1`, leaseLiabilityAccountId: `${ws}_a2`, date: '2026-10-01' };
    assert.equal(await send('post', '/api/v1/revenue/recognize', 'view-1', revenue), 403);
    assert.equal(await send('post', '/api/v1/lease/capitalize', 'view-1', lease), 403);
    assert.equal(await send('post', '/api/v1/revenue/recognize', 'stranger-1', revenue), 403);
    assert.equal(await send('post', '/api/v1/lease/capitalize', 'stranger-1', lease), 403);
    for (const uid of ['owner-1', 'acct-1', 'book-1', 'platform-admin-1']) {
      assert.equal(await send('post', '/api/v1/revenue/recognize', uid, revenue), 200, `${uid} posts revenue`);
      assert.equal(await send('post', '/api/v1/lease/capitalize', uid, lease), 200, `${uid} capitalizes a lease`);
    }
  });
});
