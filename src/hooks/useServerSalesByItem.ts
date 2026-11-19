import { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { identityScope } from '../lib/serverAction';
import { getBalances } from '../lib/balancesApi';
import { computeSalesByItem, type SalesByItemReport } from '../server/reports/itemReports';
import { rangeRevision } from '../lib/serverTopLines';
import { anyCollectionCapped } from '../lib/ledgerCollections';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { useScreenDataHealth } from './useScreenDataHealth';
import { useLedgerCollections } from './useLedgerCollections';

const inputs = ['invoices', 'inventory', 'transactions', 'accounts'] as const;

/** Read the full period for a cap, otherwise wait for all four local inputs in this book.
 * No local result means no totals, not zero. An authoritative period read stands on its own. */
export function useServerSalesByItem(from: string | undefined, to: string | undefined) {
  useLedgerCollections('inventory', 'invoices');
  const invoices = useLedgerStore(s => s.invoices);
  const items = useLedgerStore(s => s.inventory);
  const transactions = useLedgerStore(s => s.transactions);
  const accounts = useLedgerStore(s => s.accounts);
  const capped = useLedgerStore(s => anyCollectionCapped(s.truncatedCollections, inputs));
  const health = useScreenDataHealth(inputs);
  const loadedBook = useDataNeedsStore(s => s.loadedWorkspaceId);
  const uid = useAuthStore(s => s.user?.uid);
  const guest = useAuthStore(s => s.isGuest && !s.user);
  const workspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  const baseCurrency = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';
  const currentBook = !!workspaceId && workspaceId === loadedBook;
  const needed = !guest && currentBook && capped && !!from && !!to && from <= to;
  // an edit to any loaded entry (a range invoice's cost of goods sold may be posted or reversed before the range), to a range invoice, or to any item or account (names, SKUs, unit costs, account
  // classes: all report inputs; small, fully loaded lists, so whole), changes the server's report too
  const revision = useMemo(() => (needed ? `${rangeRevision(transactions || [], '')}.${JSON.stringify((invoices || []).filter(i => (i.date || '') >= from!))}.${JSON.stringify(items || [])}.${JSON.stringify(accounts || [])}` : ''),
    [needed, transactions, invoices, items, accounts, from]);
  const [attempt, setAttempt] = useState(0);
  // A -> B -> A, including a change of reader or period, must wait for a fresh answer for A.
  const period = useMemo(() => needed ? { workspaceId, from, to, uid, baseCurrency } : null,
    [needed, workspaceId, from, to, uid, baseCurrency]);
  const request = useMemo(() => period ? { period, revision, attempt } : null, [period, revision, attempt]);
  const [answer, setAnswer] = useState<{ request: NonNullable<typeof request>; report: SalesByItemReport | null } | null>(null);
  useEffect(() => {
    if (!request) return;
    const scope = identityScope(() => useAuthStore.getState().user?.uid, () => useAuthStore.getState().currentWorkspaceId);
    let live = true;
    const publish = (report: SalesByItemReport | null) => { if (live && scope.isCurrent()) setAnswer({ request, report }); };
    const { workspaceId, from, to } = request.period;
    void getBalances<SalesByItemReport>('sales-by-item', { workspaceId, from, to }, b => Array.isArray(b.rows) && !!b.totals)
      .then(publish, () => publish(null));
    return () => { live = false; };
  }, [request]);

  const current = request && request === answer?.request ? answer : null;
  const ready = (guest || currentBook) && health.ready;
  const pending = !!request && !current;
  // Don't blank a populated report on every live revision. Never carry an old empty claim,
  // a failed subscription or another selection's rows through this refresh.
  const refreshing = pending && ready && answer?.request.period === period && !!answer.report?.rows.length;
  const server = current?.report ?? (refreshing ? answer?.report : null);
  const report = useMemo(() => server ?? (ready && !pending
    ? computeSalesByItem({ invoices, items, transactions, accounts, baseCurrency, startDate: from, endDate: to }) : null),
  [server, ready, pending, invoices, items, transactions, accounts, baseCurrency, from, to]);
  const source = refreshing ? 'refreshing' : server ? 'server' : capped ? 'loaded-incomplete' : 'loaded';
  return { report, source, failed: currentBook && !server && !pending && health.failedKeys.length ? health : null,
    retryFull: current?.report === null ? () => setAttempt(n => n + 1) : undefined };
}
