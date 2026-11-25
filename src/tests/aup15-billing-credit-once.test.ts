/**
 * AUP-15: a paid checkout session grants its plan credits once, whether the webhook or verify-session arrives
 * first, or both at once. Isolated PostgreSQL only; Stripe retrieval is mocked.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import type { Firestore } from '../server/db/pgFirestore';

const dbUrl = process.env.LF_TEST_DATABASE_URL;
const parsed = dbUrl ? new URL(dbUrl) : null;
if (parsed && !['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) throw new Error('This probe requires an isolated local database.');
const run = randomUUID().replaceAll('-', '');
const uid = `probe-owner-${run}`;
const first = `probe-billing-webhook-first-${run}`;
const second = `probe-billing-verify-first-${run}`;
const third = `probe-billing-together-${run}`;
const secret = 'whsec_local_probe_only';
let db: Firestore;
let server: Server;
let origin = '';
let stripe: ReturnType<typeof import('../server/services/stripeService').getStripe>;
const sessionFor = (workspaceId: string) => ({ id: `cs_test_${workspaceId}`, mode: 'subscription', payment_status: 'paid', metadata: { workspaceId, plan: 'pro' }, customer: `cus_${workspaceId}`, subscription: `sub_${workspaceId}` });

before(async () => {
  if (!dbUrl) return;
  process.env.DATABASE_URL = dbUrl;
  process.env.STRIPE_SECRET_KEY = 'sk_test_local_probe_only';
  process.env.STRIPE_WEBHOOK_SECRET = secret;
  const { getDb } = await import('../server/db/firestore');
  const { getStripe } = await import('../server/services/stripeService');
  const { billingRouter } = await import('../server/routes/billingRoutes');
  const { registerStripeWebhookRoutes } = await import('../server/routes/stripeWebhookRoutes');
  db = getDb();
  stripe = getStripe();
  for (const id of [first, second, third]) await db.collection('workspaces').doc(id).set({ uid, name: 'Isolated billing probe', members: [uid], roles: { [uid]: 'owner' }, computeCreditBalance: 0, paymentStatus: 'past_due' });
  const app = express();
  registerStripeWebhookRoutes(app, {} as never);
  app.use(express.json());
  app.use((req, _res, next) => { (req as unknown as { user: { uid: string } }).user = { uid }; next(); });
  app.use('/api/v1/billing', billingRouter);
  await new Promise<void>((resolve, reject) => { server = app.listen(0, '127.0.0.1', e => e ? reject(e) : resolve()); });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  if (!dbUrl) return;
  if (server) await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
  if (db) {
    for (const table of ['stripeProcessedEvents', 'auditLogs', 'workspaces']) await db.pool.query(`delete from public."${table}" where workspace_id = any($1) or id = any($1)`, [[first, second, third]]);
    await db.terminate();
  }
});

test('the credits are granted once in either order and when both arrive together', { skip: !dbUrl && 'LF_TEST_DATABASE_URL required' }, async t => {
  t.mock.method(stripe.checkout.sessions, 'retrieve', async (id: string) => sessionFor(id.replace('cs_test_', '')) as never);
  const webhook = async (workspaceId: string) => {
    const event = JSON.stringify({ id: `evt_test_${workspaceId}`, type: 'checkout.session.completed', data: { object: sessionFor(workspaceId) } });
    const signature = stripe.webhooks.generateTestHeaderString({ payload: event, secret });
    return fetch(`${origin}/api/webhook/stripe`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': signature }, body: event });
  };
  const verify = (workspaceId: string) => fetch(`${origin}/api/v1/billing/verify-session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId, session_id: `cs_test_${workspaceId}` }) });
  assert.equal((await webhook(first)).status, 200);
  assert.equal((await verify(first)).status, 200);
  assert.equal((await verify(second)).status, 200);
  assert.equal((await webhook(second)).status, 200);
  const [a, b] = await Promise.all([webhook(third), verify(third)]);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  const credit = async (id: string) => (await db.collection('workspaces').doc(id).get()).data()?.computeCreditBalance;
  assert.equal(await credit(first), 1_000_000, 'webhook first, then verify: granted once');
  assert.equal(await credit(second), 1_000_000, 'verify first, then webhook: granted once');
  assert.equal(await credit(third), 1_000_000, 'both together: granted once');
  // a replay of either path changes nothing
  assert.equal((await webhook(first)).status, 200);
  assert.equal((await verify(second)).status, 200);
  assert.equal(await credit(first), 1_000_000);
  assert.equal(await credit(second), 1_000_000);
});
