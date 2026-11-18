import test from 'node:test';
import assert from 'node:assert/strict';
import { journalDeleteCommand, journalEditCommand } from '../server/commands/journalEdit';
import { runRegisteredCommand, withLegacyInputIdempotencyHash } from '../server/utils/commandExecutor';
import type { AnyCommandDefinition } from '../server/commands/types';
import { fakeRequest, MemoryDb, owner, runnerDependencies, seedWorkspace, workspaceId, type TestCounters } from './helpers/commandTestUtils';

function setup(status = 'completed') {
  const db = new MemoryDb(); seedWorkspace(db, workspaceId);
  for (const id of ['cash', 'expense']) db.seed(`chartAccounts/${id}`, { id, workspaceId, name: id, type: id === 'cash' ? 'asset' : 'expense' });
  db.seed('transactions/entry', { id: 'entry', workspaceId, uid: owner.uid, date: '2026-01-05', description: 'Supplies', currency: 'USD', exchangeRate: 1, status, type: 'actual', totalAmountCents: 100, updatedAt: '2026-01-01T00:00:00Z', lines: [{ accountId: 'expense', amountCents: 100 }, { accountId: 'cash', amountCents: -100 }] });
  return db;
}
const counters = (): TestCounters => ({ runs: 0, previews: 0, audits: 0, afterCommit: 0 });
const run = (db: MemoryDb, command: AnyCommandDefinition, input: unknown, key?: string, c = counters()) => runRegisteredCommand(fakeRequest(owner, input, key), { definition: withLegacyInputIdempotencyHash(command), workspaceId, input }, runnerDependencies(db, c));

test('partial edit writes and audits once on retry, while rejecting stale versions', async () => {
  const db = setup(); const c = counters();
  const input = { id: 'entry', partialUpdate: { notes: 'checked' }, expectedUpdatedAt: '2026-01-01T00:00:00Z' };
  const first = await run(db, journalEditCommand, input, 'edit-1', c);
  assert.equal(first.ok, true, !first.ok ? first.message : '');
  assert.equal(db.read('transactions/entry')?.notes, 'checked'); assert.equal(c.audits, 1);
  const replay = await run(db, journalEditCommand, input, 'edit-1', c);
  assert.equal(replay.ok && replay.replayed, true); assert.equal(c.audits, 1);
  const stale = await run(db, journalEditCommand, { ...input, ifMatch: true });
  assert.equal(stale.ok, false); if (!stale.ok) { assert.equal(stale.status, 412); assert.equal(stale.message, 'version_conflict'); assert.ok((stale.error as { currentTransaction?: unknown }).currentTransaction); }
});

test('partial edit keeps financial guards for documents and posted entries', async () => {
  const db = setup(); db.seed('transactions/entry', { ...db.read('transactions/entry')!, metadata: { invoiceId: 'invoice-1' } });
  const flag = await run(db, journalEditCommand, { id: 'entry', partialUpdate: { isFlagged: true } }); assert.equal(flag.ok, true);
  const doc = await run(db, journalEditCommand, { id: 'entry', partialUpdate: { status: 'void' } }); assert.equal(doc.ok, false); if (!doc.ok) assert.equal(doc.status, 409);
  const fields = await run(db, journalEditCommand, { id: 'entry', partialUpdate: { lines: [] } }); assert.equal(fields.ok, false);
  assert.equal(db.read('transactions/entry')?.status, 'completed');
});

test('full edits are validated and recheck the entry, workspace and period at commit', async () => {
  const db = setup(); const transaction = { ...db.read('transactions/entry')!, description: 'Corrected' };
  const first = await run(db, journalEditCommand, { id: 'entry', transaction });
  assert.equal(first.ok, true, !first.ok ? String(first.error || first.message) : ''); assert.equal(db.read('transactions/entry')?.description, 'Corrected');
  db.beforeTransaction = () => { db.beforeTransaction = undefined; seedWorkspace(db, workspaceId, { lockDate: '2026-02-01' }); };
  const closed = await run(db, journalEditCommand, { id: 'entry', transaction: { ...transaction, description: 'late' } });
  assert.equal(closed.ok, false); assert.equal(db.read('transactions/entry')?.description, 'Corrected');
});

test('delete only removes a draft, keeps a deletion audit and replays safely', async () => {
  const db = setup('draft'); const c = counters();
  const first = await run(db, journalDeleteCommand, { id: 'entry' }, 'delete-1', c);
  assert.equal(first.ok, true); assert.equal(db.read('transactions/entry'), undefined); assert.equal(c.audits, 1);
  const replay = await run(db, journalDeleteCommand, { id: 'entry' }, 'delete-1', c);
  assert.equal(replay.ok && replay.replayed, true); assert.equal(c.audits, 1);
  const posted = setup(); const refused = await run(posted, journalDeleteCommand, { id: 'entry' });
  assert.equal(refused.ok, false); if (!refused.ok) assert.equal(refused.status, 403); assert.ok(posted.read('transactions/entry'));
});


test('a full edit cannot use an account removed or moved after preparation', async () => {
  const db = setup(); const transaction = { ...db.read('transactions/entry')!, description: 'Correction' };
  db.beforeTransaction = () => { db.beforeTransaction = undefined; db.seed('chartAccounts/cash', { id: 'cash', workspaceId: 'another-workspace', name: 'Cash' }); };
  const outcome = await run(db, journalEditCommand, { id: 'entry', transaction });
  assert.equal(outcome.ok, false); assert.equal(db.read('transactions/entry')?.description, 'Supplies');
});
