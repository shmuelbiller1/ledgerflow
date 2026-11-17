import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiKeyRevokePersonalCommand, userAiKeySetInput } from '../server/commands/apiKeys';

// #769 review: the command form of the legacy API-key routes keeps the legacy rules.
const keyDb = (data: Record<string, unknown>) => ({
  collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => data }) }) }),
});
const ctxFor = (actor: string, admin: boolean, data: Record<string, unknown>) =>
  ({ actor, user: { uid: actor, admin }, db: keyDb(data) }) as unknown as Parameters<NonNullable<typeof apiKeyRevokePersonalCommand.prepare>>[0];

test('a pre-workspace key is revoked by its maker or a platform admin, as the legacy route allowed', async () => {
  const prepare = apiKeyRevokePersonalCommand.prepare!;
  const key = { uid: 'maker', name: 'Old key' };
  assert.deepEqual(await prepare(ctxFor('maker', false, key), { keyId: 'k1' }), { name: 'Old key' });
  assert.deepEqual(await prepare(ctxFor('someone-admin', true, key), { keyId: 'k1' }), { name: 'Old key' });
  await assert.rejects(prepare(ctxFor('someone-else', false, key), { keyId: 'k1' }), /Forbidden key revocation/);
});

test('a Gemini key of only spaces is refused, not stored empty', () => {
  assert.equal(userAiKeySetInput.safeParse({ apiKey: '   ' }).success, false);
  const ok = userAiKeySetInput.safeParse({ apiKey: '  AIza-123  ' });
  assert.ok(ok.success);
  assert.equal(ok.success && ok.data.apiKey, 'AIza-123');
});
