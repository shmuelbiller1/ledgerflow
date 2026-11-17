/**
 * `project.delete` keeps the row it removes, and `project.restore` takes back the id alone.
 *
 * The browser used to do both: read the row, delete it, and keep the snapshot in a closure for ten seconds. These
 * tests hold the two commands to the three things a closure could not promise: the deleted row is **on the server**
 * afterwards, so a reload or a second tab can still restore it; a project from another workspace cannot be
 * restored into this one; and an id that has been taken again is refused rather than overwritten.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { executeCommand } from '../server/utils/commandExecutor';
import { projectDeleteCommand, projectDeleteInput, projectRestoreCommand, projectRestoreInput } from '../server/commands/projects';
import { captureResponse, fakeRequest, MemoryDb, owner, runnerDependencies, seedWorkspace, workspaceId } from './helpers/commandTestUtils';

const project = () => ({
  id: 'proj_web',
  workspaceId,
  uid: owner.uid,
  name: 'Website Redesign',
  type: 'general',
  status: 'active',
  budgetCents: 50000,
  createdAt: '2026-01-01',
  metadata: { nested: ['א', 7] },
});

const run = (definition: typeof projectDeleteCommand | typeof projectRestoreCommand, input: unknown, db: MemoryDb) =>
  executeCommand(fakeRequest(owner, { workspaceId, input }), captureResponse().response,
    { definition, workspaceId, input }, runnerDependencies(db));

test('deleting a project keeps the row on the server, and the step back is the id alone', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('projects/proj_web', project());

  const input = projectDeleteInput.parse({ id: 'proj_web' });
  const outcome = await run(projectDeleteCommand, input, db);
  assert.equal(outcome.ok, true);
  assert.equal(db.read('projects/proj_web'), undefined, 'the row is gone from the projects');
  const kept = db.read(`deletedProjects/${workspaceId}_proj_web`);
  assert.ok(kept, 'the deleted row is kept on the server, not only in the answer');
  assert.equal(kept.name, 'Website Redesign');
  assert.deepEqual(kept.metadata, { nested: ['א', 7] });
  assert.equal(kept.deletedBy, owner.uid);
  assert.equal(typeof kept.deletedAt, 'string');

  const deleted = (outcome as unknown as { data: { project: Record<string, unknown> } }).data.project;
  // the callback of the same transaction closed over the name of the deleted project
  assert.equal(deleted.name, 'Website Redesign');
  const inverse = projectDeleteCommand.inverse!(input, { project: deleted });
  assert.deepEqual(inverse, { command: 'project.restore', input: { id: 'proj_web' } }, 'the restore needs no payload of its own');
});

test('a project in another workspace is not deleted, and its row is untouched', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('projects/elsewhere', { ...project(), id: 'elsewhere', workspaceId: 'another-workspace' });
  const input = projectDeleteInput.parse({ id: 'elsewhere' });
  const outcome = await run(projectDeleteCommand, input, db);
  assert.equal(outcome.ok, false);
  assert.equal((outcome as unknown as { code?: string }).code, 'NOT_FOUND');
  assert.equal(db.read('projects/elsewhere')?.name, 'Website Redesign');
});

test('restoring needs only the id: the server kept the row, so a reload or another tab can still undo', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('projects/proj_web', project());
  await run(projectDeleteCommand, projectDeleteInput.parse({ id: 'proj_web' }), db);

  // nothing of the deleted row is passed back here — this is the caller that lost its tab
  const input = projectRestoreInput.parse({ id: 'proj_web' });
  const outcome = await run(projectRestoreCommand, input, db);
  assert.equal(outcome.ok, true);
  const { id: _rowId, ...fields } = project();
  assert.deepEqual(db.read('projects/proj_web'), fields, 'the id is the document id, not a field inside it');
  assert.equal(db.read('projects/proj_web')?.workspaceId, workspaceId);
  assert.deepEqual(db.read('projects/proj_web')?.metadata, { nested: ['א', 7] });
  assert.equal(db.read(`deletedProjects/${workspaceId}_proj_web`), undefined, 'the kept row is cleared once the project is back');
});

test('restoring over an id that has been taken again is refused, not overwritten', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('projects/proj_web', project());
  await run(projectDeleteCommand, projectDeleteInput.parse({ id: 'proj_web' }), db);
  // something else took the id in the meantime
  db.seed('projects/proj_web', { ...project(), name: 'Another record' });
  const input = projectRestoreInput.parse({ id: 'proj_web' });
  const outcome = await run(projectRestoreCommand, input, db);
  assert.equal(outcome.ok, false);
  assert.equal((outcome as unknown as { code?: string }).code, 'CONFLICT');
  assert.equal(db.read('projects/proj_web')?.name, 'Another record');
  assert.ok(db.read(`deletedProjects/${workspaceId}_proj_web`), 'the kept row survives a refusal, so the restore can be retried');
});

test('a project deleted in another workspace cannot be restored through this one', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('deletedProjects/another-workspace_proj_web', { ...project(), id: 'proj_web', workspaceId: 'another-workspace' });
  const input = projectRestoreInput.parse({ id: 'proj_web' });
  const outcome = await run(projectRestoreCommand, input, db);
  assert.equal(outcome.ok, false);
  assert.equal((outcome as unknown as { code?: string }).code, 'NOT_FOUND');
  assert.equal(db.read('projects/proj_web'), undefined, 'nothing is written');
  assert.ok(db.read('deletedProjects/another-workspace_proj_web'), 'and the other workspace keeps its row');
});

test('a project that was never deleted has nothing to restore', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  const input = projectRestoreInput.parse({ id: 'never-deleted' });
  const outcome = await run(projectRestoreCommand, input, db);
  assert.equal(outcome.ok, false);
  assert.equal((outcome as unknown as { code?: string }).code, 'NOT_FOUND');
  assert.equal(db.read('projects/never-deleted'), undefined);
});
