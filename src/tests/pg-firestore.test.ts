/**
 * The server's Firestore-compatible layer on Postgres (src/server/db/pgFirestore.ts),
 * run against a real database with the supabase/migrations applied.
 * Runs when LF_TEST_DATABASE_URL is set (CI's Postgres service, or a local database);
 * skipped otherwise.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { FieldValue, Firestore, FirestoreError, Timestamp } from '../server/db/pgFirestore';
import type { DocumentSnapshot } from '../server/db/pgFirestore';

const url = process.env.LF_TEST_DATABASE_URL;
const ws = `ws_pgtest_${crypto.randomBytes(4).toString('hex')}`;

function errorCode(err: unknown): number | undefined {
  return err instanceof FirestoreError ? err.code : undefined;
}

describe('Postgres Firestore layer', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  let db: Firestore;

  before(() => {
    db = new Firestore({ connectionString: url, max: 8 });
  });

  after(async () => {
    for (const table of ['documents', 'transactions', 'idempotencyKeys', 'workspaceShards']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id like $2`, [ws, `${ws}%`]);
    }
    await db.terminate();
  });

  test('set / get round trip; exists is a property; data() is a fresh copy', async () => {
    const ref = db.collection('documents').doc(`${ws}_a`);
    await ref.set({ workspaceId: ws, name: 'Alpha', nested: { n: 1 }, skip: undefined });
    const snap = await ref.get();
    assert.equal(snap.exists, true);
    assert.equal(snap.id, `${ws}_a`);
    assert.deepEqual(snap.data(), { workspaceId: ws, name: 'Alpha', nested: { n: 1 } });
    const copy = snap.data()!;
    copy.name = 'changed';
    assert.equal(snap.data()!.name, 'Alpha');
    assert.equal(snap.get('nested.n'), 1);
    assert.ok(snap.createTime instanceof Timestamp);

    const missing = await db.collection('documents').doc(`${ws}_missing`).get();
    assert.equal(missing.exists, false);
    assert.equal(missing.data(), undefined);
  });

  test('set replaces; set with merge merges nested maps and applies transforms', async () => {
    const ref = db.collection('documents').doc(`${ws}_b`);
    await ref.set({ workspaceId: ws, a: 1, meta: { x: 1, y: 2 }, list: [1, 2] });
    await ref.set({ workspaceId: ws, meta: { y: 3, z: 4 }, count: FieldValue.increment(2), list: [9] }, { merge: true });
    assert.deepEqual((await ref.get()).data(), { workspaceId: ws, a: 1, meta: { x: 1, y: 3, z: 4 }, count: 2, list: [9] });

    await ref.set({ workspaceId: ws, only: true });
    assert.deepEqual((await ref.get()).data(), { workspaceId: ws, only: true });
  });

  test('concurrent merge creates atomically apply every increment', async () => {
    const ref = db.collection('workspaceShards').doc(`${ws}_merge_counter`);
    await Promise.all(Array.from({ length: 6 }, () => ref.set({ workspaceId: ws, value: FieldValue.increment(1) }, { merge: true })));
    assert.equal((await ref.get()).data()!.value, 6);
  });

  test('update: dotted paths, increment, arrayUnion / arrayRemove, delete; missing doc → NOT_FOUND', async () => {
    const ref = db.collection('documents').doc(`${ws}_c`);
    await ref.set({ workspaceId: ws, stats: { views: 1, other: 'keep' }, tags: ['a', 'b'], gone: 'x' });
    await ref.update({
      'stats.views': FieldValue.increment(4),
      tags: FieldValue.arrayUnion('b', 'c'),
      gone: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    let data = (await ref.get()).data()!;
    assert.deepEqual(data.stats, { views: 5, other: 'keep' });
    assert.deepEqual(data.tags, ['a', 'b', 'c']);
    assert.equal('gone' in data, false);
    assert.match(data.updatedAt, /^\d{4}-\d{2}-\d{2}T/);

    await ref.update('tags', FieldValue.arrayRemove('a'), 'stats', { views: 0 });
    data = (await ref.get()).data()!;
    assert.deepEqual(data.tags, ['b', 'c']);
    assert.deepEqual(data.stats, { views: 0 });

    await assert.rejects(db.collection('documents').doc(`${ws}_nope`).update({ a: 1 }), (err: unknown) => {
      assert.equal(errorCode(err), 5);
      assert.match(String(err), /NOT_FOUND/);
      return true;
    });
  });

  test('create fails with ALREADY_EXISTS; delete of a missing doc succeeds unless exists is required', async () => {
    const ref = db.collection('documents').doc(`${ws}_d`);
    await ref.create({ workspaceId: ws, v: 1 });
    await assert.rejects(ref.create({ workspaceId: ws, v: 2 }), (err: unknown) => errorCode(err) === 6);
    assert.equal((await ref.get()).data()!.v, 1);

    await ref.delete();
    await ref.delete();
    await assert.rejects(ref.delete({ exists: true }), (err: unknown) => errorCode(err) === 5);
  });

  test('NUL characters are dropped instead of failing the write', async () => {
    const ref = db.collection('documents').doc(`${ws}_nul`);
    await ref.set({ workspaceId: ws, memo: 'a\u0000b', ['k\u0000ey']: 1 });
    assert.deepEqual((await ref.get()).data(), { workspaceId: ws, memo: 'ab', key: 1 });
  });

  test('Dates and Timestamps are stored as ISO strings', async () => {
    const ref = db.collection('documents').doc(`${ws}_e`);
    const when = new Date('2026-03-04T05:06:07.000Z');
    await ref.set({ workspaceId: ws, at: when, ts: Timestamp.fromMillis(when.getTime()), list: [when] });
    const data = (await ref.get()).data()!;
    assert.equal(data.at, '2026-03-04T05:06:07.000Z');
    assert.equal(data.ts, '2026-03-04T05:06:07.000Z');
    assert.deepEqual(data.list, ['2026-03-04T05:06:07.000Z']);
  });

  test('queries: filters, order (missing fields left out), limit, cursors, count', async () => {
    const batch = db.batch();
    const rows = [
      { id: 't1', date: '2026-01-05', status: 'posted', amount: 10, tags: ['x'], lines: [{ accountId: 'query-debit', amountCents: 0 }, { accountId: 'query-credit', amountCents: 0 }] },
      { id: 't2', date: '2026-01-05', status: 'draft', amount: 20, tags: ['y'], lines: [] },
      { id: 't3', date: '2026-02-01', status: 'posted', amount: 5, tags: ['x', 'y'], lines: [{ accountId: 'query-debit', amountCents: 1 }, { accountId: 'query-credit', amountCents: -1 }] },
      { id: 't4', date: '2026-03-10', status: 'void', amount: 7, tags: [], lines: [] },
      { id: 't5', status: 'posted', amount: 1, tags: [], lines: [{ accountId: 'query-debit', amountCents: 0 }, { accountId: 'query-credit', amountCents: 0 }] },
    ];
    for (const r of rows) {
      const { id, ...rest } = r;
      batch.set(db.collection('transactions').doc(`${ws}_${id}`), { workspaceId: ws, ...rest });
    }
    await batch.commit();
    const base = db.collection('transactions').where('workspaceId', '==', ws);
    const ids = (docs: DocumentSnapshot[]) => docs.map(d => d.id.replace(`${ws}_`, ''));

    assert.deepEqual(ids((await base.where('status', '==', 'posted').get()).docs), ['t1', 't3', 't5']);
    assert.deepEqual(ids((await base.where('status', 'in', ['draft', 'void']).get()).docs), ['t2', 't4']);
    assert.deepEqual(ids((await base.where('date', '>=', '2026-01-06').where('date', '<=', '2026-02-28').get()).docs), ['t3']);
    assert.deepEqual(ids((await base.where('amount', '>', 6).get()).docs), ['t1', 't2', 't4']);
    assert.deepEqual(ids((await base.where('tags', 'array-contains', 'y').get()).docs), ['t2', 't3']);
    assert.deepEqual(ids((await base.where('tags', 'array-contains-any', ['x', 'q']).get()).docs), ['t1', 't3']);
    assert.deepEqual(ids((await base.where('status', '!=', 'posted').get()).docs), ['t2', 't4']);

    const byDate = base.orderBy('date', 'desc').orderBy('__name__', 'desc');
    const all = await byDate.get();
    assert.deepEqual(ids(all.docs), ['t4', 't3', 't2', 't1']);

    const page1 = await byDate.limit(2).get();
    assert.deepEqual(ids(page1.docs), ['t4', 't3']);
    const page2 = await byDate.startAfter(page1.docs[1]).limit(2).get();
    assert.deepEqual(ids(page2.docs), ['t2', 't1']);
    const page3 = await byDate.startAfter(page2.docs[1]).limit(2).get();
    assert.equal(page3.empty, true);

    assert.deepEqual(ids((await base.orderBy('date').startAt('2026-02-01').get()).docs), ['t3', 't4']);
    assert.deepEqual(ids((await base.orderBy('date').endBefore('2026-02-01').get()).docs), ['t1', 't2']);
    assert.deepEqual(ids((await base.orderBy('amount').offset(1).limit(2).get()).docs), ['t3', 't4']);

    assert.equal((await base.count().get()).data().count, 5);
    assert.equal((await base.where('status', '==', 'posted').limit(2).count().get()).data().count, 2);
    assert.deepEqual(ids((await db.collectionGroup('transactions').where('workspaceId', '==', ws).where('amount', '==', 5).get()).docs), ['t3']);
  });

  test('stream() pages through large results', async () => {
    const total = 2150;
    for (let start = 0; start < total; start += 500) {
      const batch = db.batch();
      for (let i = start; i < Math.min(total, start + 500); i++) {
        batch.set(db.collection('documents').doc(`${ws}_s${String(i).padStart(5, '0')}`), { workspaceId: ws, kind: 'stream', i });
      }
      await batch.commit();
    }
    const seen: number[] = [];
    for await (const doc of db.collection('documents').where('workspaceId', '==', ws).where('kind', '==', 'stream').stream()) {
      seen.push((doc as DocumentSnapshot).data()!.i);
    }
    assert.equal(seen.length, total);
    assert.equal(new Set(seen).size, total);
  });

  test('getAll keeps order and reports missing documents', async () => {
    const a = db.collection('documents').doc(`${ws}_ga`);
    await a.set({ workspaceId: ws, v: 'a' });
    const missing = db.collection('documents').doc(`${ws}_gmissing`);
    const snaps = await db.getAll(missing, a, a);
    assert.deepEqual(snaps.map(s => s.exists), [false, true, true]);
    assert.equal(snaps[1].data()!.v, 'a');
  });

  test('a batch is all-or-nothing', async () => {
    const ok = db.collection('documents').doc(`${ws}_batch_ok`);
    const batch = db.batch()
      .set(ok, { workspaceId: ws, v: 1 })
      .update(db.collection('documents').doc(`${ws}_batch_missing`), { v: 2 });
    await assert.rejects(batch.commit(), (err: unknown) => errorCode(err) === 5);
    assert.equal((await ok.get()).exists, false);
  });

  test('transactions: return values, app errors pass through unchanged, failed writes roll back', async () => {
    const ref = db.collection('documents').doc(`${ws}_tx`);
    const value = await db.runTransaction(async t => {
      const snap = await t.get(ref);
      t.set(ref, { workspaceId: ws, n: snap.exists ? 1 : 0 });
      return 'done';
    });
    assert.equal(value, 'done');

    const appError = Object.assign(new Error('Occurrence already generated'), { status: 409 });
    await assert.rejects(db.runTransaction(async () => { throw appError; }), (err: unknown) => err === appError);

    await assert.rejects(db.runTransaction(async t => {
      await t.get(ref);
      t.update(ref, { n: 5 });
      t.update(db.collection('documents').doc(`${ws}_tx_missing`), { n: 1 });
    }), (err: unknown) => errorCode(err) === 5);
    assert.equal((await ref.get()).data()!.n, 0);

    await assert.rejects(db.runTransaction(async t => {
      t.set(ref, { workspaceId: ws, n: 9 });
      await t.get(ref);
    }), /reads to be executed before all writes/);
  });

  test('transactions are serializable: concurrent read-modify-write never loses an update', async () => {
    const ref = db.collection('workspaceShards').doc(`${ws}_counter`);
    await ref.set({ workspaceId: ws, value: 0 });
    await Promise.all(Array.from({ length: 6 }, () => db.runTransaction(async t => {
      const snap = await t.get(ref);
      t.set(ref, { workspaceId: ws, value: (snap.data()?.value || 0) + 1 });
    }, { maxAttempts: 30 })));
    assert.equal((await ref.get()).data()!.value, 6);
  });

  test('read-then-create of the same key runs once, like an idempotency check', async () => {
    const key = db.collection('idempotencyKeys').doc(`${ws}_op1`);
    let executions = 0;
    const results = await Promise.all(Array.from({ length: 4 }, () => db.runTransaction(async t => {
      const snap = await t.get(key);
      if (snap.exists) return snap.data()!.result as string;
      executions++;
      t.set(key, { workspaceId: ws, result: 'first' });
      return 'first';
    }, { maxAttempts: 30 })));
    assert.deepEqual(results, ['first', 'first', 'first', 'first']);
    const stored = await key.get();
    assert.equal(stored.data()!.result, 'first');
    assert.ok(executions >= 1);
  });

  test('a failed statement caught inside the callback still fails the transaction', async () => {
    const ref = db.collection('documents').doc(`${ws}_swallow`);
    await assert.rejects(db.runTransaction(async t => {
      try {
        // Postgres refuses text with a NUL character, so this read fails in the database.
        await t.get(db.collection('documents').doc(`${ws}_\u0000`));
      } catch {
        // ignored by the callback
      }
      t.set(ref, { workspaceId: ws, v: 1 });
    }));
    assert.equal((await ref.get()).exists, false);
  });

  test('unknown collections: reads are empty, writes are refused', async () => {
    const snap = await db.collection('noSuchCollection').where('workspaceId', '==', ws).get();
    assert.equal(snap.empty, true);
    assert.equal((await db.collection('noSuchCollection').doc('x').get()).exists, false);
    await assert.rejects(db.collection('noSuchCollection').doc('x').set({ a: 1 }), (err: unknown) => errorCode(err) === 3);
    assert.throws(() => db.collection('a/b/c'), (err: unknown) => errorCode(err) === 3);
  });

  test('server writes skip the browser rules (long ids, fields outside the allowed lists)', async () => {
    const longId = `${ws}_${'k'.repeat(200)}`;
    const ref = db.collection('idempotencyKeys').doc(longId);
    await ref.set({ workspaceId: ws, anything: { goes: true } });
    assert.equal((await ref.get()).exists, true);
  });
});
