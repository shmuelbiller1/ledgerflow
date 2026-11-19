/**
 * S-11: Session hardening & API-key / legacy-route privilege boundary reproduction suite.
 *
 * Proves three live security gaps on main (reported to AI #1 per the 17 Nov coordination rule):
 *  1. `authRoutes.ts` mounts `/api/v1/auth/{revoke-sessions,delete-account,audit,login-audits}`
 *     behind `apiAuthenticate`, and `requiredApiKeyScope()` has no `/auth/` branch, so a
 *     workspace `lf_id_` API key with `write:transactions` / `read:transactions` can read
 *     personal sign-in history, revoke all personal sessions, and DELETE the key creator's account.
 *  2. `commandExecutor.ts:416` exempts `legacyRoute: true` from `risk: 'high'` `aal2`/human-only
 *     enforcement (`POST /api/v1/workspaces/:id/restore` vs `POST /api/v1/commands/workspace.restore`).
 *  3. Owner-sensitive controls (`POST /api/v1/keys/provision`, `PUT /api/v1/workspaces/:id/security/two-step`)
 *     accept stale `auth_time` `aal1` tokens when workspace 2FA is not yet enforced.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { Server } from 'node:http';
import { callApi, closeServer, listenOnRandomPort, restoreEnv, signTestJwt, useLiveApiEnv } from './helpers/liveApiServer';

const hasDb = Boolean(process.env.LF_TEST_DATABASE_URL);

describe('S-11: session hardening & API-key auth-route boundary', { skip: !hasDb && 'needs LF_TEST_DATABASE_URL' }, () => {
  const tag = crypto.randomBytes(4).toString('hex');
  const wsId = `ws_s11_${tag}`;
  const ownerUid = crypto.randomUUID();
  const ownerEmail = `owner.s11.${tag}@example.test`;
  const keyId = `lf_id_${wsId}_${crypto.randomBytes(8).toString('hex')}`;
  let apiKey = '';
  let tokenAal1Stale = '';
  let server: Server | undefined;
  let base = '';
  let prevEnv: Record<string, string | undefined> = {};
  let db: Awaited<ReturnType<(typeof import('../server/db/firestore'))['getDb']>>;

  const api = (method: string, routePath: string, auth?: string, body?: unknown) => callApi(base, method, routePath, { token: auth, body });

  before(async () => {
    prevEnv = useLiveApiEnv('s11-hardening');

    const [{ getDb }, { createApp }] = await Promise.all([
      import('../server/db/firestore'),
      import('../../server'),
    ]);
    db = getDb();
    await db.pool.query(`delete from public."rateLimitEntries"`);

    await db.pool.query(
      `insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data)
       values ($1::uuid, $2, now(), '{}'::jsonb)`,
      [ownerUid, ownerEmail],
    );

    const now = new Date().toISOString();
    await db.collection('workspaces').doc(wsId).set({
      id: wsId,
      name: 'S11 Workspace',
      uid: ownerUid,
      members: [ownerUid],
      roles: { [ownerUid]: 'owner' },
      plan: 'pro',
      bypassBilling: true,
      computeCreditBalance: 10000,
      requireTwoStep: false,
      createdAt: now,
    });

    const rawSecret = crypto.randomBytes(16).toString('hex');
    apiKey = `${keyId}.${rawSecret}`;
    const keyHash = crypto.createHash('sha256').update(rawSecret).digest('hex');
    await db.collection('apiKeys').doc(keyId).set({
      id: keyId,
      uid: ownerUid,
      workspaceId: wsId,
      name: 'Tx Integration Key',
      scopes: ['read:transactions', 'write:transactions'],
      keyHash,
      expiresAt: 'never',
      createdAt: now,
    });
    await db.collection('loginAudits').doc(`la_${tag}`).set({
      id: `la_${tag}`,
      uid: ownerUid,
      event: 'login',
      ip: '203.0.113.42',
      userAgent: 'TestBrowser/1.0',
      email: ownerEmail,
      timestamp: now,
    });

    tokenAal1Stale = await signTestJwt({ uid: ownerUid, email: ownerEmail, aal: 'aal1', authTimeOffsetSec: -7200, userMetadata: { email_verified: true } });

    const app = await createApp();
    ({ server, base } = await listenOnRandomPort(app));
  });

  after(async () => {
    await closeServer(server);
    if (db) {
      await db.pool.query(`delete from public."rateLimitEntries"`);
      await db.pool.query(`delete from public."loginAudits" where id = $1`, [`la_${tag}`]);
      await db.pool.query(`delete from public."auditLogs" where workspace_id = $1`, [wsId]);
      await db.pool.query(`delete from public."apiKeys" where workspace_id = $1`, [wsId]);
      await db.pool.query(`delete from public.workspaces where id = $1`, [wsId]);
      await db.pool.query(`delete from public.users where id = $1`, [ownerUid]);
      await db.pool.query(`delete from auth.users where id = $1::uuid`, [ownerUid]);
    }
    restoreEnv(prevEnv);
  });

  it('S-11 finding 1 (LIVE): workspace write:transactions API key can read loginAudits, revoke sessions, and delete creator account via /api/v1/auth/*', async () => {
    const audits = await api('GET', '/api/v1/auth/login-audits', apiKey);
    assert.equal(audits.status, 200);
    assert.equal((audits.json as { loginAudits?: unknown[] }).loginAudits?.length, 1);

    const revoked = await api('POST', '/api/v1/auth/revoke-sessions', apiKey, {});
    assert.equal(revoked.status, 200);

    // Prove DELETE /api/v1/auth/delete-account accepts the transactions-only API key (currently returns 200 and erases the user!)
    const deleted = await api('DELETE', '/api/v1/auth/delete-account', apiKey);
    assert.equal(deleted.status, 200);
    assert.equal((await db.pool.query(`select 1 from auth.users where id = $1::uuid`, [ownerUid])).rows.length, 0);

    // Re-insert auth.users row for remaining tests
    await db.pool.query(
      `insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data)
       values ($1::uuid, $2, now(), '{}'::jsonb)`,
      [ownerUid, ownerEmail],
    );
    await db.collection('workspaces').doc(wsId).update({ status: 'active', deletedAt: null, scheduledPurgeAt: null });
  });

  it('S-11 finding 2 (LIVE): /api/v1/commands/workspace.restorebackup blocks aal1/API key (403 TWO_STEP_REQUIRED), while legacy /restore bypasses that check', async () => {
    const cmdRes = await api('POST', '/api/v1/commands/workspace.restorebackup', tokenAal1Stale, {
      workspaceId: wsId,
      input: { backup: { schemaVersion: 1, workspaceId: wsId, collections: {} } },
    });
    assert.equal(cmdRes.status, 403);
    assert.equal((cmdRes.json as { code?: string }).code, 'TWO_STEP_REQUIRED');

    // Legacy route runs commandExecutor with legacyRoute: true -> skips line 416 TWO_STEP_REQUIRED and reaches backup validation instead
    const legacyRes = await api('POST', `/api/v1/workspaces/${wsId}/restore`, tokenAal1Stale, {
      invalid: true,
    });
    assert.notEqual((legacyRes.json as { code?: string }).code, 'TWO_STEP_REQUIRED');
  });

  it('S-11 finding 3 (LIVE): stale 2-hour-old aal1 token can provision new workspace API keys without fresh re-auth or aal2', async () => {
    const provisioned = await api('POST', '/api/v1/keys/provision', tokenAal1Stale, {
      workspaceId: wsId,
      name: 'Stale Session Key',
      scopes: ['read:transactions', 'write:transactions'],
    });
    assert.equal(provisioned.status, 201);
    assert.match(String((provisioned.json as { apiKey?: string }).apiKey || ''), /^lf_id_/);
  });
});
