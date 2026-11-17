import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test, { after, before, describe } from 'node:test';
import { FieldValue, Firestore, FirestoreError, getDb } from '../server/db/firestore';
import { seedSandbox } from './helpers/sandbox';

const url = process.env.LF_TEST_DATABASE_URL;
const hasCode = (code: number) => (err: unknown) => err instanceof FirestoreError && err.code === code;

describe('SBX-1 database handle', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `sbx-${randomUUID()}`;
  const otherWs = `${ws}-other`;
  const id = (suffix: string) => `${ws}-${suffix}`;
  let real: Firestore;
  let draft: Firestore;
  let other: Firestore;
  let sandboxId: string;

  before(async () => {
    process.env.DATABASE_URL = url;
    real = getDb();
    await real.collection('workspaces').doc(ws).set({ uid: 'owner', name: 'Live books' });
    await real.collection('workspaces').doc(otherWs).set({ uid: 'other-owner', name: 'Other books' });
    sandboxId = await seedSandbox(real, ws);
    draft = getDb({ sandboxId });
    other = getDb({ sandboxId: await seedSandbox(real, ws, 'another-person') });
  });

  after(async () => {
    await real.pool.query('delete from sandbox.sandboxes where workspace_id = $1', [ws]);
    for (const table of ['transactions', 'journalEntries', 'periodBalances', 'customers', 'chartAccounts', 'documents', 'rateLimitEntries', 'workspaces']) {
      await real.pool.query(`delete from public."${table}" where workspace_id = any($1::text[]) or id = any($1::text[])`, [[ws, otherWs]]);
    }
    await real.terminate();
  });

  test('untouched rows read live; writes, updates and tombstones belong only to that sandbox', async () => {
    const path = `customers/${id('customer')}`;
    const live = real.doc(path);
    const edited = draft.doc(path);
    const newPath = `customers/${id('new')}`;
    assert.equal((await edited.get()).exists, false);
    await live.create({ workspaceId: ws, name: 'Real customer', stats: { orders: 1 }, tags: ['one'] });
    assert.deepEqual((await edited.get()).data(), (await live.get()).data());
    await live.update({ name: 'Renamed on the books' });
    assert.equal((await edited.get()).data()?.name, 'Renamed on the books');

    const original = (await live.get()).data();
    await edited.set({ stats: { orders: FieldValue.increment(1) } }, { merge: true });
    await edited.update('name', 'Sandbox name', 'tags', FieldValue.arrayUnion('two'));
    await draft.doc(newPath).create({ workspaceId: ws, name: 'Proposed customer' });
    assert.deepEqual((await getDb({ sandboxId }).doc(path).get()).data(), {
      workspaceId: ws, name: 'Sandbox name', stats: { orders: 2 }, tags: ['one', 'two'],
    }, 'a new handle sees committed sandbox data');
    await assert.rejects(edited.create({ workspaceId: ws }), hasCode(6));
    assert.equal((await real.doc(newPath).get()).exists, false);
    assert.equal((await other.doc(newPath).get()).exists, false);
    assert.deepEqual((await live.get()).data(), original);
    assert.deepEqual((await other.doc(path).get()).data(), original);
    await edited.delete();
    assert.equal((await edited.get()).exists, false);
    assert.equal((await other.doc(path).get()).exists, true);
    await assert.rejects(edited.delete({ exists: true }), hasCode(5));
    await assert.rejects(edited.update({ name: 'Missing' }), hasCode(5));
    await edited.create({ workspaceId: ws, name: 'Recreated' });
    assert.equal((await edited.get()).data()?.name, 'Recreated');
  });

  test('merged filters, order, cursors, limit and count do not count shadowed or foreign base rows', async () => {
    const add = (suffix: string, rank: number, workspaceId = ws) => real.doc(`documents/${id(suffix)}`).create({ workspaceId, kind: 'paged', rank });
    await add('a', 1);
    await add('b', 3);
    await add('c', 4);
    await add('foreign', 0, otherWs);
    await draft.doc(`documents/${id('a')}`).update({ kind: 'no longer paged' });
    await draft.doc(`documents/${id('b')}`).update({ rank: 5 });
    await draft.doc(`documents/${id('c')}`).delete();
    await draft.doc(`documents/${id('d')}`).create({ workspaceId: ws, kind: 'paged', rank: 2 });
    const list = draft.collection('documents').where('kind', '==', 'paged').orderBy('rank');
    const first = (await list.limit(1).get()).docs[0];
    assert.equal(first.id, id('d'));
    assert.deepEqual((await list.startAfter(first).limit(4).get()).docs.map(d => [d.id, d.get('rank')]), [[id('b'), 5]]);
    assert.equal((await list.count().get()).data().count, 2);
    assert.equal((await list.offset(1).limit(5).count().get()).data().count, 1);
    const missing = draft.doc(`documents/${id('foreign')}`);
    assert.deepEqual((await draft.getAll(missing, first.ref, missing)).map(d => d.exists), [false, true, false]);
    assert.equal((await draft.collection('workspaces').get()).docs[0]?.id, ws);
    assert.equal((await draft.collection('workspaces').count().get()).data().count, 1);
    assert.equal((await draft.doc(`workspaces/${otherWs}`).get()).exists, false);
    await assert.rejects(missing.update({ rank: 10 }), hasCode(5));
    await assert.rejects(first.ref.update({ workspaceId: otherWs }), hasCode(7));
    await assert.rejects(draft.doc(`workspaces/${otherWs}`).set({ name: 'Foreign' }), hasCode(7));
    assert.throws(() => draft.pool, /raw database pool/);
    await assert.rejects(draft.getAll(real.doc(first.ref.path)), /different database scope/);
    assert.throws(() => real.collection('documents').startAfter(first), /different database scope/);
    await assert.rejects(real.batch().update(first.ref, { rank: 8 }).commit(), /different database scope/);
  });

  test('writes and reads are atomic in a sandbox transaction, and one refusal rolls back the batch', async () => {
    const child = draft.doc(`documents/${id('batch-ok')}`);
    const missing = draft.doc(`documents/${id('batch-missing')}`);
    await assert.rejects(draft.batch().set(child, { workspaceId: ws }).update(missing, { count: 1 }).commit(), hasCode(5));
    assert.equal((await child.get()).exists, false);
    const results = await Promise.all(Array.from({ length: 4 }, () => draft.runTransaction(async tx => {
      const doc = await tx.get(child);
      const value = Number(doc.get('count') ?? 0) + 1;
      tx.set(child, { workspaceId: ws, count: value });
      return value;
    })));
    assert.deepEqual(results.sort(), [1, 2, 3, 4]);
    assert.equal((await child.get()).get('count'), 4);
    assert.equal((await real.doc(child.path).get()).exists, false);
  });

  test('an overlay write already applied inside a sandbox transaction never blocks a live save', { timeout: 5_000 }, async () => {
    const ref = real.doc(`documents/${id('no-lock')}`);
    await ref.create({ workspaceId: ws, note: 'old' });
    const liveClient = await real.pool.connect();
    const stop = new Error('End the test after the concurrent save');
    try {
      await liveClient.query('begin');
      await liveClient.query("set local lock_timeout = '500ms'");
      await assert.rejects(draft.runTransaction(async tx => {
        const row = draft.doc(ref.path);
        assert.equal((await tx.get(row)).get('note'), 'old');
        tx.update(row, { note: 'draft' });
        await tx.flush(); // The overlay row already exists in this still-open transaction.
        const saved = await liveClient.query("update public.documents set data = data || '{\"note\":\"person saved\"}' where id = $1", [ref.id]);
        assert.equal(saved.rowCount, 1);
        await liveClient.query('commit');
        throw stop;
      }), (error: unknown) => error === stop);
      assert.equal((await draft.doc(ref.path).get()).get('note'), 'person saved');
    } finally {
      await liveClient.query('rollback');
      liveClient.release();
    }
  });

  test('base versions survive repeat edits and change on jsonb patches, lf_update and trigger writes', async () => {
    const check = async (table: string, key: string, data: object, change: () => Promise<unknown>) => {
      const live = real.collection(table).doc(id(key));
      await live.create({ workspaceId: ws, ...data });
      const ref = draft.doc(live.path);
      const version = async () => (await real.pool.query<{ content: string; hash: string; updated_at: Date }>(
        `select data::text as content, sandbox.content_version(data) as hash, updated_at from public."${table}" where id = $1`, [live.id],
      )).rows[0];
      const copied = async () => (await real.pool.query<{ base_version: string | null }>(
        `select base_version from sandbox."${table}" where sandbox_id = $1 and id = $2`, [sandboxId, live.id],
      )).rows[0].base_version;
      const initial = await version();
      const hash = createHash('sha256').update(initial.content).digest('hex');
      await ref.update({ note: 'draft edit' });
      assert.equal(await copied(), hash);
      await change();
      const latest = await version();
      assert.notEqual(latest.hash, hash);
      if (table === 'rateLimitEntries') assert.deepEqual(latest.updated_at, initial.updated_at, 'this lf_update path does not move updated_at');
      await ref.update({ note: 'second draft edit' });
      await ref.delete();
      assert.equal(await copied(), hash, 'the version refers to the first copied live row');
    };
    await check('customers', 'hash-patch', { name: 'Before' }, () => real.pool.query(
      `update public.customers set data = jsonb_set(data, '{name}', '"After"') where id = $1`, [id('hash-patch')],
    ));
    await check('rateLimitEntries', 'hash-rpc', { count: 1 }, () => real.pool.query(
      `select public.lf_update('rateLimitEntries', $1, '{"count":2}')`, [id('hash-rpc')],
    ));
    await check('periodBalances', 'hash-trigger', { asOf: '2026-02-28', stale: false }, async () => {
      await real.doc(`transactions/${id('hash-trigger-source')}`).create({ workspaceId: ws, status: 'draft', date: '2026-02-28' });
      assert.equal((await real.doc(`periodBalances/${id('hash-trigger')}`).get()).get('stale'), true);
    });
    const created = id('hash-new');
    await draft.collection('customers').doc(created).create({ workspaceId: ws });
    assert.deepEqual((await real.pool.query('select base_version from sandbox.customers where sandbox_id = $1 and id = $2', [sandboxId, created])).rows, [{ base_version: null }]);
  });

  test('ledger guards use the merged chart and the same balance validation in both modes', async () => {
    const ledger = (key: string) => ({ workspaceId: ws, status: 'completed', lines: [
      { accountId: id('cash'), amountCents: 100 }, { accountId: id(key), amountCents: -100 },
    ] });
    await real.doc(`chartAccounts/${id('cash')}`).create({ workspaceId: ws, name: 'Cash' });
    await real.doc(`chartAccounts/${id('sale')}`).create({ workspaceId: ws, name: 'Sales' });
    await draft.doc(`chartAccounts/${id('draft-sale')}`).create({ workspaceId: ws, name: 'Draft sales' });
    await draft.doc(`chartAccounts/${id('sale')}`).delete();
    const entry = `transactions/${id('ledger')}`;
    await assert.rejects(real.doc(entry).create(ledger('draft-sale')), /unknown or foreign chartAccount/);
    await assert.rejects(draft.doc(entry).create(ledger('sale')), /unknown or foreign chartAccount/);
    await real.doc(entry).create(ledger('sale'));
    await draft.doc(entry).set(ledger('draft-sale'));
    assert.deepEqual((await draft.doc(entry).get()).data(), ledger('draft-sale'));
    assert.deepEqual((await real.doc(entry).get()).data(), ledger('sale'));
    const fx = { ...ledger('cash'), exchangeRate: 1.5, lines: [
      { accountId: id('cash'), amountCents: 1 }, { accountId: id('cash'), amountCents: -1 },
    ] };
    const fxPath = `journalEntries/${id('fx')}`;
    for (const db of [real, draft]) await db.doc(fxPath).set(fx);
    assert.deepEqual((await draft.doc(fxPath).get()).data(), (await real.doc(fxPath).get()).data());
    assert.deepEqual((await draft.doc(fxPath).get()).data()?.lines.map((line: { baseAmountCents: number }) => line.baseAmountCents), [1, -1]);
    const unbalanced = ledger('cash');
    unbalanced.lines[1].amountCents = -99;
    for (const db of [real, draft]) {
      for (const table of ['journalEntries', 'transactions']) {
        await assert.rejects(db.collection(table).doc(id('unbalanced')).create(unbalanced), /Double-entry violation.*1\)/);
      }
    }
  });

  test('commit and rollback both clear the role and scope on a reused pool connection', async () => {
    const shared = new Firestore({ connectionString: url, max: 1 });
    const scoped = shared.forSandbox(sandboxId);
    const path = `documents/${id('reused-connection')}`;
    const scope = async () => (await shared.pool.query(
      "select current_user = session_user as live_role, nullif(current_setting('lf.sandbox_id',true),'') as sandbox_id",
    )).rows[0];
    try {
      await scoped.doc(path).create({ workspaceId: ws });
      assert.deepEqual(await scope(), { live_role: true, sandbox_id: null });
      await assert.rejects(scoped.doc(path).update({ workspaceId: otherWs }), hasCode(7));
      assert.deepEqual(await scope(), { live_role: true, sandbox_id: null });
      await shared.doc(path).create({ workspaceId: ws });
    } finally {
      await shared.terminate();
    }
  });

  test('invalid, closed and expired sandbox ids cannot fall back to live reads or writes', async () => {
    assert.throws(() => getDb({ sandboxId: '' }), /Expected a sandbox id/);
    const closedId = await seedSandbox(real, ws);
    const expiredId = await seedSandbox(real, ws);
    await real.pool.query("update sandbox.sandboxes set status = 'closed' where id = $1", [closedId]);
    await real.pool.query("update sandbox.sandboxes set expires_at = now() - interval '1 second' where id = $1", [expiredId]);
    const path = `documents/${id('no-fallback')}`;
    await real.doc(path).create({ workspaceId: ws });
    for (const sbx of [closedId, expiredId, randomUUID()]) {
      const db = getDb({ sandboxId: sbx });
      await assert.rejects(db.doc(path).get(), hasCode(5));
      await assert.rejects(db.doc(path).delete(), hasCode(5));
    }
    assert.equal((await real.doc(path).get()).exists, true);
  });
});
