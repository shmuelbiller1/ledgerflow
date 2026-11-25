/**
 * AUP-10: a failed owned-workspace lookup is an error (500), never an empty success.
 * AUP-14: billing status tells the screen whether there is a subscription and how payment stands.
 */
import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { callApi, closeServer, listenOnRandomPort, restoreEnv, signTestJwt, useLiveApiEnv } from './helpers/liveApiServer';

const enabled = Boolean(process.env.LF_TEST_DATABASE_URL);
describe('AUP-10 / AUP-14: API reads say what they know', { skip: !enabled && 'requires LF_TEST_DATABASE_URL' }, () => {
  const ws = `ws_aup10_${randomUUID()}`;
  const owner = randomUUID();
  let server: Server | undefined, env: Record<string, string | undefined> = {};
  const app = { base: '', token: '' };
  let db: Awaited<ReturnType<(typeof import('../server/db/firestore'))['getDb']>>;
  before(async () => {
    env = useLiveApiEnv('aup10-14-reads');
    const [{ getDb }, { createApp }] = await Promise.all([import('../server/db/firestore'), import('../../server')]);
    db = getDb();
    await db.pool.query("insert into auth.users (id,email,email_confirmed_at,raw_app_meta_data) values ($1::uuid,$2,now(),'{}'::jsonb)", [owner, `${owner}@example.test`]);
    await db.collection('workspaces').doc(ws).set({ uid: owner, name: 'Reads', currency: 'USD', members: [owner], roles: { [owner]: 'owner' }, stripeSubscriptionId: 'sub_test_1', paymentStatus: 'past_due', plan: 'pro' });
    app.token = await signTestJwt({ uid: owner, email: `${owner}@example.test`, aal: 'aal2', userMetadata: { email_verified: true } });
    const started = await listenOnRandomPort(await createApp());
    server = started.server;
    app.base = started.base;
  });
  after(async () => {
    await closeServer(server);
    if (db) {
      await db.pool.query('delete from public.workspaces where id = $1', [ws]);
      await db.pool.query('delete from public.users where id = $1', [owner]);
      await db.pool.query('delete from auth.users where id = $1::uuid', [owner]);
    }
    restoreEnv(env);
  });

  test('AUP-10: the owned workspaces are listed, and a database failure answers 500, not zero workspaces', async t => {
    const ok = await callApi(app.base, 'GET', '/api/v1/workspaces', { token: app.token });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.ok((ok.json as { workspaces: Array<{ id: string }> }).workspaces.some(w => w.id === ws));
    const { Query } = await import('../server/db/pgFirestore');
    const original = Query.prototype.get;
    t.mock.method(Query.prototype, 'get', function (this: InstanceType<typeof Query>, ...args: unknown[]) {
      if (JSON.stringify((this as unknown as { filters?: unknown }).filters ?? '').includes('"uid"') || String((this as unknown as { collectionId?: string }).collectionId) === 'workspaces') {
        return Promise.reject(new Error('database unavailable'));
      }
      return (original as (...a: unknown[]) => unknown).apply(this, args);
    });
    const failed = await callApi(app.base, 'GET', '/api/v1/workspaces', { token: app.token });
    assert.equal(failed.status, 500, JSON.stringify(failed.json));
    assert.equal(Object.hasOwn(failed.json as object, 'workspaces'), false, 'no empty list is reported');
  });

  test('AUP-14: billing status has hasSubscription and paymentStatus, not the subscription id', async () => {
    const res = await callApi(app.base, 'GET', `/api/v1/billing/status?workspaceId=${ws}`, { token: app.token });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const body = res.json as Record<string, unknown>;
    assert.equal(body.hasSubscription, true);
    assert.equal(body.paymentStatus, 'past_due');
    assert.equal(Object.hasOwn(body, 'stripeSubscriptionId'), false);
  });
});
