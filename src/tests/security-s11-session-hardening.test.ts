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
import type { AddressInfo } from 'node:net';
import { SignJWT } from 'jose';

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

  async function mintJwt(uid: string, email: string, opts: { aal?: 'aal1' | 'aal2'; authTimeOffsetSec?: number } = {}): Promise<string> {
    const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET!);
    const nowSec = Math.floor(Date.now() / 1000);
    return new SignJWT({
      email,
      email_verified: true,
      aal: opts.aal || 'aal1',
      auth_time: nowSec + (opts.authTimeOffsetSec ?? 0),
      role: 'authenticated',
      user_metadata: { email_verified: true },
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(uid)
      .setAudience('authenticated')
      .setIssuer(`${process.env.SUPABASE_URL}/auth/v1`)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret);
  }

  async function api(method: string, routePath: string, auth?: string, body?: unknown) {
    const headers: Record<string, string> = { 'X-LedgerFlow-Request': '1' };
    if (auth) headers.Authorization = `Bearer ${auth}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${base}${routePath}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json: unknown = text;
    try { json = JSON.parse(text); } catch { /* raw */ }
    return { status: res.status, json };
  }

  before(async () => {
    prevEnv = {
      DATABASE_URL: process.env.DATABASE_URL,
      SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET,
      SUPABASE_URL: process.env.SUPABASE_URL,
      SESSION_SECRET: process.env.SESSION_SECRET,
      SYSTEM_SALT: process.env.SYSTEM_SALT,
      INVITE_SECRET: process.env.INVITE_SECRET,
    };
    process.env.DATABASE_URL = process.env.LF_TEST_DATABASE_URL;
    process.env.SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || 'test-s11-jwt-secret-at-least-32-chars-long!!';
    process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://s11-hardening.supabase.test';
    process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-s11-session-secret-000000000000001';
    process.env.SYSTEM_SALT = process.env.SYSTEM_SALT || 'test-s11-system-salt-000000000000000001';
    process.env.INVITE_SECRET = process.env.INVITE_SECRET || 'test-s11-invite-secret-0000000000000001';

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

    tokenAal1Stale = await mintJwt(ownerUid, ownerEmail, { aal: 'aal1', authTimeOffsetSec: -7200 });

    const app = await createApp();
    const listening = await new Promise<Server>(resolve => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    server = listening;
    base = `http://127.0.0.1:${(listening.address() as AddressInfo).port}`;
  });

  after(async () => {
    const runningServer = server;
    if (runningServer) await new Promise<void>(resolve => runningServer.close(() => resolve()));
    if (db) {
      await db.pool.query(`delete from public."rateLimitEntries"`);
      await db.pool.query(`delete from public."loginAudits" where id = $1`, [`la_${tag}`]);
      await db.pool.query(`delete from public."auditLogs" where workspace_id = $1`, [wsId]);
      await db.pool.query(`delete from public."apiKeys" where workspace_id = $1`, [wsId]);
      await db.pool.query(`delete from public.workspaces where id = $1`, [wsId]);
      await db.pool.query(`delete from public.users where id = $1`, [ownerUid]);
      await db.pool.query(`delete from auth.users where id = $1::uuid`, [ownerUid]);
    }
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
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
