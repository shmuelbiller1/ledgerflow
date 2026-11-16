/**
 * The sample company's own store is the second — and last — place the browser writes.
 *
 * These tests are about the guarantee, not the CRUD: a signed-in screen that reaches
 * `localUpdate` by mistake must fail loudly rather than write to a workspace that never asked
 * for it, and the demo must keep working through the same calls the hooks now make.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { endGuestDatabase, guestSession, initializeGuestDatabase, readGuestTable, startGuestDatabase } from '../lib/db/guestDatabase';
import { localAdd, localDelete, localSet, localUpdate, localUpdateMany } from '../lib/db/localStore';

const seed = () => {
  startGuestDatabase();
  initializeGuestDatabase({
    workspaces: { guest: { id: 'guest', uid: 'owner-sample' } },
    autoRules: {
      a: { workspaceId: 'guest', name: 'Office supplies', priority: 1, isActive: true },
      b: { workspaceId: 'guest', name: 'Travel', priority: 2, isActive: true },
    },
  });
};

/** The sample company's table as `id -> row`, read through the guest transport's own accessor. */
const table = (name: string): Record<string, Record<string, unknown>> =>
  Object.fromEntries(readGuestTable(name, guestSession()!).map(row => [row.id, row.data as Record<string, unknown>]));

afterEach(() => endGuestDatabase());

test('outside the sample company every call is refused, before it reaches the database', async () => {
  // the demo is not open: a screen that forgot its guest branch gets the sentence the demo shows,
  // not a write into whatever workspace the session happens to be in
  await assert.rejects(localAdd('autoRules', { name: 'x' }), /sample company has closed/);
  await assert.rejects(localSet('autoRules', 'a', { name: 'x' }), /sample company has closed/);
  await assert.rejects(localUpdate('autoRules', 'a', { priority: 3 }), /sample company has closed/);
  await assert.rejects(localDelete('autoRules', 'a'), /sample company has closed/);
  await assert.rejects(localUpdateMany('autoRules', [{ id: 'a', data: { priority: 3 } }]), /sample company has closed/);
});

test('inside the sample company the same calls change its records', async () => {
  seed();
  const id = await localAdd('autoRules', { workspaceId: 'guest', name: 'Receipts', priority: 3 });
  assert.ok(id, 'a created rule has an id the screen can key the row by');
  assert.equal(table('autoRules')[id].name, 'Receipts');

  await localUpdate('autoRules', 'a', { priority: 9 });
  assert.equal(table('autoRules').a.priority, 9);

  await localSet('autoRules', 'b', { workspaceId: 'guest', name: 'Travel and meals' }, { merge: true });
  assert.equal(table('autoRules').b.isActive, true, 'merge keeps the fields it does not name');
  assert.equal(table('autoRules').b.name, 'Travel and meals');

  await localDelete('autoRules', id);
  assert.equal(table('autoRules')[id], undefined);
});

test('a group change is one call, and changes every record it names', async () => {
  seed();
  await localUpdateMany('autoRules', [
    { id: 'a', data: { groupName: 'Expenses' } },
    { id: 'b', data: { groupName: 'Expenses' } },
  ]);
  assert.equal(table('autoRules').a.groupName, 'Expenses');
  assert.equal(table('autoRules').b.groupName, 'Expenses');
});

test('two group changes in flight both complete, and the later one wins', async () => {
  seed();
  const first = localUpdateMany('autoRules', [{ id: 'a', data: { priority: 4 } }]);
  const second = localUpdateMany('autoRules', [{ id: 'a', data: { priority: 5 } }]);
  await Promise.all([first, second]);
  assert.equal(table('autoRules').a.priority, 5, 'the later write wins, and both completed');
});
