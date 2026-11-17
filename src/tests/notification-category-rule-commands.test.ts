/**
 * Three writes that were a batch in the tab and are a command now: notifications marked read, an item category
 * renamed across the workspace, and the learned patterns forgotten.
 *
 * All three were `writeBatch`/`deleteDoc` loops built from what the open page had loaded — so a category rename
 * missed the items the list had not scrolled to, a "wipe" left the patterns past the first page, and marking notices
 * read stamped the device's clock on rows nothing checked were the caller's.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { executeCommand } from '../server/utils/commandExecutor';
import { notificationsReadCommand, notificationsReadInput } from '../server/commands/notifications';
import { inventoryCategoryRenameCommand, inventoryCategoryRenameInput } from '../server/commands/inventoryItems';
import { autoRuleResetCommand, autoRuleResetInput } from '../server/commands/rulePatterns';
import { captureResponse, fakeRequest, MemoryDb, owner, runnerDependencies, seedWorkspace, workspaceId } from './helpers/commandTestUtils';

const runNotifications = (input: unknown, db: MemoryDb) =>
  executeCommand(fakeRequest(owner, { input }), captureResponse().response,
    { definition: notificationsReadCommand, workspaceId: '', input: notificationsReadInput.parse(input) }, runnerDependencies(db));
const runRename = (input: unknown, db: MemoryDb) =>
  executeCommand(fakeRequest(owner, { workspaceId, input }), captureResponse().response,
    { definition: inventoryCategoryRenameCommand, workspaceId, input: inventoryCategoryRenameInput.parse(input) }, runnerDependencies(db));
const runReset = (db: MemoryDb) =>
  executeCommand(fakeRequest(owner, { workspaceId, input: autoRuleResetInput.parse({}) }), captureResponse().response,
    { definition: autoRuleResetCommand, workspaceId, input: autoRuleResetInput.parse({}) }, runnerDependencies(db));

test('only the caller’s own notifications are marked, and the answer counts what was actually marked', async () => {
  const db = new MemoryDb();
  db.seed('notifications/n1', { id: 'n1', uid: owner.uid, workspaceId, read: false });
  db.seed('notifications/n2', { id: 'n2', uid: 'someone-else', workspaceId, read: false });
  db.seed('notifications/n3', { id: 'n3', uid: owner.uid, workspaceId, read: true });
  db.seed('notifications/n4', { id: 'n4', uid: owner.uid, workspaceId, read: false });

  const result = await runNotifications({ ids: ['n1', 'n2', 'n3', 'n4', 'gone'] }, db);
  assert.equal(result.ok, true);
  assert.equal((result as unknown as { data: { marked: number } }).data.marked, 2);
  assert.equal(db.read('notifications/n1')!.read, true);
  assert.equal(db.read('notifications/n4')!.read, true);
  assert.equal(db.read('notifications/n2')!.read, false, 'someone else’s notice is left alone, not refused');
  assert.match(String(db.read('notifications/n1')!.readAt), /^\d{4}-\d{2}-\d{2}T/);
});

test('a rename reaches every item that carries the name, ignoring spaces and case, and an empty name removes it', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('inventory/a', { id: 'a', workspaceId, name: 'A', category: 'Parts' });
  db.seed('inventory/b', { id: 'b', workspaceId, name: 'B', category: ' parts ' });
  db.seed('inventory/c', { id: 'c', workspaceId, name: 'C', category: 'Tools' });

  const renamed = await runRename({ from: 'Parts', to: 'Spare parts' }, db);
  assert.equal(renamed.ok, true);
  assert.equal((renamed as unknown as { data: { renamed: number } }).data.renamed, 2, 'both spellings of the name move');
  assert.equal(db.read('inventory/a')!.category, 'Spare parts');
  assert.equal(db.read('inventory/b')!.category, 'Spare parts');
  assert.equal(db.read('inventory/c')!.category, 'Tools', 'the other category is untouched');

  const removed = await runRename({ from: 'Tools', to: '' }, db);
  assert.equal(removed.ok, true);
  assert.equal(db.read('inventory/c')!.category, '', 'an empty name removes the category rather than storing a space');
});

test('renaming a category to the name it already has is refused, and so is one in another workspace', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('inventory/a', { id: 'a', workspaceId, name: 'A', category: 'Parts' });
  db.seed('inventory/z', { id: 'z', workspaceId: 'ws-other', name: 'Z', category: 'Parts' });

  const same = await runRename({ from: 'Parts', to: ' parts ' }, db);
  assert.equal(same.ok, false);
  assert.equal((same as unknown as { code: string }).code, 'CONFLICT');
  assert.equal(db.read('inventory/a')!.category, 'Parts');
  assert.equal(db.read('inventory/z')!.category, 'Parts', 'another workspace’s card is never renamed');
});

test('the wipe removes every pattern of the workspace and none of anyone else’s', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('rulePatterns/ws-command-test_p1', { workspaceId, description: 'rent' });
  db.seed('rulePatterns/ws-command-test_p2', { workspaceId, description: 'fuel' });
  db.seed('rulePatterns/ws-other_p1', { workspaceId: 'ws-other', description: 'rent' });

  const result = await runReset(db);
  assert.equal(result.ok, true);
  assert.equal((result as unknown as { data: { removed: number } }).data.removed, 2);
  assert.deepEqual(db.entries('rulePatterns').map(row => row.id), ['ws-other_p1']);
});

test('the wipe takes no fields, and marking notices takes at least one id', () => {
  assert.equal(autoRuleResetInput.safeParse({ workspaceId: 'ws-1' }).success, false);
  assert.equal(notificationsReadInput.safeParse({ ids: [] }).success, false);
  assert.equal(notificationsReadInput.safeParse({ ids: Array.from({ length: 201 }, (_, i) => `n${i}`) }).success, false);
  assert.equal(notificationsReadCommand.scope, 'person', 'a notice is addressed to a person, not a workspace');
});
