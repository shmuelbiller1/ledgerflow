/** Real app and disposable database; JWTs are locally signed and delivery is not exercised. */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { callApi, closeServer, listenOnRandomPort, restoreEnv, signTestJwt, useLiveApiEnv } from '../src/tests/helpers/liveApiServer';
const enabled = Boolean(process.env.LF_TEST_DATABASE_URL);
describe('workspace invitation lifecycle via local application', { skip: !enabled && 'requires LF_TEST_DATABASE_URL' }, () => {
  const owner = randomUUID(), invitee = randomUUID(), outsider = randomUUID(), ws = `ws_invite_http_${randomUUID()}`;
  const users = [owner, invitee, outsider], email = `${invitee}@example.test`;
  let db: Awaited<ReturnType<(typeof import('../src/server/db/firestore'))['getDb']>>;
  let server: Server | undefined, base = '', tokens: string[] = [], env: Record<string, string | undefined> = {};
  const request = (method: string, path: string, token?: string, body?: unknown) => callApi(base, method, path, { token, body });
  before(async () => {
    env = useLiveApiEnv('invite-http');
    const [{ getDb }, { createApp }] = await Promise.all([import('../src/server/db/firestore'), import('../server')]);
    db = getDb();
    for (const uid of users) await db.pool.query("insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data) values ($1::uuid, $2, now(), '{}'::jsonb)", [uid, `${uid}@example.test`]);
    await db.collection('workspaces').doc(ws).set({ id: ws, uid: owner, name: 'Invite test books', currency: 'USD', bypassBilling: true, members: [owner], roles: { [owner]: 'owner' } });
    tokens = await Promise.all(users.map(uid => signTestJwt({ uid, email: `${uid}@example.test`, aal: 'aal2', userMetadata: { email_verified: true } })));
    ({ server, base } = await listenOnRandomPort(await createApp()));
  });
  after(async () => {
    await closeServer(server);
    if (db) {
      for (const table of ['invites', 'auditLogs', 'idempotencyKeys', 'notifications', 'numberingSeries']) await db.pool.query(`delete from public."${table}" where workspace_id = any($1::text[])`, [[ws, ...users.map(uid => `person:${uid}`)]]);
      await db.pool.query('delete from public.workspaces where id = $1', [ws]);
      await db.pool.query('delete from public.users where id = any($1::text[])', [users]);
      await db.pool.query('delete from auth.users where id = any($1::uuid[])', [users]);
    }
    restoreEnv(env);
  });
  it('owner creates invite; public lookup, wrong identity refusal and single-use acceptance', async () => {
    const path = `/api/v1/workspaces/${ws}/invites`;
    assert.equal((await request('POST', path, tokens[2], { email, role: 'bookkeeper' })).status, 403);
    const created = await request('POST', path, tokens[0], { email, role: 'bookkeeper' });
    assert.equal(created.status, 200, JSON.stringify(created.json));
    const invite = (created.json as { invite: { token: string; id: string } }).invite;
    assert.ok(invite.token && invite.id);
    const url = `/api/v1/invites/${encodeURIComponent(invite.token)}`;
    const lookup = await request('GET', url); assert.equal(lookup.status, 200, JSON.stringify(lookup.json));
    const returned = (lookup.json as { invite: { email: string; role: string; workspaceName: string } }).invite;
    assert.deepEqual([returned.email, returned.role, returned.workspaceName], [email, 'bookkeeper', 'Invite test books']);
    assert.equal((await request('POST', `${url}/accept`, tokens[2], {})).status, 403);
    assert.equal((await request('POST', `${url}/accept`, undefined, {})).status, 401);
    const accepted = await request('POST', `${url}/accept`, tokens[1], {});
    assert.equal(accepted.status, 200, JSON.stringify(accepted.json));
    const workspace = (await db.collection('workspaces').doc(ws).get()).data()!;
    assert.ok((workspace.members as string[]).includes(invitee));
    assert.equal((workspace.roles as Record<string, string>)[invitee], 'bookkeeper');
    assert.equal((await db.collection('invites').doc(invite.id).get()).data()?.status, 'accepted');
    assert.equal((await request('POST', `${url}/accept`, tokens[1], {})).status, 400);
    assert.equal((await request('GET', url)).status, 400);
    const list = await request('GET', path, tokens[0]); assert.equal(list.status, 200);
    assert.ok((list.json as { invites: Array<{ id: string; status: string }> }).invites.some(row => row.id === invite.id && row.status === 'accepted'));
  });
  it('owner changes a member role, updates numbering, and removes access', async () => {
    const rolePath = `/api/v1/workspaces/${ws}/roles/${invitee}`;
    assert.equal((await request('PATCH', rolePath, tokens[1], { role: 'owner' })).status, 403);
    const update = await request('PATCH', rolePath, tokens[0], { role: 'accountant' });
    assert.equal(update.status, 200, JSON.stringify(update.json));
    assert.equal(((await db.collection('workspaces').doc(ws).get()).data()!.roles as Record<string, string>)[invitee], 'accountant');
    const numbers = `/api/v1/workspaces/${ws}/numbering`;
    assert.equal((await request('GET', numbers, tokens[2])).status, 403);
    assert.equal((await request('PUT', `${numbers}/invoice`, tokens[2], { prefix: 'F-', nextNumber: 7, padding: 3 })).status, 403);
    const saved = await request('PUT', `${numbers}/invoice`, tokens[0], { prefix: 'F-', nextNumber: 7, padding: 3 });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.equal((saved.json as { series: { next: string } }).series.next, 'F-007');
    const read = await request('GET', numbers, tokens[1]);
    assert.equal(read.status, 200, JSON.stringify(read.json));
    assert.equal((read.json as { series: Array<{ type: string; next: string }> }).series.find(row => row.type === 'invoice')?.next, 'F-007');
    const memberPath = `/api/v1/workspaces/${ws}/members/${invitee}`;
    assert.equal((await request('DELETE', memberPath, tokens[1])).status, 403);
    const removed = await request('DELETE', memberPath, tokens[0]); assert.equal(removed.status, 200, JSON.stringify(removed.json));
    const state = (await db.collection('workspaces').doc(ws).get()).data()!;
    assert.ok(!(state.members as string[]).includes(invitee));
    assert.equal((state.roles as Record<string, string>)[invitee], undefined);
    assert.equal((await request('GET', numbers, tokens[1])).status, 403);
  });
});
