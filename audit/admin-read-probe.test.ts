/** Actual local Express/DB read routes, with synthetic signed admin and ordinary-user tokens. */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { callApi, closeServer, listenOnRandomPort, restoreEnv, signTestJwt, useLiveApiEnv } from '../src/tests/helpers/liveApiServer';

const enabled = Boolean(process.env.LF_TEST_DATABASE_URL);
describe('selected admin read routes', { skip: !enabled && 'requires LF_TEST_DATABASE_URL' }, () => {
  const uid = randomUUID(), ws = `ws_admin_read_${randomUUID()}`;
  let server: Server | undefined, base = '', adminToken = '', normalToken = '';
  let env: Record<string, string | undefined> = {};
  let db: Awaited<ReturnType<(typeof import('../src/server/db/firestore'))['getDb']>>;
  before(async () => {
    env = useLiveApiEnv('admin-read-probe');
    const [{ getDb }, { createApp }] = await Promise.all([import('../src/server/db/firestore'), import('../server')]);
    db = getDb();
    await db.pool.query("insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data) values ($1::uuid, $2, now(), '{}'::jsonb)", [uid, `${uid}@example.test`]);
    await db.collection('workspaces').doc(ws).set({ id: ws, name: 'Admin read probe', uid, members: [uid], roles: { [uid]: 'owner' }, currency: 'USD' });
    adminToken = await signTestJwt({ uid, email: `${uid}@example.test`, aal: 'aal2', appMetadata: { admin: true }, userMetadata: { email_verified: true } });
    normalToken = await signTestJwt({ uid, email: `${uid}@example.test`, aal: 'aal2', userMetadata: { email_verified: true, admin: true } });
    ({ server, base } = await listenOnRandomPort(await createApp()));
  });
  after(async () => {
    await closeServer(server);
    if (db) {
      await db.pool.query('delete from public.workspaces where id = $1', [ws]);
      await db.pool.query('delete from public.users where id = $1', [uid]);
      await db.pool.query('delete from auth.users where id = $1::uuid', [uid]);
    }
    restoreEnv(env);
  });
  for (const [path, property] of [
    ['/api/v1/admin/telemetry', 'status'],
    ['/api/v1/admin/users', 'users'],
    [`/api/v1/admin/audit-logs?workspaceId=${ws}`, 'logs'],
    [`/api/v1/admin/error-logs?workspaceId=${ws}`, 'logs'],
    ['/api/v1/admin/global-config', 'globalAdminConfig'],
  ] as const) {
    it(`${path}: trusted metadata permitted; user-controlled claim refused`, async () => {
      const allowed = await callApi(base, 'GET', path, { token: adminToken });
      assert.equal(allowed.status, 200, JSON.stringify(allowed.json));
      assert.ok(allowed.json && typeof allowed.json === 'object' && property in allowed.json);
      assert.equal((await callApi(base, 'GET', path, { token: normalToken })).status, 403);
      assert.equal((await callApi(base, 'GET', path)).status, 401);
    });
  }
});
