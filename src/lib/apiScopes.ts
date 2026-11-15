/** API-key scopes accepted by key provisioning and checked by server authentication. */
export const API_KEY_SCOPE_IDS = [
  'read:transactions',
  'write:transactions',
  'read:projects',
  'write:projects',
  'read:ledger',
  'write:ledger',
  'read:workspaces',
  'write:customers',
  'write:vendors',
  'write:rules',
  'brain:analyze',
] as const;

export type ApiKeyScope = typeof API_KEY_SCOPE_IDS[number];

export function isApiKeyScope(value: unknown): value is ApiKeyScope {
  return typeof value === 'string' && (API_KEY_SCOPE_IDS as readonly string[]).includes(value);
}

export type ApiKeyScopeValidation =
  | { ok: true; scopes: ApiKeyScope[] }
  | { ok: false; reason: 'missing' | 'unsupported' | 'duplicate' };

export function validateApiKeyScopes(value: unknown): ApiKeyScopeValidation {
  if (!Array.isArray(value) || value.length === 0) return { ok: false, reason: 'missing' };
  if (value.some(scope => !isApiKeyScope(scope))) return { ok: false, reason: 'unsupported' };
  if (new Set(value).size !== value.length) return { ok: false, reason: 'duplicate' };
  return { ok: true, scopes: [...value] };
}
