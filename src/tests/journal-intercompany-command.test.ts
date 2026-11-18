import test from 'node:test';
import assert from 'node:assert/strict';
import { journalIntercompanyCommand } from '../server/commands/journalIntercompany';
import { runRegisteredCommand, previewCommand, withLegacyInputIdempotencyHash } from '../server/utils/commandExecutor';
import { fakeRequest, MemoryDb, owner, runnerDependencies, type TestCounters } from './helpers/commandTestUtils';

const source = 'ws-source'; const target = 'ws-target';
const input = { sourceWorkspaceId: source, targetWorkspaceId: target, amountCents: 500, date: '2026-02-01', sourceAccountId: 'source-cash', targetAccountId: 'target-cash' };
function setup() {
  const db = new MemoryDb();
  db.seed(`workspaces/${source}`, { uid: owner.uid, name: 'Source', currency: 'USD' });
  db.seed(`workspaces/${target}`, { uid: owner.uid, name: 'Target', currency: 'USD' });
  db.seed('chartAccounts/source-cash', { id: 'source-cash', workspaceId: source, name: 'Cash', type: 'asset', subtype: 'cash' });
  db.seed('chartAccounts/target-cash', { id: 'target-cash', workspaceId: target, name: 'Cash', type: 'asset', subtype: 'cash' });
  return db;
}
const counters = (): TestCounters => ({ runs: 0, previews: 0, audits: 0, afterCommit: 0 });
const run = (db: MemoryDb, value = input, key?: string, c = counters()) => runRegisteredCommand(fakeRequest(owner, value, key), { definition: withLegacyInputIdempotencyHash(journalIntercompanyCommand), workspaceId: source, input: value }, runnerDependencies(db, c));

test('intercompany creates reciprocal entries and audits both books exactly once on retry', async () => {
  const db = setup(); const c = counters();
  const preview = await previewCommand(fakeRequest(owner, input), { definition: journalIntercompanyCommand, workspaceId: source, input }, runnerDependencies(db));
  assert.equal(preview.ok, true, !preview.ok ? String(preview.error || preview.message) : ''); assert.equal(db.entries('transactions').length, 0);
  const first = await run(db, input, 'transfer-1', c); assert.equal(first.ok, true, !first.ok ? String(first.error || first.message) : '');
  if (!first.ok) return;
  const result = first.data as { sourceTxId: string; targetTxId: string; sharedIdentityHash: string };
  const from = db.read(`transactions/${result.sourceTxId}`)!; const to = db.read(`transactions/${result.targetTxId}`)!;
  assert.equal(from.workspaceId, source); assert.equal(to.workspaceId, target);
  assert.equal((from.metadata as Record<string, unknown>).targetTxId, result.targetTxId);
  assert.equal((to.metadata as Record<string, unknown>).sourceTxId, result.sourceTxId);
  assert.equal(db.entries('auditLogs').length, 1); assert.equal(c.audits, 1);
  const replay = await run(db, input, 'transfer-1', c); assert.equal(replay.ok && replay.replayed, true);
  assert.equal(db.entries('transactions').length, 2); assert.equal(db.entries('auditLogs').length, 1); assert.equal(c.audits, 1);
});

test('both workspaces and currencies are checked, including at commit', async () => {
  const db = setup(); db.seed(`workspaces/${target}`, { uid: 'other', name: 'Target', currency: 'USD' });
  const forbidden = await run(db); assert.equal(forbidden.ok, false); if (!forbidden.ok) assert.equal(forbidden.status, 403); assert.equal(db.entries('transactions').length, 0);
  db.seed(`workspaces/${target}`, { uid: owner.uid, name: 'Target', currency: 'EUR' });
  const currency = await run(db); assert.equal(currency.ok, false); if (!currency.ok) assert.equal(currency.status, 400);
  db.seed(`workspaces/${target}`, { uid: owner.uid, name: 'Target', currency: 'USD' });
  db.beforeTransaction = () => { db.beforeTransaction = undefined; db.seed(`workspaces/${target}`, { uid: 'other', name: 'Target', currency: 'USD' }); };
  const changed = await run(db); assert.equal(changed.ok, false); if (!changed.ok) assert.equal(changed.status, 403);
  assert.equal(db.entries('transactions').length, 0);
});

test('a changed chart between preparation and commit refuses both sides', async () => {
  const db = setup();
  db.beforeTransaction = () => { db.beforeTransaction = undefined; db.seed('chartAccounts/target-cash', { id: 'target-cash', workspaceId: target, name: 'Renamed', type: 'asset', subtype: 'cash' }); };
  const changed = await run(db); assert.equal(changed.ok, false); if (!changed.ok) assert.equal(changed.status, 409);
  assert.equal(db.entries('transactions').length, 0);
});

test('a replay does not expose target information after target access is revoked', async () => {
  const db = setup(); const first = await run(db, input, 'transfer-revoke'); assert.equal(first.ok, true);
  db.seed(`workspaces/${target}`, { uid: 'other', currency: 'USD' });
  const retry = await run(db, input, 'transfer-revoke'); assert.equal(retry.ok, false); assert.equal(db.entries('transactions').length, 2);
});
