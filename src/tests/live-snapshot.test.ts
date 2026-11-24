/**
 * onSnapshot (src/lib/db/firestore.ts) on a fake database: the first load is the whole list;
 * after that our own writes, deletes and other people's changes (Realtime events) fetch only the
 * changed rows and merge them, and the list always equals what a full reload would give.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { collection, deleteDoc, doc, getFirestore, limit, onSnapshot, orderBy, query, setDoc, where } from '../lib/db/firestore';

interface FakeRow { id: string; data: Record<string, unknown>; workspace_id: string; updated_at: string }
type Cond = (r: FakeRow) => boolean;

function fakeDatabase() {
  const tables = new Map<string, Map<string, FakeRow>>();
  let clock = Date.parse('2026-10-02T10:00:00Z');
  const now = () => new Date((clock += 1000)).toISOString();
  const table = (name: string) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name)!;
  };
  const selects: Array<{ table: string; delta: boolean }> = [];
  const realtime: Array<(payload: unknown) => void> = [];
  /** The `subscribe` status callbacks the production code registers (F-13). */
  const statuses: Array<(status: string) => void> = [];
  let removedChannels = 0;

  const column = (c: string) => (r: FakeRow): unknown => {
    if (c === 'id') return r.id;
    if (c === 'workspace_id') return r.workspace_id;
    if (c === 'updated_at') return r.updated_at;
    const m = c.match(/^data->>?(\w+)$/);
    return m ? r.data[m[1]] : undefined;
  };

  function builder(name: string) {
    const conds: Cond[] = [];
    const orders: Array<{ get: (r: FakeRow) => unknown; asc: boolean }> = [];
    let delta = false;
    const b = {
      eq(c: string, v: unknown) { conds.push(r => column(c)(r) === v); return b; },
      gt(c: string, v: string) { if (c === 'updated_at') delta = true; conds.push(r => String(column(c)(r)) > v); return b; },
      not(c: string, op: string) { if (op === 'is') conds.push(r => column(c)(r) !== undefined && column(c)(r) !== null); return b; },
      order(c: string, o: { ascending: boolean }) { orders.push({ get: column(c), asc: o.ascending }); return b; },
      range(from: number, to: number) {
        selects.push({ table: name, delta });
        const rows = [...table(name).values()].filter(r => conds.every(fn => fn(r)));
        rows.sort((x, y) => {
          for (const o of orders) {
            const a = String(o.get(x)); const z = String(o.get(y));
            if (a !== z) return (a < z ? -1 : 1) * (o.asc ? 1 : -1);
          }
          return 0;
        });
        return Promise.resolve({ data: rows.slice(from, to + 1).map(r => ({ id: r.id, data: r.data, updated_at: r.updated_at })), error: null });
      },
    };
    return b;
  }

  const client = {
    from: (name: string) => ({ select: () => builder(name) }),
    rpc: (fn: string, args: Record<string, unknown>) => {
      const t = table(String(args.p_table));
      if (fn === 'lf_set') {
        const data = args.p_data as Record<string, unknown>;
        t.set(String(args.p_id), { id: String(args.p_id), data, workspace_id: String(data.workspaceId), updated_at: now() });
      } else if (fn === 'lf_delete') {
        t.delete(String(args.p_id));
      }
      return Promise.resolve({ error: null });
    },
    channel: () => {
      const ch = {
        on: (_e: string, _f: unknown, cb: (p: unknown) => void) => { realtime.push(cb); return ch; },
        subscribe: (cb?: (status: string) => void) => { if (cb) statuses.push(cb); return ch; },
      };
      return ch;
    },
    removeChannel: () => { removedChannels++; return Promise.resolve('ok'); },
  };

  return {
    db: getFirestore(() => client as unknown as SupabaseClient),
    put(name: string, id: string, data: Record<string, unknown>) {
      table(name).set(id, { id, data, workspace_id: String(data.workspaceId), updated_at: now() });
    },
    remove(name: string, id: string) { table(name).delete(id); },
    selects,
    fireRealtime(payload: unknown) { realtime.forEach(cb => cb(payload)); },
    fireChannelStatus(status: string) { statuses.slice().forEach(cb => cb(status)); },
    get removedChannels() { return removedChannels; },
  };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 250));

describe('Live lists fetch only what changed', () => {
  test('first load, own writes and deletes, other people\'s changes', async () => {
    const fake = fakeDatabase();
    fake.put('invoices', 'a', { workspaceId: 'w1', date: '2026-01-01' });
    fake.put('invoices', 'b', { workspaceId: 'w1', date: '2026-02-01' });
    fake.put('invoices', 'x', { workspaceId: 'w2', date: '2026-03-01' });

    const seen: string[][] = [];
    const unsubscribe = onSnapshot(
      query(collection(fake.db, 'invoices'), where('workspaceId', '==', 'w1'), orderBy('date', 'desc'), limit(10)),
      snap => seen.push(snap.docs.map(d => d.id)));
    await settle();
    assert.deepEqual(seen.at(-1), ['b', 'a']);
    assert.deepEqual(fake.selects.map(s => s.delta), [false], 'the first load is the whole list');

    await setDoc(doc(fake.db, 'invoices', 'c'), { workspaceId: 'w1', date: '2026-03-01' });
    await settle();
    assert.deepEqual(seen.at(-1), ['c', 'b', 'a']);
    assert.equal(fake.selects.at(-1)?.delta, true, 'an own write fetches only what changed');

    await deleteDoc(doc(fake.db, 'invoices', 'a'));
    await settle();
    assert.deepEqual(seen.at(-1), ['c', 'b']);

    // someone else moves b to May, and deletes c
    fake.put('invoices', 'b', { workspaceId: 'w1', date: '2026-05-01' });
    fake.fireRealtime({ eventType: 'UPDATE' });
    await settle();
    assert.deepEqual(seen.at(-1), ['b', 'c']);
    fake.remove('invoices', 'c');
    fake.fireRealtime({ eventType: 'DELETE', old: { id: 'c' } });
    await settle();
    assert.deepEqual(seen.at(-1), ['b']);
    assert.equal(fake.selects.filter(s => !s.delta).length, 1, 'never reloaded in full');

    unsubscribe();
    assert.equal(fake.removedChannels, 1);
  });

  test('a channel that reached an error reloads in full instead of staying stale (F-13)', async () => {
    const fake = fakeDatabase();
    fake.put('payments', 'a', { workspaceId: 'w1', date: '2026-01-01' });
    const seen: string[][] = [];
    const unsubscribe = onSnapshot(
      query(collection(fake.db, 'payments'), where('workspaceId', '==', 'w1'), orderBy('date', 'desc')),
      snap => seen.push(snap.docs.map(d => d.id)));
    await settle();
    assert.deepEqual(seen.at(-1), ['a']);

    // someone else adds a row while the realtime channel is dead: no event ever arrives
    fake.put('payments', 'b', { workspaceId: 'w1', date: '2026-02-01' });
    fake.fireChannelStatus('CHANNEL_ERROR');
    await settle();
    assert.deepEqual(seen.at(-1), ['b', 'a'], 'the list caught up with a full reload');
    assert.equal(fake.selects.filter(s => !s.delta).length, 2, 'one reload after the first load');
    unsubscribe();
  });

  test('a delete from a list cut by its limit reloads in full', async () => {
    const fake = fakeDatabase();
    for (const id of ['a', 'b', 'c']) fake.put('payments', id, { workspaceId: 'w1', date: `2026-0${id.charCodeAt(0) - 96}-01` });
    const seen: string[][] = [];
    const unsubscribe = onSnapshot(
      query(collection(fake.db, 'payments'), where('workspaceId', '==', 'w1'), orderBy('date', 'desc'), limit(2)),
      snap => seen.push(snap.docs.map(d => d.id)));
    await settle();
    assert.deepEqual(seen.at(-1), ['c', 'b']);
    await deleteDoc(doc(fake.db, 'payments', 'c'));
    await settle();
    assert.deepEqual(seen.at(-1), ['b', 'a'], 'the next row comes in');
    assert.equal(fake.selects.filter(s => !s.delta).length, 2);
    unsubscribe();
  });
});
