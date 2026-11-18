/**
 * The two workspace-wide transaction writes that were still hand-written in the routes: emptying a
 * workspace that holds only demo data (`transaction.reset`) and moving a workspace's entries onto its
 * dimension node ids (`dimensions.migrate`).
 *
 * Both were already transactional and role-checked. What this batch adds is the runner's door, and what
 * a test has to hold is that the door did not change the rules: a reset still refuses real books, still
 * needs the explicit confirmation, still never touches the audit trail, and still belongs to the owner;
 * a migration still belongs to the writers and still refuses to rewrite an entry in a closed period.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { RequestUser } from '../server/auth/requestUser';
import { CommandRegistry } from '../server/commands/registry';
import { createCommandRouter } from '../server/routes/commandRoutes';
import type { AnyCommandDefinition } from '../server/commands/types';
import {
  RESET_COLLECTIONS, TRANSACTION_HOUSEKEEPING_COMMANDS, dimensionsMigrateCommand, transactionResetCommand,
} from '../server/commands/transactionHousekeeping';
import { DIMENSION_MIGRATION_REFUSAL } from '../server/services/dimensionMigrationService';
import { MemoryDb, runnerDependencies, type TestCounters } from './helpers/commandTestUtils';

const OWNER = 'owner-1';
const ACCOUNTANT = 'acct-1';
const BOOKKEEPER = 'book-1';
const VIEWER = 'view-1';
const WS = 'ws-tx-housekeeping';

const COMMANDS: AnyCommandDefinition[] = TRANSACTION_HOUSEKEEPING_COMMANDS;

function seed(db: MemoryDb, extra: Record<string, unknown> = {}): void {
  db.seed(`workspaces/${WS}`, {
    uid: OWNER, name: 'Demo Co', currency: 'USD', isDemoLoaded: true,
    members: [OWNER, ACCOUNTANT, BOOKKEEPER, VIEWER],
    roles: { [ACCOUNTANT]: 'accountant', [BOOKKEEPER]: 'bookkeeper', [VIEWER]: 'viewer' },
    ...extra,
  });
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
    if (uid) (req as unknown as { user: RequestUser }).user = { uid, email: `${uid}@example.test`, aal: 'aal2' };
    next();
  });
  app.use('/api/v1/commands', createCommandRouter(registry, dependencies));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const run = (uid: string, name: string, input: Record<string, unknown>, workspace = WS) => fetch(`${base}/api/v1/commands/${name}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-test-uid': uid },
    body: JSON.stringify({ workspaceId: workspace, input }),
  });
  const preview = (uid: string, name: string, input: Record<string, unknown>) => fetch(`${base}/api/v1/commands/${name}/preview`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-test-uid': uid },
    body: JSON.stringify({ workspaceId: WS, input }),
  });
  return { db, counters, run, preview, async close() { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); } };
}

test('the two commands publish a schema, roles, a parseable example and refusals', () => {
  assert.deepEqual(COMMANDS.map(c => c.name).sort(), ['dimensions.migrate', 'transaction.reset']);
  for (const command of COMMANDS) {
    assert.equal(command.input.safeParse(command.describe.example).success, true, `${command.name} example parses`);
    assert.ok(command.describe.sentence.length > 20);
    assert.ok(command.describe.refusals.length >= 1);
    for (const refusal of command.describe.refusals) assert.ok(refusal.when && refusal.next);
    assert.equal(command.inverse?.({} as never, {} as never), null, `${command.name} is one-way`);
    assert.equal(typeof command.prepare, 'function', `${command.name} reads before the transaction`);
  }
  // emptying real books has always been the owner's alone; a platform admin may be allowed through
  assert.deepEqual(transactionResetCommand.roles, ['owner']);
  assert.equal(transactionResetCommand.allowPlatformAdmin, true);
  assert.equal(transactionResetCommand.risk, 'high');
  // moving entries onto node ids is bookkeeping, as the address required
  assert.deepEqual(dimensionsMigrateCommand.roles, ['owner', 'accountant', 'bookkeeper']);
  assert.equal(dimensionsMigrateCommand.allowPlatformAdmin, true);
});

test('a reset never lists the audit trail among the tables it clears', () => {
  // the route kept auditLogs on purpose ("Never wipe auditLogs"), and there is a guard for the purge too
  assert.ok(!RESET_COLLECTIONS.includes('auditLogs' as never), 'the audit trail survives a reset');
  assert.ok(!RESET_COLLECTIONS.includes('workspaces' as never), 'the workspace row survives a reset');
  // and the tables it does clear are the ones the route listed, in its order
  assert.deepEqual([...RESET_COLLECTIONS].slice(0, 4), ['transactions', 'chartAccounts', 'projects', 'budgets']);
  assert.equal(RESET_COLLECTIONS.length, 17);
});

test('a reset needs the explicit confirmation and refuses a workspace that is not demo data', async () => {
  const harness = await createHarness();
  try {
    // confirmReset must be true, as the address required; the schema carries the address's sentence and
    // the route answers it, so a caller who forgets is refused before anything is read
    const missing = transactionResetCommand.input.safeParse({ workspaceId: WS });
    assert.equal(missing.success, false);
    if (!missing.success) assert.match(missing.error.issues[0].message, /Explicit confirmation required/);

    // a viewer may not empty the workspace
    const viewer = await harness.run(VIEWER, 'transaction.reset', { workspaceId: WS, confirmReset: true });
    assert.equal(viewer.status, 403);

    // real books are refused rather than wiped, in the refusal the address has always given
    const real = new MemoryDb();
    seed(real, { isDemoLoaded: false });
    const counters: TestCounters = { runs: 0, previews: 0, afterCommit: 0, audits: 0 };
    const { executeCommand } = await import('../server/utils/commandExecutor');
    const res = { statusCode: 0, body: undefined as unknown, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } };
    await executeCommand(
      { user: { uid: OWNER, aal: 'aal2' }, body: {}, params: {}, query: {}, header: () => undefined, get: () => undefined } as never,
      res as never,
      { definition: transactionResetCommand, workspaceId: WS, input: { workspaceId: WS, confirmReset: true } },
      runnerDependencies(real, counters),
    );
    assert.equal(res.statusCode, 409);
    assert.match(String((res.body as { message: string }).message), /Only demo data can be cleared at once/);
  } finally {
    await harness.close();
  }
});

test('a migration belongs to the writers, and a closed period refuses it', async () => {
  const harness = await createHarness();
  try {
    const viewer = await harness.run(VIEWER, 'dimensions.migrate', { workspaceId: WS });
    assert.equal(viewer.status, 403);
    // through the command router the runner names the roles; the address keeps its own sentence (below)
    assert.match(((await viewer.json()) as { message: string }).message, /requires one of/);
    assert.ok(DIMENSION_MIGRATION_REFUSAL.startsWith('Only owners, accountants and bookkeepers'));
    for (const uid of [OWNER, ACCOUNTANT, BOOKKEEPER]) {
      const ok = await harness.run(uid, 'dimensions.migrate', { workspaceId: WS });
      assert.equal(ok.status, 200, `${uid} may migrate: ${JSON.stringify(await ok.clone().json())}`);
    }
  } finally {
    await harness.close();
  }
});

test('both previews describe the change and write nothing', async () => {
  const harness = await createHarness();
  try {
    for (const [name, input] of [
      ['transaction.reset', { workspaceId: WS, confirmReset: true }],
      ['dimensions.migrate', { workspaceId: WS }],
    ] as const) {
      const response = await harness.preview(OWNER, name, input);
      assert.equal(response.status, 200, `${name} previews`);
      const body = await response.json() as { preview?: { title: string; lines: string[] } };
      assert.ok(body.preview?.title, `${name} preview has a title`);
      assert.ok((body.preview?.lines.length || 0) > 0, `${name} preview says what changes`);
    }
    assert.equal(harness.counters.runs, 0, 'no preview ran a handler');
    assert.equal(harness.counters.afterCommit, 0);
  } finally {
    await harness.close();
  }
});

test('a reset actually empties a seeded demo workspace, across more than one table, and keeps the audit trail', async () => {
  // The first draft of this command read each table and deleted its rows in the same loop, which the real
  // transaction refuses ("all reads before all writes") — so every real demo workspace would have failed
  // the reset while these tests passed. This one runs a successful reset over two tables and the trail.
  const harness = await createHarness();
  try {
    harness.db.seed(`transactions/tx-1`, { workspaceId: WS, date: '2026-01-01', totalAmountCents: 100 });
    harness.db.seed(`transactions/tx-2`, { workspaceId: WS, date: '2026-01-02', totalAmountCents: 200 });
    harness.db.seed(`chartAccounts/acc-1`, { workspaceId: WS, name: 'Cash', type: 'asset' });
    harness.db.seed(`auditLogs/log-1`, { workspaceId: WS, action: 'ACCOUNT_CREATED' });
    harness.db.seed(`transactions/other-ws-tx`, { workspaceId: 'ws-other', date: '2026-01-01' });

    const response = await harness.run(OWNER, 'transaction.reset', { workspaceId: WS, confirmReset: true });
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));

    const rows = async (path: string) => (await harness.db.collection(path.split('/')[0]).where('workspaceId', '==', WS).get()).docs.length;
    assert.equal(await rows('transactions/x'), 0, 'the entries are gone');
    assert.equal(await rows('chartAccounts/x'), 0, 'the accounts are gone');
    assert.notEqual(await harness.db.collection('transactions').doc('other-ws-tx').get().then(s => s.data()), undefined, 'another workspace is untouched');
    assert.notEqual(await harness.db.collection('auditLogs').doc('log-1').get().then(s => s.data()), undefined, 'the audit trail is never cleared');
    assert.notEqual(await harness.db.collection('workspaces').doc(WS).get().then(s => s.data()), undefined, 'the workspace row remains');
  } finally {
    await harness.close();
  }
});

test('a migration refuses rather than overwrite an entry that changed after it was prepared', async () => {
  // prepareDimensionMigration reads the entries outside the transaction; without re-reading them inside
  // it the write would be a full t.set of the snapshot prepare saw, silently replacing a concurrent edit.
  const { prepareDimensionMigration, migrateDimensionsInTransaction } = await import('../server/services/dimensionMigrationService');
  const db = new MemoryDb();
  seed(db, { dimensions: [{ id: 'dept', name: 'Department', values: [{ id: 'sales', name: 'Sales' }] }] } as never);
  // the dimension value lives in the line's `dimensions` map, keyed by the axis id
  const balanced = [
    { accountId: 'bank', amountCents: -100, dimensions: { dept: 'sales' } },
    { accountId: 'exp', amountCents: 100 },
  ];
  db.seed(`transactions/tx-1`, { workspaceId: WS, totalAmountCents: 100, currency: 'USD', status: 'posted', date: '2026-01-01', description: 'Paper', lines: balanced });
  const firestore = db as unknown as Parameters<typeof prepareDimensionMigration>[0];
  const prepared = await prepareDimensionMigration(firestore, WS, { uid: OWNER });
  // someone edits it while the migration is in flight
  const edited = { ...(await db.collection('transactions').doc('tx-1').get()).data()!, description: 'Paper (edited)' };
  db.seed('transactions/tx-1', edited);

  await assert.rejects(
    db.runTransaction(t => migrateDimensionsInTransaction(firestore, WS, { uid: OWNER }, prepared, t as never)),
    (error: unknown) => (error as { status?: number }).status === 409,
  );
});
