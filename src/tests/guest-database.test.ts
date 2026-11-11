import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { startGuestDatabase, endGuestDatabase, initializeGuestDatabase, guestSession, readGuestTable, writeGuestBatch } from '../lib/db/guestDatabase';
import { getFirestore, collection, doc, query, where, orderBy, limit, setDoc, updateDoc, deleteDoc, getDoc, getDocs, writeBatch, onSnapshot, increment, arrayUnion, arrayRemove, deleteField } from '../lib/db/firestore';
import { installGuestNetworkGuard } from '../lib/guestNetwork';
import type { SupabaseClient } from '@supabase/supabase-js';

let serverCalls = 0;
const db = getFirestore(() => { serverCalls++; throw new Error('Guest reached Supabase'); });
const seed = () => {
  startGuestDatabase();
  initializeGuestDatabase({ workspaces: { guest: { id: 'guest', uid: 'owner-sample' } }, customers: { a: { workspaceId: 'guest', name: 'Alpha', balanceCents: 100, tags: ['first'] }, b: { workspaceId: 'guest', name: 'Beta', balanceCents: 200 }, c: { workspaceId: 'guest', name: 'Other', balanceCents: 300 } } });
};
afterEach(() => { endGuestDatabase(); assert.equal(serverCalls, 0); });

test('guest reads, filtered ordered lists and CRUD stay local, with detached snapshots', async () => {
  seed();
  const ref = doc(db, 'customers', 'a');
  const first = await getDoc(ref);
  first.data()!.name = 'not stored';
  assert.equal((await getDoc(ref)).data()!.name, 'Alpha');
  await setDoc(doc(db, 'customers', 'd'), { workspaceId: 'guest', name: 'Delta', balanceCents: 400 });
  await updateDoc(ref, { balanceCents: increment(50), tags: arrayUnion('first', 'second'), 'metadata.hello': 'world' });
  await updateDoc(ref, { tags: arrayRemove('first'), 'metadata.hello': deleteField() });
  assert.deepEqual((await getDoc(ref)).data(), { workspaceId: 'guest', name: 'Alpha', balanceCents: 150, tags: ['second'], metadata: {} });
  const snap = await getDocs(query(collection(db, 'customers'), where('balanceCents', '>=', 200), orderBy('name', 'desc'), limit(2)));
  assert.deepEqual(snap.docs.map(row => row.id), ['c', 'd']);
  assert.deepEqual((await getDocs(query(collection(db, 'customers'), where('tags', 'array-contains', 'second')))).docs.map(row => row.id), ['a']);
  await deleteDoc(doc(db, 'customers', 'd'));
  assert.equal((await getDoc(doc(db, 'customers', 'd'))).exists(), false);
});

test('batch failure is atomic; no first operation is published on a missing record', async () => {
  seed();
  const batch = writeBatch(db);
  batch.update(doc(db, 'customers', 'a'), { name: 'Changed' });
  batch.update(doc(db, 'customers', 'missing'), { name: 'Missing' });
  await assert.rejects(batch.commit(), /not found/);
  assert.equal((await getDoc(doc(db, 'customers', 'a'))).data()!.name, 'Alpha');
});

test('guest references, their derived queries and batches cannot escape into a real transport after exit', async () => {
  seed();
  const coll = collection(db, 'customers');
  const ref = doc(coll, 'a');
  const batch = writeBatch(db).update(ref, { name: 'Stale' });
  endGuestDatabase();
  await assert.rejects(getDoc(ref), /sample company has closed/);
  await assert.rejects(getDocs(coll), /sample company has closed/);
  await assert.rejects(setDoc(doc(coll, 'a'), { name: 'Stale' }), /sample company has closed/);
  await assert.rejects(batch.commit(), /sample company has closed/);
  seed();
  await assert.rejects(setDoc(ref, { name: 'Old session' }), /sample company has closed/);
  assert.throws(() => writeBatch(db).set(ref, {}), /cannot cross sessions/);
  await assert.rejects(setDoc(doc(db, 'customers', 'foreign'), { workspaceId: 'real-books', name: 'Foreign' }), /Only the sample/);
});

test('snapshots deliver local writes, unsubscribe and never publish into a later demo session', async () => {
  seed();
  const values: string[] = [];
  const unsubscribe = onSnapshot(doc(db, 'customers', 'a'), snap => values.push(String(snap.data()?.name)));
  await Promise.resolve();
  assert.deepEqual(values, ['Alpha']);
  await updateDoc(doc(db, 'customers', 'a'), { name: 'Edited' });
  await Promise.resolve();
  assert.deepEqual(values, ['Alpha', 'Edited']);
  unsubscribe();
  await updateDoc(doc(db, 'customers', 'a'), { name: 'Not observed' });
  assert.deepEqual(values, ['Alpha', 'Edited']);
  const lateValues: unknown[] = [];
  onSnapshot(doc(db, 'customers', 'a'), snap => lateValues.push(snap.data()));
  endGuestDatabase();
  seed();
  await Promise.resolve();
  assert.deepEqual(lateValues, []);
});

test('low-level sample batch rejects foreign workspace and prototype field paths without partial writes', () => {
  seed();
  const session = guestSession()!;
  assert.throws(() => writeGuestBatch([{ op: 'set', table: 'customers', id: 'x', data: { workspaceId: 'real' } }], session), /Only the sample/);
  assert.throws(() => writeGuestBatch([{ op: 'update', table: 'customers', id: 'a', data: { '__proto__.polluted': true } }], session), /Invalid sample field path/);
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
  assert.equal(readGuestTable('customers', session).length, 3);
});

test('network fence rejects fetch before native transport; normal sessions forward the exact request', async () => {
  const calls: unknown[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (...args) => { calls.push(args); return new Response('ok'); }) as typeof fetch;
  const restore = installGuestNetworkGuard();
  try {
    seed();
    await assert.rejects(fetch('/api/v1/unknown-future-action', { method: 'POST', body: 'sample-only' }), /Nothing was sent/);
    await assert.rejects(fetch('https://example.invalid/collect?sample=record'), /Nothing was sent/);
    assert.equal(calls.length, 0);
    endGuestDatabase();
    const init = { method: 'POST', body: 'real-user-request' };
    await fetch('/api/v1/real-action', init);
    assert.deepEqual(calls, [['/api/v1/real-action', init]]);
  } finally { restore(); globalThis.fetch = originalFetch; }
});

test('non-guest data adapter still uses its configured Supabase transport', async () => {
  const calls: unknown[] = [];
  const realDb = getFirestore(() => ({ rpc: async (...args: unknown[]) => { calls.push(args); return { error: null }; } }) as unknown as SupabaseClient);
  await setDoc(doc(realDb, 'customers', 'real'), { workspaceId: 'real-workspace', name: 'Real customer' });
  assert.equal(calls.length, 1);
  assert.equal((calls[0] as unknown[])[0], 'lf_set');
});

test('sample posting captures existing builders atomically and rejects an answer from an exited demo', async () => {
  const { withSamplePosting } = await import('../lib/guestPosting');
  seed();
  const session = guestSession();
  const result = await withSamplePosting('guest', session, async context => {
    assert.ok(context?.capture);
    context.capture.push({ txs: [], entityMutation: { collection: 'invoices', docId: 'sample-draft', action: 'create', data: { workspaceId: 'guest', status: 'draft', amountCents: 12000 } } });
    return 'builder-result';
  });
  assert.equal(result, 'builder-result');
  assert.equal(readGuestTable('invoices', session!)[0].data.amountCents, 12000);
  const late = withSamplePosting('guest', session, async context => {
    context!.capture!.push({ txs: [], entityMutation: { collection: 'invoices', docId: 'late', action: 'create', data: { workspaceId: 'guest' } } });
    await Promise.resolve();
  });
  endGuestDatabase();
  seed();
  await assert.rejects(late, /sample company has closed/);
  assert.deepEqual(readGuestTable('invoices', guestSession()!), []);
  endGuestDatabase();
  let received: unknown = 'not-called';
  await withSamplePosting('real-workspace', null, async context => { received = context; });
  assert.equal(received, undefined, 'real posting receives exactly its previous context');
});
