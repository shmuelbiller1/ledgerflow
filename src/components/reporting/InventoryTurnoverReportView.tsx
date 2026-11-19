import { isItemDetails } from '../../lib/reportListRows';
import { useReportList } from '../../hooks/useReportList';
import { useMemo, useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { downloadCsv } from '../../lib/csvExport';
import { inventoryTurnover, turnoverCsvRows, TURNOVER_CSV_HEADERS } from '../../lib/inventoryTurnover';
import ReportSchedule from './ReportSchedule';
import { useReportDates } from './useReportDates';
import { useReportText } from './useReportText';

const qty = (n: number) => String(Math.round(n * 100) / 100);
const ratio = (n: number | null) => (n === null ? '—' : n.toFixed(2));

/**
 * A-192: inventory turnover by item. Reads the stock history from the server (the same
 * inventory-details report Stock Aging uses — the browser's loaded copies can be capped) and
 * shows, per item, what sold against the average held. Read-only.
 */
export default function InventoryTurnoverReportView() {
  const reportText = useReportText();
  const dates = useReportDates();
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  const workspaceId = workspace?.id || '';
  const home = workspace?.currency || 'USD';
  const today = getLocalDateISO();
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);

  const periodValid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;
  const query = new URLSearchParams({ workspaceId, startDate: from, endDate: to });
  const { rows: items, loading, failed, error, retry } = useReportList(
    workspaceId && periodValid ? `/api/v1/reports/inventory-details?${query}` : null, 'items', isItemDetails);
  const rows = useMemo(() => items ? inventoryTurnover(items, from, to) : [], [items, from, to]);

  return <section aria-label={reportText('r.inventory-turnover', 'Inventory turnover')} className="p-4 space-y-4 min-w-0">
    <h2>{reportText('r.inventory-turnover', 'Inventory turnover')}</h2>
    <p className="text-sm text-[var(--muted)]">
      {reportText('r.inventory-turnover-intro', 'How many times each item\'s average stock sold through in the period, from the stock history the server keeps. Sold is the net of sales and returns; stock that left for another reason (a count write-off, a purchase return) is under Issued, never in Sold. The average is (opening + closing) ÷ 2 — a two-point average, not a daily one. Where nothing sold, or the average is not positive, the turnover is — rather than an invented number.')}
    </p>

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1 text-sm">{reportText('r.from', 'From')}
        <input type="date" aria-label={reportText('r.period-start', 'Period start')} className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]" value={from} onChange={e => setFrom(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-sm">{reportText('r.to', 'To')}
        <input type="date" aria-label={reportText('r.period-end', 'Period end')} className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]" value={to} onChange={e => setTo(e.target.value)} />
      </label>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={!rows.length}
        onClick={() => downloadCsv('inventory-turnover', [...TURNOVER_CSV_HEADERS], turnoverCsvRows(rows))}>{reportText('r.export-csv', 'Export CSV')}</button>
    </div>

    {!periodValid && <p role="alert" className="text-sm">{reportText('r.choose-a-valid-period-the-start-must-not-be-afte', 'Choose a valid period: the start must not be after the end.')}</p>}
    {loading && <p role="status" className="text-sm text-[var(--muted)]">{reportText('r.reading-the-stock-history', 'Reading the stock history…')}</p>}
    {failed && <div className="space-y-2">
      <p role="alert" className="text-sm">{reportText('r.the-stock-history-could-not-be-read', 'The stock history could not be read:')} {error || reportText('r.missing-report-rows', 'The response did not contain report rows.')}</p>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" onClick={retry}>{reportText('r.retry', 'Retry')}</button>
    </div>}

    {rows.length > 0 && <ReportSchedule columnControls allowDisplayedExport rows={rows} rowKey={row => row.itemId}
      caption={<>{reportText('r.inventory-turnover-by-item', 'Inventory turnover by item,')} <bdi>{dates.periodText(from, to)}</bdi> {reportText('r.values-in', '(values in')} {home})</>}
      columns={[
        { header: reportText('r.item', 'Item'), cell: row => <><bdi>{row.itemName}</bdi>{row.note === 'negative-stock' && <> {reportText('r.stock-was-negative', '· stock was negative')}</>}</> },
        { header: reportText('r.opening-units', 'Opening units'), align: 'right', cell: row => qty(row.openingQty) },
        { header: reportText('r.received', 'Received'), align: 'right', cell: row => qty(row.receivedQty) },
        { header: reportText('r.sold-net', 'Sold (net)'), align: 'right', cell: row => qty(row.soldQty) },
        { header: reportText('r.issued-all-reasons', 'Issued (all reasons)'), align: 'right', cell: row => qty(row.issuedQty) },
        { header: reportText('r.closing-units', 'Closing units'), align: 'right', cell: row => qty(row.closingQty) },
        { header: reportText('r.average-units', 'Average units'), align: 'right', cell: row => qty(row.averageQty) },
        { header: reportText('r.cost-of-what-sold', 'Cost of what sold'), align: 'right', cell: row => formatCurrency(row.costOfSoldCents, home) },
        { header: reportText('r.average-value', 'Average value'), align: 'right', cell: row => formatCurrency(row.averageValueCents, home) },
        { header: reportText('r.turnover-units', 'Turnover (units)'), align: 'right', cell: row => ratio(row.turnoverUnits) },
        { header: reportText('r.turnover-value', 'Turnover (value)'), align: 'right', cell: row => ratio(row.turnoverValue) },
        { header: reportText('r.days-of-stock', 'Days of stock'), align: 'right', cell: row => row.daysOfStock === null ? '—' : row.daysOfStock.toFixed(1) },
      ]} />}
    {items && !rows.length && <p role="status">{reportText('r.no-item-has-stock-or-a-stock-movement-in-this-pe', 'No item has stock or a stock movement in this period.')}</p>}

    <p className="text-xs text-[var(--muted)]">
      {reportText('r.inventory-turnover-footnote', 'Values are the stock ledger\'s own, as in Inventory Valuation. Days of stock is the period\'s days divided by the units turnover — about how long the average stock lasts at this period\'s pace, not a promise about the next one.')}
    </p>
  </section>;
}
