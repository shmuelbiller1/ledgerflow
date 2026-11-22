/**
 * #945 / S-21: the members list gives owners and accountants each person's last sign-in and
 * whether they use two-step sign-in, from the auth provider; bookkeepers and viewers do not get it.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { Server } from 'node:http';
import { callApi, closeServer, listenOnRandomPort, restoreEnv, signTestJwt, useLiveApiEnv } from './helpers/liveApiServer';

const hasDb = Boolean(process.env.LF_TEST_DATABASE_URL);
describe('S-21 member sign-in facts', { skip: !hasDb && 'needs LF_TEST_DATABASE_URL' }, () => {
  const tag = crypto.randomBytes(4).toString('hex');
  const wsId = `ws_s21_${tag}`;
  const ownerUid = crypto.randomUUID();
  const bookkeeperUid = crypto.randomUUID();
  const viewerUid = crypto.randomUUID();
  const all = [ownerUid, bookkeeperUid, viewerUid];
  const email = (who: string) => `${who}.s21.${tag}@example.test`;
  let server: Server | undefined;
  let base = '';
  let prevEnv: Record<string, string | undefined> = {};
  let db: Awaited<ReturnType<(typeof import('../server/db/firestore'))['getDb']>>;

  before(async () => {
    prevEnv = useLiveApiEnv('member-sign-in-s21');
    const [{ getDb }, { createApp }] = await Promise.all([import('../server/db/firestore'), import('../../server')]);
    db = getDb();
    await db.pool.query(`insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data, last_sign_in_at) values ($1::uuid, $2, now(), '{}'::jsonb, '2026-11-20T08:30:00Z')`, [ownerUid, email('owner')]);
    await db.pool.query(`insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data, last_sign_in_at) values ($1::uuid, $2, now(), '{}'::jsonb, null)`, [bookkeeperUid, email('bookkeeper')]);
    await db.pool.query(`insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data) values ($1::uuid, $2, now(), '{}'::jsonb)`, [viewerUid, email('viewer')]);
    await db.pool.query(`insert into auth.mfa_factors (id, user_id, factor_type, status) values ($1::uuid, $2::uuid, 'totp', 'verified')`, [crypto.randomUUID(), ownerUid]);
    await db.pool.query(`insert into auth.mfa_factors (id, user_id, factor_type, status) values ($1::uuid, $2::uuid, 'totp', 'unverified')`, [crypto.randomUUID(), bookkeeperUid]);
    await db.collection('workspaces').doc(wsId).set({
      id: wsId, name: 'S-21', uid: ownerUid, members: [ownerUid, bookkeeperUid, viewerUid],
      roles: { [ownerUid]: 'owner', [bookkeeperUid]: 'bookkeeper', [viewerUid]: 'viewer' },
      plan: 'pro', bypassBilling: true, createdAt: new Date().toISOString(),
    });
    const app = await createApp();
    ({ server, base } = await listenOnRandomPort(app));
  });

  after(async () => {
    await closeServer(server);
    if (db) {
      await db.pool.query(`delete from public.workspaces where id = $1`, [wsId]);
      await db.pool.query(`delete from public.users where id = any($1::text[])`, [all]);
      await db.pool.query(`delete from auth.mfa_factors where user_id = any($1::uuid[])`, [all]);
      await db.pool.query(`delete from auth.users where id = any($1::uuid[])`, [all]);
    }
    restoreEnv(prevEnv);
  });

  const members = async (uid: string, who: string) => {
    // the owner has a verified second step, so the server expects a two-step (aal2) token from them
    const token = await signTestJwt({ uid, email: email(who), aal: uid === ownerUid ? 'aal2' : 'aal1', userMetadata: { email_verified: true } });
    return callApi(base, 'GET', `/api/v1/workspaces/${wsId}/members`, { token });
  };

  it('the owner sees last sign-in and verified two-step for each person', async () => {
    const res = await members(ownerUid, 'owner');
    assert.equal(res.status, 200);
    const signIn = (res.json as { signIn?: Record<string, { lastSignInAt: string | null; mfaEnrolled: boolean }> }).signIn;
    assert.ok(signIn, 'owners get sign-in facts');
    assert.deepEqual(signIn[ownerUid], { lastSignInAt: '2026-11-20T08:30:00.000Z', mfaEnrolled: true });
    assert.deepEqual(signIn[bookkeeperUid], { lastSignInAt: null, mfaEnrolled: false }, 'an unverified factor is not two-step');
    assert.deepEqual(signIn[viewerUid], { lastSignInAt: null, mfaEnrolled: false });
  });

  it('bookkeepers and viewers get the member list without sign-in facts', async () => {
    for (const [uid, who] of [[bookkeeperUid, 'bookkeeper'], [viewerUid, 'viewer']] as const) {
      const res = await members(uid, who);
      assert.equal(res.status, 200, who);
      assert.equal((res.json as { signIn?: unknown }).signIn, undefined, who);
    }
  });
});
