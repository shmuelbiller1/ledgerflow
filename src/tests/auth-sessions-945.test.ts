/**
 * #945 / S-28: a person lists their own sign-in sessions (one per device) and signs out just one
 * through POST /api/v1/auth/revoke-sessions { sessionId }; nobody can see or end another person's.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { Server } from 'node:http';
import { callApi, closeServer, listenOnRandomPort, restoreEnv, signTestJwt, useLiveApiEnv } from './helpers/liveApiServer';

const hasDb = Boolean(process.env.LF_TEST_DATABASE_URL);
describe('S-28 per-device sessions', { skip: !hasDb && 'needs LF_TEST_DATABASE_URL' }, () => {
  const tag = crypto.randomBytes(4).toString('hex');
  const alice = crypto.randomUUID();
  const bob = crypto.randomUUID();
  const laptop = crypto.randomUUID();
  const phone = crypto.randomUUID();
  const bobsSession = crypto.randomUUID();
  const email = (who: string) => `${who}.s28.${tag}@example.test`;
  let server: Server | undefined;
  let base = '';
  let prevEnv: Record<string, string | undefined> = {};
  let db: Awaited<ReturnType<(typeof import('../server/db/firestore'))['getDb']>>;

  before(async () => {
    prevEnv = useLiveApiEnv('auth-sessions-s28');
    const [{ getDb }, { createApp }] = await Promise.all([import('../server/db/firestore'), import('../../server')]);
    db = getDb();
    for (const [uid, who] of [[alice, 'alice'], [bob, 'bob']]) {
      await db.pool.query(`insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data) values ($1::uuid, $2, now(), '{}'::jsonb)`, [uid, email(who)]);
    }
    await db.pool.query(`insert into auth.sessions (id, user_id, created_at) values ($1::uuid, $2::uuid, '2026-11-20T08:00:00Z'), ($3::uuid, $2::uuid, '2026-11-21T08:00:00Z'), ($4::uuid, $5::uuid, now())`,
      [laptop, alice, phone, bobsSession, bob]);
    const app = await createApp();
    ({ server, base } = await listenOnRandomPort(app));
  });

  after(async () => {
    await closeServer(server);
    if (db) {
      await db.pool.query(`delete from auth.sessions where user_id = any($1::uuid[])`, [[alice, bob]]);
      await db.pool.query(`delete from public.users where id = any($1::text[])`, [[alice, bob]]);
      await db.pool.query(`delete from auth.users where id = any($1::uuid[])`, [[alice, bob]]);
    }
    restoreEnv(prevEnv);
  });

  // the sign-in limiter (5 per 15 min per IP) is shared by every test file on this database; a
  // made-up client address (the server trusts one proxy hop) keeps this file in its own bucket
  const clientIp = `198.18.${crypto.randomInt(0, 255)}.${crypto.randomInt(1, 255)}`;
  const revoke = async (sessionId: string) => callApi(base, 'POST', '/api/v1/auth/revoke-sessions',
    { token: await tokenFor(alice, 'alice', laptop), body: { sessionId }, headers: { 'X-Forwarded-For': clientIp } });
  const tokenFor = (uid: string, who: string, sessionId: string) =>
    signTestJwt({ uid, email: email(who), sessionId, userMetadata: { email_verified: true } });
  const remaining = async () =>
    (await db.pool.query<{ id: string }>(`select id::text from auth.sessions where user_id = any($1::uuid[]) order by id`, [[alice, bob]])).rows.map(r => r.id);

  it('lists only the caller\'s own sessions, newest first, and marks the current one', async () => {
    const res = await callApi(base, 'GET', '/api/v1/auth/sessions', { token: await tokenFor(alice, 'alice', laptop) });
    assert.equal(res.status, 200);
    const sessions = (res.json as { sessions: Array<{ id: string; current: boolean }> }).sessions;
    assert.deepEqual(sessions.map(s => s.id), [phone, laptop]);
    assert.deepEqual(sessions.map(s => s.current), [false, true]);
  });

  it('cannot sign out someone else\'s session', async () => {
    const res = await revoke(bobsSession);
    assert.equal(res.status, 404);
    assert.ok((await remaining()).includes(bobsSession));
  });

  it('refuses a malformed session id', async () => {
    const res = await revoke('not-a-uuid');
    assert.equal(res.status, 400);
  });

  it('signs out exactly one of the caller\'s devices', async () => {
    const res = await revoke(phone);
    assert.equal(res.status, 200);
    assert.equal((res.json as { current: boolean }).current, false);
    const left = await remaining();
    assert.ok(!left.includes(phone), 'the phone is signed out');
    assert.ok(left.includes(laptop) && left.includes(bobsSession), 'other sessions are untouched');
  });
});
