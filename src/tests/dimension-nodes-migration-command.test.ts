/**
 * `workspace.dimensionnodesmigrate` — the legacy label tree moved off the workspace row, once, atomically.
 *
 * `useLedgerData` used to do the move in the background with a `writeBatch` and an `updateDoc(deleteField())`: no
 * audit line, no role, and no answer, so a tab that went away halfway left a workspace with some values in the
 * collection and the rest still on the row — and the next load migrated them again. These tests hold the command to
 * the two promises that replace it: the rows and the cleared field happen together, and a label that has nowhere to
 * land is refused instead of guessed.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { executeCommand } from '../server/utils/commandExecutor';
import { dimensionNodesMigrateCommand, dimensionNodesMigrateInput } from '../server/commands/dimensions';
import { captureResponse, fakeRequest, MemoryDb, owner, runnerDependencies, seedWorkspace, workspaceId } from './helpers/commandTestUtils';

const viewer = { ...owner, uid: 'viewer-1', email: 'viewer@example.test' };
const run = (input: unknown, db: MemoryDb, user = owner) =>
  executeCommand(fakeRequest(user, { workspaceId, input }), captureResponse().response,
    { definition: dimensionNodesMigrateCommand, workspaceId, input: dimensionNodesMigrateInput.parse(input) }, runnerDependencies(db));

const tree = [
  { id: 'n1', dimensionId: 'property', description: 'North tower', status: 'active' },
  { id: 'n2', dimensionId: 'class', description: 'Repairs' },
] as const;

test('the values are written under their workspace/axis/code id and the legacy field is cleared in the same move', async () => {
  const db = new MemoryDb();
  seedWorkspace(db, workspaceId, { dimensionNodes: tree });
  const result = await run({ nodes: tree }, db);
  assert.equal(result.ok, true);
  assert.equal((result as unknown as { data: { migrated: number } }).data.migrated, 2);

  const row = db.read(`dimensionNodes/${workspaceId}_property_n1`)!;
  assert.equal(row.workspaceId, workspaceId, 'the workspace comes from the request, not the payload');
  assert.equal(row.description, 'North tower');
  assert.match(String(row.updatedAt), /^\d{4}-\d{2}-\d{2}T/, 'the server stamps the time');
  assert.ok(db.read(`dimensionNodes/${workspaceId}_class_n2`));

  assert.equal('dimensionNodes' in (db.read(`workspaces/${workspaceId}`) || {}), false,
    'the legacy list is gone from the workspace row, not left beside the copy');
});

test('a label with no axis or no code is not input the screen could have produced', () => {
  assert.equal(dimensionNodesMigrateInput.safeParse({ nodes: [{ id: 'n1', description: 'no axis' }] }).success, false);
  assert.equal(dimensionNodesMigrateInput.safeParse({ nodes: [{ dimensionId: 'property', description: 'no code' }] }).success, false);
});

test('more than 450 labels in one call is refused: the caller sends the tree in the screen’s own chunks', () => {
  const many = Array.from({ length: 451 }, (_, index) => ({ id: `n${index}`, dimensionId: 'property', description: `Value ${index}` }));
  assert.equal(dimensionNodesMigrateInput.safeParse({ nodes: many }).success, false);
});

test('an empty tree still clears the field, and a viewer cannot run the move', async () => {
  const db = new MemoryDb();
  seedWorkspace(db, workspaceId, { dimensionNodes: [] });
  const cleared = await run({ nodes: [] }, db);
  assert.equal(cleared.ok, true);
  assert.equal('dimensionNodes' in (db.read(`workspaces/${workspaceId}`) || {}), false);

  // a member whose role is viewer is in the workspace but may not write it
  db.seed(`workspaces/${workspaceId}`, { uid: owner.uid, members: [owner.uid, viewer.uid], roles: { [viewer.uid]: 'viewer' }, currency: 'USD' });
  const refused = await run({ nodes: tree }, db, viewer);
  assert.equal(refused.ok, false);
  assert.equal((refused as unknown as { code: string }).code, 'ROLE_REQUIRED');
});

test('a workspace that is no longer open is refused before anything is written', async () => {
  const db = new MemoryDb();
  const result = await run({ nodes: tree }, db);
  assert.equal(result.ok, false);
  assert.equal((result as unknown as { code: string }).code, 'WORKSPACE_NOT_FOUND',
    'the runner answers first: there is no workspace to write into');
  assert.deepEqual(db.entries('dimensionNodes'), []);
});

test('the move is one audit line naming how many labels were written', () => {
  const summary = dimensionNodesMigrateCommand.audit({ nodes: tree }, { migrated: 2, cleared: true })!;
  assert.equal(summary.action, 'DIMENSION_NODES_MIGRATED');
  assert.deepEqual(summary.details, { migrated: 2 });
});
