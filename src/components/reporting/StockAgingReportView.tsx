import { isStockAge } from '../../lib/reportListRows';
import ReportSchedule from './ReportSchedule';
import { useReportDates } from './useReportDates';
import { useReportList } from '../../hooks/useReportList';
import { useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { AGE_BUCKETS, type StockAge } from '../../lib/stockMoves';
import { useReportText, fill } from './useReportText';

const field = 'min-h-11 px-2 py-1.5 border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]';
const qty = (n: number) => (n ? String(Math.round(n * 1e6) / 1e6) : '');

/**
 * Stock aging (W-09): as of a day, each item's stock on hand split by how long ago those units came
 * in (first in, first out), with its value, the last sale and how long ago; the oldest stock first.
 * Read by the server from the stock history (src/lib/stockMoves.ts `stockAging`).
 */
export default function StockAgingReportView() {
  const reportText = useReportText();
  const dates = useReportDates();
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const [asOf, setAsOf] = useState(getLocalDateISO());
  const currency = workspace?.currency || 'USD';
  const key = workspace && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? new URLSearchParams({ workspaceId: workspace.id, asOf }).toString() : '';

  const { rows: items, loading, failed, error, retry } = useReportList(
    key ? `/api/v1/reports/stock-aging?${key}` : null, 'items', isStockAge);
  const bucketLabels = {
    d30: reportText('r.stock-age-d30', '0–30 days'), d90: reportText('r.stock-age-d90', '31–90 days'),
    d180: reportText('r.stock-age-d180', '91–180 days'), d365: reportText('r.stock-age-d365', '181–365 days'),
    older: reportText('r.stock-age-older', 'Over a year'),
  };
  const unknown = items?.some(i => i.unknownAge > 0);

  return (
    <section aria-labelledby="stock-aging-title" className="space-y-4">
      <h2 id="stock-aging-title" className="text-lg font-bold text-[var(--text)]">{reportText('r.stock-aging', 'Stock aging')}</h2>
      <label className="flex flex-col gap-1 text-sm text-[var(--muted)] w-fit">{reportText('r.as-of-2', 'As of')}<input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} className={field} /></label>
      {loading && <p role="status" className="text-sm text-[var(--muted)]">{reportText('r.loading', 'Loading…')}</p>}
      {failed && <div>
        <p role="alert">{reportText('r.the-stock-history-could-not-be-read', 'The stock history could not be read:')} {error || reportText('r.missing-report-rows', 'The response did not contain report rows.')}</p>
        <button type="button" className="min-h-11 rounded border px-3" onClick={retry}>{reportText('r.retry', 'Retry')}</button>
      </div>}
      {items && items.length === 0 && <p className="text-sm text-[var(--muted)]">{reportText('r.no-stock-on-hand-that-day', 'No stock on hand that day.')}</p>}
      {items && items.length > 0 && <ReportSchedule rows={items} rowKey={row => row.itemId}
        caption={reportText('r.units-on-hand-by-how-long-ago-they-came-in-the-l', 'Units on hand by how long ago they came in, the latest units taken to be the ones still there; the oldest stock first.')}
        columns={[
          { header: reportText('r.item', 'Item'), cell: row => <bdi>{row.itemName}</bdi> },
          { header: reportText('r.on-hand', 'On hand'), align: 'right', cell: row => qty(row.quantity) },
          { header: reportText('r.value', 'Value'), align: 'right', cell: row => formatCurrency(row.valueCents, currency) },
          ...AGE_BUCKETS.map(bucket => ({ header: bucketLabels[bucket.key], align: 'right' as const, cell: (row: StockAge) => qty(row.buckets[bucket.key]) })),
          unknown ? { header: reportText('r.before-the-history', 'Before the history'), align: 'right', cell: row => qty(row.unknownAge) } : false,
          { header: reportText('r.last-sold', 'Last sold'), cell: row => row.lastSold
            ? <time dateTime={row.lastSold}>{fill(reportText('r.0-1-days-ago', '{0} ({1} days ago)'), { 0: dates.dateText(row.lastSold), 1: row.daysSinceSold ?? '' })}</time>
            : reportText('r.never', 'never') },
        ]} />}
    </section>
  );
}
