/** Destructive demo-only reset tested solely in freshly generated disposable local workspaces. */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { callApi, closeServer, listenOnRandomPort, restoreEnv, signTestJwt, useLiveApiEnv } from '../src/tests/helpers/liveApiServer';
const enabled = Boolean(process.env.LF_TEST_DATABASE_URL);
describe('demo reset through local app', { skip: !enabled && 'requires LF_TEST_DATABASE_URL' }, () => {
  const owner = randomUUID(), viewer = randomUUID(), users = [owner, viewer], ws = `ws_demo_http_${randomUUID()}`, other = `${ws}_other`;
  let db: Awaited<ReturnType<(typeof import('../src/server/db/firestore'))['getDb']>>;
  let server: Server | undefined, base = '', tokens: string[] = [], env: Record<string, string | undefined> = {};
  before(async () => {
    env = useLiveApiEnv('demo-reset-http');
    const [{ getDb }, { createApp }] = await Promise.all([import('../src/server/db/firestore'), import('../server')]); db = getDb();
    for (const uid of users) await db.pool.query("insert into auth.users (id,email,email_confirmed_at,raw_app_meta_data) values ($1::uuid,$2,now(),'{}'::jsonb)", [uid, `${uid}@example.test`]);
    for (const id of [ws, other]) {
      await db.collection('workspaces').doc(id).set({ uid: owner, id, name: id, isDemoLoaded: true, members: [owner, viewer], roles: { [owner]: 'owner', [viewer]: 'viewer' } });
      await db.collection('customers').doc(`${id}_customer`).set({ workspaceId: id, name: 'Sample customer' });
      await db.collection('auditLogs').doc(`${id}_audit`).set({ workspaceId: id, action: 'PREEXISTING_TEST', timestamp: '2026-01-01T00:00:00Z' });
    }
    tokens = await Promise.all(users.map(uid => signTestJwt({ uid, email: `${uid}@example.test`, aal: 'aal2', userMetadata: { email_verified: true } })));
    ({ server, base } = await listenOnRandomPort(await createApp()));
  });
  after(async () => {
    await closeServer(server);
    if (db) {
      for (const table of ['customers', 'auditLogs', 'idempotencyKeys']) await db.pool.query(`delete from public."${table}" where workspace_id = any($1::text[])`, [[ws, other]]);
      await db.pool.query('delete from public.workspaces where id = any($1::text[])', [[ws, other]]);
      await db.pool.query('delete from public.users where id = any($1::text[])', [users]);
      await db.pool.query('delete from auth.users where id = any($1::uuid[])', [users]);
    }
    restoreEnv(env);
  });
  it('viewer cannot reset; confirmed owner reset clears demo rows but not audit or another workspace', async () => {
    const body = { workspaceId: ws, confirmReset: true }, path = '/api/v1/transactions/reset';
    assert.equal((await callApi(base, 'POST', path, { token: tokens[1], body })).status, 403);
    assert.ok((await db.collection('customers').doc(`${ws}_customer`).get()).exists);
    const result = await callApi(base, 'POST', path, { token: tokens[0], body });
    assert.equal(result.status, 200, JSON.stringify(result.json));
    assert.equal((await db.collection('customers').doc(`${ws}_customer`).get()).exists, false);
    assert.equal((await db.collection('customers').doc(`${other}_customer`).get()).exists, true);
    assert.equal((await db.collection('auditLogs').doc(`${ws}_audit`).get()).exists, true);
    assert.ok((await db.collection('auditLogs').where('workspaceId', '==', ws).get()).docs.some(doc => doc.data().action === 'WORKSPACE_DATA_RESET'));
  });
});
