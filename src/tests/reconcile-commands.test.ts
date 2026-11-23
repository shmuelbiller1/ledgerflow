/**
 * Reconciliation (CA-01, CA-04, Y-09, Y-10, EG-9): the legacy writes under `/api/v1/transactions`
 * keep their request and answer while the registered reconciliation commands run the work. Covers a
 * normal call on the in-memory database, the refusals the legacy routes answered (a closed period, a
 * line in another currency, a missing entry, a role that may not write the books, a malformed body),
 * and a retry with the same operation id replaying the first result without a second write.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { COMMAND_ROLES, type AnyCommandDefinition } from '../server/commands/types';
import {
  bankRulesRerunCommand,
  clearEntriesCommand,
  clearEntriesCommandInput,
  completeReconciliationCommand,
  completeReconciliationCommandInput,
  RECONCILIATION_COMMANDS,
  reconcileCommand,
  reconcileInput,
  updateBankLineCommand,
  updateBankLineCommandInput,
} from '../server/commands/reconciliations';
import { executeCommand } from '../server/utils/commandExecutor';
import { fakeRequest, MemoryDb, runnerDependencies, seedWorkspace } from './helpers/commandTestUtils';

const WS = 'ws-reconcile-test';
const OTHER = 'ws-reconcile-other';
const OWNER = 'owner-1';
const ACCOUNTANT = 'acct-1';
const BOOKKEEPER = 'book-1';
const VIEWER = 'view-1';
const OUTSIDER = 'out-1';
const ADMIN = 'platform-admin-1';
const BANK = `${WS}_bank`;
const SALES = `${WS}_sales`;
const SUPPLIES = `${WS}_supplies`;

const user = (uid: string, admin = false) => ({ uid, email: `${uid}@example.test`, ...(admin ? { admin: true } : {}) } as never);

function seed(db: MemoryDb): void {
  seedWorkspace(db, WS, {
    name: 'Reconcile Co',
    currency: 'USD',
    members: [OWNER, ACCOUNTANT, BOOKKEEPER, VIEWER],
    roles: { [OWNER]: 'owner', [ACCOUNTANT]: 'accountant', [BOOKKEEPER]: 'bookkeeper', [VIEWER]: 'viewer' },
  });
  db.seed(`workspaces/${OTHER}`, { uid: OUTSIDER, name: 'Other', currency: 'USD', members: [OUTSIDER] });
  db.seed(`chartAccounts/${BANK}`, { workspaceId: WS, name: 'Bank', type: 'asset', category: 'Cash' });
  db.seed(`chartAccounts/${SALES}`, { workspaceId: WS, name: 'Sales', type: 'revenue', category: 'Revenue' });
  db.seed(`chartAccounts/${SUPPLIES}`, { workspaceId: WS, name: 'Supplies', type: 'expense', category: 'Expense' });
}

/** One HTTP-shaped invocation of a command through the same runner the routes call. */
async function invoke(
  db: MemoryDb,
  definition: AnyCommandDefinition,
  uid: string,
  input: unknown,
  options: { operationId?: string; admin?: boolean } = {},
): Promise<{ status: number; body: Record<string, unknown>; audits: number }> {
  const counters = { runs: 0, previews: 0, afterCommit: 0, audits: 0 };
  const dependencies = runnerDependencies(db, counters);
  // capture by reference: the executor writes the status and body after the call
  let status = 200;
  let body: unknown;
  const response = {
    status(code: number) { status = code; return this; },
    json(payload: unknown) { body = payload; return this; },
  } as never;
  await executeCommand(fakeRequest(user(uid, options.admin), input, options.operationId), response, {
    definition,
    workspaceId: String((input as { workspaceId?: unknown }).workspaceId ?? WS),
    input,
    formatResponse: outcome => (outcome.ok
      ? { status: 200, body: { status: 'ok', ...(outcome.data as Record<string, unknown>) } }
      : { status: outcome.status, body: { error: outcome.message } }),
  }, dependencies);
  return { status, body: body as Record<string, unknown>, audits: counters.audits };
}

test('the seven reconciliation commands publish schema, roles, scope and a parseable example', () => {
  assert.equal(RECONCILIATION_COMMANDS.length, 7);
  for (const command of RECONCILIATION_COMMANDS) {
    assert.equal(command.scope ?? 'workspace', 'workspace', `${command.name} works on a workspace`);
    assert.equal(command.risk, 'normal', `${command.name} keeps the legacy route's session requirements`);
    assert.ok(command.roles.length > 0 && command.roles.every(role => COMMAND_ROLES.includes(role)), `${command.name} names real roles`);
    assert.equal(command.input.safeParse(command.describe.example).success, true, `${command.name} example parses`);
    assert.ok(command.describe.refusals.length >= 1, `${command.name} lists its refusals`);
  }
  // writing the books is the bookkeepers' work; re-running the feed rules is only review
  assert.deepEqual(reconcileCommand.roles, ['owner', 'accountant', 'bookkeeper']);
  assert.deepEqual(clearEntriesCommand.roles, ['owner', 'accountant', 'bookkeeper']);
  assert.deepEqual(bankRulesRerunCommand.roles, ['owner', 'accountant']);
  // clearing entries can be taken back, and the inverse says exactly how
  assert.deepEqual(
    clearEntriesCommand.inverse?.({ transactionIds: ['tx-1', 'tx-2'], clearanceDate: '2026-11-01' }, { clearedCount: 2, undo: false }),
    { command: 'reconciliations.clear', input: { transactionIds: ['tx-1', 'tx-2'], cleared: false } },
  );
});

test('the schemas refuse a malformed batch before any work starts', () => {
  assert.equal(reconcileInput.safeParse({ operations: [] }).success, false, 'an empty batch is refused');
  assert.equal(reconcileInput.safeParse({ operations: [{ id: 'x', type: 'deleteEverything' }] }).success, false, 'an unknown type is refused');
  assert.equal(reconcileInput.safeParse({ operations: [{ type: 'updateBankLine' }] }).success, false, 'an operation without an id is refused');
  assert.equal(reconcileInput.safeParse({ operations: Array.from({ length: 251 }, (_, i) => ({ id: `l${i}`, type: 'updateBankLine' })) }).success, false, 'a batch over 250 is refused');
  assert.equal(clearEntriesCommandInput.safeParse({ transactionIds: [] }).success, false);
  assert.equal(clearEntriesCommandInput.safeParse({ transactionIds: ['tx-1'], clearanceDate: '01/11/2026' }).success, false);
  assert.equal(completeReconciliationCommandInput.safeParse({ accountId: BANK, statementDate: '2026-1-1', statementBalanceCents: 0 }).success, false);
  assert.equal(updateBankLineCommandInput.safeParse({ id: 'line-1', data: {} }).success, true, 'the workspace is optional for the runner');
});

test('clearing entries marks them cleared, keeps one audit line, and a retry writes nothing twice', async () => {
  const db = new MemoryDb();
  seed(db);
  db.seed(`transactions/${WS}_tx1`, { workspaceId: WS, uid: OWNER, date: '2026-10-02', status: 'completed', totalAmountCents: 5000, lines: [] });
  db.seed(`transactions/${WS}_tx2`, { workspaceId: WS, uid: OWNER, date: '2026-10-03', status: 'completed', totalAmountCents: 7000, lines: [] });

  const first = await invoke(db, clearEntriesCommand, BOOKKEEPER, {
    workspaceId: WS, transactionIds: [`${WS}_tx1`, `${WS}_tx2`], clearanceDate: '2026-10-05',
  }, { operationId: 'clear-op-1' });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.status, 'ok');
  assert.equal(first.body.clearedCount, 2);
  assert.equal(db.read(`transactions/${WS}_tx1`)?.isCleared, true);
  assert.equal(db.read(`transactions/${WS}_tx1`)?.clearanceDate, '2026-10-05');

  assert.equal(first.audits, 1, 'the batch leaves exactly one audit line');

  // the same operation id replays the first answer and writes nothing again
  const replay = await invoke(db, clearEntriesCommand, BOOKKEEPER, {
    workspaceId: WS, transactionIds: [`${WS}_tx1`, `${WS}_tx2`], clearanceDate: '2026-10-05',
  }, { operationId: 'clear-op-1' });
  assert.equal(replay.status, 200);
  assert.equal(replay.audits, 0, 'a replay leaves no second audit line');
});

test('clearing entries keeps its refusals: a missing entry is a 404, a day before the entry is a 400, an outsider a 403', async () => {
  const db = new MemoryDb();
  seed(db);
  db.seed(`transactions/${WS}_tx1`, { workspaceId: WS, uid: OWNER, date: '2026-10-02', status: 'completed', totalAmountCents: 5000, lines: [] });

  const missing = await invoke(db, clearEntriesCommand, OWNER, { workspaceId: WS, transactionIds: ['nope'] });
  assert.equal(missing.status, 404);
  assert.match(String(missing.body.error), /not found/);

  const early = await invoke(db, clearEntriesCommand, OWNER, { workspaceId: WS, transactionIds: [`${WS}_tx1`], clearanceDate: '2026-09-01' });
  assert.equal(early.status, 400);
  assert.match(String(early.body.error), /before the entry's own date/);

  const outsider = await invoke(db, clearEntriesCommand, OUTSIDER, { workspaceId: WS, transactionIds: [`${WS}_tx1`] });
  assert.equal(outsider.status, 403);

  const viewer = await invoke(db, clearEntriesCommand, VIEWER, { workspaceId: WS, transactionIds: [`${WS}_tx1`] });
  assert.equal(viewer.status, 403);
  assert.equal(db.read(`transactions/${WS}_tx1`)?.isCleared, undefined, 'nothing was written');
});

test('a closed period refuses the batch with the legacy 400 and writes nothing', async () => {
  const db = new MemoryDb();
  seed(db);
  db.seed(`workspaces/${WS}`, { uid: OWNER, name: 'Reconcile Co', currency: 'USD', lockDate: '2026-09-30', members: [OWNER], roles: { [OWNER]: 'owner' } });
  db.seed(`bankLines/${WS}_line`, { workspaceId: WS, date: '2026-09-15', status: 'pending', amountCents: 1000, currency: 'USD' });

  const refused = await invoke(db, reconcileCommand, OWNER, {
    workspaceId: WS,
    operations: [{ id: `${WS}_line`, type: 'updateBankLine', data: { status: 'matched' } }],
  });
  assert.equal(refused.status, 400);
  assert.match(String(refused.body.error), /Period Locked/);
  assert.equal(db.read(`bankLines/${WS}_line`)?.status, 'pending', 'the line is untouched');
});

test('a bank line in another currency cannot be matched as home-currency money', async () => {
  const db = new MemoryDb();
  seed(db);
  db.seed(`bankLines/${WS}_eur`, { workspaceId: WS, date: '2026-10-20', status: 'pending', amountCents: -1050, currency: 'EUR' });
  db.seed(`bankLines/${WS}_usd`, { workspaceId: WS, date: '2026-10-20', status: 'pending', amountCents: -1050, currency: 'USD' });

  const refused = await invoke(db, reconcileCommand, OWNER, {
    workspaceId: WS, operations: [{ id: `${WS}_eur`, type: 'updateBankLine', data: { status: 'matched' } }],
  });
  assert.equal(refused.status, 400);
  assert.match(String(refused.body.error), /in EUR, not USD/);
  assert.equal(db.read(`bankLines/${WS}_eur`)?.status, 'pending');

  const allowed = await invoke(db, reconcileCommand, OWNER, {
    workspaceId: WS, operations: [{ id: `${WS}_usd`, type: 'updateBankLine', data: { status: 'matched' } }],
  });
  assert.equal(allowed.status, 200, JSON.stringify(allowed.body));
  assert.equal(db.read(`bankLines/${WS}_usd`)?.status, 'matched');
});

test('updating one bank line answers its id and fields, and refuses another workspace\'s line', async () => {
  const db = new MemoryDb();
  seed(db);
  db.seed(`bankLines/${WS}_line`, { workspaceId: WS, date: '2026-10-20', status: 'pending', amountCents: 1000 });
  db.seed(`bankLines/${OTHER}_line`, { workspaceId: OTHER, date: '2026-10-20', status: 'pending', amountCents: 1000 });

  // #830: a viewer is refused; a bookkeeper may change the line
  const asViewer = await invoke(db, updateBankLineCommand, VIEWER, { workspaceId: WS, id: `${WS}_line`, data: { notes: 'Cheque 118' } });
  assert.equal(asViewer.status, 403, JSON.stringify(asViewer.body));
  const updated = await invoke(db, updateBankLineCommand, BOOKKEEPER, { workspaceId: WS, id: `${WS}_line`, data: { notes: 'Cheque 118' } });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal(updated.body.id, `${WS}_line`);
  assert.deepEqual(updated.body.data, { notes: 'Cheque 118' });
  assert.equal(db.read(`bankLines/${WS}_line`)?.notes, 'Cheque 118');
  assert.equal(updated.audits, 1, 'one audit line for the update');

  const wrongWorkspace = await invoke(db, updateBankLineCommand, OWNER, { workspaceId: WS, id: `${OTHER}_line`, data: { notes: 'x' } });
  assert.equal(wrongWorkspace.status, 404);
  assert.match(String(wrongWorkspace.body.error), /not found in workspace/);
});

test('completing a reconciliation keeps its record, marks the entries and answers the count', async () => {
  const db = new MemoryDb();
  seed(db);
  // BR-02: the entry clears the bank account, and the statement balance is the beginning balance
  // plus exactly the money it moved there
  db.seed(`transactions/${WS}_tx1`, { workspaceId: WS, uid: OWNER, date: '2026-10-02', status: 'completed', totalAmountCents: 125000, lines: [{ accountId: BANK, amountCents: 125000 }, { accountId: SALES, amountCents: -125000 }] });

  const done = await invoke(db, completeReconciliationCommand, ACCOUNTANT, {
    workspaceId: WS, accountId: BANK, statementDate: '2026-10-31', statementBalanceCents: 125000, reconciledTransactionIds: [`${WS}_tx1`],
  });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.reconciledCount, 1);
  assert.ok(String(done.body.reconciliationId));
  assert.equal(db.read(`transactions/${WS}_tx1`)?.status, 'reconciled');
  assert.equal(db.read(`transactions/${WS}_tx1`)?.isCleared, true);
  assert.equal(db.entries('reconciliations').length, 1);
  assert.equal(done.audits, 1, 'one audit line for the completed reconciliation');

  // a draft or void entry cannot be reconciled, and a closed statement date is the legacy 409
  db.seed(`transactions/${WS}_draft`, { workspaceId: WS, uid: OWNER, date: '2026-10-02', status: 'draft', totalAmountCents: 125000, lines: [{ accountId: BANK, amountCents: 125000 }, { accountId: SALES, amountCents: -125000 }] });
  const draft = await invoke(db, completeReconciliationCommand, OWNER, {
    workspaceId: WS, accountId: BANK, statementDate: '2026-10-31', statementBalanceCents: 125000, reconciledTransactionIds: [`${WS}_draft`],
  });
  assert.equal(draft.status, 400);
  assert.match(String(draft.body.error), /Cannot reconcile draft transaction/);

  db.seed(`workspaces/${WS}`, { uid: OWNER, name: 'Reconcile Co', currency: 'USD', lockDate: '2026-12-31', members: [OWNER], roles: { [OWNER]: 'owner' } });
  const locked = await invoke(db, completeReconciliationCommand, OWNER, {
    workspaceId: WS, accountId: BANK, statementDate: '2026-10-31', statementBalanceCents: 125000, reconciledTransactionIds: [],
  });
  assert.equal(locked.status, 409, 'a closed statement period keeps the legacy 409');
});

test('an entry the validator refuses keeps the legacy 400 and its real message, never a generic 500', async () => {
  const db = new MemoryDb();
  seed(db);
  // a batch that names an account of another workspace: the validator refuses it, and the screen must
  // read why (the legacy route answered 400 with that sentence, not "An internal server error occurred.")
  db.seed(`chartAccounts/${OTHER}_acct`, { workspaceId: OTHER, name: 'Not ours', type: 'expense', category: 'Expense' });
  const foreign = await invoke(db, reconcileCommand, OWNER, {
    workspaceId: WS,
    operations: [{
      id: `${WS}_new`,
      type: 'createTransaction',
      data: {
        date: '2026-10-05',
        description: 'Names another workspace\'s account',
        totalAmountCents: 1000,
        currency: 'USD',
        status: 'completed',
        type: 'actual',
        lines: [
          { accountId: `${OTHER}_acct`, amountCents: 1000 },
          { accountId: SALES, amountCents: -1000 },
        ],
      },
    }],
  });
  assert.equal(foreign.status, 400, 'a validation failure is a 400, not the runner\'s 500');
  assert.notEqual(foreign.body.error, 'An internal server error occurred.');
  assert.match(String(foreign.body.error), /does not exist|does not belong/);
  assert.equal(db.entries('transactions').some(row => row.id === `${WS}_new`), false, 'nothing was written');
});

test('a platform admin keeps the legacy bypass on clear, patch and complete', async () => {
  const db = new MemoryDb();
  seed(db);
  // an admin who is not a member of this workspace: the legacy routes let them through
  db.seed(`transactions/${WS}_tx1`, { workspaceId: WS, uid: OWNER, date: '2026-10-02', status: 'completed', totalAmountCents: 1000, lines: [{ accountId: BANK, amountCents: 1000 }, { accountId: SALES, amountCents: -1000 }] });
  db.seed(`bankLines/${WS}_line`, { workspaceId: WS, date: '2026-10-20', status: 'pending', amountCents: 1000 });

  const cleared = await invoke(db, clearEntriesCommand, ADMIN, { workspaceId: WS, transactionIds: [`${WS}_tx1`] }, { admin: true });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
  assert.equal(db.read(`transactions/${WS}_tx1`)?.isCleared, true);

  const patched = await invoke(db, updateBankLineCommand, ADMIN, { workspaceId: WS, id: `${WS}_line`, data: { notes: 'Seen' } }, { admin: true });
  assert.equal(patched.status, 200, JSON.stringify(patched.body));

  const completed = await invoke(db, completeReconciliationCommand, ADMIN, {
    workspaceId: WS, accountId: BANK, statementDate: '2026-10-31', statementBalanceCents: 1000, reconciledTransactionIds: [`${WS}_tx1`],
  }, { admin: true });
  assert.equal(completed.status, 200, JSON.stringify(completed.body));

  // without the admin flag the same person is refused, so the bypass is the admin's alone
  const refused = await invoke(db, clearEntriesCommand, ADMIN, { workspaceId: WS, transactionIds: [`${WS}_tx1`] });
  assert.equal(refused.status, 403);
});
