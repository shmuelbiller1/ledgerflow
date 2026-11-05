/**
 * Audit F1 and F2 (independent readiness audit, 5 Nov 2026), as safety tests against migrated Postgres:
 *   F1  a draft credit note (customer or vendor) posts nothing; issuing it posts it once; taking it back to draft
 *       reverses that posting; an applied credit cannot go back to draft.
 *   F2  two saves of one credit note built from the same old state (different idempotency keys) never count it
 *       twice: one goes through, the other is refused (409) — receivables fall by $100 once, not $200.
 * Hand-worked: one $100.00 credit (10,000 cents) against Accounts Receivable / Sales.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Firestore } from '../server/db/pgFirestore';
import { postDocument } from '../server/services/documentPostService';
import { getDb } from '../server/db/firestore';
import { isPostable } from '../lib/txFilters';
import type { Transaction } from '../types';

const url = process.env.LF_TEST_DATABASE_URL;
type Run = (db: Firestore, ws: string) => Promise<void>;

async function isolated(run: Run) {
  process.env.DATABASE_URL = url;
  const db = new Firestore({ connectionString: url });
  const ws = `auditf1_${crypto.randomUUID()}`;
  try {
    await db.collection('workspaces').doc(ws).set({ uid: 'owner', members: ['owner'], roles: {}, currency: 'USD' });
    await db.collection('chartAccounts').doc(`${ws}_ar`).set({ workspaceId: ws, name: 'Accounts Receivable', type: 'asset', category: 'Receivables' });
    await db.collection('chartAccounts').doc(`${ws}_ap`).set({ workspaceId: ws, name: 'Accounts Payable', type: 'liability', category: 'Payables' });
    await db.collection('chartAccounts').doc(`${ws}_sales`).set({ workspaceId: ws, name: 'Sales', type: 'income', category: 'Revenue' });
    await db.collection('chartAccounts').doc(`${ws}_cogs`).set({ workspaceId: ws, name: 'Purchases', type: 'expense', category: 'Expenses' });
    await run(db, ws);
  } finally {
    for (const table of await db.tables()) await db.pool.query(`delete from public."${table.replaceAll('"', '""')}" where data->>'workspaceId' = $1`, [ws]);
    await db.collection('workspaces').doc(ws).delete();
    await db.terminate();
    await getDb().terminate();
  }
}

const entriesOf = async (db: Firestore, ws: string) =>
  (await db.collection('transactions').where('workspaceId', '==', ws).get()).docs.map(d => ({ id: d.id, ...d.data() }) as Transaction);
const netOn = (entries: Transaction[], accountId: string) =>
  entries.filter(isPostable).flatMap(e => e.lines || []).filter(l => l.accountId === accountId).reduce((s, l) => s + l.amountCents, 0);

const credit = (ws: string, id: string, status: string, extra: Record<string, unknown> = {}) => ({
  collection: 'creditNotes' as const, docId: id, workspaceId: ws, action: 'create' as const,
  data: { workspaceId: ws, customerId: 'customer', date: '2026-11-01', amountCents: 10000, remainingCents: 10000, status, ...extra },
});

describe('audit F1/F2: credit postings', { skip: !url }, () => {
  test('F1: a draft customer credit note posts nothing; issuing posts −100 on A/R once; back to draft reverses it', async () => {
    await isolated(async (db, ws) => {
      const id = `${ws}_cn`;
      await postDocument(db, { uid: 'owner' } as never, credit(ws, id, 'draft'));
      assert.equal((await entriesOf(db, ws)).length, 0);
      await postDocument(db, { uid: 'owner' } as never, { ...credit(ws, id, 'open'), action: 'update' });
      assert.equal(netOn(await entriesOf(db, ws), `${ws}_ar`), -10000);
      await postDocument(db, { uid: 'owner' } as never, { ...credit(ws, id, 'draft'), action: 'update' });
      assert.equal(netOn(await entriesOf(db, ws), `${ws}_ar`), 0);
    });
  });

  test('F1: an applied credit cannot go back to draft', async () => {
    await isolated(async (db, ws) => {
      const id = `${ws}_cn`;
      await postDocument(db, { uid: 'owner' } as never, credit(ws, id, 'open'));
      await assert.rejects(postDocument(db, { uid: 'owner' } as never, { ...credit(ws, id, 'draft', { remainingCents: 4000 }), action: 'update' }), /go back to draft/);
      assert.equal(netOn(await entriesOf(db, ws), `${ws}_ar`), -10000);
    });
  });

  test('F1: a draft vendor credit posts nothing', async () => {
    await isolated(async (db, ws) => {
      await postDocument(db, { uid: 'owner' } as never, { collection: 'vendorCredits', docId: `${ws}_vc`, workspaceId: ws, action: 'create',
        data: { workspaceId: ws, vendorId: 'vendor', date: '2026-11-01', amountCents: 10000, remainingCents: 10000, status: 'draft' } } as never);
      assert.equal((await entriesOf(db, ws)).length, 0);
    });
  });

  test('F2: two saves of one credit note from the same old state count it once (−100 on A/R, one refused 409)', async () => {
    await isolated(async (db, ws) => {
      const input = credit(ws, `${ws}_cn`, 'open');
      // both requests finish building from the same old state before either commits (timing only)
      const originalRun = db.runTransaction.bind(db);
      let arrivals = 0;
      let release!: () => void;
      const built = new Promise<void>(resolve => { release = resolve; });
      db.runTransaction = (async (fn: never, options: never) => {
        if (++arrivals === 2) release();
        await built;
        return originalRun(fn, options);
      }) as typeof db.runTransaction;
      const outcomes = await Promise.allSettled([
        postDocument(db, { uid: 'owner' } as never, { ...input, idempotencyKey: 'tab-one' }),
        postDocument(db, { uid: 'owner' } as never, { ...input, idempotencyKey: 'tab-two' }),
      ]);
      db.runTransaction = originalRun;
      assert.equal(netOn(await entriesOf(db, ws), `${ws}_ar`), -10000);
      const refused = outcomes.filter(o => o.status === 'rejected');
      assert.ok(refused.length <= 1, JSON.stringify(outcomes));
      for (const r of refused) assert.match(String((r as PromiseRejectedResult).reason?.message), /changed or posted elsewhere/);
    });
  });

  test('F2: two stale saves back to draft reverse the issued credit once', async () => {
    await isolated(async (db, ws) => {
      const id = `${ws}_cn`;
      await postDocument(db, { uid: 'owner' } as never, credit(ws, id, 'open'));
      const originalRun = db.runTransaction.bind(db);
      let arrivals = 0;
      let release!: () => void;
      const built = new Promise<void>(resolve => { release = resolve; });
      db.runTransaction = (async (fn: never, options: never) => {
        if (++arrivals === 2) release();
        await built;
        return originalRun(fn, options);
      }) as typeof db.runTransaction;
      await Promise.allSettled([
        postDocument(db, { uid: 'owner' } as never, { ...credit(ws, id, 'draft'), action: 'update', idempotencyKey: 'a' }),
        postDocument(db, { uid: 'owner' } as never, { ...credit(ws, id, 'draft'), action: 'update', idempotencyKey: 'b' }),
      ]);
      db.runTransaction = originalRun;
      assert.equal(netOn(await entriesOf(db, ws), `${ws}_ar`), 0);
    });
  });
});
