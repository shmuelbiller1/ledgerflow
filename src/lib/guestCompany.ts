import { buildSampleBusinessYear } from './sampleBusinessYear';
import { initializeGuestDatabase, guestRows, guestTableNames, writeGuestBatch, type GuestOperation, guestReady, guestSession, queryGuestRows, SAMPLE_WORKSPACE_ID, type GuestTables } from './db/guestDatabase';
import { LEDGER_COLLECTIONS } from './ledgerCollections';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useAuthStore } from '../stores/useAuthStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import type { Workspace, DimensionNode } from '../types';

/** Hydrates the existing stores from the isolated copy, never from durable user data. */
export function loadGuestCompany(): void {
  if (!guestReady()) {
    const sample = buildSampleBusinessYear({ workspaceId: SAMPLE_WORKSPACE_ID });
    const tables: GuestTables = {};
    for (const [key, records] of Object.entries(sample)) {
      if (!Array.isArray(records)) continue;
      const table = key === 'accounts' ? 'chartAccounts' : key;
      tables[table] = Object.fromEntries(records.filter(record => record && typeof record.id === 'string').map(record => [record.id, record]));
    }
    tables.workspaces = { [SAMPLE_WORKSPACE_ID]: { ...sample.workspace, name: 'Sample company' } };
    initializeGuestDatabase(tables);
  }
  publishGuestCompany();
}

export function publishGuestCompany(): void {
  const auth = useAuthStore.getState();
  if (auth.user || !auth.isGuest || auth.currentWorkspaceId !== SAMPLE_WORKSPACE_ID || !guestReady()) return;
  const patch = Object.fromEntries(Object.entries(LEDGER_COLLECTIONS).filter(([key]) => key !== 'scenarios').map(([key, spec]) => [key, queryGuestRows(spec.collection, guestSession()!, [], 'newestFirstBy' in spec ? [{ field: spec.newestFirstBy, direction: 'desc' }] : []).map(row => ({ ...row.data, id: row.id }))]));
  useLedgerStore.setState(patch);
  useLedgerStore.getState().recomputeBalances();
  useLedgerStore.getState().setDimensionNodes(guestRows('dimensionNodes').map(row => row.data as unknown as DimensionNode));
  const workspace = guestRows('workspaces')[0]?.data;
  if (typeof workspace?.currency === 'string') useLedgerStore.getState().setBaseCurrency(workspace.currency);
  auth.setWorkspaces(guestRows('workspaces').map(row => ({ ...row.data, id: row.id }) as unknown as Workspace));
  for (const key of Object.keys(LEDGER_COLLECTIONS) as Array<keyof typeof LEDGER_COLLECTIONS>) useDataNeedsStore.getState().markLoaded(key);
}

/** Keep the existing country picker/reset on the same persistent sample copy as the forms. */
export function replaceGuestCompany(records: { currency: string; accounts: Array<{ id: string }>; customers: Array<{ id: string }>; vendors: Array<{ id: string }>; invoices: Array<{ id: string }>; bills: Array<{ id: string }>; transactions: Array<{ id: string }> }, name: string): void {
  const session = guestSession();
  if (!session) throw new Error('The sample company is closed.');
  const operations: GuestOperation[] = guestTableNames(session).filter(table => table !== 'workspaces').flatMap(table => guestRows(table).map(row => ({ op: 'delete' as const, table, id: row.id })));
  for (const key of ['accounts', 'customers', 'vendors', 'invoices', 'bills', 'transactions'] as const) {
    for (const record of records[key]) operations.push({ op: 'set', table: key === 'accounts' ? 'chartAccounts' : key, id: record.id, data: { ...record, workspaceId: SAMPLE_WORKSPACE_ID } });
  }
  operations.push({ op: 'set', table: 'workspaces', id: SAMPLE_WORKSPACE_ID, data: { ...buildSampleBusinessYear({ workspaceId: SAMPLE_WORKSPACE_ID }).workspace, name, currency: records.currency, defaultCurrency: records.currency, dimensions: [], taxProfiles: {} } });
  writeGuestBatch(operations, session);
  publishGuestCompany();
}
