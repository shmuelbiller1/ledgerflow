import { useMemo } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { useLedgerCollections } from './useLedgerCollections';
import { purchaseTrendsByVendor, trendWindowStart, type TrendRow } from '../lib/documentTrends';
import { useServerRangeReport, type RangeReportSource } from './useServerRangeReport';

const parseTrends = (body: Record<string, unknown>) => (Array.isArray(body.rows) ? body.rows as TrendRow[] : null);

/**
 * L-123 step 4m: amounts billed per month by vendor over the twelve months ending `asOf` (purchaseTrendsByVendor). When
 * the loaded bills or vendors are capped or failed to load, bills of the window may be missing, so the rows come from
 * the server (GET /api/v1/balances/purchase-trends); a change to the window's loaded bills or the vendors asks again.
 * `enabled` false (an invalid date, loading, sales) keeps the loaded rows and asks nothing.
 */
export function useServerPurchaseTrends(asOf: string, enabled: boolean): { rows: TrendRow[]; source: RangeReportSource } {
  useLedgerCollections('vendors', 'bills');
  const workspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  const vendors = useLedgerStore(s => s.vendors);
  const bills = useLedgerStore(s => s.bills);
  const capped = useLedgerStore(s => Boolean(s.truncatedCollections?.vendors || s.truncatedCollections?.bills));
  const failed = useDataNeedsStore(s => Boolean(s.failed.vendors || s.failed.bills));
  const from = enabled ? trendWindowStart(asOf) : undefined;
  const own = useMemo(() => {
    const scoped = <T extends { workspaceId?: string }>(rows: T[] | undefined) => (rows || []).filter(r => !workspaceId || !r.workspaceId || r.workspaceId === workspaceId);
    return { vendors: scoped(vendors), bills: scoped(bills) };
  }, [workspaceId, vendors, bills]);
  const loaded = useMemo(() => (enabled ? purchaseTrendsByVendor(own.vendors, own.bills, asOf) : []), [enabled, own, asOf]);
  const extraKey = useMemo(() => JSON.stringify([own.vendors, own.bills.filter(b => !from || (b.date || '') >= from)]), [own, from]);
  const { report, source } = useServerRangeReport({
    path: 'purchase-trends', from, to: enabled ? asOf : undefined, extraKey, alsoIncomplete: capped || failed, parse: parseTrends, loaded,
  });
  return { rows: report, source };
}
