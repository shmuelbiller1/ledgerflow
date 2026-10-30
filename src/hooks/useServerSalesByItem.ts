import { useEffect, useMemo, useState } from 'react';
import { getIdToken } from '../firebase';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { workspaceScope } from '../lib/serverAction';
import { computeSalesByItem, type SalesByItemReport } from '../server/reports/itemReports';
import { rangeRevision } from '../lib/serverTopLines';
import { useLedgerCollections } from './useLedgerCollections';

/**
 * L-123 step 4b: the sales-by-item report over `from`…`to`. When the loaded invoices or entries are capped, sales or
 * their posted cost of goods sold may be missing from the browser, so the report comes from the server
 * (GET /api/v1/balances/sales-by-item). Otherwise, and until it answers or when it cannot be reached, the loaded
 * lists' report, as before. `source` says which, so the screen can say so.
 */
export function useServerSalesByItem(from: string | undefined, to: string | undefined): SalesByItemReport & { source: 'loaded' | 'server' | 'loaded-incomplete' } {
  useLedgerCollections('inventory', 'invoices');
  const invoices = useLedgerStore(s => s.invoices);
  const items = useLedgerStore(s => s.inventory);
  const transactions = useLedgerStore(s => s.transactions);
  const accounts = useLedgerStore(s => s.accounts);
  const capped = useLedgerStore(s => Boolean(s.truncatedCollections?.invoices || s.truncatedCollections?.transactions || s.truncatedCollections?.chartAccounts));
  const workspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  const needed = capped && !!workspaceId && !!from && !!to && from <= to;
  // an edit to a loaded invoice or entry in the range, or to any item or account (names, SKUs, unit costs, account
  // classes: all report inputs; small, fully loaded lists, so whole), changes the server's report too
  const revision = useMemo(() => (needed ? `${rangeRevision(transactions || [], from!)}.${JSON.stringify((invoices || []).filter(i => (i.date || '') >= from!))}.${JSON.stringify(items || [])}.${JSON.stringify(accounts || [])}` : ''),
    [needed, transactions, invoices, items, accounts, from]);
  const key = needed ? `${workspaceId}|${from}|${to}|${revision}` : '';
  const [answer, setAnswer] = useState<{ key: string; server: (SalesByItemReport & { workspaceId: string }) | null } | null>(null);

  useEffect(() => {
    if (!key || !from || !to) return;
    const scope = workspaceScope(() => useAuthStore.getState().currentWorkspaceId);
    let live = true;
    (async () => {
      const query = new URLSearchParams({ workspaceId, from, to }).toString();
      const res = await fetch(`/api/v1/balances/sales-by-item?${query}`, { headers: { Authorization: `Bearer ${await getIdToken()}` } });
      const body = await res.json().catch(() => ({})) as Partial<SalesByItemReport>;
      if (!res.ok || !Array.isArray(body.rows) || !body.totals) throw new Error(`sales by item ${res.status}`);
      return { workspaceId, rows: body.rows, totals: body.totals };
    })().then(server => {
      if (live && scope.isCurrent()) setAnswer({ key, server });
    }).catch(() => {
      // best-effort: without the server's answer the screen keeps the loaded lists' report and says it may be short
      if (live && scope.isCurrent()) setAnswer({ key, server: null });
    });
    return () => { live = false; };
  }, [key, workspaceId, from, to]);

  const server = key && answer?.key === key ? answer.server : null;
  return useMemo(() => {
    if (server && server.workspaceId === workspaceId) return { rows: server.rows, totals: server.totals, source: 'server' as const };
    const own = computeSalesByItem({ invoices: invoices || [], items: items || [], transactions: transactions || [], accounts: accounts || [], startDate: from, endDate: to });
    return { ...own, source: capped ? 'loaded-incomplete' as const : 'loaded' as const };
  }, [server, workspaceId, invoices, items, transactions, accounts, from, to, capped]);
}
