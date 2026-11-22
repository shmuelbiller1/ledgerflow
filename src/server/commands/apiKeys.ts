/**
 * API keys (Z-01, Z-02, AUD-09 step 3): the four writes `apiKeysRoutes.ts` made — mint a workspace key,
 * revoke one, and keep or remove the person's own Gemini key.
 *
 * Two scopes here. A workspace key is minted and revoked for one workspace, so the runner's membership
 * and role gates apply, and an owner is required (the route checked `requireWorkspaceRole(['owner'])`,
 * and a platform admin was allowed to revoke a key; the route also let a platform admin who is not a
 * member act, so `allowPlatformAdmin` keeps that). The Gemini key is the person's own account, like the
 * recovery codes in `account.ts`: `scope: 'person'`, no workspace gates, audited under `person:<uid>`.
 *
 * The key's secret is never in a result the runner records: provisioning returns it from `afterCommit`,
 * so a retry replays the key's metadata and never a second copy of a working secret.
 */
import crypto from 'crypto';
import { z } from 'zod';
import { validateApiKeyScopes } from '../../lib/apiScopes';
import { apiKeyLimit } from '../middleware/rateLimiters';
import { FieldValue } from '../db/firestore';
import { SecurityService } from '../../services/securityService';
import { COMMAND_ROLES, type CommandDefinition } from './types';

/** The key id's legacy shape, `lf_id_<workspaceId>_<16 hex>`, as the console and the SDK show it. */
const keyIdFor = (workspaceId: string) => `lf_id_${workspaceId}_${crypto.randomBytes(8).toString('hex')}`;

/** A minted key: the full secret once, and what the API answers with afterwards. */
export interface ProvisionedApiKey {
  keyId: string;
  secret: string;
  name: string;
  scopes: string[];
  expiresAt: string;
  createdAt: string;
  rateLimitPerMinute: number;
}

const expiryFor = (expiration: unknown): string => {
  if (!expiration || expiration === 'never') return 'never';
  const at = new Date();
  if (expiration === '1h') at.setHours(at.getHours() + 1);
  else if (expiration === '24h') at.setHours(at.getHours() + 24);
  else if (expiration === '30d') at.setDate(at.getDate() + 30);
  else if (expiration === '90d') at.setDate(at.getDate() + 90);
  else return 'never';
  return at.toISOString();
};

export const apiKeyProvisionInput = z.object({
  workspaceId: z.string().min(1).max(200),
  name: z.string().max(120).optional(),
  /** the shapes are checked in `prepare`, in the route's own wording (see the comment there) */
  scopes: z.array(z.string()),
  /** never (the default) or one of the offered periods; anything else meant "never" before, and still does */
  expiration: z.string().max(20).optional(),
  /** Z-02: requests a minute this key may make (10 to 10,000; 120 unless chosen; anything else is 120) */
  rateLimitPerMinute: z.unknown().optional(),
}).strict();

export const apiKeyProvisionCommand: CommandDefinition<typeof apiKeyProvisionInput, { key: Omit<ProvisionedApiKey, 'secret'> }> = {
  name: 'apikey.provision',
  input: apiKeyProvisionInput,
  roles: ['owner'],
  allowPlatformAdmin: true,
  // only a signed-in person mints a key: an API key could otherwise mint itself a wider one
  peopleOnly: true,
  // #941: minting a key is owner-sensitive, so a stolen long-lived session cannot do it
  recentSignInSec: 30 * 60,
  async prepare(_ctx, input) {
    // The route's answer to a bad scope list, in its own wording and before any workspace work. These
    // checks live here rather than in the schema so the legacy message (not a Zod 400) is the answer;
    // they are the same ones `src/lib/apiScopes.ts` makes, which is also what the console validates.
    const validated = validateApiKeyScopes(input.scopes);
    if (!validated.ok) {
      const message = validated.reason === 'missing' ? 'Choose at least one API key scope.'
        : validated.reason === 'duplicate' ? 'API key scopes must not contain duplicates.'
          : 'One or more API key scopes are not supported.';
      throw Object.assign(new Error(message), { status: 400 });
    }
    return { scopes: validated.scopes };
  },
  async handler(ctx, tx, input) {
    const scopes = (ctx.prepared as { scopes: string[] }).scopes;
    const secret = crypto.randomBytes(32).toString('hex');
    const keyHash = crypto.createHash('sha256').update(secret).digest('hex');
    const id = keyIdFor(ctx.workspaceId);
    const createdAt = new Date().toISOString();
    const provisioned: ProvisionedApiKey = {
      keyId: id,
      secret,
      name: input.name || 'Production Integration Key',
      scopes,
      expiresAt: expiryFor(input.expiration),
      createdAt,
      rateLimitPerMinute: apiKeyLimit(input.rateLimitPerMinute),
    };
    tx.set(ctx.db.collection('apiKeys').doc(id), {
      id,
      workspaceId: ctx.workspaceId,
      uid: ctx.actor,
      name: provisioned.name,
      keyHash,
      scopes: provisioned.scopes,
      expiresAt: provisioned.expiresAt,
      createdAt,
      lastUsedAt: null,
      totalRequests: 0,
      rateLimitPerMinute: provisioned.rateLimitPerMinute,
    });
    // the full key is shown once; it is not part of the recorded result (see the header)
    ctx.afterCommit(() => ({ apiKey: `${id}.${secret}` }));
    const { secret: _secret, ...key } = provisioned;
    return { key };
  },
  async preview(ctx, input) {
    return {
      title: `Mint an API key for ${ctx.workspaceId}`,
      lines: [
        `Named "${input.name || 'Production Integration Key'}"`,
        `Scopes: ${input.scopes.join(', ')}`,
        `Expires: ${expiryFor(input.expiration) === 'never' ? 'never' : expiryFor(input.expiration)}`,
        'The secret is shown once',
      ],
    };
  },
  audit(_input, result) {
    return {
      action: 'API_KEY_PROVISIONED',
      entityType: 'api_key',
      entityId: result.key.keyId,
      description: `Provisioned API key "${result.key.name}"`,
      details: { scopes: result.key.scopes, expiresAt: result.key.expiresAt },
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Mint an API key for one workspace so a tool can sign in with it; do not use it to invite a person — that is workspace.invite.',
    example: { workspaceId: 'ws_123', name: 'Reporting', scopes: ['read:transactions'], expiration: '90d', rateLimitPerMinute: 120 },
    refusals: [
      { code: 'INVALID_INPUT', when: 'No scope is chosen, a scope is repeated or unsupported, or the expiry is unknown.', next: 'Choose at least one supported scope, once each, and a known expiry.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner.', next: 'Ask an owner to mint the key.' },
      { code: 'NOT_A_MEMBER', when: 'The caller is not in the workspace.', next: 'Choose a workspace you belong to.' },
    ],
  },
};

export const apiKeyRevokeInput = z.object({
  /** The key's workspace, read from the key itself; the runner checks the caller against it. */
  workspaceId: z.string().min(1).max(200),
  keyId: z.string().min(1).max(200),
}).strict();

export const apiKeyRevokeCommand: CommandDefinition<typeof apiKeyRevokeInput, { keyId: string; name: string }> = {
  name: 'apikey.revoke',
  input: apiKeyRevokeInput,
  roles: ['owner'],
  // a platform admin may revoke a workspace key without being a member of it (AUD-09 step 3)
  allowPlatformAdmin: true,
  peopleOnly: true,
  async prepare(ctx, input) {
    const snapshot = await ctx.db.collection('apiKeys').doc(input.keyId).get();
    if (!snapshot.exists) throw Object.assign(new Error('API key not found.'), { status: 404 });
    const key = snapshot.data() || {};
    if (key.workspaceId !== input.workspaceId) throw Object.assign(new Error('API key not found.'), { status: 404 });
    // the key may be gone before the transaction commits; the handler re-reads it and answers the same
    return { name: String(key.name || input.keyId) };
  },
  async handler(ctx, tx, input) {
    const ref = ctx.db.collection('apiKeys').doc(input.keyId);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return { keyId: input.keyId, name: (ctx.prepared as { name: string }).name };
    tx.delete(ref);
    return { keyId: input.keyId, name: String((snapshot.data() || {}).name || input.keyId) };
  },
  async preview(ctx, input) {
    const snapshot = await ctx.db.collection('apiKeys').doc(input.keyId).get();
    const name = String((snapshot.data() || {}).name || input.keyId);
    return {
      title: `Revoke the API key "${name}"`,
      lines: ['Anything still using it stops working at once', 'The key is deleted; the audit line stays'],
    };
  },
  audit(_input, result) {
    // the route wrote this line for a workspace key only; an unowned key is its maker's own, below
    return {
      action: 'API_KEY_REVOKED',
      entityType: 'api_key',
      entityId: result.keyId,
      description: `Revoked API key "${result.name}"`,
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Revoke one of the workspace\'s API keys so it can no longer be used; do not use it to change what a key may read — mint a new one with the scopes you want.',
    example: { workspaceId: 'ws_123', keyId: 'lf_id_ab12cd34ef56' },
    refusals: [
      { code: 'NOT_FOUND', when: 'No such key, or it belongs to another workspace.', next: 'Check the key id in Settings → API keys.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner.', next: 'Ask an owner to revoke the key.' },
    ],
  },
};

// --------------------------------------------------------------------------- the person's own Gemini key

export const userAiKeySetInput = z.object({
  // trimmed first, as the legacy handler did: a key of only spaces is refused, not stored empty
  apiKey: z.string().trim().min(1, 'A non-empty apiKey string is required.').max(500),
}).strict();

export const userAiKeySetCommand: CommandDefinition<typeof userAiKeySetInput, { hasCustomApiKey: true; apiKeySuffix: string }> = {
  name: 'user.aikeyset',
  input: userAiKeySetInput,
  roles: COMMAND_ROLES,
  scope: 'person',
  peopleOnly: true,
  async handler(ctx, tx, input) {
    const cleanKey = input.apiKey.trim();
    const suffix = cleanKey.length >= 4 ? cleanKey.slice(-4) : cleanKey;
    tx.set(ctx.db.collection('users').doc(ctx.actor), {
      geminiApiKeyEncrypted: SecurityService.encryptSensitiveField(cleanKey),
      hasCustomApiKey: true,
      apiKeySuffix: suffix,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    return { hasCustomApiKey: true as const, apiKeySuffix: suffix };
  },
  async preview() {
    return {
      title: 'Save your own Gemini API key',
      lines: ['The key is encrypted before it is stored', 'Only its last four characters are shown back'],
    };
  },
  audit(_input, result) {
    return {
      action: 'USER_AI_KEY_SAVED',
      entityType: 'users',
      entityId: 'self',
      // the key itself is never in the audit line: only its last four characters
      description: `Custom AI key saved (ending ${result.apiKeySuffix})`,
    };
  },
  inverse() { return { command: 'user.aikeyremove', input: {} }; },
  risk: 'normal',
  describe: {
    sentence: 'Save your own AI provider key so the assistant uses your account; do not use it to change a workspace setting.',
    example: { apiKey: 'AIza...' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The key is empty or not a string.', next: 'Send the key as a non-empty string.' },
    ],
  },
};

export const userAiKeyRemoveInput = z.object({}).strict();

export const userAiKeyRemoveCommand: CommandDefinition<typeof userAiKeyRemoveInput, { hasCustomApiKey: false }> = {
  name: 'user.aikeyremove',
  input: userAiKeyRemoveInput,
  roles: COMMAND_ROLES,
  scope: 'person',
  peopleOnly: true,
  async handler(ctx, tx) {
    // A person with no user record yet has no key to remove: the legacy route answered 404 through
    // handleApiError (an `update` of a missing document), and a stranger must not get a 500 for it.
    const profile = await tx.get(ctx.db.collection('users').doc(ctx.actor));
    if (!profile.exists) {
      throw Object.assign(new Error('Resource not found: no saved key to remove'), { status: 404 });
    }
    // FieldValue.delete() removes a field; setting it to undefined would store nothing at all
    tx.update(ctx.db.collection('users').doc(ctx.actor), {
      geminiApiKeyEncrypted: FieldValue.delete(),
      geminiApiKey: FieldValue.delete(),
      hasCustomApiKey: false,
      apiKeySuffix: FieldValue.delete(),
      updatedAt: new Date().toISOString(),
    });
    return { hasCustomApiKey: false as const };
  },
  async preview() {
    return { title: 'Remove your own Gemini API key', lines: ['The saved key is deleted', 'The assistant falls back to the workspace default'] };
  },
  audit() {
    return { action: 'USER_AI_KEY_REMOVED', entityType: 'users', entityId: 'self', description: 'Custom AI key removed' };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Remove the AI provider key saved on your own account; do not use it to change anyone else\'s.',
    example: {},
    refusals: [
      { code: 'UNAUTHENTICATED', when: 'Nobody is signed in.', next: 'Sign in and try again.' },
    ],
  },
};

/**
 * A key stored without a workspace (the pre-workspace shape) belongs to the person who made it, so it
 * is revoked as their own account's write, not as a workspace one. The route reads the key's fields to
 * know which case it has; the check below is the same one the route made.
 */
export const apiKeyRevokePersonalInput = z.object({
  keyId: z.string().min(1).max(200),
}).strict();

export const apiKeyRevokePersonalCommand: CommandDefinition<typeof apiKeyRevokePersonalInput, { keyId: string; name: string }> = {
  name: 'apikey.revokepersonal',
  input: apiKeyRevokePersonalInput,
  roles: COMMAND_ROLES,
  scope: 'person',
  peopleOnly: true,
  async prepare(ctx, input) {
    const snapshot = await ctx.db.collection('apiKeys').doc(input.keyId).get();
    if (!snapshot.exists) throw Object.assign(new Error('API key not found.'), { status: 404 });
    const key = snapshot.data() || {};
    // the legacy route's rule: the key's maker, or a platform admin (`keyData.uid !== uid && !user.admin`)
    if (key.uid !== ctx.actor && ctx.user.admin !== true) throw Object.assign(new Error('Forbidden key revocation'), { status: 403 });
    return { name: String(key.name || input.keyId) };
  },
  async handler(ctx, tx, input) {
    const ref = ctx.db.collection('apiKeys').doc(input.keyId);
    const snapshot = await tx.get(ref);
    if (snapshot.exists) tx.delete(ref);
    return { keyId: input.keyId, name: String((snapshot.data() || {}).name || (ctx.prepared as { name: string }).name) };
  },
  async preview(_ctx, input) {
    return { title: `Revoke your API key ${input.keyId}`, lines: ['Anything still using it stops working at once'] };
  },
  audit() { return null; },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Revoke an API key of your own that was made before keys belonged to a workspace; do not use it to revoke a workspace key — that is apikey.revoke.',
    example: { keyId: 'lf_id_ab12cd34ef56' },
    refusals: [
      { code: 'NOT_FOUND', when: 'No such key.', next: 'Check the key id.' },
      { code: 'FORBIDDEN', when: 'The key belongs to someone else.', next: 'Only its owner revokes it.' },
    ],
  },
};

/** Every API-key command this batch registers. */
export const API_KEY_COMMANDS = [
  apiKeyProvisionCommand,
  apiKeyRevokeCommand,
  apiKeyRevokePersonalCommand,
  userAiKeySetCommand,
  userAiKeyRemoveCommand,
];
