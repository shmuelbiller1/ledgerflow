import { byCodeUnit } from './codeUnitOrder';
/**
 * What the browser loads into useLedgerStore, and when (launch step 9: C-14 C-15 C-16 AA-06).
 *
 * - CORE collections load when a workspace opens (the ledger and the chart of accounts every
 *   screen and the dashboard need; small reference lists).
 * - Every other collection loads the first time a screen that needs it is shown: the screen calls
 *   `useLedgerCollections('invoices', ...)` (src/hooks/useLedgerCollections.ts). Once loaded it
 *   stays live for the session, so no screen ever sees a stale copy. A guard test
 *   (ledger-collections-guard.test.ts) fails when a file reads one of these from the store without
 *   asking for it.
 * - Live lists fetch only what changed (src/lib/db/liveQuery.ts), so a big ledger is not reloaded
 *   after every edit.
 *
 * The keys are the useLedgerStore field names.
 */

export interface LedgerCollectionSpec {
  /** database table */
  collection: string;
  /** most rows loaded; reaching it shows the "not everything is loaded" banner */
  cap: number;
  /** newest first by this field, so a cap keeps the most recent rows */
  newestFirstBy?: string;
}

export const LEDGER_COLLECTIONS = {
  transactions: { collection: 'transactions', cap: 20000, newestFirstBy: 'date' },
  accounts: { collection: 'chartAccounts', cap: 2000 },
  taxRates: { collection: 'taxRates', cap: 500 },
  autoRules: { collection: 'autoRules', cap: 1000 },
  customers: { collection: 'customers', cap: 5000 },
  vendors: { collection: 'vendors', cap: 5000 },
  invoices: { collection: 'invoices', cap: 10000, newestFirstBy: 'date' },
  creditNotes: { collection: 'creditNotes', cap: 5000, newestFirstBy: 'date' },
  payments: { collection: 'payments', cap: 10000, newestFirstBy: 'date' },
  estimates: { collection: 'estimates', cap: 5000, newestFirstBy: 'date' },
  bills: { collection: 'bills', cap: 10000, newestFirstBy: 'date' },
  vendorCredits: { collection: 'vendorCredits', cap: 5000, newestFirstBy: 'date' },
  inventory: { collection: 'inventory', cap: 5000 },
  budgets: { collection: 'budgets', cap: 1000 },
  projects: { collection: 'projects', cap: 1000 },
  journalEntries: { collection: 'journalEntries', cap: 5000 },
  payRuns: { collection: 'payRuns', cap: 1000 },
  employees: { collection: 'employees', cap: 1000 },
  bankLines: { collection: 'bankLines', cap: 10000, newestFirstBy: 'date' },
  reconciliations: { collection: 'reconciliations', cap: 1000 },
  auditLogs: { collection: 'auditLogs', cap: 500, newestFirstBy: 'timestamp' },
  recurring: { collection: 'recurring', cap: 1000 },
  assets: { collection: 'assets', cap: 2000 },
  loans: { collection: 'loans', cap: 1000 },
  scenarios: { collection: 'scenarios', cap: 100 },
} as const satisfies Record<string, LedgerCollectionSpec>;

export type LedgerKey = keyof typeof LEDGER_COLLECTIONS;

/**
 * What each collection is called on screen (plural, plain words). One list for the data status bar
 * and for the notice a screen shows when its data could not be loaded (A-235), so the words a
 * reader sees are the same everywhere.
 */
export const COLLECTION_LABELS: Record<LedgerKey, string> = {
  transactions: 'entries', accounts: 'accounts', taxRates: 'tax codes', autoRules: 'rules',
  customers: 'customers', vendors: 'vendors', invoices: 'invoices', creditNotes: 'credit notes',
  payments: 'payments', estimates: 'estimates', bills: 'bills', vendorCredits: 'vendor credits',
  inventory: 'items', budgets: 'budgets', projects: 'projects', journalEntries: 'journal entries',
  payRuns: 'pay runs', employees: 'employees', bankLines: 'bank lines', reconciliations: 'reconciliations',
  auditLogs: 'activity', recurring: 'recurring schedules', assets: 'fixed assets', loans: 'loans',
  scenarios: 'scenarios',
};

/** "customers", "customers and vendors", "entries, accounts and bills" */
export function collectionList(keys: readonly LedgerKey[]): string {
  const labels = keys.map(k => COLLECTION_LABELS[k]);
  return labels.length <= 1 ? labels.join('') : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/** Loaded as soon as a workspace opens. */
export const CORE_KEYS: readonly LedgerKey[] = ['transactions', 'accounts', 'projects', 'journalEntries', 'taxRates', 'autoRules'];

/** Loaded the first time a screen asks for them. */
export const ON_DEMAND_KEYS: readonly LedgerKey[] =
  (Object.keys(LEDGER_COLLECTIONS) as LedgerKey[]).filter(k => !CORE_KEYS.includes(k));

export const isLedgerKey = (k: string): k is LedgerKey => Object.prototype.hasOwnProperty.call(LEDGER_COLLECTIONS, k);

/** The keys still to subscribe: asked for (or core), not yet active. Sorted, no repeats. */
export function keysToStart(asked: readonly string[], active: ReadonlySet<string>): LedgerKey[] {
  const want = new Set<LedgerKey>([...CORE_KEYS, ...asked.filter(isLedgerKey)]);
  return [...want].filter(k => !active.has(k)).sort(byCodeUnit);
}

/**
 * Is the collection behind this key cut at its cap (or, for entries, left to the server)?
 *
 * `useLedgerStore.truncatedCollections` is keyed by **database collection name**
 * (`setCollectionTruncated(spec.collection, …)` in src/hooks/useLedgerData.ts), which is not always
 * the store key: `accounts` is loaded from `chartAccounts`. A screen that writes
 * `truncated.accounts` therefore never sees the cap and shows a figure taken from a cut list with
 * no warning — so screens ask through this function rather than indexing the map themselves.
 */
export function isCollectionCapped(truncated: Record<string, boolean> | undefined, key: LedgerKey): boolean {
  return Boolean(truncated?.[LEDGER_COLLECTIONS[key].collection]);
}

/** Is any of these collections cut? The usual per-screen completeness check. */
export function anyCollectionCapped(truncated: Record<string, boolean> | undefined, keys: readonly LedgerKey[]): boolean {
  return keys.some(key => isCollectionCapped(truncated, key));
}

/**
 * The store key behind a cut collection name, for screens that carry collection names rather than keys
 * (`truncatedInputs` in src/lib/dataChecks.ts). A collection the app does not load in the browser (a
 * server-only list) is returned unchanged, so nothing is silently dropped.
 */
export function ledgerKeyOfCollection(collection: string): LedgerKey | string {
  const key = (Object.keys(LEDGER_COLLECTIONS) as LedgerKey[]).find(k => LEDGER_COLLECTIONS[k].collection === collection);
  return key ?? collection;
}

/**
 * L-123 step 4: the entry list is partial when the cap is reached, or when the closed years are left to the server
 * (`closedThrough`: the newest fresh year-end snapshot's day). Either way the screens that read every entry fall back
 * to the server's figures, as they do for a capped list.
 */
export function entryListPartial(count: number, cap: number, closedThrough: string | null): boolean {
  return count >= cap || closedThrough !== null;
}

/** The newest fresh year-end snapshot's day from `GET /api/v1/balances/closed-through`, or null (none, or no answer). */
export function closedThroughFrom(body: unknown): string | null {
  const day = (body as { closedThrough?: unknown } | null)?.closedThrough;
  return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}
