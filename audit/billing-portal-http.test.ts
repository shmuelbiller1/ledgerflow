/** Local HTTP/DB portal route with synthetic users and a stubbed Stripe transport; no provider calls. */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { callApi, closeServer, listenOnRandomPort, restoreEnv, signTestJwt, useLiveApiEnv } from '../src/tests/helpers/liveApiServer';
const enabled = Boolean(process.env.LF_TEST_DATABASE_URL);
describe('billing portal via local app', { skip: !enabled && 'requires LF_TEST_DATABASE_URL' }, () => {
  const owner = randomUUID(), viewer = randomUUID(), stranger = randomUUID(), users = [owner, viewer, stranger], ws = `ws_portal_http_${randomUUID()}`;
  let db: Awaited<ReturnType<(typeof import('../src/server/db/firestore'))['getDb']>>;
  let server: Server | undefined, base = '', tokens: string[] = [], env: Record<string, string | undefined> = {};
  let stripe: ReturnType<(typeof import('../src/server/services/stripeService'))['getStripe']>;
  before(async () => {
    env = useLiveApiEnv('billing-portal-http', { STRIPE_SECRET_KEY: 'sk_test_local_only' });
    const [{ getDb }, { createApp }, stripeService] = await Promise.all([import('../src/server/db/firestore'), import('../server'), import('../src/server/services/stripeService')]);
    db = getDb(); stripe = stripeService.getStripe();
    for (const uid of users) await db.pool.query("insert into auth.users (id,email,email_confirmed_at,raw_app_meta_data) values ($1::uuid,$2,now(),'{}'::jsonb)", [uid, `${uid}@example.test`]);
    await db.collection('workspaces').doc(ws).set({ uid: owner, id: ws, name: 'Portal test', stripeCustomerId: 'cus_test_synthetic', members: [owner, viewer], roles: { [owner]: 'owner', [viewer]: 'viewer' } });
    tokens = await Promise.all(users.map(uid => signTestJwt({ uid, email: `${uid}@example.test`, aal: 'aal2', userMetadata: { email_verified: true } })));
    ({ server, base } = await listenOnRandomPort(await createApp()));
  });
  after(async () => {
    await closeServer(server);
    if (db) {
      await db.pool.query('delete from public.workspaces where id = $1', [ws]);
      await db.pool.query('delete from public.users where id = any($1::text[])', [users]);
      await db.pool.query('delete from auth.users where id = any($1::uuid[])', [users]);
    }
    restoreEnv(env);
  });
  it('owner gets stubbed portal URL; viewer, outsider and anonymous cannot open it', async t => {
    const calls: Array<{ customer?: string }> = [];
    t.mock.method(stripe.billingPortal.sessions, 'create', async params => {
      calls.push(params as { customer?: string });
      return { url: 'https://billing.example.test/session' } as never;
    });
    const path = '/api/v1/billing/portal', body = { workspaceId: ws };
    assert.equal((await callApi(base, 'POST', path, { token: tokens[1], body })).status, 403);
    assert.equal((await callApi(base, 'POST', path, { token: tokens[2], body })).status, 403);
    assert.equal((await callApi(base, 'POST', path, { body })).status, 401);
    assert.equal(calls.length, 0);
    const result = await callApi(base, 'POST', path, { token: tokens[0], body });
    assert.equal(result.status, 200, JSON.stringify(result.json));
    assert.equal((result.json as { url: string }).url, 'https://billing.example.test/session');
    assert.equal(calls.length, 1); assert.equal(calls[0].customer, 'cus_test_synthetic');
  });
});
