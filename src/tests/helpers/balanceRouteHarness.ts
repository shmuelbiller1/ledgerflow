/**
 * L-123: the balances API (src/server/routes/balanceRoutes.ts) against the test database, for the route tests of
 * the server-side reports. `x-test-uid` stands in for the signed-in user; the workspace has one member, OWNER.
 */
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Firestore } from '../../server/db/pgFirestore';

export const OWNER = 'owner-1';

export function balanceRouteHarness(wsPrefix: string, name: string) {
  const ws = `${wsPrefix}_${crypto.randomBytes(4).toString('hex')}`;
  const realFetch = globalThis.fetch;
  let db: Firestore;
  let server: Server | undefined;
  let base = '';
  let tables: string[] = [];

  return {
    ws,
    async get<T>(path: string, q: Record<string, string>, uid = OWNER): Promise<{ status: number; body: T }> {
      const res = await realFetch(`${base}/api/v1/balances/${path}?${new URLSearchParams(q)}`, { headers: { 'x-test-uid': uid } });
      return { status: res.status, body: await res.json() as T };
    },
    /** Starts the API and writes the workspace and each table's rows (whole documents, by id). */
    async start(rows: Record<string, unknown[]>) {
      process.env.DATABASE_URL = process.env.LF_TEST_DATABASE_URL;
      const express = (await import('express')).default;
      db = (await import('../../server/db/firestore')).getDb();
      const app = express();
      app.use((req, _res, next) => { (req as unknown as { user: { uid: string } }).user = { uid: String(req.header('x-test-uid')) }; next(); });
      app.use('/api/v1/balances', (await import('../../server/routes/balanceRoutes')).balanceRouter);
      server = app.listen(0);
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      await db.collection('workspaces').doc(ws).set({ uid: OWNER, name, currency: 'USD', timezone: 'UTC', members: [OWNER] });
      tables = [...Object.keys(rows), 'workspaces'];
      for (const [table, list] of Object.entries(rows)) {
        await db.pool.query(`insert into public."${table}" (id, data) select r->>'id', r from jsonb_array_elements($1::jsonb) r`, [JSON.stringify(list)]);
      }
    },
    async stop() {
      server?.close();
      for (const table of tables) {
        await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]).catch(() => {});
      }
      const { getSupabase } = await import('../../lib/db/client');
      getSupabase().realtime.disconnect();
      await getSupabase().auth.dispose();
      await db.terminate();
    },
  };
}
