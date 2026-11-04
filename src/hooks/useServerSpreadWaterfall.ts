import { useMemo } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { useLedgerCollections } from './useLedgerCollections';
import { spreadWaterfall, type SpreadSide, type Waterfall } from '../lib/spreadWaterfall';
import { rangeRevision } from '../lib/serverTopLines';
import { useServerRangeReport, type RangeReportSource } from './useServerRangeReport';

const parseWaterfall = (body: Record<string, unknown>) => {
  const w = body.waterfall as Waterfall | undefined;
  return w && Array.isArray(w.months) && Array.isArray(w.rows) && w.totals ? w : null;
};

/**
 * L-123 step 4o: the spread waterfall for `from`…`to` (spreadWaterfall). It counts recognition entries at any date
 * (before the period as earned, after it as deferred), so a capped entry list can leave shares out wherever the cap
 * falls; when the loaded entries, invoices or bills are capped or failed to load, the waterfall comes from the server
 * (GET /api/v1/balances/spread-waterfall). A change to any loaded entry or document asks again. `enabled` false (an
 * invalid period, loading) keeps the loaded waterfall and asks nothing.
 */
export function useServerSpreadWaterfall(side: SpreadSide, from: string, to: string, enabled: boolean): { waterfall: Waterfall | null; source: RangeReportSource } {
  useLedgerCollections('transactions', 'invoices', 'bills');
  const workspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  const transactions = useLedgerStore(s => s.transactions);
  const invoices = useLedgerStore(s => s.invoices);
  const bills = useLedgerStore(s => s.bills);
  const capped = useLedgerStore(s => Boolean(['transactions', 'invoices', 'bills'].some(k => s.truncatedCollections?.[k])));
  const failed = useDataNeedsStore(s => Boolean(s.failed.transactions || s.failed.invoices || s.failed.bills));
  const own = useMemo(() => {
    const scoped = <T extends { workspaceId?: string }>(rows: T[] | undefined) => (rows || []).filter(r => !workspaceId || !r.workspaceId || r.workspaceId === workspaceId);
    return { transactions: scoped(transactions), documents: side === 'invoice' ? scoped(invoices) : scoped(bills) };
  }, [workspaceId, transactions, invoices, bills, side]);
  const loaded = useMemo(() => (enabled ? spreadWaterfall(own.transactions, own.documents, side, { startDate: from, endDate: to }) : null), [enabled, own, side, from, to]);
  const query = useMemo(() => ({ side }), [side]);
  const extraKey = useMemo(() => JSON.stringify([rangeRevision(own.transactions, ''), own.documents.map(d => [d.id, d.number, 'customerName' in d ? d.customerName : (d as { vendorName?: string }).vendorName])]), [own]);
  // The entry list is capped wherever it is capped, not only before `from` (shares after the period count as deferred).
  const { report, source } = useServerRangeReport({
    path: 'spread-waterfall', from: enabled ? from : undefined, to: enabled ? to : undefined, query, extraKey, alsoIncomplete: capped || failed, parse: parseWaterfall, loaded,
  });
  return { waterfall: report, source };
}
