import test from 'node:test';
import assert from 'node:assert/strict';
import { journalReverseCommand } from '../server/commands/journalReverse';
import { runRegisteredCommand, previewCommand, withLegacyInputIdempotencyHash } from '../server/utils/commandExecutor';
import { fakeRequest, MemoryDb, owner, runnerDependencies, seedWorkspace, workspaceId, type TestCounters } from './helpers/commandTestUtils';

function setup() {
  const db = new MemoryDb();
  seedWorkspace(db, workspaceId, { currency: 'USD', members: [owner.uid, 'viewer'], roles: { viewer: 'viewer' } });
  for (const id of ['cash', 'expense']) db.seed(`chartAccounts/${id}`, { id, workspaceId, name: id, type: id === 'cash' ? 'asset' : 'expense' });
  db.seed('transactions/entry', { id: 'entry', workspaceId, uid: owner.uid, date: '2026-01-05', description: 'Supplies', currency: 'USD', exchangeRate: 1, status: 'completed', type: 'actual', totalAmountCents: 100, lines: [{ accountId: 'expense', amountCents: 100 }, { accountId: 'cash', amountCents: -100 }] });
  return db;
}
const input = { id: 'entry', reversalDate: '2026-02-01', reason: 'Mistake' };
const counters = (): TestCounters => ({ runs: 0, previews: 0, audits: 0, afterCommit: 0 });
const run = (db: MemoryDb, values = input, operationId?: string, c = counters()) => runRegisteredCommand(fakeRequest(owner, values, operationId), { definition: withLegacyInputIdempotencyHash(journalReverseCommand), workspaceId, input: values }, runnerDependencies(db, c));

test('reversal creates the opposite lines, links the original, audits and replays once', async () => {
  const db = setup(); const c = counters();
  const preview = await previewCommand(fakeRequest(owner, input), { definition: journalReverseCommand, workspaceId, input }, runnerDependencies(db));
  assert.equal(preview.ok, true); assert.equal(db.entries('transactions').length, 1);
  const first = await run(db, input, 'reverse-1', c);
  assert.equal(first.ok, true, !first.ok ? first.message : ''); if (!first.ok) return;
  const result = first.data as { reversal: { id: string; lines: Array<{ amountCents: number }> }; replacement: unknown };
  assert.deepEqual(result.reversal.lines.map(l => l.amountCents), [-100, 100]);
  assert.equal(db.read('transactions/entry')?.reversalEventId, result.reversal.id);
  assert.ok(db.read(`transactions/${result.reversal.id}`)); assert.equal(result.replacement, null); assert.equal(c.audits, 1);
  const again = await run(db, input, 'reverse-1', c);
  assert.equal(again.ok && again.replayed, true); assert.equal(db.entries('transactions').length, 2); assert.equal(c.audits, 1);
  const duplicate = await run(db, input);
  assert.equal(duplicate.ok, false); if (!duplicate.ok) assert.match(duplicate.message, /already been reversed/);
});

test('documents, locked dates, different workspaces and viewers are refused without writes', async () => {
  const db = setup();
  db.seed('transactions/entry', { ...db.read('transactions/entry')!, metadata: { invoiceId: 'inv' } });
  const doc = await run(db); assert.equal(doc.ok, false); if (!doc.ok) assert.equal(doc.status, 409);
  assert.equal(db.entries('transactions').length, 1);
  db.seed('transactions/entry', { ...db.read('transactions/entry')!, metadata: {} });
  seedWorkspace(db, workspaceId, { lockDate: '2026-02-28' });
  const locked = await run(db); assert.equal(locked.ok, false); if (!locked.ok) { assert.equal(locked.status, 400); assert.match(locked.message, /Period Locked/i); }
  seedWorkspace(db, workspaceId);
  const mismatch = await run(db, { ...input, requestedWorkspaceId: 'other' } as typeof input); assert.equal(mismatch.ok, false); if (!mismatch.ok) assert.equal(mismatch.status, 403);
  seedWorkspace(db, workspaceId, { members: [owner.uid, 'viewer'], roles: { viewer: 'viewer' } });
  const viewer = await runRegisteredCommand(fakeRequest({ uid: 'viewer' }, input), { definition: journalReverseCommand, workspaceId, input }, runnerDependencies(db));
  assert.equal(viewer.ok, false); if (!viewer.ok) assert.equal(viewer.status, 403);
  assert.equal(db.entries('transactions').length, 1);
});
