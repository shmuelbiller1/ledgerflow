/**
 * S-26: Platform-admin audit & `admins` collection coverage verification.
 *
 * Confirms `#826`/`#875` (`PUT /api/v1/admin/users/:userId` uses `writeAuditLogStrict`), while
 * pinning remaining S-26 gaps for AI #1:
 *  - `PUT /api/v1/admin/users/:userId` and `POST /api/v1/admin/give-access` do not sync `public.admins`
 *  - `DELETE /api/csp-report/summary` writes zero audit log entries
 *  - `PUT /api/v1/admin/workspaces/:workspaceId`, `PUT /api/v1/admin/global-config`,
 *    and `POST /api/v1/admin/give-access` use non-strict `writeAuditLog` (source-checked below)
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SignJWT } from 'jose';

const hasDb = Boolean(process.env.LF_TEST_DATABASE_URL);

describe('S-26: platform-admin audit completeness', { skip: !hasDb && 'needs LF_TEST_DATABASE_URL' }, () => {
  const tag = crypto.randomBytes(4).toString('hex');
  const adminUid = crypto.randomUUID();
  const targetUid = crypto.randomUUID();
  const adminEmail = `admin.s26.${tag}@example.test`;
  const targetEmail = `target.s26.${tag}@example.test`;
  const wsId = `ws_s26_${tag}`;
  let adminToken = '';
  let server: Server | undefined;
  let base = '';
  let prevEnv: Record<string, string | undefined> = {};
  let db: Awaited<ReturnType<(typeof import('../server/db/firestore'))['getDb']>>;

  async function api(method: string, routePath: string, token: string, body?: unknown) {
    const res = await fetch(`${base}${routePath}`, {
      method,
      headers: {
        'X-LedgerFlow-Request': '1',
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
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
    process.env.SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || 'test-s26-jwt-secret-at-least-32-chars-long!!';
    process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://s26-admin.supabase.test';
    process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-s26-session-secret-000000000000001';
    process.env.SYSTEM_SALT = process.env.SYSTEM_SALT || 'test-s26-system-salt-000000000000000001';
    process.env.INVITE_SECRET = process.env.INVITE_SECRET || 'test-s26-invite-secret-0000000000000001';

    const [{ getDb }, { createApp }] = await Promise.all([
      import('../server/db/firestore'),
      import('../../server'),
    ]);
    db = getDb();

    await db.pool.query(
      `insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data)
       values ($1::uuid, $2, now(), '{"admin":true,"role":"admin"}'::jsonb),
              ($3::uuid, $4, now(), '{}'::jsonb)`,
      [adminUid, adminEmail, targetUid, targetEmail],
    );
    await db.collection('workspaces').doc(wsId).set({
      id: wsId,
      name: 'S26 Target WS',
      uid: targetUid,
      members: [targetUid],
      roles: { [targetUid]: 'owner' },
      plan: 'free',
      bypassBilling: false,
      createdAt: new Date().toISOString(),
    });

    const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET!);
    adminToken = await new SignJWT({
      email: adminEmail,
      email_verified: true,
      aal: 'aal2',
      role: 'authenticated',
      app_metadata: { admin: true, role: 'admin' },
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(adminUid)
      .setAudience('authenticated')
      .setIssuer(`${process.env.SUPABASE_URL}/auth/v1`)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret);

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
      await db.pool.query(`delete from public."auditLogs" where workspace_id in ($1, 'system') and data->>'uid' = $2`, [wsId, adminUid]);
      await db.pool.query(`delete from public.admins where id in ($1, $2)`, [adminUid, targetUid]);
      await db.pool.query(`delete from public.users where id in ($1, $2)`, [adminUid, targetUid]);
      await db.pool.query(`delete from public.workspaces where id = $1`, [wsId]);
      await db.pool.query(`delete from auth.users where id in ($1::uuid, $2::uuid)`, [adminUid, targetUid]);
    }
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('S-26: admin user promotion writes strict audit row but leaves public.admins out of sync; CSP reset writes no audit row', async () => {
    const promote = await api('PUT', `/api/v1/admin/users/${targetUid}/role`, adminToken, { role: 'admin' });
    assert.equal(promote.status, 200);

    const systemAudits = (await db.collection('auditLogs').where('workspaceId', '==', 'system').get())
      .docs.map(d => d.data())
      .filter(d => d.uid === adminUid && d.action === 'ADMIN_USER_UPDATED');
    assert.equal(systemAudits.length >= 1, true);

    // Admins collection is NOT updated by adminRoutes (only grant-admin.ts writes it)
    const adminDoc = await db.collection('admins').doc(targetUid).get();
    assert.equal(adminDoc.exists, false);

    // DELETE /api/csp-report/summary has no audit row
    const beforeCount = (await db.collection('auditLogs').where('workspaceId', '==', 'system').get())
      .docs.filter(d => d.data().uid === adminUid).length;
    const resetCsp = await api('DELETE', '/api/csp-report/summary', adminToken);
    assert.equal(resetCsp.status, 200);
    const afterCount = (await db.collection('auditLogs').where('workspaceId', '==', 'system').get())
      .docs.filter(d => d.data().uid === adminUid).length;
    assert.equal(afterCount, beforeCount);
  });

  it('S-26 source audit: non-strict writeAuditLog still used on workspace, global-config, and give-access admin mutations', () => {
    const adminRoutes = fs.readFileSync(path.join(process.cwd(), 'src/server/routes/adminRoutes.ts'), 'utf8');
    const giveAccessRoutes = fs.readFileSync(path.join(process.cwd(), 'src/server/routes/giveAccessRoutes.ts'), 'utf8');
    const grantAdmin = fs.readFileSync(path.join(process.cwd(), 'scripts/grant-admin.ts'), 'utf8');

    assert.match(adminRoutes, /writeAuditLogStrict\(/);
    // Remaining non-strict calls in adminRoutes + giveAccessRoutes
    assert.match(adminRoutes, /await writeAuditLog\(/);
    assert.equal(giveAccessRoutes.includes('writeAuditLogStrict'), false);
    assert.equal(grantAdmin.includes('writeServerAuditLog'), false);
  });
});
