/**
 * #821 (A6S-01): a `person` command acts on the caller's whole account — two-step login, notice emails, groups of
 * books — so an API key, issued for one workspace's integration, may not run it. Before this, a key scoped to one
 * workspace with `write:transactions` could mint recovery codes (and spend one, deleting the owner's authenticator),
 * switch security emails off, and group a workspace the key was never given. `workspace.apicreate` is the one person
 * command built for keys, and it still refuses a workspace-scoped key.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { RequestUser } from '../server/auth/requestUser';
import type { AnyCommandDefinition } from '../server/commands/types';
import { executeCommand } from '../server/utils/commandExecutor';
import { createDefaultCommandRegistry } from '../server/commands/defaultRegistry';
import { accountMakeRecoveryCodesCommand, accountSetNotificationEmailCommand, accountUseRecoveryCodeCommand } from '../server/commands/account';
import { groupCreateCommand, groupShareCommand } from '../server/commands/groups';
import { verifiedFactors } from '../server/services/recoveryCodeService';
import { captureResponse, fakeRequest, MemoryDb, owner, runnerDependencies, seedWorkspace, workspaceId } from './helpers/commandTestUtils';

const workspaceKey: RequestUser = { ...owner, usedApiKeyId: 'key-1', developerWorkspaceId: workspaceId };
const personalKey: RequestUser = { ...owner, usedApiKeyId: 'key-2' };

const run = (definition: AnyCommandDefinition, input: unknown, user: RequestUser) => {
  const db = new MemoryDb();
  seedWorkspace(db);
  return executeCommand(fakeRequest(user, { input }), captureResponse().response, { definition, workspaceId: '', input }, runnerDependencies(db));
};

test('#821: an API key cannot run an account command, whatever its scope', async () => {
  const cases: Array<[AnyCommandDefinition, unknown]> = [
    [accountMakeRecoveryCodesCommand as AnyCommandDefinition, {}],
    [accountUseRecoveryCodeCommand as AnyCommandDefinition, { code: 'ABCDE-FGHIJ' }],
    [accountSetNotificationEmailCommand as AnyCommandDefinition, { mode: 'off' }],
    [groupCreateCommand as AnyCommandDefinition, { name: 'G', workspaceIds: [workspaceId, 'ws-other'] }],
    [groupShareCommand as AnyCommandDefinition, { id: 'g1', uid: 'outsider' }],
  ];
  for (const [definition, input] of cases) {
    for (const user of [workspaceKey, personalKey]) {
      const outcome = await run(definition, input, user);
      assert.equal(outcome.ok, false, `${definition.name} via ${user.developerWorkspaceId ? 'workspace' : 'personal'} key`);
      if (!outcome.ok) {
        assert.equal(outcome.status, 403, definition.name);
        assert.equal(outcome.code, 'PERSON_ONLY', definition.name);
      }
    }
  }
});

test('#821: every person command refuses API keys unless it is built for them', () => {
  const registry = createDefaultCommandRegistry() as unknown as { list(): AnyCommandDefinition[] };
  const keyable = registry.list().filter(c => c.scope === 'person' && c.apiKeyAllowed).map(c => c.name);
  assert.deepEqual(keyable, ['workspace.apicreate'], 'a new person command that keys may run is a deliberate choice');
});

test('#821: an id that is not a UUID has no authenticator, instead of a database error', async () => {
  const invalid = Object.assign(new Error('invalid input syntax for type uuid: "not-a-uuid"'), { code: '22P02' });
  const db = { pool: { query: async () => { throw invalid; } } } as unknown as Parameters<typeof verifiedFactors>[0];
  assert.deepEqual(await verifiedFactors(db, 'not-a-uuid'), []);
  const broken = { pool: { query: async () => { throw Object.assign(new Error('down'), { code: '08006' }); } } } as unknown as Parameters<typeof verifiedFactors>[0];
  await assert.rejects(verifiedFactors(broken, 'x'), /down/, 'any other database error still surfaces');
});
