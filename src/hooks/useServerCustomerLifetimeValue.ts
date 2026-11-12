import { useMemo } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { anyCollectionCapped } from '../lib/ledgerCollections';
import { useLedgerCollections } from './useLedgerCollections';
import { customerLifetimeValue, type CustomerLifetimeValueReport } from '../lib/customerLifetimeValue';
import { useServerRangeReport, type RangeReportSource } from './useServerRangeReport';

/** "All recorded history" on the wire (the route's ALL_HISTORY_FROM). */
const ALL_HISTORY_FROM = '0001-01-01';
const parseReport = (body: Record<string, unknown>) =>
  (body.report && typeof body.report === 'object' && Array.isArray((body.report as { rows?: unknown }).rows) ? body.report as CustomerLifetimeValueReport : null);

/**
 * L-123 step 4q: customer lifetime value as of `asOf` (customerLifetimeValue). Without `from` it covers all recorded
 * history. When the loaded entries are capped (cost of goods sold may be missing), or the invoices, credit notes, items,
 * chart of accounts or customers are capped, or any of them failed to load, the report comes from the server
 * (GET /api/v1/balances/customer-lifetime-value), which reads documents at any date. `enabled` false (an invalid date or
 * lifespan, loading) keeps the loaded report and asks nothing.
 */
export function useServerCustomerLifetimeValue(asOf: string, from: string, lifespanYears: number, enabled: boolean):
  { report: CustomerLifetimeValueReport | null; source: RangeReportSource } {
  useLedgerCollections('customers', 'invoices', 'creditNotes', 'inventory', 'transactions', 'accounts');
  const workspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  const baseCurrency = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';
  const customers = useLedgerStore(s => s.customers);
  const invoices = useLedgerStore(s => s.invoices);
  const creditNotes = useLedgerStore(s => s.creditNotes);
  const items = useLedgerStore(s => s.inventory);
  const transactions = useLedgerStore(s => s.transactions);
  const accounts = useLedgerStore(s => s.accounts);
  const capped = useLedgerStore(s => anyCollectionCapped(s.truncatedCollections, ['transactions', 'invoices', 'creditNotes', 'inventory', 'accounts', 'customers']));
  const failed = useDataNeedsStore(s => Boolean((['customers', 'invoices', 'creditNotes', 'inventory', 'transactions', 'accounts'] as const).some(k => s.failed[k])));
  const own = useMemo(() => {
    const scoped = <T extends { workspaceId?: string }>(rows: T[] | undefined) => (rows || []).filter(r => !workspaceId || r.workspaceId === workspaceId);
    return { customers: scoped(customers), invoices: scoped(invoices), creditNotes: scoped(creditNotes), items: scoped(items), transactions: scoped(transactions), accounts: scoped(accounts), baseCurrency };
  }, [workspaceId, baseCurrency, customers, invoices, creditNotes, items, transactions, accounts]);
  const loaded = useMemo(() => (enabled ? customerLifetimeValue({ ...own, asOfDate: asOf, from: from || undefined, lifespanYears }) : null), [enabled, own, asOf, from, lifespanYears]);
  const query = useMemo(() => ({ lifespan: String(lifespanYears) }), [lifespanYears]);
  const extraKey = useMemo(() => JSON.stringify([own.customers.map(c => [c.id, c.name]), own.invoices, own.creditNotes, own.items, own.accounts]), [own]);
  const { report, source } = useServerRangeReport({
    path: 'customer-lifetime-value', from: enabled ? from || ALL_HISTORY_FROM : undefined, to: enabled ? asOf : undefined, query, extraKey,
    alsoIncomplete: capped || failed, parse: parseReport, loaded,
  });
  return { report, source };
}
