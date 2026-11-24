/** Selected real application routes, local PostgreSQL and synthetic identities only. */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { callApi, closeServer, listenOnRandomPort, restoreEnv, signTestJwt, useLiveApiEnv } from '../src/tests/helpers/liveApiServer';
const enabled = Boolean(process.env.LF_TEST_DATABASE_URL);
describe('workspace settings and watch HTTP routes', { skip: !enabled && 'requires LF_TEST_DATABASE_URL' }, () => {
  const owner = randomUUID(), viewer = randomUUID(), outsider = randomUUID(), users = [owner, viewer, outsider], ws = `ws_settings_http_${randomUUID()}`;
  const customer = `${ws}_customer`;
  let db: Awaited<ReturnType<(typeof import('../src/server/db/firestore'))['getDb']>>;
  let server: Server | undefined, base = '', tokens: string[] = [], env: Record<string, string | undefined> = {};
  const request = (method: string, path: string, token: string, body?: unknown) => callApi(base, method, `/api/v1/workspaces/${ws}${path}`, { token, body });
  before(async () => {
    env = useLiveApiEnv('workspace-settings-http');
    const [{ getDb }, { createApp }] = await Promise.all([import('../src/server/db/firestore'), import('../server')]); db = getDb();
    for (const uid of users) await db.pool.query("insert into auth.users (id,email,email_confirmed_at,raw_app_meta_data) values ($1::uuid,$2,now(),'{}'::jsonb)", [uid, `${uid}@example.test`]);
    await db.collection('workspaces').doc(ws).set({ id: ws, uid: owner, name: 'Settings test', members: [owner, viewer], roles: { [owner]: 'owner', [viewer]: 'viewer' }, currency: 'USD' });
    await db.collection('customers').doc(customer).set({ workspaceId: ws, name: 'Tagged customer', tags: ['VIP', 'Other'] });
    for (const id of ['cash', 'expense']) await db.collection('chartAccounts').doc(`${ws}_${id}`).set({ workspaceId: ws, name: id, type: id === 'cash' ? 'asset' : 'expense', category: id === 'cash' ? 'Cash' : 'Expenses', code: id });
    tokens = await Promise.all(users.map(uid => signTestJwt({ uid, email: `${uid}@example.test`, aal: 'aal2', userMetadata: { email_verified: true } })));
    ({ server, base } = await listenOnRandomPort(await createApp()));
  });
  after(async () => {
    await closeServer(server);
    if (db) {
      for (const table of ['customers', 'chartAccounts', 'documents', 'auditLogs', 'idempotencyKeys']) await db.pool.query(`delete from public."${table}" where workspace_id = $1`, [ws]);
      await db.pool.query('delete from public.workspaces where id = $1', [ws]);
      await db.pool.query('delete from public.users where id = any($1::text[])', [users]);
      await db.pool.query('delete from auth.users where id = any($1::uuid[])', [users]);
    }
    restoreEnv(env);
  });
  it('tags are visible to a viewer, only a writer can rename them', async () => {
    const list = await request('GET', '/tags', tokens[1]); assert.equal(list.status, 200, JSON.stringify(list.json));
    assert.ok((list.json as { data: { tags: Array<{ tag: string; total: number }> } }).data.tags.some(tag => tag.tag === 'VIP' && tag.total === 1));
    assert.equal((await request('POST', '/tags/change', tokens[1], { from: 'VIP', to: 'Priority' })).status, 403);
    const changed = await request('POST', '/tags/change', tokens[0], { from: 'VIP', to: 'Priority' });
    assert.equal(changed.status, 200, JSON.stringify(changed.json));
    assert.equal((changed.json as { data: { changed: number } }).data.changed, 1);
    assert.deepEqual((await db.collection('customers').doc(customer).get()).data()?.tags, ['Priority', 'Other']);
    assert.equal((await request('GET', '/tags', tokens[2])).status, 403);
  });
  it('balanced template saves and lists without posting; viewer cannot save', async () => {
    const template = { name: 'Monthly entry', lines: [{ accountId: `${ws}_expense`, debitCents: 500, creditCents: 0 }, { accountId: `${ws}_cash`, debitCents: 0, creditCents: 500 }] };
    assert.equal((await request('POST', '/journal-templates', tokens[1], template)).status, 403);
    const bad = await request('POST', '/journal-templates', tokens[0], { ...template, lines: [template.lines[0]] }); assert.equal(bad.status, 400);
    const saved = await request('POST', '/journal-templates', tokens[0], template); assert.equal(saved.status, 200, JSON.stringify(saved.json));
    const list = await request('GET', '/journal-templates', tokens[1]); assert.equal(list.status, 200);
    assert.ok((list.json as { data: { templates: Array<{ name: string }> } }).data.templates.some(row => row.name === template.name));
    assert.equal((await db.collection('transactions').where('workspaceId', '==', ws).get()).size, 0);
  });
  it('viewer watches a record and can delete only their own watch', async () => {
    const path = '/tasks/watching';
    const made = await request('POST', path, tokens[1], { record: { type: 'account', id: `${ws}_cash`, label: 'Cash account' } });
    assert.equal(made.status, 200, JSON.stringify(made.json));
    const id = (made.json as { watch: { id: string } }).watch.id;
    const mine = await request('GET', path, tokens[1]); assert.equal(mine.status, 200);
    assert.ok((mine.json as { watches: Array<{ id: string }> }).watches.some(row => row.id === id));
    assert.equal((await request('DELETE', `${path}/${id}`, tokens[0])).status, 404);
    assert.equal((await request('DELETE', `${path}/${id}`, tokens[2])).status, 403);
    assert.equal((await request('DELETE', `${path}/${id}`, tokens[1])).status, 200);
    assert.equal(((await request('GET', path, tokens[1])).json as { watches: unknown[] }).watches.length, 0);
  });
});
