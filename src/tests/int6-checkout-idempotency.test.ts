/**
 * INT-6: a Stripe Checkout session is opened with one idempotency key per invoice + amount still due (the public
 * pay link) and per workspace + plan + price (the subscription checkout), so a double click cannot open two payable
 * sessions. Stripe is mocked: it records every call's key and, as Stripe does, gives the same session back for a key
 * it has seen. Runs when LF_TEST_DATABASE_URL is set.
 *
 * Worked figures (cents): invoice INV-7 for 100,000, nothing paid → two clicks → 2 calls, 1 key, 1 session, each for
 * 100,000. Then 40,000 is paid → due 100,000 − 40,000 = 60,000 → a new key and a session for 60,000.
 * Subscription: Pro twice → 1 key, 1 session; Enterprise → another key; after a subscription id is recorded, Pro again
 * → another key (a new subscription, not the old session).
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { checkoutIdempotencyKey, isIdempotencyInFlight } from '../server/services/stripeService';

test('the key: the same parts give the same key, any other amount another; unsafe characters are replaced; at most 255', () => {
  assert.equal(checkoutIdempotencyKey('inv1', 100_000, 'tok'), checkoutIdempotencyKey('inv1', 100_000, 'tok'));
  assert.notEqual(checkoutIdempotencyKey('inv1', 100_000, 'tok'), checkoutIdempotencyKey('inv1', 60_000, 'tok'));
  assert.equal(checkoutIdempotencyKey('a b', 'c/d'), 'checkout_a-b_c-d');
  assert.equal(checkoutIdempotencyKey('x'.repeat(400)).length, 255);
  assert.equal(isIdempotencyInFlight({ type: 'StripeIdempotencyError' }), true);
  assert.equal(isIdempotencyInFlight(new Error('card declined')), false);
});

const url = process.env.LF_TEST_DATABASE_URL;

describe('Checkout sessions with a mocked Stripe', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_int6_${crypto.randomBytes(4).toString('hex')}`;
  const OWNER = 'owner-1';
  const invoiceId = `${ws}_inv7`;
  const token = `pay_${crypto.randomBytes(12).toString('hex')}`;
  const calls: Array<{ params: Record<string, any>; key?: string }> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const sessions = new Map<string, string>();
  let server: Server;
  let base = '';
  let db: import('../server/db/pgFirestore').Firestore;
  const saved = { key: process.env.STRIPE_SECRET_KEY, app: process.env.APP_URL };
  const post = async (path: string, body: unknown = {}) => {
    const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() as Record<string, string> };
  };

  before(async () => {
    process.env.DATABASE_URL = url;
    process.env.STRIPE_SECRET_KEY = 'sk_test_int6_mock';
    process.env.APP_URL = 'https://books.example.test';
    const { getStripe } = await import('../server/services/stripeService');
    const stripe = getStripe();
    // the mock: records the key; a key it has seen gets the same session back (Stripe's idempotency)
    (stripe.checkout.sessions as unknown as { create: unknown }).create = async (params: Record<string, unknown>, options?: { idempotencyKey?: string }) => {
      calls.push({ params, key: options?.idempotencyKey });
      const k = options?.idempotencyKey || crypto.randomUUID();
      if (!sessions.has(k)) sessions.set(k, `cs_test_${sessions.size + 1}`);
      return { id: sessions.get(k), url: `https://checkout.stripe.test/${sessions.get(k)}` };
    };
    const express = (await import('express')).default;
    const { publicInvoiceRouter } = await import('../server/routes/publicInvoiceRoutes');
    const { billingRouter } = await import('../server/routes/billingRoutes');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({ uid: OWNER, name: 'Pay links', currency: 'USD', members: [OWNER] });
    await db.collection('invoices').doc(invoiceId).set({
      workspaceId: ws, uid: OWNER, number: 'INV-7', customerName: 'Tenant', status: 'sent', currency: 'USD', paymentToken: token,
      amountCents: 100_000, amountPaidCents: 0, date: '2026-10-01', dueDate: '2026-10-31',
    });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string; email: string } }).user = { uid: OWNER, email: 'owner@pay.test' }; next(); });
    app.use('/api/v1/invoices/public', publicInvoiceRouter);
    app.use('/api/v1/billing', billingRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    process.env.STRIPE_SECRET_KEY = saved.key;
    process.env.APP_URL = saved.app;
    for (const table of ['invoices', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]).catch(() => {});
    }
    const { getSupabase } = await import('../lib/db/client');
    getSupabase().realtime.disconnect();
    await getSupabase().auth.dispose();
    await db.terminate();
  });

  test('a double click on the pay link: one key, one session for 100,000; after 40,000 paid, a new key for 60,000', async () => {
    const [first, second] = await Promise.all([post(`/api/v1/invoices/public/${token}/pay`), post(`/api/v1/invoices/public/${token}/pay`)]);
    assert.deepEqual([first.status, second.status], [200, 200]);
    assert.equal(first.body.url, second.body.url, 'the same session both times');
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map(c => c.key), [checkoutIdempotencyKey(invoiceId, 100_000, token.slice(-16)), checkoutIdempotencyKey(invoiceId, 100_000, token.slice(-16))]);
    assert.deepEqual(calls.map(c => c.params.line_items[0].price_data.unit_amount), [100_000, 100_000]);

    await db.collection('invoices').doc(invoiceId).update({ amountPaidCents: 40_000, status: 'sent' });
    const third = await post(`/api/v1/invoices/public/${token}/pay`);
    assert.equal(third.status, 200);
    assert.notEqual(third.body.url, first.body.url);
    assert.equal(calls[2].key, checkoutIdempotencyKey(invoiceId, 60_000, token.slice(-16)), '100,000 − 40,000');
    assert.equal(calls[2].params.line_items[0].price_data.unit_amount, 60_000);
  });

  test('the subscription checkout: Pro twice is one key and one session; Enterprise or a new subscription is another', async () => {
    calls.length = 0;
    const a = await post('/api/v1/billing/checkout', { workspaceId: ws, plan: 'pro' });
    const b = await post('/api/v1/billing/checkout', { workspaceId: ws, plan: 'pro' });
    assert.deepEqual([a.status, b.status], [200, 200], JSON.stringify(a.body));
    assert.equal(a.body.url, b.body.url);
    assert.ok(calls[0].key?.startsWith(`checkout_subscription_${ws}_pro_`), calls[0].key);
    assert.equal(calls[0].key, calls[1].key);
    const enterprise = await post('/api/v1/billing/checkout', { workspaceId: ws, plan: 'enterprise' });
    assert.equal(enterprise.status, 200, JSON.stringify(enterprise.body));
    assert.notEqual(calls[2].key, calls[0].key);
    await db.collection('workspaces').doc(ws).update({ stripeSubscriptionId: 'sub_old' });
    await post('/api/v1/billing/checkout', { workspaceId: ws, plan: 'pro' });
    assert.notEqual(calls[3].key, calls[0].key);
    assert.match(String(calls[3].key), /_sub_old$/);
  });
});
