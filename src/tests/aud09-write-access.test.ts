/**
 * AUD-09: every write route under /api/v1/workspaces refuses someone who is not a member of the workspace, and
 * refuses a viewer. The routes are found by recording each router's registrations, so a new write route is
 * covered without editing this file. A refusal is any 4xx; a 2xx is a hole, and a 5xx means the route did work
 * before checking who is asking.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createRequire } from 'node:module';

const hasDb = !!process.env.LF_TEST_DATABASE_URL;
type Rec = { router: object; kind: 'verb' | 'use'; method?: string; path: string; child?: object };
const recs: Rec[] = [];
const WRITE = ['post', 'put', 'patch', 'delete'];
/**
 * Writes a viewer may make by design (each service checks the rest): watch a record, answer a client question,
 * log and move their own time, and change or remove a task given to them. These are left out of the viewer check;
 * that they work with a valid body, and nothing more, is AUD-09 step 2 (valid-body cases).
 */
const VIEWER_MAY = new Set([
  'post /:workspaceId/tasks/watching', 'delete /:workspaceId/tasks/watching/:watchId',
  'patch /:workspaceId/tasks/:taskId', 'delete /:workspaceId/tasks/:taskId',
  'post /:workspaceId/queries/:queryId/reply',
  'post /:workspaceId/time/', 'patch /:workspaceId/time/:entryId', 'delete /:workspaceId/time/:entryId', 'post /:workspaceId/time/move',
]);

/** Wraps express.Router so every router created afterwards records its routes and mounts. */
function recordRouters() {
  const require = createRequire(import.meta.url);
  const express = require('express');
  let proto = Object.getPrototypeOf(express.Router());
  while (proto && !Object.prototype.hasOwnProperty.call(proto, 'post')) proto = Object.getPrototypeOf(proto);
  for (const m of WRITE) {
    const orig = proto[m];
    proto[m] = function (this: object, path: unknown, ...rest: unknown[]) {
      if (typeof path === 'string') recs.push({ router: this, kind: 'verb', method: m, path });
      return orig.call(this, path, ...rest);
    };
  }
  const origUse = proto.use;
  proto.use = function (this: object, path: unknown, ...rest: unknown[]) {
    if (typeof path === 'string') for (const h of rest) if (typeof h === 'function' && Array.isArray((h as { stack?: unknown }).stack)) recs.push({ router: this, kind: 'use', path, child: h });
    return origUse.call(this, path, ...rest);
  };
}

function writeRoutes(root: object): { method: string; path: string }[] {
  const out: { method: string; path: string }[] = [];
  const walk = (router: object, prefix: string, depth: number) => {
    if (depth > 6) return;
    for (const r of recs.filter(x => x.router === router)) {
      if (r.kind === 'verb') out.push({ method: r.method!, path: prefix + r.path });
      else walk(r.child!, prefix + r.path, depth + 1);
    }
  };
  walk(root, '', 0);
  return out;
}

describe('AUD-09: write routes refuse non-members and viewers', { skip: !hasDb && 'needs LF_TEST_DATABASE_URL' }, () => {
  const ws = `aud09_${crypto.randomBytes(4).toString('hex')}`;
  let server: Server | undefined;
  let base = '';
  let routes: { method: string; path: string }[] = [];
  let db: { pool: { query: (q: string, p: unknown[]) => Promise<unknown> }; terminate: () => Promise<void>; collection: (n: string) => { doc: (id: string) => { set: (d: object) => Promise<unknown> } } };

  before(async () => {
    process.env.DATABASE_URL = process.env.LF_TEST_DATABASE_URL;
    recordRouters();
    const express = (await import('express')).default;
    const { workspaceRouter } = await import('../server/routes/workspaceRoutes');
    db = (await import('../server/db/firestore')).getDb() as unknown as typeof db;
    await db.collection('workspaces').doc(ws).set({ uid: 'owner-1', name: 'AUD-09', currency: 'USD', timezone: 'UTC', members: ['owner-1', 'view-1'], roles: { 'view-1': 'viewer' } });
    routes = writeRoutes(workspaceRouter).filter(r => r.path.includes(':workspaceId'));
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
      await db?.pool.query(`delete from public."workspaces" where id = $1`, [ws]);
    } finally {
      await db?.terminate();
    }
  });

  const call = async (r: { method: string; path: string }, uid: string) => {
    const url = base + '/api/v1/workspaces' + r.path.replace(':workspaceId', ws).replace(/:[A-Za-z]+/g, 'x1');
    const res = await fetch(url, { method: r.method.toUpperCase(), headers: { 'content-type': 'application/json', 'x-test-uid': uid, 'idempotency-key': crypto.randomUUID() }, body: r.method === 'delete' ? undefined : '{}' });
    return res.status;
  };

  it('finds the write routes', () => {
    // a floor that only goes up: raise it when routes are added, lower it only when one is removed on purpose
    assert.ok(routes.length >= 89, `only ${routes.length} of at least 89 write routes found`);
  });

  for (const who of ['stranger-1', 'view-1']) {
    it(who === 'view-1' ? 'every write route a viewer may not use refuses a viewer' : 'every write route refuses a non-member', async () => {
      const holes: string[] = [];
      for (const r of routes) {
        if (who === 'view-1' && VIEWER_MAY.has(`${r.method} ${r.path}`)) continue;
        const status = await call(r, who);
        // a non-member is stopped by the membership check itself (403); a viewer may be refused by validation first
        const refused = who === 'stranger-1' ? status === 403 : status >= 400 && status < 500;
        if (!refused) holes.push(`${r.method.toUpperCase()} ${r.path} → ${status}`);
      }
      assert.deepEqual(holes, []);
    });
  }
});
