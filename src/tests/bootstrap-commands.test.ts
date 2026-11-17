/**
 * The two rows that exist before any workspace does: the person's own profile, and the first workspace they own.
 *
 * `useLedgerData` wrote both from an `onSnapshot` that fires whenever the collection is empty — a `setDoc` in a
 * listener, with no audit line and no answer for a second tab that sees the same empty collection. These tests
 * hold the commands to the three things that replaces: a profile is never overwritten, a workspace is written with
 * the caller as its owner, and both are person-scoped so neither needs a workspace to name.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { executeCommand } from '../server/utils/commandExecutor';
import { userProvisionCommand, userProvisionInput, workspaceCreateCommand, workspaceCreateInput } from '../server/commands/bootstrap';
import { captureResponse, fakeRequest, MemoryDb, owner, runnerDependencies } from './helpers/commandTestUtils';

test('a first sign-in creates the profile, and a later one leaves the stored profile alone', async () => {
  const db = new MemoryDb();
  const input = userProvisionInput.parse({});

  const created = await executeCommand(fakeRequest(owner, { input }), captureResponse().response,
    { definition: userProvisionCommand, workspaceId: '', input }, runnerDependencies(db));
  assert.equal(created.ok, true);
  assert.deepEqual(db.read(`users/${owner.uid}`), {
    uid: owner.uid,
    email: 'owner@example.test',
    role: 'client',
    createdAt: db.read(`users/${owner.uid}`)?.createdAt,
  });
  assert.equal(typeof db.read(`users/${owner.uid}`)?.createdAt, 'string');

  // someone renamed themselves (or an admin changed their role) since: a second bootstrap must not revert it
  db.seed(`users/${owner.uid}`, { uid: owner.uid, email: 'new@example.test', role: 'client', name: 'Renamed', createdAt: '2020-01-01T00:00:00.000Z' });
  const again = await executeCommand(fakeRequest(owner, { input }), captureResponse().response,
    { definition: userProvisionCommand, workspaceId: '', input }, runnerDependencies(db));
  assert.equal(again.ok, true);
  assert.equal(db.read(`users/${owner.uid}`)?.name, 'Renamed', 'an existing profile is returned, never rewritten');
  assert.equal(db.read(`users/${owner.uid}`)?.createdAt, '2020-01-01T00:00:00.000Z');
});

test('the profile command is person-scoped and takes no workspace and no fields', async () => {
  assert.equal(userProvisionCommand.scope, 'person');
  assert.equal(userProvisionInput.safeParse({ workspaceId: 'ws-1' }).success, false, 'the profile is the caller’s own row');
  const db = new MemoryDb();
  const input = userProvisionInput.parse({});
  // workspaceId '' is what the command route passes for a person command: no workspace gates the profile
  const outcome = await executeCommand(fakeRequest(owner, { input }), captureResponse().response,
    { definition: userProvisionCommand, workspaceId: '', input }, runnerDependencies(db));
  assert.equal(outcome.ok, true);
});

test('a new workspace is owned by the caller, and carries only the fields the bootstrap sets', async () => {
  const db = new MemoryDb();
  const input = workspaceCreateInput.parse({ name: 'Personal Workspace', businessType: 'personal', currency: 'usd' });

  const outcome = await executeCommand(fakeRequest(owner, { input }), captureResponse().response,
    { definition: workspaceCreateCommand, workspaceId: '', input }, runnerDependencies(db));
  assert.equal(outcome.ok, true);
  const rows = [...db.entries('workspaces')];
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.equal(row.data.uid, owner.uid, 'the caller owns what they opened');
  assert.equal(row.data.name, 'Personal Workspace');
  assert.equal(row.data.businessType, 'personal');
  assert.equal(row.data.currency, 'USD', 'the currency is stored in the case the rest of the product reads');
  assert.equal(typeof row.data.createdAt, 'string');
  assert.equal(row.data.id, undefined, 'the id is the document id, not a field inside it');
});

test('the currency must be three letters, and an unknown field is refused', async () => {
  assert.equal(workspaceCreateInput.safeParse({ currency: 'US' }).success, false);
  assert.equal(workspaceCreateInput.safeParse({ currency: 'USDX' }).success, false);
  assert.equal(workspaceCreateInput.safeParse({ seedFrom: 'other-workspace' }).success, false, 'a copy is its own command');
  assert.equal(workspaceCreateInput.safeParse({}).success, true, 'the bootstrap names nothing and gets the defaults');
});

test('the personal workspace is one fixed row: asking twice answers with it instead of opening a second book', async () => {
  const db = new MemoryDb();
  const input = workspaceCreateInput.parse({ name: 'Personal Workspace', businessType: 'personal', currency: 'USD', personal: true });

  const first = await executeCommand(fakeRequest(owner, { input }), captureResponse().response,
    { definition: workspaceCreateCommand, workspaceId: '', input }, runnerDependencies(db));
  const second = await executeCommand(fakeRequest(owner, { input }), captureResponse().response,
    { definition: workspaceCreateCommand, workspaceId: '', input }, runnerDependencies(db));

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  const rows = [...db.entries('workspaces')];
  assert.equal(rows.length, 1, 'the second call is answered by the row the first one wrote');
  assert.equal(second.ok && (second.data as { created: boolean }).created, false, 'and it reports that nothing was created');
  assert.equal((second.ok && (second.data as { workspace: { id: string } }).workspace.id), (first.ok && (first.data as { workspace: { id: string } }).workspace.id));
});

test('a personal workspace that no longer exists is opened again', async () => {
  const db = new MemoryDb();
  const input = workspaceCreateInput.parse({ personal: true });
  const first = await executeCommand(fakeRequest(owner, { input }), captureResponse().response,
    { definition: workspaceCreateCommand, workspaceId: '', input }, runnerDependencies(db));
  const id = first.ok && (first.data as { workspace: { id: string } }).workspace.id;
  assert.ok(id);
  // the workspace is purged after its deletion window: the row is gone, so the next sign-in writes it again
  db.apply({ method: 'delete', path: `workspaces/${id}` });
  const again = await executeCommand(fakeRequest(owner, { input }), captureResponse().response,
    { definition: workspaceCreateCommand, workspaceId: '', input }, runnerDependencies(db));
  assert.equal(again.ok, true);
  assert.equal(again.ok && (again.data as { created: boolean }).created, true, 'the answer is the row, not a replay of an old request');
  assert.equal([...db.entries('workspaces')].length, 1);
});

test('two people get two personal workspaces, and the derived id cannot be shared', async () => {
  const db = new MemoryDb();
  const input = workspaceCreateInput.parse({ personal: true });
  const other = { ...owner, uid: 'owner-2' };
  await executeCommand(fakeRequest(owner, { input }), captureResponse().response,
    { definition: workspaceCreateCommand, workspaceId: '', input }, runnerDependencies(db));
  await executeCommand(fakeRequest(other, { input }), captureResponse().response,
    { definition: workspaceCreateCommand, workspaceId: '', input }, runnerDependencies(db));
  assert.equal([...db.entries('workspaces')].length, 2);
});
