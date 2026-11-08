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
import { commitLedgerBulk } from '../server/services/ledgerBulkCommit';
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
  for (const collection of ['creditNotes', 'vendorCredits'] as const) {
    const party = collection === 'creditNotes' ? { customerId: 'customer' } : { vendorId: 'vendor' };
    test(`${collection}: identical issuance retries succeed, changed reasons refuse before dropping the mutation`, async () => {
      await isolated(async (db, ws) => {
        const id = `${ws}_credit`;
        const data = { ...credit(ws, id, 'open').data, ...party, reason: 'Original reason' };
        const input = { collection, docId: id, workspaceId: ws, action: 'create' as const, data };
        await postDocument(db, { uid: 'owner' } as never, input);
        const [entry] = await entriesOf(db, ws);
        const retry = { workspaceId: ws, transactions: [{ ...entry, id: `${entry.id}_retry` }], entityMutation: input };
        assert.equal((await commitLedgerBulk(db, { uid: 'owner' } as never, retry)).body.replayed, true);
        await assert.rejects(commitLedgerBulk(db, { uid: 'owner' } as never, {
          ...retry, entityMutation: { ...input, data: { ...data, reason: 'Changed reason' } },
        }), (error: { status?: number }) => error.status === 409);
        assert.equal((await db.collection(collection).doc(id).get()).data()?.reason, 'Original reason');
        assert.equal((await entriesOf(db, ws)).length, 1);
      });
    });

    test(`${collection}: a stale empty draft plan cannot undo issuance`, async () => {
      await isolated(async (db, ws) => {
        const id = `${ws}_credit`;
        const input = { collection, docId: id, workspaceId: ws, action: 'create' as const,
          data: { ...credit(ws, id, 'open').data, ...party } };
        await postDocument(db, { uid: 'owner' } as never, input);
        await assert.rejects(commitLedgerBulk(db, { uid: 'owner' } as never, {
          workspaceId: ws, transactions: [], entityMutation: { collection, docId: id, action: 'update', data: { status: 'draft' } },
        }), (error: { status?: number }) => error.status === 409);
        assert.equal((await db.collection(collection).doc(id).get()).data()?.status, 'open');
        assert.equal((await entriesOf(db, ws)).length, 1);
        await postDocument(db, { uid: 'owner' } as never, { ...input, action: 'update', data: { status: 'draft' } });
        // Once properly reversed, empty draft retries are safe.
        await commitLedgerBulk(db, { uid: 'owner' } as never, {
          workspaceId: ws, transactions: [], entityMutation: { collection, docId: id, action: 'update', data: { status: 'draft' } },
        });
        assert.equal(netOn(await entriesOf(db, ws), `${ws}_ar`), 0);
      });
    });
  }

  test('reversals: both aliases, workspace scope, nonpostable history, and repeated targets', async () => {
    await isolated(async (db, ws) => {
      await postDocument(db, { uid: 'owner' } as never, credit(ws, `${ws}_cn`, 'open'));
      const [entry] = await entriesOf(db, ws);
      const reversal = (id: string, field = 'reversesTxId') => ({ ...entry, id,
        metadata: { isReversal: true, [field]: entry.id },
        lines: entry.lines.map(line => ({ ...line, amountCents: -line.amountCents })),
      }) as Transaction;
      const commit = (transactions: Transaction[]) => commitLedgerBulk(db, { uid: 'owner' } as never, { workspaceId: ws, transactions });
      for (const field of ['reversesTxId', 'reversedTransactionId']) {
        const prior = reversal(`${ws}_prior`, field);
        await db.collection('transactions').doc(prior.id).set(prior);
        await assert.rejects(commit([reversal(`${ws}_next`)]), (error: { status?: number }) => error.status === 409);
        await db.collection('transactions').doc(prior.id).delete();
      }
      await assert.rejects(commit([reversal(`${ws}_a`), reversal(`${ws}_b`, 'reversedTransactionId')]),
        (error: { status?: number }) => error.status === 409);
      const ignored = reversal(`${ws}_ignored`, 'reversedTransactionId');
      await db.collection('transactions').doc(ignored.id).set({ ...ignored, status: 'draft' });
      const foreign = reversal(`${ws}_foreign`, 'reversedTransactionId');
      await db.collection('transactions').doc(foreign.id).set({ ...foreign, workspaceId: `${ws}_other` });
      try {
        await commit([reversal(`${ws}_valid`)]);
        assert.equal(netOn(await entriesOf(db, ws), `${ws}_ar`), 0);
      } finally {
        await db.collection('transactions').doc(foreign.id).delete();
      }
    });
  });

});
