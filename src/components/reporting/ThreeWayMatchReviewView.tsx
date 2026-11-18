import React, { useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useCollection } from '../../hooks/useCollection';
import { threeWayReview, threeWayReviewCsvRows, THREE_WAY_REVIEW_CSV_HEADERS, type ThreeWayStatus } from '../../lib/threeWayReview';
import type { PurchaseOrder } from '../../types';
import { formatCurrency } from '../../lib/utils';
import { downloadCsv } from '../../lib/csvExport';
import ReportTableScroll from './ReportTableScroll';
import { RowTable } from '../ui/RowTable';
import { useReportText, fill } from './useReportText';

const field = 'min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]';
const STATUS_LABEL: Record<ThreeWayStatus, string> = {
  matched: 'Matched',
  quantity_variance: 'Quantity variance',
  price_variance: 'Price variance',
  unreceived: 'Not received',
  missing_bill: 'Awaiting bill',
};

/**
 * A-118: the three-way match review. Order against goods received against the supplier's bill for
 * a period, as a review list: what matched, what is short, what is over-delivered, what has no
 * receipt and what is still waiting for a bill. The check itself is the purchase-orders engine
 * (`performThreeWayMatch`) — this screen never recomputes it, so the two cannot disagree.
 * Read-only: nothing is posted, approved or changed here.
 */
export default function ThreeWayMatchReviewView({ startDate = '', endDate = '' }: { startDate?: string; endDate?: string }) {
  const { data: orders, loading: loadingOrders } = useCollection<PurchaseOrder>('purchaseOrders', { orderByField: 'createdAt', orderDirection: 'desc', limit: 500 });
  return <ThreeWayMatchReviewPanel from={startDate} to={endDate} orders={orders} ordersLoading={loadingOrders} />;
}

/** The review for the orders it is given (the wrapper above reads them). */
export function ThreeWayMatchReviewPanel({ from = '', to = '', orders, ordersLoading = false }: { from?: string; to?: string; orders: PurchaseOrder[]; ordersLoading?: boolean }) {
  const reportText = useReportText();
  const bills = useLedgerStore(state => state.bills);
  const vendors = useLedgerStore(state => state.vendors);
  const truncated = useLedgerStore(state => state.truncatedCollections);
  const failed = useDataNeedsStore(state => state.failed);
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  const { loading: loadingLedger } = useLedgerCollections('bills', 'vendors');
  const [status, setStatus] = useState<ThreeWayStatus | 'all'>('all');

  const report = useMemo(() => threeWayReview({
    orders: orders.filter(order => !workspaceId || order.workspaceId === workspaceId),
    bills: bills.filter(bill => !workspaceId || bill.workspaceId === workspaceId),
    vendors: vendors.filter(vendor => !workspaceId || vendor.workspaceId === workspaceId),
    from: from || undefined,
    to: to || undefined,
    status,
  }), [orders, bills, vendors, workspaceId, from, to, status]);

  const partial = truncated.bills || failed.bills || truncated.vendors || failed.vendors || orders.length >= 500;
  const loading = loadingLedger || ordersLoading;
  const home = workspace?.currency || 'USD';

  return <section aria-label={reportText('r.three-way-match-review', 'Three-way match review')} className="p-4 space-y-4 min-w-0">
    <h2>{reportText('r.three-way-match-review', 'Three-way match review')}</h2>
    <p className="text-sm text-[var(--muted)]">
      {reportText('r.every-purchase-order-whose-issue-date-is-in-the', 'Every purchase order whose issue date is in the window, checked against its goods receipts and its supplier\'s bill')}{from || to ? ` (${from || 'start'} – ${to || 'today'})` : ''}{reportText('r.the-result-and-the-sentences-come-from-the-same', '. The result and the sentences come from the same check the Purchase orders screen runs; the amounts are each order\'s own figures in the order\'s own currency and are never added across currencies. Read-only: nothing is approved, posted or changed, and the tolerance stays what the check uses (whole minor units, 0 by default).')}
    </p>

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1 text-sm">{reportText('r.result', 'Result')}
        <select aria-label={reportText('r.match-result', 'Match result')} className={field} value={status} onChange={event => setStatus(event.target.value as ThreeWayStatus | 'all')}>
          <option value="all">{reportText('r.all-results', 'All results')}</option>
          {(Object.keys(STATUS_LABEL) as ThreeWayStatus[]).map(key => <option key={key} value={key}>{STATUS_LABEL[key]}</option>)}
        </select>
      </label>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={!report.rows.length}
        onClick={() => downloadCsv('three-way-match-review', THREE_WAY_REVIEW_CSV_HEADERS, threeWayReviewCsvRows(report))}>{reportText('r.export-csv', 'Export CSV')}</button>
    </div>

    {loading && <p role="status" className="text-sm text-[var(--muted)]">{reportText('r.loading-orders-and-bills', 'Loading orders and bills…')}</p>}
    {partial && <p role="alert" className="text-sm text-[var(--muted)]">{reportText('r.the-loaded-orders-bills-or-vendors-are-capped-or', 'The loaded orders, bills or vendors are capped or failed at the database (the newest 500 orders are read). This review may be incomplete.')}</p>}

    <p className="text-sm text-[var(--text)]">
      {report.summary.orders} {reportText('r.order-s', 'order(s):')} {report.summary.matched} {reportText('r.matched', 'matched ·')} {report.summary.quantityVariance} {reportText('r.quantity-variance', 'quantity variance ·')} {report.summary.priceVariance} {reportText('r.price-variance', 'price variance ·')} {report.summary.unreceived} {reportText('r.not-received', 'not received ·')} {report.summary.missingBill} {reportText('r.awaiting-a-bill', 'awaiting a bill')}
    </p>
    {report.byCurrency.length > 0 && <p className="text-sm text-[var(--muted)]">
      {reportText('r.bill-against-order-by-currency', 'Bill against order, by currency:')} {report.byCurrency.map(total => `${total.currency} ${formatCurrency(total.varianceCents, total.currency)}`).join(' · ')} {reportText('r.no-sign-both-directions', '(no sign: both directions).')}
    </p>}

    <ReportTableScroll>
      <RowTable
        rowClassName="border-b border-[var(--line)]/50"
        caption={(<>{reportText('r.three-way-match', 'Three-way match')}{from || to ? fill(reportText('r.orders-issued-range', ': orders issued {from} – {to}'), { from: from || reportText('r.any-date', 'any date'), to: to || reportText('r.today', 'Today').toLowerCase() }) : reportText('r.every-loaded-order', ': every loaded order')}</>)}
        rows={report.rows}
        rowKey={row => row.poId}
        captionClassName=""
        tableClassName="w-full text-sm"
        headRowClassName=""
        bodyClassName=""
        columns={[
          { header: reportText('r.order', 'Order'), className: "text-left font-normal py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => <bdi>{row.poNumber}</bdi> },
          { header: reportText('r.vendor', 'Vendor'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => <bdi>{row.vendorName}</bdi> },
          { header: reportText('r.issued', 'Issued'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.issueDate || '—' },
          { header: reportText('r.currency-2', 'Currency'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.currency || home },
          { header: reportText('r.result', 'Result'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => STATUS_LABEL[row.status] },
          { header: reportText('r.ordered', 'Ordered'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => formatCurrency(row.orderedCents, row.currency || home) },
          { header: reportText('r.received', 'Received'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => formatCurrency(row.receivedCents, row.currency || home) },
          { header: reportText('r.billed-2', 'Billed'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.billedCents ? formatCurrency(row.billedCents, row.currency || home) : '—' },
          { header: reportText('r.variance', 'Variance'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.billId ? `${formatCurrency(row.varianceCents, row.currency || home)}${row.variancePercent === undefined ? '' : ` (${row.variancePercent > 0 ? '+' : ''}${row.variancePercent.toFixed(2)}%)`}` : '—' },
          { header: reportText('r.what-the-check-found', 'What the check found'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.findings.length ? <ul className="list-disc pl-4">{row.findings.map(finding => <li key={finding}>{finding}</li>)}</ul> : 'Order, receipt and bill agree.' },
        ]}
      />
      {!loading && !report.rows.length && <p className="text-sm text-[var(--muted)]">{reportText('r.no-purchase-order-in-this-window', 'No purchase order in this window.')}</p>}
    </ReportTableScroll>

    <p className="text-xs text-[var(--muted)]">{reportText('r.the-sentences-in-the-last-column-are-the-check-s', 'The sentences in the last column are the check\'s own wording, kept as it is: they put a dollar sign in front of the figures. The columns beside them show the same figures in the order\'s own currency.')}</p>
  </section>;
}
