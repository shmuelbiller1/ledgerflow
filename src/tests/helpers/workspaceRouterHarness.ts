/**
 * A test server for /api/v1/workspaces against the test database. `x-test-uid` stands in for the signed-in user.
 * start() writes the workspace document; stop() removes it and its audit lines and closes the database.
 */
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

type Db = {
  pool: { query: (q: string, p: unknown[]) => Promise<unknown> };
  terminate: () => Promise<void>;
  collection: (n: string) => { doc: (id: string) => { set: (d: object) => Promise<unknown>; get: () => Promise<{ data: () => Record<string, unknown> | undefined }> } };
};

export function workspaceRouterHarness(prefix: string) {
  const ws = `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
  let server: Server | undefined;
  let base = '';
  let db: Db | undefined;
  return {
    ws,
    get db() { return db!; },
    async start(workspace: Record<string, unknown>) {
      process.env.DATABASE_URL = process.env.LF_TEST_DATABASE_URL;
      const express = (await import('express')).default;
      const { workspaceRouter } = await import('../../server/routes/workspaceRoutes');
      db = (await import('../../server/db/firestore')).getDb() as unknown as Db;
      await db.collection('workspaces').doc(ws).set(workspace);
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => { (req as unknown as { user: { uid: string } }).user = { uid: String(req.header('x-test-uid')) }; next(); });
      app.use('/api/v1/workspaces', workspaceRouter);
      server = app.listen(0);
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    },
    request(uid: string, method: string, path: string, body?: unknown) {
      return fetch(`${base}/api/v1/workspaces/${ws}${path}`, { method, headers: { 'content-type': 'application/json', 'x-test-uid': uid }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    },
    async workspace() { return (await db!.collection('workspaces').doc(ws).get()).data() || {}; },
    async stop() {
      server?.close();
      try {
        await db?.pool.query(`delete from public."auditLogs" where workspace_id = $1`, [ws]);
        await db?.pool.query(`delete from public."workspaces" where id = $1`, [ws]);
      } finally {
        await db?.terminate();
      }
    },
  };
}
