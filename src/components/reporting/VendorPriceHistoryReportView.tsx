import React, { useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { priceTrend, vendorPriceHistory, vendorPriceHistoryCsvRows, VENDOR_PRICE_HISTORY_CSV_HEADERS, type VendorPriceRow } from '../../lib/vendorPriceHistory';
import { validCustomReportPeriod } from '../../lib/reportCustomPeriod';
import { formatCurrency } from '../../lib/utils';
import { downloadCsv } from '../../lib/csvExport';
import ReportTableScroll from './ReportTableScroll';
import { RowTable } from '../ui/RowTable';
import { fill, useReportText } from './useReportText';

const field = 'min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]';
const TREND_LABEL: Record<ReturnType<typeof priceTrend>, string> = {
  up: 'Higher',
  down: 'Lower',
  flat: 'Unchanged',
  single: 'One purchase so far',
};

/**
 * A-71: vendor price history, from the bill lines already recorded. One series per vendor and item
 * in the purchase's own currency, in date order, with the change from the first purchase to the
 * last, and a line chart of the chosen series. Read-only: nothing is posted, priced or changed.
 */
export default function VendorPriceHistoryReportView({ startDate = '', endDate = '' }: { startDate?: string; endDate?: string }) {
  return <VendorPriceHistoryPanel from={startDate} to={endDate} />;
}

/** The report for the window it is given (the wrapper above takes the window from the Reports page). */
export function VendorPriceHistoryPanel({ from = '', to = '' }: { from?: string; to?: string }) {
  const reportText = useReportText();
  const bills = useLedgerStore(state => state.bills);
  const vendors = useLedgerStore(state => state.vendors);
  const items = useLedgerStore(state => state.inventory);
  const truncated = useLedgerStore(state => state.truncatedCollections);
  const failed = useDataNeedsStore(state => state.failed);
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  const { loading } = useLedgerCollections('bills', 'vendors', 'inventory');

  const windowValid = validCustomReportPeriod({ startDate: from, endDate: to });
  const valid = windowValid || (!from && !to);
  const [vendorId, setVendorId] = useState('');
  const [itemFilter, setItemFilter] = useState('');
  const [chartKey, setChartKey] = useState('');

  const rows = useMemo(() => {
    if (!valid) return [];
    const scopedBills = bills.filter(bill => !workspaceId || bill.workspaceId === workspaceId);
    const scopedVendors = vendors.filter(vendor => !workspaceId || vendor.workspaceId === workspaceId);
    const scopedItems = items.filter(item => !workspaceId || item.workspaceId === workspaceId);
    const search = itemFilter.trim().toLowerCase();
    return vendorPriceHistory({
      bills: scopedBills,
      vendors: scopedVendors,
      items: scopedItems,
      vendorId: vendorId || undefined,
      from: windowValid ? from : undefined,
      to: windowValid ? to : undefined,
      homeCurrency: workspace?.currency || 'USD',
    }).filter(row => !search || row.itemName.toLowerCase().includes(search) || (row.sku || '').toLowerCase().includes(search));
  }, [bills, vendors, items, workspaceId, workspace, vendorId, itemFilter, from, to, valid, windowValid]);

  const partial = truncated.bills || failed.bills || truncated.vendors || failed.vendors || truncated.inventory || failed.inventory;
  const currency = workspace?.currency || 'USD';
  const keyOf = (row: VendorPriceRow) => `${row.vendorId}:${row.itemId}:${row.currency}`;
  const charted = rows.find(row => keyOf(row) === chartKey) || rows[0];

  return <section aria-label={reportText('r.vendor-price-history', 'Vendor price history')} className="p-4 space-y-4 min-w-0">
    <h2>{reportText('r.vendor-price-history', 'Vendor price history')}</h2>
    <p className="text-sm text-[var(--muted)]">
      {reportText('r.what-each-item-actually-cost-from-each-vendor-li', 'What each item actually cost from each vendor, line by line, from the bills the books hold: the line amount divided by its units, in that bill\'s own currency. Draft, void, cancelled and rejected bills are not purchases and are left out. Prices are never compared or added across currencies, and a single purchase shows no change.')}
    </p>

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1 text-sm">{reportText('r.vendor', 'Vendor')}
        <select aria-label={reportText('r.vendor', 'Vendor')} className={field} value={vendorId} onChange={event => setVendorId(event.target.value)}>
          <option value="">{reportText('r.all-vendors', 'All vendors')}</option>
          {vendors.map(vendor => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">{reportText('r.item-or-sku', 'Item or SKU')}
        <input aria-label={reportText('r.item-or-sku', 'Item or SKU')} className={field} value={itemFilter} onChange={event => setItemFilter(event.target.value)} placeholder={reportText('r.search-items', 'Search items')} />
      </label>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" onClick={() => downloadCsv('vendor-price-history', VENDOR_PRICE_HISTORY_CSV_HEADERS, vendorPriceHistoryCsvRows(rows))} disabled={!rows.length}>{reportText('r.export-csv', 'Export CSV')}</button>
    </div>

    {!valid && <p role="alert">{reportText('r.choose-a-valid-report-period', 'Choose a valid report period.')}</p>}
    {loading && <p role="status" className="text-sm text-[var(--muted)]">{reportText('r.loading-bills', 'Loading bills…')}</p>}
    {partial && <p role="alert" className="text-sm text-[var(--muted)]">{reportText('r.the-loaded-bill-history-is-capped-or-failed-at-t', 'The loaded bill history is capped or failed at the database. Figures may be incomplete.')}</p>}

    {charted && <PriceChart row={charted} rows={rows} currency={currency} onChoose={setChartKey} keyOf={keyOf} />}

    <ReportTableScroll>
      <RowTable
        rowClassName="border-b border-[var(--line)]/50"
        caption={(<>{reportText('r.recorded-purchase-prices', 'Recorded purchase prices')} {windowValid ? `${from} – ${to}` : reportText('r.all-recorded-bills', '(all recorded bills)')}</>)}
        rows={rows}
        rowKey={row => keyOf(row)}
        captionClassName=""
        tableClassName="w-full text-sm"
        headRowClassName=""
        bodyClassName=""
        columns={[
          { header: reportText('r.vendor', 'Vendor'), className: "text-left font-normal py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => <bdi>{row.vendorName}</bdi> },
          { header: reportText('r.item', 'Item'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => (<><bdi>{row.itemName}</bdi>{row.sku ? <span className="text-[var(--muted)]"> ({row.sku})</span> : null}</>) },
          { header: reportText('r.currency-2', 'Currency'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.currency },
          { header: reportText('r.purchases', 'Purchases'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.points.length },
          { header: reportText('r.units', 'Units'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.units },
          { header: reportText('r.first', 'First'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => formatCurrency(row.firstUnitCents, row.currency) },
          { header: reportText('r.last', 'Last'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => formatCurrency(row.lastUnitCents, row.currency) },
          { header: reportText('r.lowest-2', 'Lowest'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => formatCurrency(row.minUnitCents, row.currency) },
          { header: reportText('r.highest', 'Highest'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => formatCurrency(row.maxUnitCents, row.currency) },
          { header: reportText('r.change-2', 'Change'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => (<>{row.changePercent === undefined ? '—' : `${row.changePercent > 0 ? '+' : ''}${row.changePercent.toFixed(2)}%`}{row.changes > 0 ? ` ${fill(reportText('r.0-moves', '({0} moves)'), { 0: row.changes })}` : ''}</>) },
          { header: reportText('r.trend', 'Trend'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => TREND_LABEL[priceTrend(row)] },
        ]}
      />
      {valid && !loading && !rows.length && <p className="text-sm text-[var(--muted)]">{reportText('r.no-bill-line-in-this-window-names-an-item-with-u', 'No bill line in this window names an item with units.')}</p>}
    </ReportTableScroll>
  </section>;
}

/** A small line chart of one series: unit cost over time. Pure SVG, so it prints and exports well. */
function PriceChart({ row, rows, currency, onChoose, keyOf }: { row: VendorPriceRow; rows: VendorPriceRow[]; currency: string; onChoose: (key: string) => void; keyOf: (row: VendorPriceRow) => string }) {
  const reportText = useReportText();
  const width = 640;
  const height = 200;
  const padding = 36;
  const values = row.points.map(point => point.unitCents);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low || 1;
  const step = row.points.length > 1 ? (width - padding * 2) / (row.points.length - 1) : 0;
  const x = (index: number) => padding + index * step;
  const y = (value: number) => height - padding - ((value - low) / span) * (height - padding * 2);
  const path = row.points.map((point, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(point.unitCents).toFixed(1)}`).join(' ');

  return <div className="space-y-2">
    <label className="flex flex-col gap-1 text-sm w-fit" data-print-hide>{reportText('r.series-to-chart', 'Series to chart')}
      <select aria-label={reportText('r.series-to-chart', 'Series to chart')} className={field} value={keyOf(row)} onChange={event => onChoose(event.target.value)}>
        {rows.map(option => <option key={keyOf(option)} value={keyOf(option)}>{option.vendorName} — {option.itemName} ({option.currency})</option>)}
      </select>
    </label>
    <svg role="img" aria-label={fill(reportText('r.unit-cost-of-0-from-1-over-2-purchases-3-to-4', 'Unit cost of {0} from {1} over {2} purchases, {3} to {4}'), { 0: row.itemName, 1: row.vendorName, 2: row.points.length, 3: formatCurrency(low, row.currency), 4: formatCurrency(high, row.currency) })}
      viewBox={`0 0 ${width} ${height}`} className="w-full max-w-[40rem] h-auto border border-[var(--line)] rounded bg-[var(--panel)]">
      <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="currentColor" strokeOpacity="0.3" />
      <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="currentColor" strokeOpacity="0.3" />
      <text x={padding} y={padding - 8} fontSize="11" fill="currentColor">{formatCurrency(high, row.currency)}</text>
      <text x={padding} y={height - padding + 16} fontSize="11" fill="currentColor">{formatCurrency(low, row.currency)} · {row.points[0].date}</text>
      <text x={width - padding} y={height - padding + 16} fontSize="11" fill="currentColor" textAnchor="end">{row.points[row.points.length - 1].date}</text>
      <path d={path} fill="none" stroke="currentColor" strokeWidth="2" />
      {row.points.map((point, index) => <circle key={`${point.documentId}:${point.date}:${point.quantity}:${point.unitCents}`} cx={x(index)} cy={y(point.unitCents)} r="3" fill="currentColor"><title>{fill(reportText('r.0-1-2-units', '{0}: {1} ({2} units)'), { 0: point.date, 1: formatCurrency(point.unitCents, row.currency), 2: point.quantity })}</title></circle>)}
    </svg>
    <p className="text-xs text-[var(--muted)]">{reportText('r.unit-cost-in', 'Unit cost in')} {row.currency === currency ? reportText('r.the-workspace-currency', 'the workspace currency') : row.currency}; {span === 1 ? reportText('r.the-cost-has-not-moved', 'the cost has not moved') : reportText('r.the-vertical-axis-spans-the-lowest-and-highest-r', 'the vertical axis spans the lowest and highest recorded cost')}.</p>
  </div>;
}
