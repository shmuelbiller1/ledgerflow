/** #912: a document can only be linked to a real entry of the same books, and only an owner or
 * accountant moves another member's evidence to a different entry. */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request } from 'express';
import type { RequestUser } from '../server/auth/requestUser';
import { executeCommand } from '../server/utils/commandExecutor';
import { documentSaveCommand } from '../server/commands/attachments';
import { captureResponse, fakeRequest, MemoryDb, owner, runnerDependencies, type TestCounters } from './helpers/commandTestUtils';

const ws = 'ws-912';
const book: RequestUser = { uid: 'book-1', email: 'book@example.test', aal: 'aal2', auth_time: Math.floor(Date.now() / 1000) };

function seeded() {
  const db = new MemoryDb();
  db.seed(`workspaces/${ws}`, { uid: owner.uid, members: [owner.uid, book.uid], roles: { [book.uid]: 'bookkeeper' }, currency: 'USD' });
  db.seed('transactions/tx-ours', { workspaceId: ws, description: 'Fuel' });
  db.seed('transactions/tx-theirs', { workspaceId: 'ws-other', description: 'Elsewhere' });
  db.seed('documents/receipt-owner', { workspaceId: ws, uid: owner.uid, name: 'fuel.jpg', linkedTransactionId: 'tx-ours' });
  db.seed('documents/receipt-book', { workspaceId: ws, uid: book.uid, name: 'lunch.jpg' });
  return db;
}
const run = (db: MemoryDb, input: Record<string, unknown>, user: RequestUser) => {
  const counters: TestCounters = { runs: 0, previews: 0, afterCommit: 0, audits: 0 };
  const req = fakeRequest(user, { workspaceId: ws, input }) as Request;
  return executeCommand(req, captureResponse().response, { definition: documentSaveCommand, workspaceId: ws, input }, runnerDependencies(db, counters));
};

test('a link to an entry that does not exist, or belongs to other books, is refused', async () => {
  const db = seeded();
  for (const target of ['tx-missing', 'tx-theirs']) {
    const outcome = await run(db, { id: 'receipt-book', linkedTransactionId: target }, book);
    assert.equal(outcome.ok, false, target);
    if (!outcome.ok) assert.equal(outcome.code, 'LINK_TARGET_NOT_FOUND');
  }
  assert.equal(db.read('documents/receipt-book')?.linkedTransactionId, undefined);
});

test('a bookkeeper links their own file, but cannot move the owner\'s receipt to another entry', async () => {
  const db = seeded();
  db.seed('transactions/tx-other', { workspaceId: ws, description: 'Hotel' });
  assert.equal((await run(db, { id: 'receipt-book', linkedTransactionId: 'tx-ours' }, book)).ok, true);
  const moved = await run(db, { id: 'receipt-owner', linkedTransactionId: 'tx-other' }, book);
  assert.equal(moved.ok, false);
  if (!moved.ok) assert.equal(moved.code, 'ROLE_REQUIRED');
  assert.equal(db.read('documents/receipt-owner')?.linkedTransactionId, 'tx-ours');
  assert.equal((await run(db, { id: 'receipt-owner', linkedTransactionId: 'tx-other' }, owner)).ok, true, 'the owner may');
});
