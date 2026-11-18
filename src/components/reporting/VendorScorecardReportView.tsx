import React, { useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useUIStore } from '../../stores/useUIStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useCollection } from '../../hooks/useCollection';
import { vendorScorecard, vendorScorecardCsvRows, VENDOR_SCORECARD_CSV_HEADERS } from '../../lib/vendorScorecard';
import { validCustomReportPeriod } from '../../lib/reportCustomPeriod';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { downloadCsv } from '../../lib/csvExport';
import ReportTableScroll from './ReportTableScroll';
import type { PurchaseOrder } from '../../types';
import { RowTable } from '../ui/RowTable';
import { useReportText, fill } from './useReportText';

const field = 'min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]';
const percent = (value: number | null | undefined) => (value === null || value === undefined ? 'Not measured' : `${value.toFixed(2)}%`);

/**
 * A-47: vendor scorecard. Per vendor: on-time delivery against the expected date, price changes
 * per item (in the bill's own currency), and the returns sent back. Read-only; nothing is posted
 * or changed. The purchase orders are read in one request of up to 500, so a longer history is
 * flagged as partial rather than shown as complete.
 */
export default function VendorScorecardReportView({ endDate = '' }: { endDate?: string }) {
  const { data: orders, loading: loadingOrders } = useCollection<PurchaseOrder>('purchaseOrders', { orderByField: 'createdAt', orderDirection: 'desc', limit: 500 });
  return <VendorScorecardPanel endDate={endDate} orders={orders} ordersLoading={loadingOrders} />;
}

/** The scorecard for the purchase orders it is given (the wrapper above reads them). */
export function VendorScorecardPanel(props: { endDate?: string; orders: PurchaseOrder[]; ordersLoading?: boolean }) {
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const userId = useAuthStore(state => state.user?.uid);
  return <VendorScorecardContent key={JSON.stringify([userId, workspaceId])} {...props} />;
}

function VendorScorecardContent({ endDate = '', orders, ordersLoading = false }: { endDate?: string; orders: PurchaseOrder[]; ordersLoading?: boolean }) {
  const reportText = useReportText();
  const bills = useLedgerStore(state => state.bills);
  const vendors = useLedgerStore(state => state.vendors);
  const credits = useLedgerStore(state => state.vendorCredits);
  const truncated = useLedgerStore(state => state.truncatedCollections);
  const failed = useDataNeedsStore(state => state.failed);
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  const { loading: loadingLedger } = useLedgerCollections('bills', 'vendors', 'vendorCredits');
  const [chosenFrom, setChosenFrom] = useState<string | null>(null);

  const to = endDate || getLocalDateISO();
  const from = chosenFrom ?? `${to.slice(0, 4)}-01-01`;
  const valid = validCustomReportPeriod({ startDate: from, endDate: to });
  const [vendorSearch, setVendorSearch] = useState('');
  const homeCurrency = workspace?.currency || 'USD';

  const rows = useMemo(() => {
    if (!valid) return [];
    const scopedOrders = orders.filter(po => !workspaceId || po.workspaceId === workspaceId);
    const scopedBills = bills.filter(b => !workspaceId || b.workspaceId === workspaceId);
    const scopedCredits = credits.filter(c => !workspaceId || c.workspaceId === workspaceId);
    return vendorScorecard({ vendors, orders: scopedOrders, bills: scopedBills, credits: scopedCredits, from, to, homeCurrency });
  }, [vendors, orders, bills, credits, workspaceId, from, to, valid, homeCurrency]);

  const partial = truncated.bills || failed.bills || truncated.vendorCredits || failed.vendorCredits || orders.length >= 500;
  const loading = loadingLedger || ordersLoading;
  const visibleRows = rows.filter(row => row.vendorName.toLocaleLowerCase().includes(vendorSearch.trim().toLocaleLowerCase()));
  const money = (cents: number, currency?: string) => formatCurrency(cents, currency || homeCurrency);

  return <section aria-label={reportText('r.vendor-scorecard', 'Vendor scorecard')} className="p-4 space-y-4 min-w-0">
    <h2>{reportText('r.vendor-scorecard', 'Vendor scorecard')}</h2>
    <p className="text-sm text-[var(--muted)]">{reportText('r.read-only-for-each-vendor-how-often-the-first-go', 'Read-only. For each vendor: how often the first goods receipt came on or before the expected delivery date, which items changed price (unit cost, in each bill\'s own currency), and the returns sent back. Nothing is posted or changed here.')}</p>

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1">{reportText('r.from', 'From')}
        <input aria-label={reportText('r.scorecard-from-date', 'Scorecard from date')} type="date" className={field} value={from} onChange={event => setChosenFrom(event.target.value)} />
      </label>
      <label className="flex flex-col gap-1">{reportText('r.to', 'To')}
        <input aria-label={reportText('r.scorecard-to-date', 'Scorecard to date')} type="date" className={field} value={to} readOnly />
      </label>
      <label className="flex flex-col gap-1">{reportText('r.find-vendor', 'Find vendor')}
        <input aria-label={reportText('r.find-vendor', 'Find vendor')} dir="auto" className={field} value={vendorSearch} onChange={event => setVendorSearch(event.target.value)} />
      </label>
      <button type="button" className="btn-secondary min-h-11 px-3" disabled={!visibleRows.length} onClick={() => downloadCsv(
        `vendor-scorecard-${from}-${to}.csv`, VENDOR_SCORECARD_CSV_HEADERS, vendorScorecardCsvRows(visibleRows)
      )}>{reportText('r.export-csv', 'Export CSV')}</button>
    </div>

    {loading && <p role="status">{reportText('r.loading-vendor-history', 'Loading vendor history…')}</p>}
    {!valid && <p role="alert">{reportText('r.choose-a-valid-date-range-from-must-be-on-or-bef', 'Choose a valid date range; From must be on or before To.')}</p>}
    {partial && <p role="alert">{reportText('r.some-history-is-incomplete-or-failed-to-load-fig', 'Some history is incomplete or failed to load. Figures here may leave out older orders, bills or credits.')}</p>}

    {visibleRows.length > 0 && <ReportTableScroll><RowTable
      rowClassName="border-t border-[var(--line)] align-top"
      caption={(<>{reportText('r.vendors-from', 'Vendors from')} {from} {reportText('r.to-2', 'to')} {to}</>)}
      rows={visibleRows}
      rowKey={row => row.vendorId}
      captionClassName=""
      tableClassName="w-full min-w-[900px] text-sm"
      headRowClassName=""
      bodyClassName=""
      columns={[
        { header: reportText('r.vendor', 'Vendor'), className: "text-left min-w-60", headClassName: "", cell: (row) => (<><bdi>{row.vendorName}</bdi>
          <details key={`${workspaceId}:${row.vendorId}`} className="font-normal mt-2 w-64 max-w-full">
            <summary className="min-h-11 cursor-pointer">{reportText('r.review-source-bills', 'Review source bills')}</summary>
            <p className="text-sm text-[var(--muted)]">{reportText('r.loaded-bills-in-this-date-range-including-bills', 'Loaded bills in this date range, including bills without item quantities. Open a bill to inspect its original lines. Orders and return credits keep their own screens.')}</p>
            <ul>{bills.filter(bill => typeof bill.date === 'string' && bill.vendorId === row.vendorId && (!workspaceId || bill.workspaceId === workspaceId) &&
              bill.date.slice(0, 10) >= from && bill.date.slice(0, 10) <= to).map(bill => <li key={bill.id}>
                <button type="button" className="min-h-11 underline text-left" onClick={() => useUIStore.getState().openRecord({ type: 'bill', id: bill.id })}>
                  <bdi>{bill.number || bill.id}</bdi> · <bdi>{bill.date?.slice(0, 10)}</bdi>
                </button>
              </li>)}</ul>
          </details></>) },
        { header: reportText('r.orders-with-dates', 'Orders with dates'), align: 'right', className: "tabular-nums", headClassName: "", cell: (row) => (<>{row.orders.withDates}{row.orders.withDates ? ` ${fill(reportText('r.pct-on-time', '({pct} on time)'), { pct: percent(row.orders.onTimeRate) })}` : ''}</>) },
        { header: reportText('r.on-time', 'On time'), align: 'right', className: "tabular-nums", headClassName: "", cell: (row) => (<>{row.orders.onTime} {reportText('r.on-time-2', 'on time,')} {row.orders.late} {reportText('r.late', 'late')}</>) },
        { header: reportText('r.average-days-late', 'Average days late'), align: 'right', className: "tabular-nums", headClassName: "", cell: (row) => row.orders.averageDaysLate ?? 'Not measured' },
        { header: reportText('r.price-changes', 'Price changes'), headClassName: "", cell: (row) => row.priceChanges.length ? <ul className="space-y-1">{row.priceChanges.map(p => <li key={`${p.itemId}-${p.currency}`}>
          <code>{p.itemId}</code> ({p.currency}): {money(p.firstUnitCents, p.currency)} {reportText('r.to-2', 'to')} {money(p.lastUnitCents, p.currency)} {reportText('r.per-unit', 'per unit,')} {fill(p.changes === 1 ? reportText('r.n-change', '{n} change') : reportText('r.n-changes', '{n} changes'), { n: p.changes })}{p.changePercent !== undefined ? ` (${p.changePercent}%)` : ''}
        </li>)}</ul> : 'No price changes' },
        { header: reportText('r.returns', 'Returns'), align: 'right', className: "tabular-nums", headClassName: "", cell: (row) => row.returns.credits ? `${row.returns.credits} credit${row.returns.credits === 1 ? '' : 's'}, ${row.returns.units} unit${row.returns.units === 1 ? '' : 's'}, ${money(row.returns.cents)}` : 'None' },
      ]}
    /></ReportTableScroll>}

    {!loading && visibleRows.length === 0 && valid && <p>{rows.length ? reportText('r.no-matching-vendors-clear-the-vendor-search', 'No matching vendors. Clear the vendor search.') : reportText('r.no-vendors-to-show-for-this-period', 'No vendors to show for this period.')}</p>}
  </section>;
}
