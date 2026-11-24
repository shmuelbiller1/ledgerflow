/** Fault-injection probe of current billing behavior. Isolated PostgreSQL only; Stripe retrieval is mocked. */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import type { Firestore } from '../src/server/db/pgFirestore';

const dbUrl = process.env.LF_TEST_DATABASE_URL;
const parsed = dbUrl ? new URL(dbUrl) : null;
if (parsed && !['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) throw new Error('This probe requires an isolated local database.');
const run = randomUUID().replaceAll('-', '');
const uid = `probe-owner-${run}`;
const first = `probe-billing-webhook-first-${run}`;
const second = `probe-billing-verify-first-${run}`;
const secret = 'whsec_local_probe_only';
let db: Firestore;
let server: Server;
let origin = '';
let stripe: ReturnType<typeof import('../src/server/services/stripeService').getStripe>;
const sessionFor = (workspaceId: string) => ({ id: `cs_test_${workspaceId}`, mode: 'subscription', payment_status: 'paid', metadata: { workspaceId, plan: 'pro' }, customer: `cus_${workspaceId}`, subscription: `sub_${workspaceId}` });

before(async () => {
  if (!dbUrl) return;
  process.env.DATABASE_URL = dbUrl;
  process.env.STRIPE_SECRET_KEY = 'sk_test_local_probe_only';
  process.env.STRIPE_WEBHOOK_SECRET = secret;
  const { getDb } = await import('../src/server/db/firestore');
  const { getStripe } = await import('../src/server/services/stripeService');
  const { billingRouter } = await import('../src/server/routes/billingRoutes');
  const { registerStripeWebhookRoutes } = await import('../src/server/routes/stripeWebhookRoutes');
  db = getDb();
  stripe = getStripe();
  for (const id of [first, second]) await db.collection('workspaces').doc(id).set({ uid, name: 'Isolated billing probe', members: [uid], roles: { [uid]: 'owner' }, computeCreditBalance: 0, paymentStatus: 'past_due' });
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
    for (const table of ['stripeProcessedEvents', 'auditLogs', 'workspaces']) await db.pool.query(`delete from public."${table}" where workspace_id = any($1) or id = any($1)`, [[first, second]]);
    await db.terminate();
  }
});

test('webhook-first and verify-first produce different credit balances for the same paid session', { skip: !dbUrl && 'LF_TEST_DATABASE_URL required' }, async t => {
  t.mock.method(stripe.checkout.sessions, 'retrieve', async (id: string) => sessionFor(id === `cs_test_${first}` ? first : second) as never);
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
  const credit = async (id: string) => (await db.collection('workspaces').doc(id).get()).data()?.computeCreditBalance;
  assert.equal(await credit(first), 2_000_000, 'observed duplicate credit when webhook arrives first');
  assert.equal(await credit(second), 1_000_000, 'verification first does not duplicate in this serial run');
  const stored = (await db.collection('workspaces').doc(first).get()).data();
  assert.equal(stored?.stripeSubscriptionId, `sub_${first}`);
  assert.equal(stored?.paymentStatus, 'past_due');
  const status = await fetch(`${origin}/api/v1/billing/status?workspaceId=${first}`);
  assert.equal(status.status, 200);
  const statusBody = await status.json() as Record<string, unknown>;
  assert.equal(Object.hasOwn(statusBody, 'stripeSubscriptionId'), false, 'status omits the subscription field the UI uses for the portal button');
  assert.equal(Object.hasOwn(statusBody, 'paymentStatus'), false, 'status omits the payment field the UI tries to read');
});
