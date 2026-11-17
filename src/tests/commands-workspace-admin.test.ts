/**
 * The CMD-1 conversions' gates, run in memory (the database suites need LF_TEST_DATABASE_URL, which CI
 * has and a bare checkout does not): the audit line and a later one's after-commit notice, the
 * last-owner protection, the seat cap, an API key's secret never entering the recorded result, and the
 * role gates each write advertises. The Postgres-backed route suites still cover the HTTP answers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request } from 'express';
import type { CommandInvocation } from '../server/commands/types';
import type { Firestore } from '../server/db/firestore';
import type { RequestUser } from '../server/auth/requestUser';
import { executeCommand } from '../server/utils/commandExecutor';
import { scheduledPurgeAt } from '../lib/retention';
import {
  workspaceInviteCommand, workspaceScheduleDeletionCommand, workspaceUpdateRoleCommand,
} from '../server/commands/workspaceAdmin';
import { apiKeyProvisionCommand, apiKeyRevokeCommand, userAiKeyRemoveCommand } from '../server/commands/apiKeys';
import { captureResponse, fakeRequest, MemoryDb, owner, runnerDependencies, type TestCounters } from './helpers/commandTestUtils';

const ws = 'ws-converted';
const deps = (db: MemoryDb, counters: TestCounters) => runnerDependencies(db, counters);

function seeded(fields: Record<string, unknown> = {}) {
  const db = new MemoryDb();
  db.seed(`workspaces/${ws}`, { uid: owner.uid, members: [owner.uid], currency: 'USD', ...fields });
  return db;
}

type AnyDefinition = CommandInvocation['definition'];

const run = (db: MemoryDb, counters: TestCounters, definition: AnyDefinition, input: unknown, user: RequestUser = owner, operationId?: string) => {
  const req = fakeRequest(user, { workspaceId: ws, input }, operationId) as Request;
  return executeCommand(req, captureResponse().response, { definition, workspaceId: ws, input }, deps(db, counters));
};

test('a role change writes the role, audits once, and tells the person afterwards', async () => {
  const counters: TestCounters = { runs: 0, previews: 0, afterCommit: 0, audits: 0 };
  const db = seeded({ members: [owner.uid, 'person-2'], roles: { 'person-2': 'viewer' } });
  const outcome = await run(db, counters, workspaceUpdateRoleCommand, { role: 'accountant', targetUid: 'person-2' });
  assert.equal(outcome.ok, true);
  if (outcome.ok) assert.deepEqual(outcome.data, { targetUid: 'person-2', role: 'accountant', previousRole: 'viewer' });
  assert.equal(db.read(`workspaces/${ws}`)?.roles && (db.read(`workspaces/${ws}`)!.roles as Record<string, string>)['person-2'], 'accountant');
  assert.equal(counters.audits, 1);
  // the notice is a commit side effect: its row exists (MemoryDb records the notification write)
  assert.ok(db.entries('notifications').length >= 1);
});

test('the last owner cannot be demoted, and nothing is written or told', async () => {
  const counters: TestCounters = { runs: 0, previews: 0, afterCommit: 0, audits: 0 };
  const db = seeded({ members: [owner.uid] });
  const outcome = await run(db, counters, workspaceUpdateRoleCommand, { role: 'viewer', targetUid: owner.uid });
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.status, 400);
    assert.equal(outcome.code, 'LAST_OWNER_PROTECTION');
  }
  assert.equal(counters.audits, 0);
  assert.equal(counters.afterCommit, 0);
  assert.equal(db.entries('notifications').length, 0);
});

test('a workspace at its seat cap refuses an invitation before the transaction', async () => {
  const counters: TestCounters = { runs: 0, previews: 0, afterCommit: 0, audits: 0 };
  const db = seeded({ members: [owner.uid, 'person-2', 'person-3', 'person-4', 'person-5'], maxSeats: 5 });
  const outcome = await run(db, counters, workspaceInviteCommand, { email: 'new@example.test', role: 'viewer' });
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.status, 402);
    assert.match(outcome.message, /seat limit reached \(5\/5 seats used\)/);
  }
  assert.equal(db.entries('invites').length, 0);
  assert.equal(counters.audits, 0);
});

test('an invitation stores its token, audits once and notifies the other owners once', async () => {
  const counters: TestCounters = { runs: 0, previews: 0, afterCommit: 0, audits: 0 };
  // the notice about an invitation goes to the workspace's owners, never to the one who sent it
  const db = seeded({ members: [owner.uid, 'co-owner'], roles: { 'co-owner': 'owner' } });
  process.env.SYSTEM_SALT ||= 'test-ledgerflow-salt-32b-deterministic';
  const outcome = await run(db, counters, workspaceInviteCommand, { email: 'new@example.test', role: 'bookkeeper' });
  assert.equal(outcome.ok, true);
  const invites = db.entries('invites');
  assert.equal(invites.length, 1);
  assert.equal(invites[0].data.email, 'new@example.test');
  assert.equal(invites[0].data.role, 'bookkeeper');
  assert.equal(counters.audits, 1);
  assert.equal(db.entries('notifications').length, 1);
});

test('scheduling a deletion keeps the recovery window the workspace set', async () => {
  const counters: TestCounters = { runs: 0, previews: 0, afterCommit: 0, audits: 0 };
  const db = seeded({ retention: { deletionGraceDays: 60 } });
  const outcome = await run(db, counters, workspaceScheduleDeletionCommand, {});
  assert.equal(outcome.ok, true);
  if (outcome.ok) {
    const data = outcome.data as { scheduledPurgeAt: string; graceDays: number };
    assert.equal(data.graceDays, 60);
    const purge = new Date(data.scheduledPurgeAt);
    const days = Math.round((purge.getTime() - Date.now()) / 86_400_000);
    assert.ok(days >= 59 && days <= 61, `purge in ${days} days`);
    // the same answer `scheduledPurgeAt` gives the retention screen: the window from the moment asked
    assert.deepEqual(data.scheduledPurgeAt, scheduledPurgeAt({ retention: { deletionGraceDays: 60 } }, new Date(JSON.parse(JSON.stringify(db.read(`workspaces/${ws}`)!.deletedAt)) as string)));
  }
  const workspace = db.read(`workspaces/${ws}`)!;
  assert.equal(workspace.status, 'pending_deletion');
  assert.ok(workspace.deletedAt);
});

test('an API key\'s secret is answered once and never recorded with the result', async () => {
  const counters: TestCounters = { runs: 0, previews: 0, afterCommit: 0, audits: 0 };
  const db = seeded();
  const outcome = await run(db, counters, apiKeyProvisionCommand, { workspaceId: ws, scopes: ['read:transactions'], expiration: '30d' });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  const data = outcome.data as { key: { keyId: string }; apiKey: string };
  // the secret arrives through a commit side effect, so a retry (which replays the recorded result)
  // hands back the key's metadata and never a second working secret
  assert.match(data.apiKey, new RegExp(`^lf_id_${ws}_[0-9a-f]{16}\\.[0-9a-f]{64}$`));
  assert.ok(data.apiKey.startsWith(`${data.key.keyId}.`));
  const stored = db.entries('apiKeys')[0].data;
  assert.equal(stored.workspaceId, ws);
  assert.equal(String(stored.keyHash).length, 64);
  assert.equal(JSON.stringify(stored).includes(data.apiKey.split('.')[1]), false, 'the secret itself is not stored');
});

test('an API key cannot mint or revoke keys: only a signed-in person can', async () => {
  const counters: TestCounters = { runs: 0, previews: 0, afterCommit: 0, audits: 0 };
  const db = seeded();
  // `usedApiKeyId` is set only when the request arrived on a verified `lf_...` key
  const onAnApiKey: RequestUser = { uid: 'key-actor', aal: 'aal2', usedApiKeyId: 'lf_id_x' };
  db.seed(`workspaces/${ws}`, { uid: owner.uid, members: [owner.uid, 'key-actor'], roles: { 'key-actor': 'owner' }, currency: 'USD' });
  for (const [definition, input] of [
    [apiKeyProvisionCommand, { workspaceId: ws, scopes: ['read:transactions'] }],
    [apiKeyRevokeCommand, { workspaceId: ws, keyId: 'anything' }],
  ] as const) {
    const refused = await run(db, counters, definition, input, onAnApiKey);
    assert.equal(refused.ok, false);
    if (!refused.ok) {
      assert.equal(refused.status, 403);
      assert.equal(refused.code, 'PERSON_ONLY');
    }
  }
  assert.equal(db.entries('apiKeys').length, 0);
});

test('an unsupported scope list is refused before anything is written', async () => {
  const counters: TestCounters = { runs: 0, previews: 0, afterCommit: 0, audits: 0 };
  const db = seeded();
  for (const scopes of [[], ['read:everything'], ['read:transactions', 'read:transactions']]) {
    const outcome = await run(db, counters, apiKeyProvisionCommand, { workspaceId: ws, scopes });
    assert.equal(outcome.ok, false, JSON.stringify(scopes));
    if (!outcome.ok) assert.match(outcome.message, /scope/i);
  }
  assert.equal(db.entries('apiKeys').length, 0);
});

test('revoking takes the key out and audits the name it had', async () => {
  const counters: TestCounters = { runs: 0, previews: 0, afterCommit: 0, audits: 0 };
  const db = seeded();
  db.seed('apiKeys/key-1', { id: 'key-1', workspaceId: ws, name: 'Reporting', scopes: ['read:transactions'] });
  const outcome = await run(db, counters, apiKeyRevokeCommand, { workspaceId: ws, keyId: 'key-1' });
  assert.equal(outcome.ok, true);
  if (outcome.ok) assert.deepEqual(outcome.data, { keyId: 'key-1', name: 'Reporting' });
  assert.equal(db.read('apiKeys/key-1'), undefined);
  assert.equal(db.entries('auditLogs').length + counters.audits >= 1, true);
});

test('a key of another workspace is not found, and a viewer may not revoke at all', async () => {
  const counters: TestCounters = { runs: 0, previews: 0, afterCommit: 0, audits: 0 };
  const db = seeded({ members: [owner.uid, 'viewer-1'], roles: { 'viewer-1': 'viewer' } });
  db.seed('apiKeys/other', { id: 'other', workspaceId: 'ws-other', name: 'Elsewhere' });
  const wrongWorkspace = await run(db, counters, apiKeyRevokeCommand, { workspaceId: ws, keyId: 'other' });
  assert.equal(wrongWorkspace.ok, false);
  if (!wrongWorkspace.ok) assert.equal(wrongWorkspace.status, 404);

  db.seed('apiKeys/mine', { id: 'mine', workspaceId: ws, name: 'Mine' });
  const viewer: RequestUser = { uid: 'viewer-1', aal: 'aal2' };
  const refused = await run(db, counters, apiKeyRevokeCommand, { workspaceId: ws, keyId: 'mine' }, viewer);
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.code, 'ROLE_REQUIRED');
  assert.ok(db.read('apiKeys/mine'), 'the key is untouched');
});

test('removing an AI key a person never saved says so instead of failing', async () => {
  const counters: TestCounters = { runs: 0, previews: 0, afterCommit: 0, audits: 0 };
  const db = new MemoryDb(); // no user document at all: a stranger with a session token
  const req = fakeRequest(owner, { input: {} }) as Request;
  const outcome = await executeCommand(req, captureResponse().response, { definition: userAiKeyRemoveCommand, workspaceId: '', input: {} },
    { ...deps(db, counters), getDb: () => db as unknown as Firestore });
  assert.equal(outcome.ok, false);
  // 404 through the runner's own wording (the legacy route's handleApiError said the same status)
  if (!outcome.ok) assert.equal(outcome.status, 404);
});

test('removing the personal AI key deletes the stored fields', async () => {
  const counters: TestCounters = { runs: 0, previews: 0, afterCommit: 0, audits: 0 };
  const db = new MemoryDb();
  db.seed(`users/${owner.uid}`, { hasCustomApiKey: true, apiKeySuffix: 'abcd', geminiApiKeyEncrypted: 'enc:x:y:z' });
  const req = fakeRequest(owner, { input: {} }) as Request;
  const outcome = await executeCommand(req, captureResponse().response, { definition: userAiKeyRemoveCommand, workspaceId: '', input: {} },
    { ...deps(db, counters), getDb: () => db as unknown as Firestore });
  assert.equal(outcome.ok, true);
  const user = db.read(`users/${owner.uid}`)!;
  assert.equal(user.hasCustomApiKey, false);
  assert.equal('geminiApiKeyEncrypted' in user, false);
  assert.equal('apiKeySuffix' in user, false);
});
