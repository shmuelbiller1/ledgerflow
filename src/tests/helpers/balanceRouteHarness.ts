/**
 * L-123: the balances API (src/server/routes/balanceRoutes.ts) against the test database, for the route tests of
 * the server-side reports. `x-test-uid` stands in for the signed-in user; the workspace has one member, OWNER.
 */
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { PoolClient } from 'pg';
import type { Firestore } from '../../server/db/pgFirestore';
import { startBooksReadApi, startSandboxReadApi } from './sandboxReadApi';

export const OWNER = 'owner-1';

export async function withCorruptFixtureAllowed<T>(pool: Firestore['pool'], fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('lf.allow_corrupt_fixture', 'on', true)`);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export function balanceRouteHarness(wsPrefix: string, name: string) {
  const ws = `${wsPrefix}_${crypto.randomBytes(4).toString('hex')}`;
  const realFetch = globalThis.fetch;
  let db: Firestore;
  let liveApi: Awaited<ReturnType<typeof startBooksReadApi>>;
  let sandboxApi: Awaited<ReturnType<typeof startSandboxReadApi>>;
  let tables: string[] = [];

  return {
    ws,
    async get<T>(path: string, q: Record<string, string>, uid = OWNER): Promise<{ status: number; body: T; headers: Headers }> {
      const url = `/api/v1/balances/${path}?${new URLSearchParams(q)}`;
      const init = { headers: { 'x-test-uid': uid } };
      const res = await realFetch(`${liveApi.base}${url}`, init);
      const body = await res.json() as T;
      if (uid === OWNER && q.workspaceId === ws) {
        const draft = await realFetch(`${sandboxApi.base}${url}`, init);
        assert.equal(draft.status, res.status, path);
        // closed-through is a snapshot-based browser loading hint, not a balance figure.
        const expected = path === 'closed-through' && res.ok ? { ...body, closedThrough: null } : body;
        assert.deepEqual(await draft.json(), expected, `empty-overlay parity: ${path}`);
      }
      return { status: res.status, body, headers: res.headers };
    },
    /** The test database, once started. */
    db: () => db,
    /** Starts the API and writes the workspace (with `workspace`'s extra fields) and each table's rows (whole documents, by id). */
    async start(rows: Record<string, unknown[]>, workspace: Record<string, unknown> = {}) {
      process.env.DATABASE_URL = process.env.LF_TEST_DATABASE_URL;
      db = (await import('../../server/db/firestore')).getDb();
      liveApi = await startBooksReadApi(db);
      await db.collection('workspaces').doc(ws).set({ uid: OWNER, name, currency: 'USD', timezone: 'UTC', members: [OWNER], ...workspace });
      tables = [...Object.keys(rows), 'workspaces'];
      await withCorruptFixtureAllowed(db.pool, async client => {
        for (const [table, list] of Object.entries(rows)) {
          await client.query(`insert into public."${table}" (id, data) select r->>'id', r from jsonb_array_elements($1::jsonb) r`, [JSON.stringify(list)]);
        }
      });
      sandboxApi = await startSandboxReadApi(db, ws, OWNER);
    },
    async stop() {
      await sandboxApi?.stop();
      await liveApi?.stop();
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
