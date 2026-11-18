/**
 * The payroll, journal-batch, tag and tax batch: nine registered commands behind addresses that
 * already existed.
 *
 * Every one of these services already owned its rule, its transaction and its words (`payRunService`,
 * `recategorizeService`, `ledgerBatchUpdate`, `tagService`, `taxReturnService`). The command adds the
 * registered door — one name, one schema, a role list, a read-only preview and the runner's checks —
 * while each route keeps the answer it gave before. What a route move can break is what is tested
 * here: the metadata an assistant reads, the preview that writes nothing, the runner's role and
 * workspace checks, and the service's own status and words coming back out of the runner. The route
 * tests for payroll and the ledger batch need a database, so this file covers the layer that moved.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { COMMAND_ROLES, type AnyCommandDefinition, type CommandExecutionOutcome } from '../server/commands/types';
import { batchAnswer, recategorizeAnswer } from '../server/utils/ledgerBatchCommandRoute';
import { BatchVersionConflict } from '../server/services/ledgerBatchUpdate';
import {
  PAYROLL_COMMANDS, payRunApproveCommand, payRunApprovalCommand, payRunPostCommand, payRunRejectCommand, payRunUndoCommand,
} from '../server/commands/payroll';
import { TRANSACTION_COMMANDS, transactionsBatchCommand, transactionsRecategorizeCommand } from '../server/commands/transactions';
import { TAX_COMMANDS, tagChangeCommand, taxFileCommand } from '../server/commands/tagAndTax';
import { commandHarness, MemoryDb } from './helpers/commandTestUtils';

const OWNER = 'owner-1';
const ACCOUNTANT = 'acct-1';
const BOOKKEEPER = 'book-1';
const VIEWER = 'view-1';
const OUTSIDER = 'out-1';
const WS = 'ws-batch3-test';
const OTHER = 'ws-batch3-other';

const COMMANDS: AnyCommandDefinition[] = [...PAYROLL_COMMANDS, ...TRANSACTION_COMMANDS, ...TAX_COMMANDS];

function seed(db: MemoryDb): void {
  db.seed(`workspaces/${WS}`, {
    uid: OWNER, name: 'Batch Three Co', currency: 'USD',
    members: [OWNER, ACCOUNTANT, BOOKKEEPER, VIEWER],
    roles: { [OWNER]: 'owner', [ACCOUNTANT]: 'accountant', [BOOKKEEPER]: 'bookkeeper', [VIEWER]: 'viewer' },
  });
  db.seed(`workspaces/${OTHER}`, { uid: OUTSIDER, name: 'Other', currency: 'USD', members: [OUTSIDER] });
}

const createHarness = () => commandHarness({ commands: COMMANDS, workspaceId: WS, seed });

test('the nine commands publish a schema, roles, a parseable example and refusals', () => {
  assert.equal(COMMANDS.length, 9);
  for (const command of COMMANDS) {
    assert.equal(command.scope ?? 'workspace', 'workspace', `${command.name} works on a workspace`);
    assert.equal(command.risk, 'normal', `${command.name} keeps the legacy route's session requirements`);
    assert.ok(command.roles.length > 0 && command.roles.every(role => COMMAND_ROLES.includes(role)), `${command.name} names real roles`);
    assert.equal(command.input.safeParse(command.describe.example).success, true, `${command.name} example parses`);
    assert.ok(command.describe.refusals.length >= 1, `${command.name} lists its refusals`);
    assert.ok(command.describe.sentence.length > 40, `${command.name} says what it is for and when not to use it`);
    // a batch may touch entries in several months, and payroll's own service answers a closed period
    // with its own 409 and its own words; the runner's dated check would answer 400 before it ran
    assert.equal(command.dated, undefined, `${command.name} leaves the period lock to its service`);
    // the service writes its own audit line, so the runner adds no second one
    assert.equal(command.audit({} as never, {} as never), null, `${command.name} audits nothing itself`);
  }
  assert.deepEqual(payRunPostCommand.roles, ['owner', 'accountant']);
  assert.deepEqual(payRunUndoCommand.roles, ['owner', 'accountant']);
  assert.deepEqual(payRunApprovalCommand.roles, ['owner'], 'only an owner decides whether payroll needs approval');
  // P-05: the runner's role list is checked before the service reads the workspace's two-person
  // setting, so an accountant must be listed or the rule that lets them decide could never run. The
  // service is still the authority — it refuses an accountant when the rule is off, and refuses the
  // preparer either way (pay-run-posting.test.ts covers both).
  assert.deepEqual(payRunApproveCommand.roles, ['owner', 'accountant'], 'two-person approval needs the accountant listed');
  assert.deepEqual(payRunRejectCommand.roles, ['owner', 'accountant']);
  assert.deepEqual(tagChangeCommand.roles, ['owner', 'accountant', 'bookkeeper'], 'a viewer cannot retag the books');
  assert.deepEqual(taxFileCommand.roles, ['owner', 'accountant'], 'filing is a signing act');
  assert.deepEqual(COMMANDS.map(command => command.name).sort(), [
    'journal.batchupdate', 'journal.recategorize',
    'payroll.approval', 'payroll.approve', 'payroll.reject', 'payroll.run', 'payroll.undo',
    'tag.change', 'tax.file',
  ]);
});

test('the one inverse is a command that exists, and the one-way moves answer null', () => {
  // an approval requirement can be put back; the inverse names the same command and flips the flag
  const inverse = payRunApprovalCommand.inverse?.({ required: true }, { required: true });
  assert.deepEqual(inverse, { command: 'payroll.approval', input: { required: false } });
  // a move that failed wrote nothing, so it advertises no undo — a command whose inverse reads the
  // result to name what to undo answers null when there is no result
  for (const command of [payRunUndoCommand, payRunPostCommand, transactionsBatchCommand, transactionsRecategorizeCommand]) {
    assert.equal(command.inverse?.({ payRunId: 'p1', required: true } as never, null as never) ?? null, null, `${command.name} undoes nothing it did not do`);
  }
  // approving a run is undone by withdrawing it, which is a real command; the rest are one-way records
  assert.deepEqual(payRunApproveCommand.inverse?.({ payRunId: 'p1' }, { payRunId: 'p1' }), { command: 'payroll.undo', input: { payRunId: 'p1' } });
  for (const command of [payRunPostCommand, payRunUndoCommand, payRunRejectCommand, transactionsBatchCommand, transactionsRecategorizeCommand, tagChangeCommand, taxFileCommand]) {
    assert.equal(command.inverse?.({} as never, {} as never), null, `${command.name} is one-way`);
  }
});

test('every inverse these commands advertise parses against the command it names', () => {
  const byName = new Map<string, AnyCommandDefinition>(COMMANDS.map(command => [command.name, command]));
  const walked: Array<{ from: string; to: string; input: unknown }> = [];

  const run = (name: string, inputs: Array<Record<string, unknown>>, result: unknown) => {
    const command = byName.get(name);
    assert.ok(command, `${name} exists`);
    for (const input of inputs) {
      const inverse = command.inverse?.(input as never, result as never);
      if (!inverse) continue;
      walked.push({ from: name, to: inverse.command, input: inverse.input });
    }
  };

  // the two that advertise an undo, with the inputs a person would actually send
  run('payroll.approval', [{ required: true }, { required: false }], { required: true });
  run('payroll.approve', [{ payRunId: 'p1' }], { payRunId: 'p1', status: 'approved' });
  assert.equal(walked.length, 3, 'two commands advertise an undo');

  for (const step of walked) {
    // the undo is a command that exists here, and the input it carries parses as the target's own
    // input — a consumer running the advertised undo cannot be handed a 400 INVALID_INPUT
    const target = byName.get(step.to);
    assert.ok(target, `${step.from} advertises ${step.to}, which exists in this batch`);
    const parsed = target.input.safeParse(step.input);
    assert.equal(parsed.success, true, `${step.from} → ${step.to} parses: ${JSON.stringify(step.input)}`);
  }
  assert.deepEqual([...new Set(walked.map(step => step.to))].sort(), ['payroll.approval', 'payroll.undo'], 'the undos name the two real commands');
});

test('a preview writes nothing and says what would change', async () => {
  const harness = await createHarness();
  try {
    const cases: Array<[string, Record<string, unknown>, RegExp]> = [
      ['journal.recategorize', { changes: [{ id: 'tx1', bankAccountId: 'b', toAccountId: 'office' }] }, /Move 1 entry/],
      ['journal.batchupdate', { workspaceId: WS, updates: [{ id: 'tx1', data: { isReviewed: true } }] }, /Change 1 entry/],
      ['tag.change', { from: 'Travel', to: 'Travel & meals' }, /Rename "Travel"/],
      ['tax.file', { startDate: '2026-01-01', endDate: '2026-03-31' }, /2026-01-01/],
    ];
    for (const [name, input, expected] of cases) {
      const response = await harness.preview(ACCOUNTANT, name, input);
      assert.equal(response.status, 200, `${name} previews`);
      const body = await response.json() as { preview: { title: string; lines: string[] } };
      assert.match(body.preview.title, expected, `${name} names what would change`);
      assert.ok(body.preview.lines.length > 0, `${name} says more than a title`);
    }
    assert.equal(harness.counters.runs, 0, 'a preview runs no handler');
  } finally {
    await harness.close();
  }
});

test('the runner refuses a viewer and an outsider before any service runs', async () => {
  const harness = await createHarness();
  try {
    // a viewer is a member, but none of these writes is theirs
    for (const name of ['tag.change', 'journal.recategorize', 'journal.batchupdate']) {
      const response = await harness.run(VIEWER, name, name === 'tag.change'
        ? { from: 'a', to: 'b' }
        : { changes: [{ id: 'tx1', bankAccountId: 'b', toAccountId: 'a' }] });
      assert.equal(response.status, 403, `${name} refuses a viewer`);
      const refusal = await response.json() as { status: string; message: string; code?: string };
      assert.equal(refusal.status, 'error');
      assert.match(refusal.message, /requires one of \[owner/);
    }
    // a bookkeeper keeps the books but does not file a return
    assert.equal((await harness.run(BOOKKEEPER, 'tax.file', { startDate: '2026-01-01', endDate: '2026-03-31' })).status, 403);
    // an accountant reaches payroll approval: the runner's list must allow them, because the service
    // checks the workspace's two-person setting *inside* its transaction and the runner's check comes
    // first. If this were narrowed back to owners, P-05 could never let an accountant decide.
    const accountant = await harness.run(ACCOUNTANT, 'payroll.approve', { payRunId: 'p1' });
    const decided = await accountant.json() as { status: string; message: string };
    // with two-person approval off the service refuses an accountant, and the words are the service's
    // own — which is the proof the runner admitted them. Before this, the runner's `roles: ['owner']`
    // answered "Forbidden: command payroll.approve requires one of [owner]" first, and P-05's whole
    // point (an accountant deciding a run they did not prepare) could never be reached.
    assert.equal(decided.status, 'error');
    assert.equal(decided.message, 'Only an owner approves or sends back a pay run');
    assert.doesNotMatch(decided.message, /requires one of/, 'the runner did not refuse before the service read the rule');
    // not a member at all
    const outsider = await harness.run(OUTSIDER, 'tag.change', { from: 'a', to: 'b' }, WS);
    assert.equal(outsider.status, 403);
    assert.equal(harness.counters.runs, 0, 'no handler ran for a refusal');
  } finally {
    await harness.close();
  }
});

test('a malformed body is refused by the schema the route answers 400 for', async () => {
  const harness = await createHarness();
  try {
    const recategorize = await harness.run(ACCOUNTANT, 'journal.recategorize', { changes: [] });
    assert.equal(recategorize.status, 400);
    const refusal = await recategorize.json() as { code?: string; message: string };
    assert.equal(refusal.code, 'INVALID_INPUT');
      assert.equal(refusal.message, 'Invalid command input', 'the runner names the refusal; the route words it');

    // a field a batch may not change is refused by the service's own rule, not quietly dropped
    const batch = await harness.run(ACCOUNTANT, 'journal.batchupdate', { workspaceId: WS, updates: [{ id: 'tx1', data: { date: '2026-01-01' } }] });
    assert.equal(batch.status, 400);

    const tax = await harness.run(ACCOUNTANT, 'tax.file', { startDate: '2026-1-1', endDate: '2026-03-31' });
    assert.equal(tax.status, 400);

    const approval = await harness.run(OWNER, 'payroll.approval', { required: 'yes' });
    assert.equal(approval.status, 400);
  } finally {
    await harness.close();
  }
});

/**
 * The answers a caller sees, which is what a route move can quietly change.
 *
 * The first run of this batch got these wrong in ways no command-level test could see: a refusal that
 * the handler answered with its own sentence came back as the runner's, and the ledger batch answered a
 * 403 where the handler had always answered 400 (the database suite caught that one). The route files
 * cannot be mounted here — the writer-role middleware reads a real workspace — so the answer mapping is
 * `utils/ledgerBatchCommandRoute.ts` and these tests hold it to the bodies the handlers gave.
 */
test('the ledger batch answers keep their handler\'s bodies, statuses and words', () => {
  const failure = (over: Record<string, unknown>): CommandExecutionOutcome =>
    ({ ok: false, status: 400, command: 'journal.batchupdate', message: 'x', ...over }) as CommandExecutionOutcome;

  // recategorize: the handler's "Invalid request" with the issues
  const issues = [{ path: ['changes'], message: 'Too small' }];
  assert.deepEqual(recategorizeAnswer(failure({ code: 'INVALID_INPUT', error: { issues } })), {
    status: 400, body: { error: 'Invalid request', details: issues },
  });
  // the service names the entry it refused, and the answer carries it
  assert.deepEqual(recategorizeAnswer(failure({ status: 404, message: 'Entry tx1 is not in this workspace', error: { entryId: 'tx1' } })), {
    status: 404, body: { error: 'Entry tx1 is not in this workspace', entryId: 'tx1' },
  });
  assert.deepEqual(recategorizeAnswer(failure({ status: 500, error: new Error('boom') })), { status: 500, body: { error: 'boom' } });
  assert.deepEqual(
    recategorizeAnswer({ ok: true, status: 200, command: 'journal.recategorize', data: { changed: 2 }, replayed: false }),
    { status: 200, body: { status: 'success', changed: 2 } },
  );

  // batch: the handler's one refusal before its transaction
  assert.deepEqual(batchAnswer(failure({ code: 'WORKSPACE_REQUIRED', error: undefined })), {
    status: 400, body: { error: 'Missing workspaceId or updates' },
  });
  // a locked or settled entry was always a 400 carrying "Forbidden: …" — never a 403
  assert.deepEqual(batchAnswer(failure({ status: 400, message: 'Forbidden: Transaction tx1 status is locked, cleared, or reconciled.' })), {
    status: 400, body: { error: 'Forbidden: Transaction tx1 status is locked, cleared, or reconciled.' },
  });
  assert.equal(batchAnswer(failure({ status: 403, message: 'Only owners, accountants and bookkeepers change entries' })).status, 403);
  // a closed period: assertPostingOpen throws a status-less Error the runner reports as a 500 with its
  // generic words; the batch keeps answering 400 with the "Period Locked" sentence, as the handler did
  assert.deepEqual(batchAnswer(failure({
    status: 500, message: 'An internal server error occurred.',
    error: new Error('Period Locked: this entry is in a closed period (closed through 2026-06-30).'),
  })), { status: 400, body: { error: 'Period Locked: this entry is in a closed period (closed through 2026-06-30).' } });
  // a version conflict keeps the whole body the browser reads to offer "reload"
  const conflict = batchAnswer(failure({ status: 409, error: new BatchVersionConflict('tx1', { id: 'tx1', description: 'theirs' }) }));
  assert.deepEqual(conflict, {
    status: 409,
    body: {
      error: 'version_conflict',
      message: 'Transaction tx1 was modified by another user. Nothing in this batch was saved.',
      conflictTransactionId: 'tx1',
      currentTransaction: { id: 'tx1', description: 'theirs' },
    },
  });
  assert.deepEqual(batchAnswer({ ok: true, status: 200, command: 'journal.batchupdate', data: { updated: 2 }, replayed: false }),
    { status: 200, body: { status: 'ok', updated: 2 } });
});

test('a platform admin keeps the batch update without a writer role, as the old /batch handler allowed', () => {
  assert.equal(transactionsBatchCommand.allowPlatformAdmin, true);
});
