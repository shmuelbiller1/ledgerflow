/**
 * The workspace-housekeeping batch: fourteen registered commands behind addresses that already existed —
 * merging two accounts, merging or deleting a contact, saving and removing a journal template, turning
 * on two-step login and the two-person rule, previewing and sending a scheduled report, and saving
 * document branding.
 *
 * Every one of these already had its work in a service (`accountMergeService`, `contactMergeService`,
 * `twoStepPolicyService`, `scheduledReportService`) or, in the two template and branding cases, was a
 * small transaction the command now owns. What a route move can break is what is tested here: the
 * metadata an assistant reads, the preview that writes nothing, the runner's role and workspace checks,
 * the service's own status and words coming back out of the runner, and the answers each address gave
 * before — including the three different ways these handlers worded a malformed body.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { RequestUser } from '../server/auth/requestUser';
import { CommandRegistry } from '../server/commands/registry';
import { createCommandRouter } from '../server/routes/commandRoutes';
import { COMMAND_ROLES, type AnyCommandDefinition, type CommandExecutionOutcome } from '../server/commands/types';
import {
  WORKSPACE_HOUSEKEEPING_COMMANDS, accountMergeCommand, accountMergePreviewCommand, brandingSaveCommand,
  contactDeleteCommand, contactMergeCommand, journalTemplateRemoveCommand, journalTemplateSaveCommand,
  portalLinkCreateCommand, portalLinkRevokeCommand, signLinkCreateCommand,
  reportSchedulePreviewCommand, reportScheduleSendCommand, twoPersonCommand, twoStepCommand,
} from '../server/commands/workspaceHousekeeping';
import { legacyAnswer } from '../server/utils/legacyCommandRoute';
import { runRegisteredCommand } from '../server/utils/commandExecutor';
import { MemoryDb, runnerDependencies, type TestCounters } from './helpers/commandTestUtils';

const OWNER = 'owner-1';
const ACCOUNTANT = 'acct-1';
const BOOKKEEPER = 'book-1';
const VIEWER = 'view-1';
const OUTSIDER = 'out-1';
const WS = 'ws-housekeeping-test';
const OTHER = 'ws-housekeeping-other';

const COMMANDS: AnyCommandDefinition[] = WORKSPACE_HOUSEKEEPING_COMMANDS;

function seed(db: MemoryDb): void {
  db.seed(`workspaces/${WS}`, {
    uid: OWNER, name: 'Housekeeping Co', currency: 'USD',
    members: [OWNER, ACCOUNTANT, BOOKKEEPER, VIEWER],
    roles: { [OWNER]: 'owner', [ACCOUNTANT]: 'accountant', [BOOKKEEPER]: 'bookkeeper', [VIEWER]: 'viewer' },
  });
  db.seed(`workspaces/${OTHER}`, { uid: OUTSIDER, name: 'Other', currency: 'USD', members: [OUTSIDER] });
  db.seed(`chartAccounts/acc_exp`, { workspaceId: WS, name: 'Rent', code: '6100', type: 'expense' });
  db.seed(`chartAccounts/acc_acc`, { workspaceId: WS, name: 'Prepaid', code: '1400', type: 'asset' });
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

test('the fourteen commands publish a schema, roles, a parseable example and refusals', () => {
  assert.equal(COMMANDS.length, 14);
  for (const command of COMMANDS) {
    assert.equal(command.scope ?? 'workspace', 'workspace', `${command.name} works on a workspace`);
    assert.ok(command.roles.length > 0 && command.roles.every(role => COMMAND_ROLES.includes(role)), `${command.name} names real roles`);
    assert.equal(command.input.safeParse(command.describe.example).success, true, `${command.name} example parses`);
    assert.ok(command.describe.refusals.length >= 1, `${command.name} lists its refusals`);
    assert.ok(command.describe.sentence.length > 40, `${command.name} says what it is for and when not to use it`);
    // nothing here posts an entry, so nothing declares the runner's date; a merge checks the periods of
    // the records it moves itself, in its own words
    assert.equal(command.dated, undefined, `${command.name} leaves the period lock to its service`);
    // the audit line these writes have always written stays the service's or the handler's
    assert.equal(command.audit({} as never, {} as never), null, `${command.name} audits nothing itself`);
  }
  assert.deepEqual(accountMergeCommand.roles, ['owner', 'accountant']);
  assert.deepEqual(portalLinkCreateCommand.roles, ['owner', 'accountant', 'bookkeeper']);
  assert.deepEqual(signLinkCreateCommand.roles, ['owner', 'accountant', 'bookkeeper']);
  assert.deepEqual(contactMergeCommand.roles, ['owner', 'accountant'], 'merging contacts stays with owners and accountants');
  assert.deepEqual(contactDeleteCommand.roles, ['owner', 'accountant', 'bookkeeper'], 'deleting an unused contact is a writer job');
  assert.deepEqual(journalTemplateSaveCommand.roles, ['owner', 'accountant', 'bookkeeper']);
  assert.deepEqual(twoStepCommand.roles, ['owner']);
  assert.deepEqual(twoPersonCommand.roles, ['owner']);
  // the two security settings were platform-admin allowed through the handler; keep that
  assert.equal(twoStepCommand.allowPlatformAdmin, true);
  assert.equal(twoPersonCommand.allowPlatformAdmin, true);
  assert.deepEqual(COMMANDS.map(command => command.name).sort(), [
    'account.merge', 'account.mergepreview', 'contact.delete', 'contact.merge',
    'journaltemplate.remove', 'journaltemplate.save',
    'reportschedule.preview', 'reportschedule.send',
    'security.twoperson', 'security.twostep', 'workspace.branding',
    'portal.linkcreate', 'portal.linkrevoke', 'estimate.signlink',
  ].sort());
});

test('the inverses are the two security settings and a portal link, and nothing else', () => {
  // the settings can be put back exactly; a merge, a delete, a sent report and a saved template cannot
  assert.deepEqual(twoStepCommand.inverse?.({ required: true }, {}), { command: 'security.twostep', input: { required: false } });
  assert.deepEqual(twoPersonCommand.inverse?.({ on: false }, {}), { command: 'security.twoperson', input: { on: true } });
  // a portal link can be put away exactly, and the undo names the command that does it
  assert.deepEqual(portalLinkCreateCommand.inverse?.({ customerId: 'c1' }, {}), { command: 'portal.linkrevoke', input: { customerId: 'c1' } });
  const byName = new Map(COMMANDS.map(command => [command.name, command]));
  for (const command of [accountMergeCommand, accountMergePreviewCommand, contactMergeCommand, contactDeleteCommand,
    journalTemplateSaveCommand, journalTemplateRemoveCommand, signLinkCreateCommand,
    reportSchedulePreviewCommand, reportScheduleSendCommand, brandingSaveCommand, portalLinkRevokeCommand]) {
    assert.equal(command.inverse?.({} as never, {} as never), null, `${command.name} is one-way`);
  }
  for (const [from, target] of [[twoStepCommand, 'security.twostep'], [twoPersonCommand, 'security.twoperson'], [portalLinkCreateCommand, 'portal.linkrevoke']] as const) {
    const inverse = from.inverse?.({ required: true, on: true, customerId: 'c1' } as never, {} as never);
    assert.ok(inverse);
    const command = byName.get(target);
    assert.ok(command, `${from.name} advertises ${target}, which exists`);
    assert.equal(command.input.safeParse(inverse.input).success, true, `${from.name} → ${target} parses`);
  }
});

test('a preview writes nothing and says what would change', async () => {
  const harness = await createHarness();
  try {
    const cases: Array<[string, Record<string, unknown>, RegExp]> = [
      ['account.merge', { fromId: 'acc_exp', intoId: 'acc_acc' }, /Merge account acc_exp/],
      ['contact.merge', { side: 'customer', keepId: 'c1', mergeId: 'c2' }, /Merge the customer c2/],
      ['journaltemplate.save', { name: 'Rent', lines: [{ accountId: 'acc_exp', debitCents: 1, creditCents: 0 }, { accountId: 'acc_acc', debitCents: 0, creditCents: 1 }] }, /Rent/],
      ['security.twostep', { required: true }, /two-step login/],
      ['security.twoperson', { on: true }, /two-person rule/],
      ['workspace.branding', { branding: { color: '#1f6feb' } }, /branding/i],
    ];
    for (const [name, input, expected] of cases) {
      const response = await harness.preview(ACCOUNTANT, name, input);
      // an owner-only command answers 403 for an accountant: the preview runs the same checks
      if (response.status === 403) {
        const asOwner = await harness.preview(OWNER, name, input);
        assert.equal(asOwner.status, 200, `${name} previews for an owner`);
        const body = await asOwner.json() as { preview: { title: string; lines: string[] } };
        assert.match(body.preview.title, expected, `${name} names what would change`);
        continue;
      }
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
    for (const name of ['account.merge', 'contact.merge', 'journaltemplate.save', 'security.twostep']) {
      const response = await harness.run(VIEWER, name, { fromId: 'a', intoId: 'b', side: 'customer', keepId: 'a', mergeId: 'b', name: 't', lines: [], required: true });
      assert.equal(response.status, 403, `${name} refuses a viewer`);
      assert.match(((await response.json()) as { message: string }).message, /requires one of/);
    }
    // a bookkeeper keeps the books but does not merge accounts or change the security settings
    assert.equal((await harness.run(BOOKKEEPER, 'account.merge', { fromId: 'a', intoId: 'b' })).status, 403);
    assert.equal((await harness.run(BOOKKEEPER, 'security.twostep', { required: true })).status, 403);
    // an accountant does not change a security setting either
    assert.equal((await harness.run(ACCOUNTANT, 'security.twostep', { required: true })).status, 403);
    // not a member at all
    assert.equal((await harness.run(OUTSIDER, 'contact.merge', { side: 'customer', keepId: 'a', mergeId: 'b' }, WS)).status, 403);
    assert.equal(harness.counters.runs, 0, 'no handler ran for a refusal');
  } finally {
    await harness.close();
  }
});

test('a malformed body is refused by the schema, and a handler rule keeps its own sentence', async () => {
  const harness = await createHarness();
  try {
    const merge = await harness.run(ACCOUNTANT, 'account.merge', { fromId: 'a' });
    assert.equal(merge.status, 400);
    assert.equal(((await merge.json()) as { code?: string }).code, 'INVALID_INPUT');

    // the template's own rule (at least two lines, balanced), in the service's words — not the runner's
    const unbalanced = await harness.run(BOOKKEEPER, 'journaltemplate.save', {
      name: 'Broken', lines: [{ accountId: 'acc_exp', debitCents: 500, creditCents: 0 }, { accountId: 'acc_acc', debitCents: 0, creditCents: 400 }],
    });
    assert.equal(unbalanced.status, 400);
    // the refusal is the template rule's own sentence and status, not the runner's input error
    const refusal = await unbalanced.json() as { code?: string; message: string };
    assert.notEqual(refusal.code, 'INVALID_INPUT');
    assert.match(refusal.message, /balance|line|cents|account/i);

    // and a template that saves is saved, with its audit line
    const saved = await harness.run(BOOKKEEPER, 'journaltemplate.save', {
      name: 'Rent split', lines: [{ accountId: 'acc_exp', debitCents: 500, creditCents: 0 }, { accountId: 'acc_acc', debitCents: 0, creditCents: 500 }],
    });
    assert.equal(saved.status, 200);
    const body = await saved.json() as { data: { template: { name: string; lines: unknown[] }; replaced: boolean } };
    assert.equal(body.data.template.name, 'Rent split');
    assert.equal(body.data.replaced, false);
  } finally {
    await harness.close();
  }
});

test('each address keeps its own words for a malformed body and a server fault', () => {
  const invalid: CommandExecutionOutcome = { ok: false, status: 400, command: 'x', message: 'Invalid command input', code: 'INVALID_INPUT', error: { issues: [{ message: 'Bad' }] } };
  const failed: CommandExecutionOutcome = { ok: false, status: 500, command: 'x', message: 'An internal server error occurred.', error: new Error('boom') };
  const refused: CommandExecutionOutcome = { ok: false, status: 404, command: 'x', message: 'That template is not in this workspace (already removed?)' };

  // the account merge handler: one sentence, no issues, and its own 500 sentence with the cause
  assert.deepEqual(legacyAnswer({ badBody: 'Choose the account to merge and the one to keep', failed: 'The accounts could not be merged' })(invalid),
    { status: 400, body: { status: 'error', message: 'Choose the account to merge and the one to keep' } });
  assert.deepEqual(legacyAnswer({ badBody: 'Choose the account to merge and the one to keep', failed: 'The accounts could not be merged' })(failed),
    { status: 500, body: { status: 'error', message: 'The accounts could not be merged', details: 'boom' } });
  // the contact and template handlers attached the issues
  assert.deepEqual(legacyAnswer({ badBody: 'Invalid request', failed: 'The contacts could not be merged', issues: true })(invalid),
    { status: 400, body: { status: 'error', message: 'Invalid request', details: [{ message: 'Bad' }] } });
  // the template remove handler answered the service's 404 in the service's own words
  assert.deepEqual(legacyAnswer({ badBody: 'Check the template', failed: 'The template could not be removed' })(refused),
    { status: 404, body: { status: 'error', message: 'That template is not in this workspace (already removed?)' } });
  // and a success spreads the result under `status: 'success'`
  assert.deepEqual(legacyAnswer({ badBody: 'x', failed: 'y' })({ ok: true, status: 200, command: 'x', data: { changed: 2 }, replayed: false }),
    { status: 200, body: { status: 'success', changed: 2 } });
  // the journal-template save wrapped its result in `data` (the other addresses spread it)
  assert.deepEqual(legacyAnswer({ badBody: 'x', failed: 'y', insideData: true })({ ok: true, status: 200, command: 'x', data: { replaced: false }, replayed: false }),
    { status: 200, body: { status: 'success', data: { replaced: false } } });
});

test('a high-risk setting keeps its established answer on its old address and the two-step gate on the command router', async () => {
  // The security routes answered an owner who had signed in without a code; the command router does not.
  // The wrapper says so with `legacyRoute`, so a moved route does not start refusing working requests.
  const db = new MemoryDb();
  seed(db);
  const counters: TestCounters = { runs: 0, previews: 0, afterCommit: 0, audits: 0 };
  const dependencies = runnerDependencies(db, counters);
  const registry = new CommandRegistry();
  registry.register(twoStepCommand);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: RequestUser }).user = { uid: OWNER, aal: 'aal1' };
    next();
  });
  app.use('/api/v1/commands', createCommandRouter(registry, dependencies));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const viaRouter = await fetch(`${base}/api/v1/commands/security.twostep`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: WS, input: { required: true } }),
    });
    assert.equal(viaRouter.status, 403, 'the command router still needs a code-confirmed session');
    assert.match(((await viaRouter.json()) as { message: string }).message, /two-step verification/);

    // what the old address does: the same runner, told this is the route it has always been
    const outcome = await runRegisteredCommand(
      { user: { uid: OWNER, aal: 'aal1' } } as never,
      { definition: twoStepCommand, workspaceId: WS, legacyRoute: true, input: { workspaceId: WS, required: true } },
      dependencies,
    );
    // past the gate, the service's own rule answers — here an owner who has not set up two-step
    // login yet gets the service's 409 sentence, exactly as the route answered it before
    assert.deepEqual(legacyAnswer({ badBody: 'Say whether two-step login is required', failed: 'The setting could not be saved' })(outcome), {
      status: 409,
      body: { status: 'error', message: 'Turn on two-step login for your own account first (Settings → Security), then sign in again with a code' },
    });
    assert.equal(counters.runs, 0, 'the service refused before the handler wrote anything');
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
