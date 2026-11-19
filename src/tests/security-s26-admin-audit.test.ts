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
import { callApi, closeServer, listenOnRandomPort, restoreEnv, signTestJwt, useLiveApiEnv } from './helpers/liveApiServer';

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

  const api = (method: string, routePath: string, token: string, body?: unknown) => callApi(base, method, routePath, { token, body });

  before(async () => {
    prevEnv = useLiveApiEnv('s26-admin');

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

    adminToken = await signTestJwt({ uid: adminUid, email: adminEmail, aal: 'aal2', appMetadata: { admin: true, role: 'admin' } });

    const app = await createApp();
    ({ server, base } = await listenOnRandomPort(app));
  });

  after(async () => {
    await closeServer(server);
    if (db) {
      await db.pool.query(`delete from public."auditLogs" where workspace_id in ($1, 'system') and data->>'uid' = $2`, [wsId, adminUid]);
      await db.pool.query(`delete from public.admins where id in ($1, $2)`, [adminUid, targetUid]);
      await db.pool.query(`delete from public.users where id in ($1, $2)`, [adminUid, targetUid]);
      await db.pool.query(`delete from public.workspaces where id = $1`, [wsId]);
      await db.pool.query(`delete from auth.users where id in ($1::uuid, $2::uuid)`, [adminUid, targetUid]);
    }
    restoreEnv(prevEnv);
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
