/** The signed-in-person sandbox routes through the local app and disposable Postgres.
 * Tokens are synthetic; no hosted auth or model provider is used. */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { callApi, closeServer, listenOnRandomPort, restoreEnv, signTestJwt, useLiveApiEnv } from '../src/tests/helpers/liveApiServer';

const enabled = Boolean(process.env.LF_TEST_DATABASE_URL);
describe('person sandbox HTTP routes', { skip: !enabled && 'requires LF_TEST_DATABASE_URL' }, () => {
  const owner = randomUUID(), outsider = randomUUID(), ws = `sbx-person-${randomUUID()}`;
  let env: Record<string, string | undefined> = {}, server: Server | undefined, base = '', token = '', otherToken = '', sandboxId = '', assistantToken = '';
  let db: Awaited<ReturnType<(typeof import('../src/server/db/firestore'))['getDb']>>;
  type Payload = {
    sandbox: { id: string }; assistant: { token: string }; sandboxes: Array<{ id: string }>;
    remembered: unknown[]; commands: Array<{ name: string }>; tools: unknown[]; cents: number;
    steps: Array<{ id: string; preview: { allocatedIds: Record<string, string> } }>; revision: string;
    records: unknown[]; record: { name: string };
  };
  type Response = { status: number; json: Payload };
  const call = async (method: string, path: string, body?: unknown, auth = token): Promise<Response> =>
    await callApi(base, method, path, { token: auth, body }) as Response;
  const root = () => `/api/v1/workspaces/${ws}/sandboxes`;
  const person = (method: string, path = '', body?: unknown, auth = token) => call(method, `${root()}/${sandboxId}${path}`, body, auth);
  before(async () => {
    env = useLiveApiEnv('sandbox-person');
    const [{ getDb }, { createApp }] = await Promise.all([import('../src/server/db/firestore'), import('../server')]);
    db = getDb();
    for (const uid of [owner, outsider]) await db.pool.query("insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data) values ($1::uuid, $2, now(), '{}'::jsonb)", [uid, `${uid}@example.test`]);
    await db.collection('workspaces').doc(ws).set({ id: ws, name: 'Sandbox person', uid: owner, members: [owner], roles: { [owner]: 'owner' }, currency: 'USD', bypassBilling: true });
    token = await signTestJwt({ uid: owner, email: `${owner}@example.test`, aal: 'aal2', userMetadata: { email_verified: true } });
    otherToken = await signTestJwt({ uid: outsider, email: `${outsider}@example.test`, aal: 'aal2', userMetadata: { email_verified: true } });
    ({ server, base } = await listenOnRandomPort(await createApp()));
  });
  after(async () => {
    await closeServer(server);
    if (db) {
      await db.pool.query('delete from sandbox.sandboxes where workspace_id = $1', [ws]);
      for (const table of ['customers', 'documents', 'auditLogs', 'idempotencyKeys']) await db.pool.query(`delete from public."${table}" where workspace_id = $1`, [ws]);
      await db.pool.query('delete from public.workspaces where id = $1', [ws]);
      await db.pool.query('delete from public.users where id = any($1::text[])', [[owner, outsider]]);
      await db.pool.query('delete from auth.users where id = any($1::uuid[])', [[owner, outsider]]);
    }
    restoreEnv(env);
  });
  it('open, list, remember and renew credentials; outsider cannot list', async () => {
    const opened = await call('POST', root());
    assert.equal(opened.status, 201, JSON.stringify(opened));
    sandboxId = opened.json.sandbox.id; assistantToken = opened.json.assistant.token;
    const listed = await call('GET', root());
    assert.equal(listed.status, 200); assert.ok(listed.json.sandboxes.some((s: { id: string }) => s.id === sandboxId));
    const remembered = await call('GET', `${root()}/remembered`);
    assert.equal(remembered.status, 200); assert.deepEqual(remembered.json.remembered, []);
    assert.equal((await call('GET', root(), undefined, otherToken)).status, 403);
    const renewed = await person('POST', '/token');
    assert.equal(renewed.status, 200); assert.ok(renewed.json.assistant.token.startsWith('lfa_'));
    assert.equal((await person('POST', '/token', undefined, otherToken)).status, 404);
  });
  it('person can read commands and tools and calculate without changing live records', async () => {
    const commands = await person('GET', '/commands');
    assert.equal(commands.status, 200); assert.ok(commands.json.commands.some((c: { name: string }) => c.name === 'customer.create'));
    const tools = await person('GET', '/tools'); assert.equal(tools.status, 200); assert.ok(Array.isArray(tools.json.tools));
    const result = await person('POST', '/tools/calculate', { expression: '10 + 2' });
    assert.equal(result.status, 200, JSON.stringify(result)); assert.equal(result.json.cents, 1200);
    assert.equal((await person('POST', '/tools/nope', {})).status, 404);
    assert.equal((await person('GET', '/commands', undefined, otherToken)).status, 404);
  });
  it('person adds, edits, reorders and removes draft steps; assistant can read record endpoints', async () => {
    const add = (name: string) => person('POST', '/steps', { command: 'customer.create', input: { customer: { name } } });
    const first = await add('Alpha Ltd'), second = await add('Beta Ltd');
    assert.equal(first.status, 201, JSON.stringify(first)); assert.equal(second.status, 201, JSON.stringify(second));
    const [a, b] = second.json.steps.map((s: { id: string }) => s.id);
    const customerId = first.json.steps[0].preview.allocatedIds['customers:0'];
    const listed = await call('GET', `/api/v1/sandboxes/${sandboxId}/records/customers`, undefined, assistantToken);
    assert.equal(listed.status, 200, JSON.stringify(listed)); assert.equal(listed.json.records.length, 2);
    const record = await call('GET', `/api/v1/sandboxes/${sandboxId}/records/customers/${customerId}`, undefined, assistantToken);
    assert.equal(record.status, 200); assert.equal(record.json.record.name, 'Alpha Ltd');
    const edited = await person('PUT', `/steps/${a}`, { input: { customer: { name: 'Alpha revised' } }, revision: second.json.revision });
    assert.equal(edited.status, 200, JSON.stringify(edited));
    const ordered = await person('PUT', '/steps/order', { stepIds: [b, a], revision: edited.json.revision });
    assert.equal(ordered.status, 200, JSON.stringify(ordered));
    const removed = await person('DELETE', `/steps/${b}`, { revision: ordered.json.revision });
    assert.equal(removed.status, 200, JSON.stringify(removed));
    const rejected = await person('POST', '/reject', { revision: removed.json.revision });
    assert.equal(rejected.status, 200, JSON.stringify(rejected));
    assert.equal((await db.collection('customers').where('workspaceId', '==', ws).get()).size, 0);
  });
});
