/** Self-scoped account endpoints through the real app using synthetic JWTs and disposable Postgres. */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { callApi, closeServer, listenOnRandomPort, restoreEnv, signTestJwt, useLiveApiEnv } from '../src/tests/helpers/liveApiServer';
const enabled = Boolean(process.env.LF_TEST_DATABASE_URL);
describe('personal security endpoints via local app', { skip: !enabled && 'requires LF_TEST_DATABASE_URL' }, () => {
  const user = randomUUID(), other = randomUUID(), users = [user, other];
  let db: Awaited<ReturnType<(typeof import('../src/server/db/firestore'))['getDb']>>;
  let server: Server | undefined, base = '', tokens: string[] = [], env: Record<string, string | undefined> = {};
  const call = (method: string, path: string, token?: string, body?: unknown) => callApi(base, method, path, { token, body });
  before(async () => {
    env = useLiveApiEnv('security-person-http');
    const [{ getDb }, { createApp }] = await Promise.all([import('../src/server/db/firestore'), import('../server')]);
    db = getDb();
    for (const uid of users) await db.pool.query("insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data) values ($1::uuid, $2, now(), '{}'::jsonb)", [uid, `${uid}@example.test`]);
    await db.pool.query("insert into auth.mfa_factors (id,user_id,factor_type,status) values ($1::uuid,$2::uuid,'totp','verified')", [randomUUID(), user]);
    await db.collection('loginAudits').doc(`audit_${user}`).set({ uid: user, event: 'login_success', timestamp: '2026-01-01T00:00:00Z' });
    await db.collection('loginAudits').doc(`audit_${other}`).set({ uid: other, event: 'login_success', timestamp: '2026-01-02T00:00:00Z' });
    tokens = await Promise.all(users.map(uid => signTestJwt({ uid, email: `${uid}@example.test`, aal: 'aal2', authTimeOffsetSec: 0, userMetadata: { email_verified: true } })));
    ({ server, base } = await listenOnRandomPort(await createApp()));
  });
  after(async () => {
    await closeServer(server);
    if (db) {
      await db.pool.query('delete from public."loginAudits" where id = any($1::text[])', [users.map(uid => `audit_${uid}`)]);
      await db.pool.query('delete from public."recoveryCodes" where id = any($1::text[])', [users]);
      for (const table of ['auditLogs', 'idempotencyKeys']) await db.pool.query(`delete from public."${table}" where workspace_id = any($1::text[])`, [users.map(uid => `person:${uid}`)]);
      await db.pool.query('delete from public.users where id = any($1::text[])', [users]);
      await db.pool.query('delete from auth.users where id = any($1::uuid[])', [users]);
    }
    restoreEnv(env);
  });
  it('returns only the signed-in person’s audit rows, rejecting anonymous', async () => {
    const path = '/api/v1/auth/login-audits';
    for (let i = 0; i < users.length; i++) {
      const res = await call('GET', path, tokens[i]); assert.equal(res.status, 200);
      const rows = (res.json as { loginAudits: Array<{ uid: string }> }).loginAudits;
      assert.equal(rows.length, 1); assert.equal(rows[0].uid, users[i]);
    }
    assert.equal((await call('GET', path)).status, 401);
  });
  it('creates one-time recovery codes for its own verified factor and isolates the other user', async () => {
    const path = '/api/v1/account/recovery-codes';
    assert.equal((await call('POST', path, tokens[1], {})).status, 409);
    const made = await call('POST', path, tokens[0], {});
    assert.equal(made.status, 200, JSON.stringify(made.json));
    const codes = (made.json as { codes: string[] }).codes;
    assert.equal(codes.length, 10);
    const stored = JSON.stringify((await db.collection('recoveryCodes').doc(user).get()).data());
    assert.ok(codes.every(code => !stored.includes(code) && !stored.includes(code.replace('-', ''))));
    assert.equal((await call('GET', path, tokens[0])).status, 200);
    assert.equal(((await call('GET', path, tokens[0])).json as { left: number }).left, 10);
    assert.equal(((await call('GET', path, tokens[1])).json as { left: number }).left, 0);
    const used = await call('POST', `${path}/use`, tokens[0], { code: codes[0] });
    assert.equal(used.status, 200, JSON.stringify(used.json));
    assert.equal((used.json as { left: number }).left, 9);
    assert.equal((await call('POST', `${path}/use`, tokens[0], { code: codes[0] })).status, 400);
    assert.equal(Number((await db.pool.query('select count(*) from auth.mfa_factors where user_id = $1::uuid', [user])).rows[0].count), 0);
    assert.equal((await call('GET', path)).status, 401);
  });
});
