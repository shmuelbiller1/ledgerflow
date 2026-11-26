/**
 * AUP-19: the admin audit-log route gives every row an id. The viewer rejects the whole response when one
 * row has none, so an older row written without a stored id used to blank the entire list.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { callApi, signTestJwt, startOwnerApp } from './helpers/liveApiServer';

const enabled = Boolean(process.env.LF_TEST_DATABASE_URL);
describe('AUP-19: admin audit logs carry ids', { skip: !enabled && 'requires LF_TEST_DATABASE_URL' }, () => {
  const ws = `ws_aup19_${randomUUID()}`;
  let app!: Awaited<ReturnType<typeof startOwnerApp>>;
  let adminToken = '';
  before(async () => {
    app = await startOwnerApp('aup19-audit-ids', ws);
    adminToken = await signTestJwt({ uid: app.owner, email: `${app.owner}@example.test`, aal: 'aal2', appMetadata: { admin: true }, userMetadata: { email_verified: true } });
    // an older row: no id inside it
    await app.db.collection('auditLogs').doc(`${ws}_old`).set({ workspaceId: ws, action: 'OLD_ACTION', userId: app.owner, timestamp: '2026-01-01T00:00:00.000Z' });
    await app.db.collection('auditLogs').doc(`${ws}_new`).set({ workspaceId: ws, action: 'NEW_ACTION', userId: app.owner, timestamp: '2026-02-01T00:00:00.000Z' });
  });
  after(async () => { await app.db.pool.query('delete from public."auditLogs" where workspace_id = $1', [ws]); await app?.stop(); });

  it('every returned row has a string id, including the row stored without one', async () => {
    const r = await callApi(app.base, 'GET', `/api/v1/admin/audit-logs?workspaceId=${ws}`, { token: adminToken });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const logs = (r.json as { logs: Array<{ id?: unknown; action: string }> }).logs;
    assert.equal(logs.length, 2);
    assert.ok(logs.every(l => typeof l.id === 'string' && l.id.length > 0), JSON.stringify(logs));
    assert.deepEqual(logs.map(l => l.action), ['NEW_ACTION', 'OLD_ACTION'], 'newest first, as before');
    assert.equal(new Set(logs.map(l => l.id)).size, 2, 'the ids are distinct');
  });
});
