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
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { RequestUser } from '../server/auth/requestUser';
import { CommandRegistry } from '../server/commands/registry';
import { createCommandRouter } from '../server/routes/commandRoutes';
import { COMMAND_ROLES, type AnyCommandDefinition } from '../server/commands/types';
import {
  PAYROLL_COMMANDS, payRunApproveCommand, payRunApprovalCommand, payRunPostCommand, payRunRejectCommand, payRunUndoCommand,
} from '../server/commands/payroll';
import { TRANSACTION_COMMANDS, transactionsBatchCommand, transactionsRecategorizeCommand } from '../server/commands/transactions';
import { TAX_COMMANDS, tagChangeCommand, taxFileCommand } from '../server/commands/tagAndTax';
import { MemoryDb, runnerDependencies, type TestCounters } from './helpers/commandTestUtils';

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

async function createHarness() {
  const db = new MemoryDb();
  seed(db);
  const counters: TestCounters = { runs: 0, previews: 0, afterCommit: 0, audits: 0 };
  const dependencies = runnerDependencies(db, counters);
  const registry = new CommandRegistry();
  for (const command of COMMANDS) registry.register(command);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const uid = req.header('x-test-uid');
    if (uid) (req as unknown as { user: RequestUser }).user = { uid, email: `${uid}@example.test`, displayName: 'Test Person', aal: 'aal2' };
    next();
  });
  app.use('/api/v1/commands', createCommandRouter(registry, dependencies));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const run = (uid: string, name: string, input: Record<string, unknown>, workspace = WS) => fetch(`${base}/api/v1/commands/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-uid': uid },
    body: JSON.stringify({ workspaceId: workspace, input }),
  });
  const preview = (uid: string, name: string, input: Record<string, unknown>) => fetch(`${base}/api/v1/commands/${name}/preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-uid': uid },
    body: JSON.stringify({ workspaceId: WS, input }),
  });

  return {
    db, counters, registry, dependencies, run, preview,
    async close() { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); },
  };
}

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
  assert.deepEqual(payRunApproveCommand.roles, ['owner'], 'an accountant cannot approve a run');
  assert.deepEqual(payRunRejectCommand.roles, ['owner']);
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
    // a bookkeeper keeps the books but does not file a return or approve payroll
    assert.equal((await harness.run(BOOKKEEPER, 'tax.file', { startDate: '2026-01-01', endDate: '2026-03-31' })).status, 403);
    assert.equal((await harness.run(BOOKKEEPER, 'payroll.approve', { payRunId: 'p1' })).status, 403);
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
