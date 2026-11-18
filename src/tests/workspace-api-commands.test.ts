import test from 'node:test';
import assert from 'node:assert/strict';
import { runRegisteredCommand, previewCommand, withLegacyInputIdempotencyHash } from '../server/utils/commandExecutor';
import { workspaceMemberAddCommand, workspaceMemberRemoveCommand, workspaceRestoreBackupCommand, workspaceApiCreateCommand, WORKSPACE_API_COMMANDS } from '../server/commands/workspaceApi';
import type { AnyCommandDefinition } from '../server/commands/types';
import { fakeRequest, MemoryDb, owner, runnerDependencies, seedWorkspace, workspaceId } from './helpers/commandTestUtils';

function setup() { const db = new MemoryDb(); seedWorkspace(db, workspaceId, { members: [owner.uid, 'staff'], roles: { staff: 'bookkeeper' } }); return db; }
function run(db: MemoryDb, definition: AnyCommandDefinition, input: unknown, key?: string, user = owner, legacyRoute = false) {
  return runRegisteredCommand(fakeRequest(user, input, key), { definition, workspaceId, input, legacyRoute }, runnerDependencies(db));
}

test('workspace API commands expose examples, roles and previews', async () => {
  for (const command of WORKSPACE_API_COMMANDS) assert.equal(command.input.safeParse(command.describe.example).success, true, command.name);
  const db = setup();
  const result = await previewCommand(fakeRequest(owner, {}), { definition: workspaceRestoreBackupCommand, workspaceId, input: { backup: {} } }, runnerDependencies(db));
  assert.equal(result.ok, true);
  assert.equal(db.directWriteCount, 0);
});

test('membership changes, refuses last owner and viewer, and replays without writing twice', async () => {
  const db = setup();
  const added = await run(db, workspaceMemberAddCommand, { memberUid: 'new-user' }, 'add-1');
  assert.equal(added.ok, true);
  assert.deepEqual(db.read(`workspaces/${workspaceId}`)?.members, [owner.uid, 'staff', 'new-user']);
  const replay = await run(db, workspaceMemberAddCommand, { memberUid: 'new-user' }, 'add-1');
  assert.equal(replay.ok && replay.replayed, true);
  const forbidden = await run(db, workspaceMemberRemoveCommand, { memberUid: 'new-user' }, undefined, { uid: 'staff', email: 'staff@example.test' });
  assert.equal(forbidden.ok, false); if (!forbidden.ok) assert.equal(forbidden.status, 403);
  const lastOwner = await run(db, workspaceMemberRemoveCommand, { memberUid: owner.uid });
  assert.equal(lastOwner.ok, false); if (!lastOwner.ok) { assert.equal(lastOwner.status, 400); assert.match(lastOwner.message, /last owner/); }
  const removed = await run(db, withLegacyInputIdempotencyHash(workspaceMemberRemoveCommand), { memberUid: 'staff' }, 'remove-1');
  assert.equal(removed.ok, true);
  assert.deepEqual(db.read(`workspaces/${workspaceId}`)?.members, [owner.uid, 'new-user']);
  assert.deepEqual(db.read(`workspaces/${workspaceId}`)?.roles, {});
  const changedTarget = await run(db, withLegacyInputIdempotencyHash(workspaceMemberRemoveCommand), { memberUid: 'new-user' }, 'remove-1');
  assert.equal(changedTarget.ok, false); if (!changedTarget.ok) assert.equal(changedTarget.status, 409);
});

test('restore runs in the command transaction, preserves other workspaces and replays', async () => {
  const db = setup();
  db.seed('chartAccounts/old', { workspaceId, name: 'Old' });
  db.seed('chartAccounts/foreign', { workspaceId: 'other', name: 'Other' });
  const backup = { schemaVersion: 1, accounts: [{ id: 'new', name: 'New' }] };
  const first = await run(db, workspaceRestoreBackupCommand, { backup }, 'restore-1');
  assert.equal(first.ok, true, !first.ok ? first.message : '');
  assert.equal(db.read('chartAccounts/old'), undefined);
  assert.equal(db.read('chartAccounts/new')?.name, 'New');
  assert.equal(db.read('chartAccounts/foreign')?.name, 'Other');
  assert.equal(db.entries('auditLogs').filter(x => x.data.action === 'WORKSPACE_RESTORED').length, 1);
  const replay = await run(db, workspaceRestoreBackupCommand, { backup }, 'restore-1');
  assert.equal(replay.ok && replay.replayed, true);
  assert.equal(db.entries('auditLogs').filter(x => x.data.action === 'WORKSPACE_RESTORED').length, 1);
});

test('restore refuses foreign records and closed books without deleting anything', async () => {
  const db = setup(); db.seed('chartAccounts/old', { workspaceId }); db.seed('chartAccounts/foreign', { workspaceId: 'other' });
  const foreign = await run(db, workspaceRestoreBackupCommand, { backup: { accounts: [{ id: 'foreign', name: 'take' }] } });
  assert.equal(foreign.ok, false); if (!foreign.ok) assert.equal(foreign.status, 409);
  assert.ok(db.read('chartAccounts/old')); assert.equal(db.read('chartAccounts/foreign')?.workspaceId, 'other');
  seedWorkspace(db, workspaceId, { lockDate: '2026-01-31' });
  const closed = await run(db, workspaceRestoreBackupCommand, { backup: {} });
  assert.equal(closed.ok, false); if (!closed.ok) assert.equal(closed.status, 409);
  assert.ok(db.read('chartAccounts/old'));
});

test('API workspace creation owns privileged fields, refuses scoped keys and retries safely', async () => {
  const db = setup();
  const input = { fields: { name: 'Fresh Books', uid: 'intruder', id: 'arbitrary', admins: { intruder: true }, isClosed: true } };
  const first = await run(db, workspaceApiCreateCommand, input, 'create-1');
  assert.equal(first.ok, true, !first.ok ? first.message : '');
  if (!first.ok) return;
  const ws = (first.data as { workspace: Record<string, unknown> }).workspace;
  assert.equal(ws.uid, owner.uid); assert.equal(ws.isClosed, false); assert.equal(ws.admins, undefined); assert.match(String(ws.id), /^ws_[0-9a-f]{32}$/);
  const retry = await run(db, workspaceApiCreateCommand, input, 'create-1');
  assert.equal(retry.ok && retry.replayed, true);
  assert.equal(db.entries('workspaces').length, 2);
  assert.equal(db.entries('auditLogs').filter(x => x.data.action === 'WORKSPACE_CREATED').length, 1);
  const denied = await run(db, workspaceApiCreateCommand, input, 'create-1', { ...owner, developerWorkspaceId: workspaceId });
  assert.equal(denied.ok, false); if (!denied.ok) assert.equal(denied.status, 403);
});


test('the seat-cap gate runs for a new add, but not for the replay that filled the last seat', async () => {
  const db = setup();
  seedWorkspace(db, workspaceId, { members: [] });
  let checks = 0;
  const deps = { ...runnerDependencies(db), async checkCapacity() {
    checks++;
    const members = db.read(`workspaces/${workspaceId}`)?.members as string[];
    if (members.length >= 1) throw Object.assign(new Error('seat limit reached'), { status: 402, code: 'SEAT_CAPACITY_EXCEEDED', body: { status: 'error', message: 'seat limit reached', cap: 1, current: 1 } });
  } };
  const input = { memberUid: 'new-user' };
  const invoke = (key: string) => runRegisteredCommand(fakeRequest(owner, input, key), { definition: workspaceMemberAddCommand, workspaceId, input }, deps);
  const first = await invoke('seat-key'); assert.equal(first.ok, true);
  const retry = await invoke('seat-key'); assert.equal(retry.ok && retry.replayed, true); assert.equal(checks, 1);
  const next = await invoke('other-key'); assert.equal(next.ok, false); if (!next.ok) { assert.equal(next.status, 402); assert.equal(next.code, 'SEAT_CAPACITY_EXCEEDED'); }
  assert.equal(checks, 2);
});
