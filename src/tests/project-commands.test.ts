/**
 * `project.delete` answers with the row it removed, and `project.restore` puts that row back.
 *
 * The browser used to do both: read the row, delete it, and keep the snapshot in a closure for ten seconds. These
 * tests hold the two commands to the three things a closure could not promise: the answer carries the whole row, a
 * row from another workspace cannot be restored into this one, and an id that has been taken again is refused
 * rather than overwritten.
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

test('deleting a project answers with the whole row, and its inverse names the restore', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('projects/proj_web', project());

  const input = projectDeleteInput.parse({ id: 'proj_web' });
  const outcome = await run(projectDeleteCommand, input, db);
  assert.equal(outcome.ok, true);
  assert.equal(db.read('projects/proj_web'), undefined, 'the row is gone');
  const deleted = (outcome as unknown as { data: { project: Record<string, unknown> } }).data.project;
  assert.deepEqual({ ...deleted }, { ...project() }, 'the answer carries the row as it was, id included');

  // the step back is declared by the command, so a toast, a screen and an API key all offer the same one
  const inverse = projectDeleteCommand.inverse!(input, { project: deleted });
  assert.deepEqual(inverse, { command: 'project.restore', input: { project: deleted } });
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

test('restoring puts the row back under its own id, inside the workspace that asked', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  const row = project();
  const input = projectRestoreInput.parse({ project: row });
  const outcome = await run(projectRestoreCommand, input, db);
  assert.equal(outcome.ok, true);
  const { id: _rowId, ...fields } = row;
  assert.deepEqual(db.read('projects/proj_web'), fields, 'the id is the document id, not a field inside it');
  assert.equal(db.read('projects/proj_web')?.workspaceId, workspaceId);
  assert.deepEqual(db.read('projects/proj_web')?.metadata, { nested: ['א', 7] });
});

test('restoring over an id that has been taken again is refused, not overwritten', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('projects/proj_web', { ...project(), name: 'Another record' });
  const input = projectRestoreInput.parse({ project: project() });
  const outcome = await run(projectRestoreCommand, input, db);
  assert.equal(outcome.ok, false);
  assert.equal((outcome as unknown as { code?: string }).code, 'CONFLICT');
  assert.equal(db.read('projects/proj_web')?.name, 'Another record');
});

test('a row from another workspace cannot be restored into this one', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  const input = projectRestoreInput.parse({ project: { ...project(), workspaceId: 'another-workspace' } });
  const outcome = await run(projectRestoreCommand, input, db);
  assert.equal(outcome.ok, false);
  assert.equal((outcome as unknown as { code?: string }).code, 'NOT_FOUND');
  assert.equal(db.read('projects/proj_web'), undefined, 'nothing is written');
});

test('the restore accepts a row that carries no workspace, and gives it this one', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  const { workspaceId: _drop, ...row } = project();
  const input = projectRestoreInput.parse({ project: row });
  const outcome = await run(projectRestoreCommand, input, db);
  assert.equal(outcome.ok, true);
  assert.equal(db.read('projects/proj_web')?.workspaceId, workspaceId);
});
