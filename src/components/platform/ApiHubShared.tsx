import { API_KEY_SCOPE_IDS, type ApiKeyScope } from '../../lib/apiScopes';

const SCOPE_DETAILS: Record<ApiKeyScope, { label: string; desc: string }> = {
  'read:transactions': { label: 'Read Transactions', desc: 'Allows querying and reading financial ledger transactions and journal entries.' },
  'write:transactions': { label: 'Write Transactions', desc: 'Allows creating, modifying, and voiding journal entries.' },
  'read:projects': { label: 'Read Projects', desc: 'Allows querying project codes, tags, and cost centers.' },
  'write:projects': { label: 'Write Projects', desc: 'Allows creating and managing project codes and dimensional tags.' },
  'read:ledger': { label: 'Read Chart of Accounts', desc: 'Allows reading account hierarchies, balances, and classifications.' },
  'write:ledger': { label: 'Write Chart of Accounts', desc: 'Allows creating and structuring accounts and ledger rules.' },
  'read:workspaces': { label: 'Read Workspaces', desc: 'Allows accessing workspace metadata, tax profile, and currency settings.' },
  'write:customers': { label: 'Write Customers', desc: 'Allows creating and updating customer contact profiles; it does not grant invoice or payment access.' },
  'write:vendors': { label: 'Write Vendors', desc: 'Allows creating and updating vendor contact profiles; it does not grant bill or payment access.' },
  'write:rules': { label: 'Write Automation Rules', desc: 'Allows creating and updating workspace automation rules; applying them to ledger entries still requires the transaction writer.' },
  'brain:analyze': { label: 'Brain / AI Analysis', desc: 'Allows calling Bayesian classification and AI analysis endpoints.' },
};

export const AVAILABLE_SCOPES = API_KEY_SCOPE_IDS.map(id => ({ id, ...SCOPE_DETAILS[id] }));

export interface ApiLogEntry { id: string; timestamp: string; method: string; path: string; statusCode: number; latencyMs?: number; apiKeyUsed: string }

export interface PublicKeyRow { id: string; name: string; scopes: string[]; expiresAt: string; lastUsedAt: string | null; totalRequests: number; createdAt?: string }
