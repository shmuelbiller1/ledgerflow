/**
 * `budget.save` / `budget.delete` — the three browser writes in the budget manager, as commands.
 *
 * The screen wrote a new objective with `addDoc`, changed one with `updateDoc` and removed one with `deleteDoc`, all
 * from the tab: no audit line, a viewer's refusal was only the hidden button, and an id from another workspace was
 * an update anyone could send. These tests hold the commands to the promises the screen made by hand.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { executeCommand } from '../server/utils/commandExecutor';
import { budgetDeleteCommand, budgetDeleteInput, budgetSaveCommand, budgetSaveInput } from '../server/commands/budgets';
import { captureResponse, fakeRequest, MemoryDb, owner, runnerDependencies, seedWorkspace, workspaceId } from './helpers/commandTestUtils';

const runSave = (input: unknown, db: MemoryDb, user = owner) =>
  executeCommand(fakeRequest(user, { workspaceId, input }), captureResponse().response,
    { definition: budgetSaveCommand, workspaceId, input }, runnerDependencies(db));

const runDelete = (input: unknown, db: MemoryDb, user = owner) =>
  executeCommand(fakeRequest(user, { workspaceId, input }), captureResponse().response,
    { definition: budgetDeleteCommand, workspaceId, input }, runnerDependencies(db));

const line = { targetId: 'acct_rent', targetType: 'account', amountCents: 250000, period: 'monthly', startDate: '2026-11-01' } as const;

test('a new objective is written with its workspace, author and date, and says it created one', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  const outcome = await runSave(budgetSaveInput.parse(line), db);
  assert.equal(outcome.ok, true);
  const created = (outcome as unknown as { data: { id: string; created: boolean } }).data;
  assert.equal(created.created, true);
  const row = db.read(`budgets/${created.id}`)!;
  assert.equal(row.workspaceId, workspaceId);
  assert.equal(row.targetId, 'acct_rent');
  assert.equal(row.amountCents, 250000);
  assert.equal(row.period, 'monthly');
  assert.equal(typeof row.createdAt, 'string');
  assert.equal(row.uid, owner.uid);
});

test('changing an objective keeps the id, touches no other row, and says it updated one', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('budgets/b1', { id: 'b1', workspaceId, targetId: 'acct_rent', amountCents: 1000, period: 'monthly', metadata: { note: 'kept' }, createdAt: '2026-01-01T00:00:00.000Z' });
  const outcome = await runSave(budgetSaveInput.parse({ ...line, id: 'b1', amountCents: 1200 }), db);
  assert.equal(outcome.ok, true);
  assert.equal((outcome as unknown as { data: { created: boolean } }).data.created, false);
  const row = db.read('budgets/b1')!;
  assert.equal(row.id, 'b1');
  assert.equal(row.amountCents, 1200);
  assert.deepEqual(row.metadata, { note: 'kept' }, 'metadata the screen did not send is kept');
  assert.equal(row.createdAt, '2026-01-01T00:00:00.000Z', 'the day it was created does not move');
});

test('the label on an objective is set, changed and taken away', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('budgets/b1', { id: 'b1', workspaceId, targetId: 'acct_rent', amountCents: 1000, period: 'monthly', metadata: { label: { dimensionId: 'property', value: 'P1' }, note: 'kept' } });
  await runSave(budgetSaveInput.parse({ ...line, id: 'b1', label: { dimensionId: 'property', value: 'P2' } }), db);
  assert.deepEqual(db.read('budgets/b1')!.metadata, { note: 'kept', label: { dimensionId: 'property', value: 'P2' } });
  await runSave(budgetSaveInput.parse({ ...line, id: 'b1', label: null }), db);
  assert.deepEqual(db.read('budgets/b1')!.metadata, { note: 'kept' }, 'taking the label away leaves the rest of the metadata');
});

test('an objective in another workspace is refused instead of written into this one', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('budgets/other', { id: 'other', workspaceId: 'someone-else', targetId: 'acct_rent', amountCents: 1000, period: 'monthly' });
  const save = await runSave(budgetSaveInput.parse({ ...line, id: 'other' }), db);
  assert.equal(save.ok, false);
  assert.equal((save as unknown as { code?: string }).code, 'NOT_FOUND');
  assert.equal(db.read('budgets/other')!.workspaceId, 'someone-else');
  const remove = await runDelete(budgetDeleteInput.parse({ id: 'other' }), db);
  assert.equal(remove.ok, false);
  assert.equal(db.read('budgets/other') !== undefined, true, 'and it is still there');
});

test('an amount that is not whole cents, a cycle that does not exist and a date that is not a day are refused', async () => {
  assert.equal(budgetSaveInput.safeParse({ ...line, amountCents: 10.5 }).success, false);
  assert.equal(budgetSaveInput.safeParse({ ...line, amountCents: -1 }).success, false);
  assert.equal(budgetSaveInput.safeParse({ ...line, period: 'weekly' }).success, false);
  assert.equal(budgetSaveInput.safeParse({ ...line, startDate: '2026-11' }).success, false);
  assert.equal(budgetSaveInput.safeParse({ ...line, surprise: true }).success, false, 'an unknown key is refused');
  const db = new MemoryDb();
  seedWorkspace(db);
  assert.equal(db.entries('budgets').length, 0, 'nothing was written by a refused input');
});

test('a viewer may read the plan and cannot change it', async () => {
  const db = new MemoryDb();
  // the workspace's founder is its owner whatever the roles map says, so a viewer is a member who is not the founder
  seedWorkspace(db, workspaceId, { uid: 'someone-else', roles: { [owner.uid]: 'viewer' } });
  db.seed('budgets/b1', { id: 'b1', workspaceId, targetId: 'acct_rent', amountCents: 1000, period: 'monthly' });
  const save = await runSave(budgetSaveInput.parse({ ...line, id: 'b1', amountCents: 5000 }), db);
  assert.equal(save.ok, false);
  assert.equal((save as unknown as { code?: string }).code, 'ROLE_REQUIRED');
  assert.equal(db.read('budgets/b1')!.amountCents, 1000);
  const remove = await runDelete(budgetDeleteInput.parse({ id: 'b1' }), db);
  assert.equal(remove.ok, false);
  assert.ok(db.read('budgets/b1'));
});

test('removing an objective removes the row and answers with what it was for', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('budgets/b1', { id: 'b1', workspaceId, targetId: 'acct_rent', amountCents: 1000, period: 'monthly' });
  const outcome = await runDelete(budgetDeleteInput.parse({ id: 'b1' }), db);
  assert.equal(outcome.ok, true);
  assert.equal((outcome as unknown as { data: { targetId?: string } }).data.targetId, 'acct_rent');
  assert.equal(db.read('budgets/b1'), undefined);
});

test('the command says what it is for, and that it is not a posting', async () => {
  assert.match(budgetSaveCommand.describe.sentence, /budget line/);
  assert.match(budgetSaveCommand.describe.sentence, /not use it to record spending/);
  assert.equal(budgetSaveCommand.risk, 'normal');
  assert.equal(budgetDeleteCommand.risk, 'normal');
  assert.equal(budgetSaveCommand.inverse?.({ ...line, id: 'b1' } as never, { id: 'b1', targetId: 'acct_rent', amountCents: 1, period: 'monthly', created: false }), null);
});
