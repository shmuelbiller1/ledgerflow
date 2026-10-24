/**
 * Workspace-scoped collections: deleting a workspace deletes these (workspacePurgeService). The
 * browser loads most of them (src/lib/ledgerCollections.ts); rules-coverage-guard.test.ts checks
 * both lists. Audit logs ('auditLogs') are kept permanently for security and compliance audit trails.
 */
export const WORKSPACE_SCOPED_COLLECTIONS = [
  'transactions',
  'chartAccounts',
  'projects',
  'taxRates',
  'customTemplates',
  'partners',
  'autoRules',
  'rulePatterns',
  'dimensionNodes',
  'invoices',
  'creditNotes',
  'payments',
  'estimates',
  'customers',
  'bills',
  'vendorCredits',
  'vendors',
  'inventory',
  'budgets',
  'payRuns',
  'employees',
  'bankLines',
  'reconciliations',
  'periods',
  'scenarios',
  'recurring',
  'assets',
  'loans',
  'invites',
  'journalEntries',
  'workspaceShards',
  'billingLedgerTraces',
  'supportTickets',
  'supportMessages'
] as const;

export type WorkspaceScopedCollection = typeof WORKSPACE_SCOPED_COLLECTIONS[number];

/**
 * Other tables that hold a workspace's data (the browser doesn't load them into the store). A
 * workspace purge deletes these too (L-124: bank connections with their tokens, API keys, members,
 * notifications, filed tax returns, purchase orders and email events were left behind).
 */
export const WORKSPACE_PURGE_EXTRA = [
  'purchaseOrders',
  'taxReturns',
  'notifications',
  'emailEvents',
  'numberingSeries',
  'members',
  'banks',
  'documents',
  'apiKeys',
  'idempotencyKeys',
  'rateLimitEntries', // purge workspace-specific counters; server-only, not browser data
  'fixedAssets',
  'learnedDeltas',
  'presence',
  'deepAuditJobs',
  'errorLogs',
  'clientQueries',
  'stockMoves',
  'periodBalances', // L-123 balance snapshots: server-written, rebuilt from the entries, never restored
  'stockClosings', // EG-7 stock closing snapshots: server-written, rebuilt from the stock moves, never restored
  'periodClosings', // EG-3 period-closing documents: server-written, never restored from a backup
  'repostQueue', // EG-1 repost marks: server-written, derived from the entries
  'paymentAllocations', // EG-2 payment ledger rows: server-written with each settlement
  'allocationOperations', // EG-2 idempotency keys of later applications: server-written
] as const;

/** Everything a workspace purge deletes, in order (the job resumes by position in this list). */
export const WORKSPACE_PURGE_ORDER: readonly string[] = [...WORKSPACE_SCOPED_COLLECTIONS, ...WORKSPACE_PURGE_EXTRA];

/** Tables a workspace purge leaves alone, and why (workspace-purge-coverage guard). */
export const KEPT_AFTER_WORKSPACE_PURGE: Record<string, string> = {
  workspaces: 'the workspace row itself is deleted last, after its data',
  auditLogs: 'the audit trail is kept (forensic and legal record), including the purge entry',
  jobRuns: 'the purge job records its own progress here',
  users: 'people, not workspace data; deleted with the account (L-09)',
  admins: 'platform administrators',
  loginAudits: 'per-person sign-in security log',
  recoveryCodes: 'a person\'s own two-step login recovery codes, not workspace data; deleted with the account',
  workspaceGroups: 'a person\'s own groups of workspaces (DA-01), not workspace data; a purged workspace drops out of sight because nobody can open it, and the groups go with the account',
  stripeProcessedEvents: 'payment webhook de-duplication across all workspaces',
  external_api_cache: 'shared cache of public data (exchange rates)',
};

