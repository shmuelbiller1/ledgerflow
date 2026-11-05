/**
 * Audit F4 and F5 (independent readiness audit, 5 Nov 2026), as safety tests against migrated Postgres:
 *   F5  the payment route refuses a payment date that is not a real calendar day ('not-a-date', 2026-02-30, a
 *       timestamp) with 400 and writes nothing; a leap day (2028-02-29) is accepted.
 *   F4  a person demoted to viewer after the route's check cannot still post: the save itself reads their role and
 *       refuses, writing nothing; the system actor of online payments still posts.
 * Hand-worked: one $1.00 payment (100 cents) Cash / Accounts Receivable.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Firestore } from '../server/db/pgFirestore';
import { handleCreatePayment } from '../server/routes/paymentRoutes';
import { createPaymentAtomic } from '../server/services/paymentService';

const url = process.env.LF_TEST_DATABASE_URL;

async function isolated(run: (db: Firestore, ws: string) => Promise<void>) {
  const db = new Firestore({ connectionString: url });
  const ws = `auditf5_${crypto.randomUUID()}`;
  try {
    await db.collection('workspaces').doc(ws).set({ uid: 'owner', members: ['owner', 'actor'], roles: { actor: 'bookkeeper' }, currency: 'USD' });
    await db.collection('chartAccounts').doc(`${ws}_cash`).set({ workspaceId: ws, name: 'Cash', type: 'asset', category: 'Cash' });
    await db.collection('chartAccounts').doc(`${ws}_ar`).set({ workspaceId: ws, name: 'Accounts Receivable', type: 'asset', category: 'Receivables' });
    await run(db, ws);
  } finally {
    for (const table of await db.tables()) await db.pool.query(`delete from public."${table.replaceAll('"', '""')}" where data->>'workspaceId' = $1`, [ws]);
    await db.collection('workspaces').doc(ws).delete();
    await db.terminate();
  }
}

const payment = (ws: string, extra: Record<string, unknown> = {}) => ({
  workspaceId: ws, amountCents: 100, cashAccountId: `${ws}_cash`, offsetAccountId: `${ws}_ar`, customerId: 'customer', allocations: [], ...extra,
});
const count = async (db: Firestore, collection: string, ws: string) => (await db.collection(collection).where('workspaceId', '==', ws).get()).size;

async function post(db: Firestore, body: Record<string, unknown>, user = { uid: 'actor', admin: false }, headers = {}) {
  let status = 200;
  let response: unknown;
  const res = { status(n: number) { status = n; return this; }, json(b: unknown) { response = b; return b; } };
  await handleCreatePayment({ body, headers, user } as never, res as never, db as never);
  return { status, response };
}

describe('audit F4/F5: payments', { skip: !url }, () => {
  for (const bad of ['not-a-date', '2026-02-30', '2026-13-01', '2026-11-01T10:00:00Z']) {
    test(`F5: payment date ${bad} is refused with 400 and nothing is written`, async () => {
      await isolated(async (db, ws) => {
        const { status } = await post(db, payment(ws, { paymentDate: bad }));
        assert.equal(status, 400);
        assert.equal(await count(db, 'transactions', ws), 0);
        assert.equal(await count(db, 'payments', ws), 0);
      });
    });
  }

  test('F5: a leap day is a real date and posts', async () => {
    await isolated(async (db, ws) => {
      const { status, response } = await post(db, payment(ws, { paymentDate: '2028-02-29' }));
      assert.equal(status, 200, JSON.stringify(response));
      assert.equal(await count(db, 'transactions', ws), 1);
    });
  });

  for (const idempotent of [false, true]) {
    test(`F4: platform admin without workspace membership posts${idempotent ? ' idempotently' : ''}`, async () => {
      await isolated(async (db, ws) => {
        const body = payment(ws, { paymentDate: '2026-11-01' });
        const user = { uid: 'platform-admin', admin: true };
        const headers = idempotent ? { 'idempotency-key': 'admin-payment' } : {};
        const result = await post(db, body, user, headers);
        assert.equal(result.status, 200, JSON.stringify(result.response));
        if (idempotent) {
          const replay = await post(db, body, user, headers);
          assert.equal(replay.status, 200, JSON.stringify(replay.response));
          assert.equal((replay.response as { data: { replayed: boolean } }).data.replayed, true);
        }
        assert.equal(await count(db, 'payments', ws), 1);
        assert.equal(await count(db, 'transactions', ws), 1);
      });
    });
  }

  test('F4: payment body cannot authorize a viewer as platform admin', async () => {
    await isolated(async (db, ws) => {
      await db.collection('workspaces').doc(ws).update({ roles: { actor: 'viewer' } });
      const body = payment(ws, { paymentDate: '2026-11-01', admin: true, platformAdmin: true, authorization: { platformAdmin: true } });
      assert.equal((await post(db, body)).status, 403);
      await assert.rejects(createPaymentAtomic(db, { ...body, uid: 'actor' } as never), /Forbidden/);
      assert.equal(await count(db, 'payments', ws), 0);
      assert.equal(await count(db, 'transactions', ws), 0);
    });
  });

  test('F4: a person demoted to viewer after the route check cannot post; nothing is written', async () => {
    await isolated(async (db, ws) => {
      await db.collection('workspaces').doc(ws).update({ roles: { actor: 'viewer' } });
      await assert.rejects(createPaymentAtomic(db, { ...payment(ws), uid: 'actor', paymentDate: '2026-11-01' } as never), /Forbidden/);
      assert.equal(await count(db, 'transactions', ws), 0);
      assert.equal(await count(db, 'payments', ws), 0);
    });
  });

  test('F4: a bookkeeper still posts, and so does the system actor of online payments', async () => {
    await isolated(async (db, ws) => {
      await createPaymentAtomic(db, { ...payment(ws), uid: 'actor', paymentDate: '2026-11-01' } as never);
      await createPaymentAtomic(db, { ...payment(ws), uid: 'system', paymentDate: '2026-11-01' } as never);
      assert.equal(await count(db, 'transactions', ws), 2);
    });
  });
});
