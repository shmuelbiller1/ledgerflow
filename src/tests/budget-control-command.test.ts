import test from 'node:test';
import assert from 'node:assert/strict';
import { workspaceBudgetControlCommand } from '../server/commands/budgetControl';
import { previewCommand, runRegisteredCommand, withLegacyInputIdempotencyHash } from '../server/utils/commandExecutor';
import { fakeRequest, MemoryDb, owner, runnerDependencies, seedWorkspace, workspaceId, type TestCounters } from './helpers/commandTestUtils';

function setup() { const db = new MemoryDb(); seedWorkspace(db, workspaceId); return db; }
function counters(): TestCounters { return { runs: 0, audits: 0, previews: 0, afterCommit: 0 }; }
const input = { budgetControl: 'block' as const };
const invoke = (db: MemoryDb, user = owner, key?: string, c = counters()) => runRegisteredCommand(fakeRequest(user, input, key), { definition: withLegacyInputIdempotencyHash(workspaceBudgetControlCommand), workspaceId, input }, runnerDependencies(db, c));

test('preview is read-only; change, audit and replay use the same transaction', async () => {
  const db = setup(); const c = counters();
  const preview = await previewCommand(fakeRequest(owner, input), { definition: workspaceBudgetControlCommand, workspaceId, input }, runnerDependencies(db, c));
  assert.equal(preview.ok, true); assert.equal(db.read(`workspaces/${workspaceId}`)?.budgetControl, undefined);
  const first = await invoke(db, owner, 'budget-1', c); assert.equal(first.ok, true);
  assert.equal(db.read(`workspaces/${workspaceId}`)?.budgetControl, 'block'); assert.equal(c.audits, 1);
  if (first.ok) assert.deepEqual(workspaceBudgetControlCommand.inverse!(input, first.data as never), { command: 'workspace.budgetcontrol', input: { budgetControl: 'warn' } });
  const replay = await invoke(db, owner, 'budget-1', c); assert.equal(replay.ok && replay.replayed, true); assert.equal(c.audits, 1);
});

test('viewer, accountant, invalid mode and a role revoked before commit are refused', async () => {
  const db = setup(); seedWorkspace(db, workspaceId, { members: [owner.uid, 'viewer', 'acct'], roles: { viewer: 'viewer', acct: 'accountant' } });
  for (const uid of ['viewer', 'acct']) { const result = await invoke(db, { uid }); assert.equal(result.ok, false); if (!result.ok) assert.equal(result.status, 403); }
  const bad = await runRegisteredCommand(fakeRequest(owner, { budgetControl: 'never' }), { definition: workspaceBudgetControlCommand, workspaceId, input: { budgetControl: 'never' } }, runnerDependencies(db));
  assert.equal(bad.ok, false); if (!bad.ok) assert.equal(bad.status, 400);
  db.beforeTransaction = () => { db.beforeTransaction = undefined; db.seed(`workspaces/${workspaceId}`, { uid: 'other', members: ['other'] }); };
  const revoked = await invoke(db); assert.equal(revoked.ok, false); if (!revoked.ok) assert.equal(revoked.status, 403);
  assert.equal(db.read(`workspaces/${workspaceId}`)?.budgetControl, undefined);
});

test('the audit and inverse describe the setting at commit, not a stale preflight snapshot', async () => {
  const db = setup();
  db.beforeTransaction = () => { db.beforeTransaction = undefined; seedWorkspace(db, workspaceId, { budgetControl: 'off' }); };
  const result = await invoke(db);
  assert.equal(result.ok, true);
  if (result.ok) {
    const data = result.data as { before: string; budgetControl: string };
    assert.equal(data.before, 'off'); assert.equal(data.budgetControl, 'block');
    assert.deepEqual(workspaceBudgetControlCommand.inverse!(input, result.data as never), { command: 'workspace.budgetcontrol', input: { budgetControl: 'off' } });
  }
});
