/**
 * Person-scoped commands for the caller's own account (L-85 recovery codes, S-18 notice emails,
 * DA-01 groups of books): the legacy /api/v1/account write routes keep their request/response
 * shapes while the registered commands run the work. Covers normal, refused and retried calls, the
 * read-only previews, audit entries under the person scope, inverses run as ordinary commands, and
 * the runner's person scope (no workspace gates the write; unauthenticated is refused).
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
  accountMakeRecoveryCodesCommand,
  accountSetNotificationEmailCommand,
  accountUseRecoveryCodeCommand,
} from '../server/commands/account';
import {
  groupCreateCommand,
  groupDeleteCommand,
  groupKeepRatesCommand,
  groupSetLineMergesCommand,
  groupShareCommand,
  groupUnshareCommand,
  groupUpdateCommand,
  setGroupEmailLookupForTests,
} from '../server/commands/groups';
import { previewCommand } from '../server/utils/commandExecutor';
import { setFactorRemoverForTests } from '../server/services/recoveryCodeService';
import { BRAND_NAME } from '../config/brand';
import {
  MemoryDb,
  fakeRequest,
  runnerDependencies,
  type TestCounters,
} from './helpers/commandTestUtils';
import { createAccountRouter } from '../server/routes/accountRoutes';

const ANN = 'ann-1';
const EMAIL: Record<string, string> = { 'accountant@example.test': 'user-acc-1', 'ann@example.test': ANN };

type AuditEntry = { workspaceId: string; uid: string; action: string; entityType: string; entityId: string; details: Record<string, unknown> };

async function createHarness() {
  const db = new MemoryDb();
  const factorsByUid = new Map<string, string[]>();
  (db as unknown as { pool: unknown }).pool = {
    // verifiedFactors' only query; anything else pooling through here is a test bug
    async query(sql: string, params: unknown[]) {
      if (String(sql).includes('auth.mfa_factors')) return { rows: (factorsByUid.get(String(params?.[0])) || []).map(id => ({ id })) };
      throw new Error(`Unexpected pool query in person-command test: ${sql}`);
    },
  };
  factorsByUid.set(ANN, ['factor-a1']);
  setGroupEmailLookupForTests(async email => EMAIL[email]);
  setFactorRemoverForTests(async (_db, uid, factorId) => {
    factorsByUid.set(uid, (factorsByUid.get(uid) || []).filter(id => id !== factorId));
  });

  const counters: TestCounters = { runs: 0, previews: 0, afterCommit: 0, audits: 0 };
  const auditEntries: AuditEntry[] = [];
  const state = { failAudits: false };
  const dependencies = runnerDependencies(db, counters);
  dependencies.auditWriter = async input => {
    if (state.failAudits) throw new Error('audit writer is down');
    counters.audits++;
    auditEntries.push(input as AuditEntry);
    return 'account-audit-test';
  };

  // workspaces ANN can open: her own, one shared by membership; ws-other stays invisible
  db.seed('workspaces/ws-own', { uid: ANN, members: [ANN], currency: 'USD' });
  db.seed('workspaces/ws-member', { uid: 'bob-1', members: ['bob-1', ANN], currency: 'USD' });
  db.seed('workspaces/ws-other', { uid: 'bob-1', members: ['bob-1'], currency: 'USD' });
  db.seed(`users/${ANN}`, { uid: ANN, email: 'ann@example.test' });
  db.seed('workspaceGroups/grp_family01', {
    ownerUid: ANN, name: 'Family', workspaceIds: ['ws-own', 'ws-member'], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  });
  db.seed('workspaceGroups/grp_other999', {
    ownerUid: 'bob-1', name: 'Bob group', workspaceIds: ['ws-other'], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  });

  const commandRegistry = new CommandRegistry();
  for (const command of ALL_TEN) commandRegistry.register(command);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const uid = req.header('x-test-uid');
    if (uid) (req as unknown as { user: RequestUser }).user = { uid, email: `${uid}@example.test`, aal: 'aal2' };
    next();
  });
  app.use('/api/v1/account', createAccountRouter(dependencies));
  app.use('/api/v1/commands', createCommandRouter(commandRegistry, dependencies));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const call = (uid: string | null, method: string, path: string, body?: unknown, operationId?: string) => fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(uid ? { 'x-test-uid': uid } : {}),
      ...(operationId ? { 'idempotency-key': operationId } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  return {
    db,
    counters,
    auditEntries,
    factors: factorsByUid,
    get failAudits() { return state.failAudits; },
    set failAudits(value: boolean) { state.failAudits = value; },
    call,
    async close() {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}

const ALL_TEN: AnyCommandDefinition[] = [
  accountMakeRecoveryCodesCommand,
  accountSetNotificationEmailCommand,
  accountUseRecoveryCodeCommand,
  groupCreateCommand,
  groupDeleteCommand,
  groupKeepRatesCommand,
  groupSetLineMergesCommand,
  groupShareCommand,
  groupUnshareCommand,
  groupUpdateCommand,
];

test('the ten person commands publish schema, roles, scope, risk and a parseable example', () => {
  assert.equal(ALL_TEN.length, 10);
  for (const command of ALL_TEN) {
    assert.deepEqual(command.roles, COMMAND_ROLES, `${command.name}: every signed-in person may run it on their own account`);
    assert.equal(command.scope, 'person', `${command.name} is person-scoped`);
    assert.equal(command.risk, 'normal', `${command.name} keeps the legacy route's session requirements`);
    assert.equal(command.input.safeParse(command.describe.example).success, true, `${command.name} example parses`);
    assert.ok(command.describe.refusals.length >= 2, `${command.name} lists its refusals`);
  }
  // the registry refuses a person command that pretends to read workspace state
  assert.throws(
    () => new CommandRegistry().register({ ...accountMakeRecoveryCodesCommand, capacity: 'transactions' as never }),
    /person-scoped/,
  );
});

test('inverses: notice email restores the earlier mode; group changes restore or remove', () => {
  assert.deepEqual(
    accountSetNotificationEmailCommand.inverse?.({ mode: 'daily' }, { mode: 'daily', previousMode: 'off', uid: ANN }),
    { command: 'account.setnotificationemail', input: { mode: 'off' } },
  );
  const group = { id: 'grp_family01', name: 'Family', workspaceIds: ['ws-own'] };
  assert.deepEqual(groupCreateCommand.inverse?.({} as never, { group }), { command: 'groups.delete', input: { groupId: 'grp_family01' } });
  assert.equal(groupDeleteCommand.inverse?.({ groupId: 'g' }, { name: 'G' }), null, 'a deleted group has no undo today');
  assert.equal(accountMakeRecoveryCodesCommand.inverse, undefined, 'recovery codes cannot be un-made');
  assert.equal(accountUseRecoveryCodeCommand.inverse, undefined);
  const updateResult = { group, previous: { name: 'Old name', workspaceIds: ['ws-own', 'ws-member'] } };
  assert.deepEqual(
    groupUpdateCommand.inverse?.({ groupId: 'grp_family01', name: 'Family', workspaceIds: ['ws-own'] }, updateResult as never),
    { command: 'groups.update', input: { groupId: 'grp_family01', name: 'Old name', workspaceIds: ['ws-own', 'ws-member'] } },
  );
  assert.equal(groupUpdateCommand.inverse?.({ groupId: 'grp_family01' }, { group, previous: {} } as never), null, 'an empty update does not offer an undo');
  assert.deepEqual(
    groupShareCommand.inverse?.({ groupId: 'grp_family01', email: 'a@b.test' }, { group, changed: true, withUid: 'user-acc-1' } as never),
    { command: 'groups.unshare', input: { groupId: 'grp_family01', withUid: 'user-acc-1' } },
  );
  assert.equal(groupShareCommand.inverse?.({ groupId: 'grp_family01', email: 'a@b.test' }, { group, changed: false, withUid: 'user-acc-1' } as never), null, 're-sharing changes nothing to undo');
  const unshared = { changed: true, removedEmail: 'a@b.test', left: false };
  assert.deepEqual(groupUnshareCommand.inverse?.({ groupId: 'grp_family01', withUid: 'user-acc-1' }, unshared), { command: 'groups.share', input: { groupId: 'grp_family01', email: 'a@b.test' } });
  assert.equal(groupUnshareCommand.inverse?.({ groupId: 'g', withUid: 'me' }, { changed: true, left: true }), null, 'leaving cannot be undone by the person who left');
  assert.deepEqual(
    groupKeepRatesCommand.inverse?.(
      { groupId: 'grp_family01', reportCurrency: 'USD', startDate: '2026-01-01', endDate: '2026-12-31', rates: { EUR: { closing: 1.2, average: 1.1, historical: 1 } } },
      { group, previousRates: { EUR: { closing: 1.15, average: 1.1, historical: 1.05 } } } as never),
    { command: 'groups.keeprates', input: { groupId: 'grp_family01', reportCurrency: 'USD', startDate: '2026-01-01', endDate: '2026-12-31', rates: { EUR: { closing: 1.15, average: 1.1, historical: 1.05 } } } },
  );
  assert.equal(groupKeepRatesCommand.inverse?.({ groupId: 'g' }, { group } as never), null, 'a brand-new rate key cannot be un-kept');
  assert.deepEqual(
    groupSetLineMergesCommand.inverse?.({ groupId: 'grp_family01', merges: { a: 'b' } }, { merges: { a: 'b' }, previous: { c: 'd' } }),
    { command: 'groups.setlinemerges', input: { groupId: 'grp_family01', merges: { c: 'd' } } },
  );
});

test('PUT /notification-email keeps its response, refusals, audit and retry behavior', async t => {
  const harness = await createHarness();
  t.after(harness.close);
  const { db, counters, auditEntries, call } = harness;

  const saved = await call(ANN, 'PUT', '/api/v1/account/notification-email', { mode: 'daily' });
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { status: 'success', mode: 'daily' });
  const doc = db.read(`users/${ANN}`);
  assert.equal(doc?.notificationEmail, 'daily');
  assert.equal(doc?.email, 'ann@example.test', 'the rest of the user record is untouched');
  assert.equal(counters.audits, 1);
  assert.equal(auditEntries[0].workspaceId, `person:${ANN}`, 'audited under the person scope');
  assert.equal(auditEntries[0].action, 'ACCOUNT_NOTIFICATION_EMAIL_SET');
  assert.deepEqual(auditEntries[0].details, { description: 'Notice emails: off → daily', mode: 'daily', previousMode: 'off' });

  const unchanged = await call(ANN, 'PUT', '/api/v1/account/notification-email', { mode: 'daily' });
  assert.equal(unchanged.status, 200);
  assert.equal(counters.audits, 1, 'no audit entry when nothing changed');

  const refused = await call(ANN, 'PUT', '/api/v1/account/notification-email', { mode: 'hourly' });
  assert.equal(refused.status, 400);
  assert.deepEqual(await refused.json(), { status: 'error', message: 'Choose off, immediate or daily' });
  assert.equal(counters.audits, 1, 'a refusal never audits');

  const first = await call(ANN, 'PUT', '/api/v1/account/notification-email', { mode: 'immediate' }, 'op-notify-1');
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  const replay = await call(ANN, 'PUT', '/api/v1/account/notification-email', { mode: 'immediate' }, 'op-notify-1');
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), firstBody, 'a retry replays the stored answer');
  assert.equal(counters.audits, 2, 'the replay does not audit again');
  const conflict = await call(ANN, 'PUT', '/api/v1/account/notification-email', { mode: 'off' }, 'op-notify-1');
  assert.equal(conflict.status, 409);

  assert.equal((await call(null, 'PUT', '/api/v1/account/notification-email', { mode: 'off' })).status, 401, 'anonymous is refused');
  const guest = await call('dana-1', 'PUT', '/api/v1/account/notification-email', { mode: 'daily' });
  assert.equal(guest.status, 200, 'a person with no workspace membership still runs it — person scope');
  assert.equal(db.read(`workspaces/person:dana-1`), undefined, 'no workspace document is invented for the person scope');
});

test('groups: create, update, delete keep the legacy shapes, refusals, audits and replays', async t => {
  const harness = await createHarness();
  t.after(harness.close);
  const { db, auditEntries, call } = harness;

  const made = await call(ANN, 'POST', '/api/v1/account/groups', { name: 'My companies', workspaceIds: ['ws-own', 'ws-member'] }, 'op-group-create');
  assert.equal(made.status, 201);
  const madeBody = await made.json() as { status: string; group: { id: string; name: string; mine: boolean; workspaceIds: string[] } };
  assert.equal(madeBody.status, 'success');
  assert.match(madeBody.group.id, /^grp_[a-z0-9]{20}$/);
  assert.equal(madeBody.group.name, 'My companies');
  assert.deepEqual(madeBody.group.workspaceIds, ['ws-own', 'ws-member']);
  assert.equal(madeBody.group.mine, true);
  assert.equal(auditEntries.at(-1)?.action, 'GROUP_CREATED');
  assert.equal(auditEntries.at(-1)?.entityType, 'workspaceGroups');

  const groupId = madeBody.group.id;
  const replay = await call(ANN, 'POST', '/api/v1/account/groups', { name: 'My companies', workspaceIds: ['ws-own', 'ws-member'] }, 'op-group-create');
  assert.equal(replay.status, 201);
  assert.deepEqual((await replay.json() as typeof madeBody).group.id, groupId, 'a retried create does not make a second group');
  assert.equal(db.entries('workspaceGroups').filter(row => row.data.ownerUid === ANN).length, 2, 'the seeded group and the created one, nothing more');
  const conflict = await call(ANN, 'POST', '/api/v1/account/groups', { name: 'Different', workspaceIds: [] }, 'op-group-create');
  assert.equal(conflict.status, 409);

  assert.equal((await call(ANN, 'POST', '/api/v1/account/groups', { workspaceIds: [] })).status, 400, 'unnamed group is refused');
  assert.equal((await call(ANN, 'POST', '/api/v1/account/groups', { name: 'x', workspaceIds: 'ws-own' })).status, 400, 'non-list members keep the legacy refusal');
  const invisible = await call(ANN, 'POST', '/api/v1/account/groups', { name: 'x', workspaceIds: ['ws-other'] });
  assert.equal(invisible.status, 404);
  assert.deepEqual(await invisible.json(), { status: 'error', message: 'Workspace ws-other not found' });
  assert.equal((await call(ANN, 'POST', '/api/v1/account/groups', { name: 'x', workspaceIds: ['ws-own', 'ws-own'] })).status, 400);

  const renamed = await call(ANN, 'PUT', `/api/v1/account/groups/${groupId}`, { name: 'Family companies' }, 'op-group-rename');
  assert.equal(renamed.status, 200);
  assert.deepEqual((await renamed.json() as typeof madeBody).group.name, 'Family companies');
  const updateAudit = auditEntries.at(-1)!;
  assert.equal(updateAudit.action, 'GROUP_UPDATED');
  assert.deepEqual(updateAudit.details.previous, { name: 'My companies' }, 'the audit entry carries what the inverse needs');
  const auditsAfterRename = auditEntries.length;
  const renamedReplay = await call(ANN, 'PUT', `/api/v1/account/groups/${groupId}`, { name: 'Family companies' }, 'op-group-rename');
  assert.equal(renamedReplay.status, 200);
  assert.equal(auditEntries.length, auditsAfterRename, 'replayed update does not audit again');

  assert.equal((await call(ANN, 'PUT', '/api/v1/account/groups/grp_other999', { name: 'Takeover' })).status, 404, 'someone else’s group answers like a missing one');
  assert.equal((await call(ANN, 'PUT', '/api/v1/account/groups/not-a-group', { name: 'x' })).status, 404);

  // A member ANN can no longer open stays in the group unseen — including in the previous values
  // the inverse and the audit entry carry, which would otherwise hand its id and shares back.
  db.seed(`workspaceGroups/${groupId}`, {
    ...db.read(`workspaceGroups/${groupId}`),
    workspaceIds: ['ws-own', 'ws-member', 'ws-other'],
    parentId: 'ws-own',
    ownership: { 'ws-other': 80, 'ws-member': 70 },
    investments: { 'ws-other': 'acct-hidden' },
    acquired: { 'ws-other': '2020-01-01' },
  });
  const hidden = await call(ANN, 'PUT', `/api/v1/account/groups/${groupId}`, { ownership: { 'ws-member': 60 } }, 'op-group-hidden');
  assert.equal(hidden.status, 200, await hidden.clone().text());
  const hiddenBody = await hidden.json() as typeof madeBody;
  assert.ok(!hiddenBody.group.workspaceIds.includes('ws-other'), 'the visible group hides the workspace as before');
  const hiddenPrevious = auditEntries.at(-1)?.details.previous as Record<string, unknown>;
  assert.deepEqual(hiddenPrevious, { ownership: { 'ws-member': 70 } }, 'the previous values carry only what ANN can open');
  const hiddenInverse = groupUpdateCommand.inverse?.({ groupId }, { group: hiddenBody.group, previous: hiddenPrevious } as never);
  assert.ok(hiddenInverse && !JSON.stringify(hiddenInverse).includes('ws-other'), 'the inverse cannot name the hidden workspace either');

  const removed = await call(ANN, 'DELETE', `/api/v1/account/groups/${groupId}`, undefined, 'op-group-delete');
  assert.equal(removed.status, 200);
  assert.deepEqual(await removed.json(), { status: 'success' }, 'the delete body stays minimal');
  assert.equal(db.read(`workspaceGroups/${groupId}`), undefined);
  assert.equal(auditEntries.at(-1)?.action, 'GROUP_DELETED');
  const auditsAfterDelete = auditEntries.length;
  const removedReplay = await call(ANN, 'DELETE', `/api/v1/account/groups/${groupId}`, undefined, 'op-group-delete');
  assert.equal(removedReplay.status, 200, 'a retried delete replays success');
  assert.equal((await call(ANN, 'DELETE', `/api/v1/account/groups/${groupId}`)).status, 404, 'a fresh delete is refused');
  assert.equal(auditEntries.length, auditsAfterDelete, 'the replay audited nothing new');
});

test('groups: lines and kept rates keep their validation, audit and inverse behavior', async t => {
  const harness = await createHarness();
  t.after(harness.close);
  const { db, auditEntries, call } = harness;
  const groupId = 'grp_family01';

  const merges = { 'income|Sales|Retail': 'income|Sales' };
  const lined = await call(ANN, 'PUT', `/api/v1/account/groups/${groupId}/lines`, { merges }, 'op-lines-1');
  assert.equal(lined.status, 200);
  assert.deepEqual(await lined.json(), { status: 'success', merges });
  assert.deepEqual(db.read(`workspaceGroups/${groupId}`)?.lineMerges, merges);
  assert.equal(auditEntries.at(-1)?.action, 'GROUP_LINES_SET');
  assert.equal((await call(ANN, 'PUT', `/api/v1/account/groups/${groupId}/lines`, { merges }, 'op-lines-1')).status, 200, 'replay');
  assert.equal((await call(ANN, 'PUT', `/api/v1/account/groups/${groupId}/lines`, { merges: { 'income|A': 'income|A' } })).status, 400, 'a line cannot combine into itself');
  assert.equal((await call(ANN, 'PUT', `/api/v1/account/groups/grp_other999/lines`, { merges })).status, 404);

  const rates = { EUR: { closing: 1.2, average: 1.1, historical: 1 } };
  const body = { reportCurrency: 'USD', startDate: '2026-01-01', endDate: '2026-12-31', rates };
  const kept = await call(ANN, 'PUT', `/api/v1/account/groups/${groupId}/rates`, body, 'op-rates-1');
  assert.equal(kept.status, 200);
  const keptBody = await kept.json() as { group: { rates: Record<string, unknown> } };
  assert.deepEqual(keptBody.group.rates['USD:2026-01-01:2026-12-31'], rates);
  assert.equal(auditEntries.at(-1)?.action, 'GROUP_RATES_KEPT');
  assert.equal(auditEntries.at(-1)?.entityId, groupId);
  assert.equal((await call(ANN, 'PUT', `/api/v1/account/groups/${groupId}/rates`, body, 'op-rates-1')).status, 200, 'replay');
  const bad = await call(ANN, 'PUT', `/api/v1/account/groups/${groupId}/rates`, { ...body, rates: { USD: { closing: 1, average: 1, historical: 1 } } });
  assert.equal(bad.status, 400);
  assert.match((await bad.json() as { message: string }).message, /no rates to keep for USD/);

  // undo: the second keep is inverted to the first rates
  const second = { ...body, rates: { EUR: { closing: 1.3, average: 1.25, historical: 1.1 } } };
  await call(ANN, 'PUT', `/api/v1/account/groups/${groupId}/rates`, second, 'op-rates-2');
  const inverse = groupKeepRatesCommand.inverse?.(
    { groupId, ...second },
    { group: keptBody.group, previousRates: rates } as never,
  );
  assert.ok(inverse);
  await call(ANN, 'PUT', `/api/v1/account/groups/${groupId}/rates`, inverse!.input, 'op-rates-3');
  assert.deepEqual((db.read(`workspaceGroups/${groupId}`)?.rates as Record<string, unknown>)['USD:2026-01-01:2026-12-31'], rates, 'the inverse restored the earlier rates');
});

test('groups: share and unshare keep lookup, refusals, audit and replays', async t => {
  const harness = await createHarness();
  t.after(harness.close);
  const { db, auditEntries, call } = harness;
  const groupId = 'grp_family01';

  const shared = await call(ANN, 'POST', `/api/v1/account/groups/${groupId}/share`, { email: '  Accountant@Example.TEST ' }, 'op-share-1');
  assert.equal(shared.status, 200);
  const sharedBody = await shared.json() as { group: { sharedWith: Array<{ uid: string; email: string }> } };
  assert.deepEqual(sharedBody.group.sharedWith, [{ uid: 'user-acc-1', email: 'accountant@example.test' }], 'the email is trimmed and lowered as before');
  assert.equal(auditEntries.at(-1)?.action, 'GROUP_SHARED');

  const auditsAfterShare = auditEntries.length;
  const again = await call(ANN, 'POST', `/api/v1/account/groups/${groupId}/share`, { email: 'accountant@example.test' });
  assert.equal(again.status, 200, 'sharing again is the legacy no-op');
  assert.equal(auditEntries.length, auditsAfterShare, 'an unchanged share does not audit');
  const replay = await call(ANN, 'POST', `/api/v1/account/groups/${groupId}/share`, { email: 'accountant@example.test' }, 'op-share-1');
  assert.equal(replay.status, 200);
  assert.equal(auditEntries.length, auditsAfterShare, 'replayed share neither writes nor audits');

  assert.equal((await call(ANN, 'POST', `/api/v1/account/groups/${groupId}/share`, { email: 'not-an-email' })).status, 400);
  const unknown = await call(ANN, 'POST', `/api/v1/account/groups/${groupId}/share`, { email: 'ghost@example.test' });
  assert.equal(unknown.status, 404);
  assert.deepEqual(await unknown.json(), { status: 'error', message: `No one signs in to ${BRAND_NAME} with that email yet: ask them to sign up first` });
  const self = await call(ANN, 'POST', `/api/v1/account/groups/${groupId}/share`, { email: 'ann@example.test' });
  assert.equal(self.status, 400);
  assert.deepEqual(await self.json(), { status: 'error', message: 'The group is already yours' });
  assert.equal((await call('bob-1', 'POST', `/api/v1/account/groups/${groupId}/share`, { email: 'accountant@example.test' })).status, 404, 'only the owner shares');

  const unshared = await call(ANN, 'DELETE', `/api/v1/account/groups/${groupId}/share/user-acc-1`, undefined, 'op-unshare-1');
  assert.equal(unshared.status, 200);
  assert.deepEqual(await unshared.json(), { status: 'success' });
  assert.equal(auditEntries.at(-1)?.action, 'GROUP_UNSHARED');
  assert.match(String(auditEntries.at(-1)?.details.description), /accountant@example\.test/);
  const doc = db.read(`workspaceGroups/${groupId}`);
  assert.deepEqual(doc?.sharedWith, [], 'the share is gone');
  assert.equal((await call(ANN, 'DELETE', `/api/v1/account/groups/${groupId}/share/user-acc-1`, undefined, 'op-unshare-1')).status, 200, 'replayed unshare stays a success');

  // leaving: someone with whom a group is shared takes themselves off
  await call(ANN, 'POST', `/api/v1/account/groups/${groupId}/share`, { email: 'accountant@example.test' });
  const left = await call('user-acc-1', 'DELETE', `/api/v1/account/groups/${groupId}/share/user-acc-1`);
  assert.equal(left.status, 200);
  assert.match(String(auditEntries.at(-1)?.details.description), /Left a group/);
  assert.equal((await call('user-acc-1', 'DELETE', `/api/v1/account/groups/${groupId}/share/${ANN}`)).status, 404, 'a sharee cannot remove the owner');
});

test('POST /recovery-codes keeps the shown-once response, the refusals and safe replay', async t => {
  const harness = await createHarness();
  t.after(harness.close);
  const { db, counters, auditEntries, call } = harness;

  const made = await call(ANN, 'POST', '/api/v1/account/recovery-codes', undefined, 'op-codes-1');
  assert.equal(made.status, 200);
  assert.equal(made.headers.get('cache-control'), 'no-store', 'the shown-once answer is never cached');
  const codes = (await made.json() as { status: string; codes: string[] }).codes;
  assert.equal(codes.length, 10);
  assert.ok(codes.every(code => /^[a-z2-9]{5}-[a-z2-9]{5}$/.test(code)));
  const stored = db.read(`recoveryCodes/${ANN}`);
  assert.ok(codes.every(code => !JSON.stringify(stored).includes(code) && !JSON.stringify(stored).includes(code.replace('-', ''))), 'only keyed hashes are stored');
  assert.equal(auditEntries.at(-1)?.action, 'ACCOUNT_RECOVERY_CODES_CREATED');
  assert.equal(auditEntries.at(-1)?.workspaceId, `person:${ANN}`);

  // The ten working codes are a two-step bypass: they are never written to the idempotency record,
  // so the retry replays only the uid and says so instead of answering with codes it cannot show.
  const record = db.read(`idempotencyKeys/person:${ANN}:account.makerecoverycodes:op-codes-1`);
  assert.ok(record, 'the retry record exists');
  assert.deepEqual(record?.result, { uid: ANN }, 'only the uid is recorded');
  for (const code of codes) {
    assert.ok(!JSON.stringify(record).includes(code) && !JSON.stringify(record).includes(code.replace('-', '')), `code ${code} is not in the record`);
  }

  const replay = await call(ANN, 'POST', '/api/v1/account/recovery-codes', undefined, 'op-codes-1');
  assert.equal(replay.status, 409);
  assert.deepEqual(await replay.json(), {
    status: 'error',
    message: 'These codes were already shown when the request was first made: make new ones if you did not keep them',
  });
  assert.equal(counters.audits, 1, 'a retry does not audit again');

  const again = await call(ANN, 'POST', '/api/v1/account/recovery-codes');
  assert.equal(again.status, 200);
  const renewed = (await again.json() as { codes: string[] }).codes;
  assert.notDeepEqual(renewed, codes, 'a fresh call replaces the codes, as it always did');

  const refused = await call('carol-1', 'POST', '/api/v1/account/recovery-codes');
  assert.equal(refused.status, 409);
  assert.deepEqual(await refused.json(), { status: 'error', message: 'Turn on two-step login first; recovery codes are for when the authenticator is lost' });
});

test('POST /recovery-codes/use keeps validation, lockout, spend semantics and replay', async t => {
  const harness = await createHarness();
  t.after(harness.close);
  const { db, auditEntries, call } = harness;

  const empty = await call(ANN, 'POST', '/api/v1/account/recovery-codes/use', {});
  assert.equal(empty.status, 400);
  assert.deepEqual(await empty.json(), { status: 'error', message: 'Enter a recovery code' });

  const codes = (await (await call(ANN, 'POST', '/api/v1/account/recovery-codes')).json() as { codes: string[] }).codes;
  const wrong = await call(ANN, 'POST', '/api/v1/account/recovery-codes/use', { code: 'zzzzz-zzzzz' });
  assert.equal(wrong.status, 400);
  assert.deepEqual(await wrong.json(), { status: 'error', message: 'That recovery code is not right, or was used before' });

  const used = await call(ANN, 'POST', '/api/v1/account/recovery-codes/use', { code: codes[2].replace('-', '').toUpperCase() }, 'op-use-1');
  assert.equal(used.status, 200);
  assert.deepEqual(await used.json(), { status: 'success', left: 9 });
  assert.equal(auditEntries.at(-1)?.action, 'ACCOUNT_RECOVERY_CODE_USED');
  assert.deepEqual(auditEntries.at(-1)?.details, { description: 'A recovery code was used and the authenticator removed; 9 codes left', left: 9 });

  const replay = await call(ANN, 'POST', '/api/v1/account/recovery-codes/use', { code: codes[2].replace('-', '').toUpperCase() }, 'op-use-1');
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), { status: 'success', left: 9 }, 'a retried use replays instead of refusing');
  assert.equal((await call(ANN, 'POST', '/api/v1/account/recovery-codes/use', { code: codes[2] })).status, 400, 'without the key a spent code is refused, as before');

  for (let i = 0; i < 4; i++) assert.equal((await call(ANN, 'POST', '/api/v1/account/recovery-codes/use', { code: 'yyyyy-yyyyy' })).status, 400);
  // one earlier wrong try: the fifth within the hour locks the step
  const locked = await call(ANN, 'POST', '/api/v1/account/recovery-codes/use', { code: codes[0] });
  assert.equal(locked.status, 429);
  assert.deepEqual(await locked.json(), { status: 'error', message: 'Too many wrong codes. Try again in an hour' });
  assert.ok(db.read(`recoveryCodes/${ANN}`), 'the lockout kept the codes stored');
});

test('a failed or retried use spends the code once, removes the authenticator once, and stays truthful', async t => {
  const harness = await createHarness();
  t.after(harness.close);
  const { db, factors, call } = harness;

  const codes = (await (await call(ANN, 'POST', '/api/v1/account/recovery-codes')).json() as { codes: string[] }).codes;

  // A refusal from the audit writer rolls the runner's transaction back: the code must come back
  // with it, and the authenticator must stay — otherwise a retry answers "already used" while the
  // second step is permanently off.
  harness.failAudits = true;
  const failed = await call(ANN, 'POST', '/api/v1/account/recovery-codes/use', { code: codes[0] }, 'op-use-fail');
  assert.equal(failed.status, 500);
  const afterFailure = db.read(`recoveryCodes/${ANN}`) as { codes: Array<{ usedAt?: string }> };
  assert.ok(afterFailure.codes.every(c => !c.usedAt), 'the rolled-back spend left every code unused');
  assert.deepEqual(factors.get(ANN), ['factor-a1'], 'the authenticator stays while the command did not commit');
  harness.failAudits = false;

  // The same operation id, retried for real after the failure: a normal success.
  const retried = await call(ANN, 'POST', '/api/v1/account/recovery-codes/use', { code: codes[0] }, 'op-use-fail');
  assert.equal(retried.status, 200);
  assert.deepEqual(await retried.json(), { status: 'success', left: 9 });
  assert.deepEqual(factors.get(ANN), [], 'the authenticator is removed once the command committed');

  // A replayed success runs no handler: the authenticator is not removed a second time (a second
  // removal would fail, or remove a factor set up again afterwards).
  factors.set(ANN, ['factor-b2']);
  const replay = await call(ANN, 'POST', '/api/v1/account/recovery-codes/use', { code: codes[0] }, 'op-use-fail');
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), { status: 'success', left: 9 });
  assert.deepEqual(factors.get(ANN), ['factor-b2'], 'a replay touches no authenticator');
});

test('previews are read-only and the direct command address needs no workspace', async t => {
  const harness = await createHarness();
  t.after(harness.close);
  const { db, counters, call } = harness;
  const deps = runnerDependencies(db, counters);
  const ann: RequestUser = { uid: ANN, email: 'ann@example.test', aal: 'aal2' };

  const emailPreview = await previewCommand(fakeRequest(ann, {}), { definition: accountSetNotificationEmailCommand, workspaceId: '', input: { mode: 'daily' } }, deps);
  assert.ok(emailPreview.ok);
  if (emailPreview.ok) assert.deepEqual(emailPreview.preview.lines, ['Today: No emails (the bell only)', 'After: One email a day with what I have not read']);
  assert.equal(db.read(`users/${ANN}`)?.notificationEmail, undefined, 'preview writes nothing');

  const updatePreview = await previewCommand(fakeRequest(ann, {}), { definition: groupUpdateCommand, workspaceId: '', input: { groupId: 'grp_family01', name: 'Family office' } }, deps);
  assert.ok(updatePreview.ok);
  if (updatePreview.ok) assert.ok(updatePreview.preview.lines.some(line => line === 'Name: Family → Family office'));
  assert.equal(db.read('workspaceGroups/grp_family01')?.name, 'Family', 'group preview writes nothing');

  const direct = await call(ANN, 'POST', '/api/v1/commands/account.setnotificationemail', { input: { mode: 'immediate' } });
  assert.equal(direct.status, 200, 'person commands run without a workspace id');
  const directBody = await direct.json() as { status: string; command: string; data: { mode: string } };
  assert.deepEqual([directBody.status, directBody.command, directBody.data.mode], ['success', 'account.setnotificationemail', 'immediate']);
  assert.equal(db.read(`users/${ANN}`)?.notificationEmail, 'immediate');

  const directGroup = await call(ANN, 'POST', '/api/v1/commands/groups.create', { input: { name: 'Direct', workspaceIds: ['ws-own'] } });
  assert.equal(directGroup.status, 200);
  const listed = await call(ANN, 'GET', '/api/v1/commands/groups.create');
  const listedBody = await listed.json() as { command: { name: string; scope?: string; roles: string[] } };
  assert.equal(listedBody.command.name, 'groups.create');
  assert.equal(listedBody.command.scope, 'person', 'the manifest marks the person scope');
  const unknown = await call(ANN, 'POST', '/api/v1/commands/account.nope', { input: {} });
  assert.equal(unknown.status, 404);
});
