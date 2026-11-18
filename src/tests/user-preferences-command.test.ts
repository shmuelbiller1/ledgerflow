/**
 * `user.preferences` — the person's own profile settings, as a command.
 *
 * Two browser writes became one: `useNotificationFeed.saveNotificationPrefs` (the notice toggles) and
 * `reportPreferencesDb.save` (one report's layout). Both `updateDoc`'d `users/{uid}` from the tab, which meant the
 * tab typed `updatedAt`, a save of one report wrote the whole `reportPreferences` map, and nothing was audited.
 * These tests hold the command to what replaces them: the row is always the caller's own, the merge is per key,
 * and one report's layout cannot erase another's.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { executeCommand } from '../server/utils/commandExecutor';
import { userPreferencesCommand, userPreferencesInput } from '../server/commands/userPreferences';
import { captureResponse, fakeRequest, MemoryDb, owner, runnerDependencies } from './helpers/commandTestUtils';

const run = (input: unknown, db: MemoryDb) =>
  executeCommand(fakeRequest(owner, { input }), captureResponse().response,
    { definition: userPreferencesCommand, workspaceId: '', input: userPreferencesInput.parse(input) }, runnerDependencies(db));

test('the notices are saved on the caller’s own profile and the row is typed by the server', async () => {
  const db = new MemoryDb();
  db.seed(`users/${owner.uid}`, { uid: owner.uid, email: 'owner@example.test', role: 'owner', createdAt: '2020-01-01T00:00:00.000Z' });

  const result = await run({ notificationPrefs: { emailDigest: true, digestHour: 8 } }, db);
  assert.equal(result.ok, true);
  const row = db.read(`users/${owner.uid}`)!;
  assert.deepEqual(row.notificationPrefs, { emailDigest: true, digestHour: 8 });
  assert.equal(row.createdAt, '2020-01-01T00:00:00.000Z', 'the rest of the profile is untouched');
  assert.match(String(row.updatedAt), /^\d{4}-\d{2}-\d{2}T/, 'the server types the timestamp');
});

test('a save that names one notice keeps the ones it did not mention', async () => {
  const db = new MemoryDb();
  db.seed(`users/${owner.uid}`, { uid: owner.uid, notificationPrefs: { emailDigest: true, digestHour: 8, mentions: false } });

  const result = await run({ notificationPrefs: { mentions: true } }, db);
  assert.equal(result.ok, true);
  assert.deepEqual(db.read(`users/${owner.uid}`)!.notificationPrefs, { emailDigest: true, digestHour: 8, mentions: true },
    'a merge, not a replacement');
});

test('one report’s layout does not erase another’s, and the layout cannot claim to be someone else’s', async () => {
  const db = new MemoryDb();
  db.seed(`users/${owner.uid}`, {
    uid: owner.uid,
    reportPreferences: { 'ws-a:user-a': { uid: 'user-a', workspaceId: 'ws-a', recentReportIds: ['pnl'] } },
  });

  const result = await run({
    reportPreferences: { scopeKey: 'ws-b:owner', workspaceId: 'ws-b', preferences: { recentReportIds: ['balance'], uid: 'somebody-else' } },
  }, db);
  assert.equal(result.ok, true);
  const saved = db.read(`users/${owner.uid}`)!.reportPreferences as Record<string, Record<string, unknown>>;
  assert.deepEqual(saved['ws-a:user-a'], { uid: 'user-a', workspaceId: 'ws-a', recentReportIds: ['pnl'] }, 'the other book is kept');
  assert.deepEqual(saved['ws-b:owner'].recentReportIds, ['balance']);
  assert.equal(saved['ws-b:owner'].uid, owner.uid, 'the row’s owner comes from the session, not the payload');
  assert.equal(saved['ws-b:owner'].workspaceId, 'ws-b');
});

test('a save with nothing in it is refused, and the refusal is the input', async () => {
  const db = new MemoryDb();
  const result = await run({}, db);
  assert.equal(result.ok, false);
  assert.equal((result as unknown as { code: string }).code, 'INVALID_INPUT');
  assert.equal(db.read(`users/${owner.uid}`), undefined, 'nothing is written');
});

test('a report layout with no scope key, or a notice that is not a scalar, is not input the screen could have sent', () => {
  assert.equal(userPreferencesInput.safeParse({ reportPreferences: { workspaceId: 'ws-a', preferences: {} } }).success, false);
  assert.equal(userPreferencesInput.safeParse({ notificationPrefs: { emailDigest: { on: true } } }).success, false);
  assert.equal(userPreferencesInput.safeParse({ workspaceId: 'ws-1' }).success, false, 'a workspace setting is not a profile setting');
  assert.equal(userPreferencesCommand.scope, 'person');
});

test('the change is audited as the person’s own, and names which half changed', async () => {
  const db = new MemoryDb();
  const counters = { runs: 0, previews: 0, afterCommit: 0, audits: 0 };
  const input = userPreferencesInput.parse({ notificationPrefs: { mentions: true } });
  const result = await executeCommand(fakeRequest(owner, { input }), captureResponse().response,
    { definition: userPreferencesCommand, workspaceId: '', input }, runnerDependencies(db, counters));
  assert.equal(result.ok, true);
  assert.equal(counters.audits, 1, 'one line, written by the runner');
  const summary = userPreferencesCommand.audit(input, { changed: ['notificationPrefs'] })!;
  assert.equal(summary.action, 'USER_PREFERENCES_CHANGED');
  assert.equal(summary.entityId, 'self', 'the row is the caller’s own, not a workspace’s');
  assert.deepEqual(summary.details, { changed: ['notificationPrefs'] });
});
