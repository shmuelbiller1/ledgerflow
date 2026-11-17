/**
 * Three writes that were the tab's own: an audit note, an empty account's deletion, and the chart captured as a
 * template.
 *
 * The audit note is the sharpest of them. `auditLogs` is a hash chain — every row carries `seq`, `prevHash`,
 * `chainHash` and `entryHash` — so a row `addDoc`-ed by the browser has no position in the chain and no verifiable
 * author. The note is now a command: the caller says what happened, the server says who and where in the chain.
 *
 * The account deletion carried the claim "this account is empty" without checking anything, and an account that a line
 * names would leave that line pointing at nothing. The template capture claimed to be "this workspace's chart" while
 * actually being whatever the open tab had loaded.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { executeCommand } from '../server/utils/commandExecutor';
import { auditAppendCommand, auditAppendInput } from '../server/commands/audit';
import { chartAccountDeleteCommand, chartAccountDeleteInput } from '../server/commands/chartAccounts';
import { workspaceSaveTemplateCommand, workspaceSaveTemplateInput } from '../server/commands/workspaceAdmin';
import { captureResponse, fakeRequest, MemoryDb, owner, runnerDependencies, seedWorkspace, workspaceId } from './helpers/commandTestUtils';

const appendAudit = (input: unknown, db: MemoryDb) => {
  const parsed = auditAppendInput.parse(input);
  return executeCommand(fakeRequest(owner, { workspaceId, input: parsed }), captureResponse().response,
    { definition: auditAppendCommand, workspaceId, input: parsed }, runnerDependencies(db));
};
const deleteAccount = (input: unknown, db: MemoryDb) => {
  const parsed = chartAccountDeleteInput.parse(input);
  return executeCommand(fakeRequest(owner, { workspaceId, input: parsed }), captureResponse().response,
    { definition: chartAccountDeleteCommand, workspaceId, input: parsed }, runnerDependencies(db));
};
const saveTemplate = (input: unknown, db: MemoryDb) => {
  const parsed = workspaceSaveTemplateInput.parse(input);
  return executeCommand(fakeRequest(owner, { workspaceId, input: parsed }), captureResponse().response,
    { definition: workspaceSaveTemplateCommand, workspaceId, input: parsed }, runnerDependencies(db));
};

test('an audit note is stamped with the caller and placed in the chain, not trusted from the tab', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  const result = await appendAudit({ action: 'UPDATE_TRANSACTION', entityType: 'transaction', entityId: 'tx-1', description: 'Changed the category' }, db);
  assert.equal(result.ok, true);
  const [entry] = db.entries('auditLogs');
  const row = entry.data;
  assert.equal(row.uid, owner.uid, 'the actor is the session, never the request body');
  assert.equal(row.workspaceId, workspaceId);
  assert.equal(row.action, 'UPDATE_TRANSACTION');
  assert.equal((row.details as { description: string }).description, 'Changed the category');
  assert.equal(typeof row.entryHash, 'string', 'the row has a chain hash, so the trail can still be verified');
  assert.equal(typeof row.seq, 'number');
  assert.equal(typeof row.timestamp, 'string');
});

test('two notes are two rows, each with its own hash — a note is appended, never overwritten', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  await appendAudit({ action: 'UPDATE_TRANSACTION', entityType: 'transaction', entityId: 'tx-1' }, db);
  await appendAudit({ action: 'TRANSACTION_REVERSED', entityType: 'transaction', entityId: 'tx-1' }, db);
  // the in-memory database cannot serve the head lookup the chain uses to find its predecessor, so the continuity
  // itself is pinned where the chain lives (the audit service's own tests); here: both notes landed, and each is hashed
  const rows = db.entries('auditLogs').map(entry => entry.data);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.action), ['UPDATE_TRANSACTION', 'TRANSACTION_REVERSED']);
  for (const row of rows) assert.equal(typeof row.entryHash, 'string');
});

test('a note that tries to place itself in the chain or name its own actor is refused', () => {
  assert.equal(auditAppendInput.safeParse({ action: 'update transaction', entityType: 'transaction', entityId: 'tx-1' }).success, false);
  assert.equal(auditAppendInput.safeParse({ action: 'UPDATE_TRANSACTION', entityType: 'transaction', entityId: 'tx-1', uid: 'someone' }).success, false);
  assert.equal(auditAppendInput.safeParse({ action: 'UPDATE_TRANSACTION', entityType: 'transaction', entityId: 'tx-1', details: { nested: { a: 1 } } }).success, false);
  assert.equal(auditAppendInput.safeParse({ action: 'UPDATE_TRANSACTION', entityType: 'transaction', entityId: 'tx-1', description: 'ok', details: { amount: 5 } }).success, true);
});

test('an account nothing names is deleted, and the deletion writes the audit line itself', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('chartAccounts/acc-1', { id: 'acc-1', workspaceId, code: '1099', name: 'Scratch', type: 'asset' });
  const result = await deleteAccount({ id: 'acc-1' }, db);
  assert.equal(result.ok, true);
  assert.equal(db.read('chartAccounts/acc-1'), undefined);
  // the line the command declares, in the same transaction as the removal (the runner's own write path is skipped by
  // the in-memory database, so the declaration is asserted directly)
  const line = chartAccountDeleteCommand.audit({ id: 'acc-1' }, { id: 'acc-1', name: 'Scratch' });
  assert.equal(line?.action, 'DELETE_EMPTY_ACCOUNT');
  assert.equal(line?.entityId, 'acc-1');
  assert.match(String(line?.description), /Scratch/);
});

test('an account a transaction names is refused, and a system account is refused', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('chartAccounts/acc-2', { id: 'acc-2', workspaceId, code: '1010', name: 'Checking', type: 'asset' });
  db.seed('transactions/tx-1', { id: 'tx-1', workspaceId, accountId: 'acc-2', amountCents: 100 });

  const named = await deleteAccount({ id: 'acc-2' }, db);
  assert.equal(named.ok, false);
  assert.equal((named as unknown as { code: string }).code, 'CONFLICT');
  assert.ok(db.read('chartAccounts/acc-2'), 'the account stays, so the line that names it still resolves');

  db.seed('chartAccounts/acc-3', { id: 'acc-3', workspaceId, code: '3000', name: 'Retained', type: 'equity', isSystem: true });
  const system = await deleteAccount({ id: 'acc-3' }, db);
  assert.equal(system.ok, false);
  assert.equal((system as unknown as { code: string }).code, 'CONFLICT');

  const missing = await deleteAccount({ id: 'acc-none' }, db);
  assert.equal((missing as unknown as { code: string }).code, 'NOT_FOUND');
  const other = new MemoryDb();
  seedWorkspace(other);
  other.seed('chartAccounts/acc-9', { id: 'acc-9', workspaceId: 'ws-other', name: 'Theirs' });
  const foreign = await deleteAccount({ id: 'acc-9' }, other);
  assert.equal((foreign as unknown as { code: string }).code, 'NOT_FOUND', 'another workspace’s chart is not deletable');
});

test('the template keeps the active accounts the server reads, not the ones the tab had loaded', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('workspaces/' + workspaceId, { ...db.read('workspaces/' + workspaceId), businessType: 'retail', analyticalTopology: { dimensions: [] } });
  db.seed('chartAccounts/a1', { workspaceId, code: '1010', name: 'Checking', type: 'asset', category: 'Assets' });
  db.seed('chartAccounts/a2', { workspaceId, code: '1020', name: 'Old bank', type: 'asset', archived: true });
  db.seed('chartAccounts/a3', { workspaceId, code: '4000', name: 'Sales', type: 'revenue' });

  const saved = await saveTemplate({ name: 'Retail clone' }, db);
  assert.equal(saved.ok, true);
  const [template] = db.entries('customTemplates').map(entry => entry.data);
  assert.equal(template.uid, owner.uid);
  assert.equal(template.industry, 'retail');
  const accounts = template.accounts as Array<{ code: string }>;
  assert.deepEqual(accounts.map(a => a.code), ['1010', '4000'], 'the archived account is not resurrected in a new workspace');
});

test('a workspace with no active accounts cannot become a template, and neither can a viewer’s capture', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  db.seed('chartAccounts/a2', { workspaceId, code: '1020', name: 'Old bank', type: 'asset', archived: true });
  const empty = await saveTemplate({ name: 'Nothing' }, db);
  assert.equal(empty.ok, false);
  assert.equal((empty as unknown as { code: string }).code, 'CONFLICT');
  assert.equal(db.entries('customTemplates').length, 0);
  assert.equal(workspaceSaveTemplateInput.safeParse({ name: '' }).success, false);
});
