import { usePartialReportInputs } from '../../hooks/usePartialReportInputs';
import ReportSchedule from './ReportSchedule';
import React, { useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { downloadCsv } from '../../lib/csvExport';
import ReportTableScroll from './ReportTableScroll';
import {
  milestoneBilling, milestoneBillingCsvRows, MILESTONE_BILLING_CSV_HEADERS,
  type MilestoneBilling,
} from '../../lib/milestoneBilling';
import { RowTable } from '../ui/RowTable';
import { useReportText, fill } from './useReportText';

const statusLabels: Record<string, string> = { invoiced: 'Invoiced', due: 'Due', upcoming: 'Upcoming' };

const ORDERS_CSV_HEADERS = ['Order', 'Date', 'Customer', 'Status', 'Order total (minor units)', 'Invoiced (minor units)', 'Left to bill (minor units)', 'Next milestone', 'Next due', 'Unscheduled %'];

/**
 * A-73 (screen task A-177): milestone billing view. Every sales order (accepted estimate) record
 * that carries its V-09 milestone schedule, with what has been invoiced and what is left, so the
 * business can see the next milestone to bill. Read-only: the amounts reuse the order's own
 * milestone math and invoicing a milestone stays the order screen's K-04 path. An order records
 * its customer, not a project, so this view lists orders by customer; orders without a schedule
 * are not listed.
 */
export default function MilestoneBillingReportView() {
  const reportText = useReportText();
  const estimates = useLedgerStore(state => state.estimates);
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  const { loading } = useLedgerCollections('estimates');
  const [show, setShow] = useState<'open' | 'all'>('open');
  const [selectedId, setSelectedId] = useState('');

  const home = workspace?.currency || 'USD';
  const today = getLocalDateISO();

  const orders = useMemo(() => {
    const rows = (estimates || [])
      .filter(est => !workspaceId || est.workspaceId === workspaceId)
      .filter(est => (est.milestones || []).length > 0)
      .filter(est => est.status === 'accepted' || (show === 'all' && est.status === 'converted'))
      .map(est => ({ est, billing: milestoneBilling(est.amountCents, est.milestones, today) }))
      .sort((a, b) => String(b.est.date || '').localeCompare(String(a.est.date || '')) || a.est.id.localeCompare(b.est.id));
    return rows;
  }, [estimates, workspaceId, show, today]);

  const selected = orders.find(o => o.est.id === selectedId) || orders[0];
  const dueCount = orders.reduce((sum, o) => sum + o.billing.rows.filter(r => r.status === 'due').length, 0);
  const leftTotal = orders.reduce((sum, o) => sum + o.billing.leftCents, 0);
  const partial = usePartialReportInputs(['estimates']);

  const nextOf = (billing: MilestoneBilling) => billing.rows.find(r => r.status === 'due') || billing.rows.find(r => r.status === 'upcoming');

  return <section aria-label={reportText('r.milestone-billing', 'Milestone billing')} className="p-4 space-y-4 min-w-0">
    <h2>{reportText('r.milestone-billing', 'Milestone billing')}</h2>
    <p className="text-sm text-[var(--muted)]">
      {reportText('r.each-sales-order-that-keeps-a-milestone-schedule', 'Each sales order that keeps a milestone schedule, with what is invoiced, what is left and the next milestone to bill. Amounts are cumulative shares of the order total, so cents never drift, and the percentage of the order no milestone covers shows as unscheduled. An order records its customer and not a project, so orders are listed by customer here. Read-only: invoicing a milestone stays on the order screen, and nothing is posted or changed.')}
    </p>

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1 text-sm">{reportText('r.show', 'Show')}
        <select aria-label={reportText('r.which-orders', 'Which orders')} className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]"
          value={show} onChange={event => setShow(event.target.value as 'open' | 'all')}>
          <option value="open">{reportText('r.orders-still-being-billed', 'Orders still being billed')}</option>
          <option value="all">{reportText('r.also-fully-converted-orders', 'Also fully converted orders')}</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">{reportText('r.milestones-of', 'Milestones of')}
        <select aria-label={reportText('r.order-to-inspect', 'Order to inspect')} className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]"
          value={selected?.est.id || ''} onChange={event => setSelectedId(event.target.value)}>
          {orders.map(o => <option key={o.est.id} value={o.est.id}>
            {o.est.number || o.est.id} · {o.est.customerName || reportText('r.no-customer', 'No customer')} · {String(o.est.date || '').slice(0, 10)}
          </option>)}
        </select>
      </label>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={!selected}
        onClick={() => selected && downloadCsv('milestone-billing',
          ['Order', 'Date', 'Customer', ...MILESTONE_BILLING_CSV_HEADERS],
          milestoneBillingCsvRows(selected.billing).map(row => [selected.est.number || selected.est.id, String(selected.est.date || '').slice(0, 10), selected.est.customerName || '', ...row]))}>
        {reportText('r.export-milestones-csv', 'Export milestones CSV')}</button>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={!orders.length}
        onClick={() => downloadCsv('milestone-billing-orders', ORDERS_CSV_HEADERS, orders.map(o => {
          const next = nextOf(o.billing);
          return [o.est.number || o.est.id, String(o.est.date || '').slice(0, 10), o.est.customerName || '', o.est.status,
            o.billing.orderTotalCents, o.billing.invoicedCents, o.billing.leftCents, next ? next.label : '', next?.due || '', o.billing.unscheduledPercent];
        }))}>{reportText('r.export-orders-csv', 'Export orders CSV')}</button>
    </div>

    {loading && <p role="status" className="text-sm text-[var(--muted)]">{reportText('r.loading-orders', 'Loading orders…')}</p>}
    {partial && <p role="alert" className="text-sm text-[var(--muted)]">{reportText('r.the-loaded-orders-are-capped-or-failed-at-the-da', 'The loaded orders are capped or failed at the database. These figures may be incomplete.')}</p>}
    {!loading && !partial && !orders.length && <p className="text-sm text-[var(--muted)]">{reportText('r.no-sales-order-keeps-a-milestone-schedule-yet-th', 'No sales order keeps a milestone schedule yet. The schedule is set on the order in Sales.')}</p>}
    <p className="text-sm">
      {orders.length} {reportText('r.order-s-with-a-schedule', 'order(s) with a schedule')}{dueCount ? ` ${fill(reportText('r.0-milestone-s-due-to-bill', '· {0} milestone(s) due to bill'), { 0: dueCount })}` : ` ${reportText('r.none-due', '· none due')}`} {reportText('r.left-to-bill', '· left to bill')} {formatCurrency(leftTotal, home)}
    </p>

    {orders.length > 0 && <ReportSchedule
      columnControls
      allowDisplayedExport={!partial && !loading}
      caption={reportText('r.sales-orders-with-a-milestone-schedule', 'Sales orders with a milestone schedule')}
      rowClassName={o => selected?.est.id === o.est.id ? 'border-b border-[var(--line)]/50 bg-[var(--panel)]' : 'border-b border-[var(--line)]/50'}
      bodyClassName=""
      rows={orders} rowKey={o => o.est.id}
      columns={[
        { header: reportText('r.order', 'Order'), cell: o => o.est.number || o.est.id },
        { header: reportText('r.date-2', 'Date'), cell: o => String(o.est.date || '').slice(0, 10) },
        { header: reportText('r.customer', 'Customer'), cell: o => <bdi>{o.est.customerName || '—'}</bdi> },
        { header: reportText('r.order-total', 'Order total'), align: 'right', cell: o => formatCurrency(o.billing.orderTotalCents, home) },
        { header: reportText('r.invoiced-2', 'Invoiced'), align: 'right', cell: o => formatCurrency(o.billing.invoicedCents, home) },
        { header: reportText('r.left-to-bill-2', 'Left to bill'), align: 'right', cell: o => formatCurrency(o.billing.leftCents, home) },
        { header: reportText('r.next-milestone', 'Next milestone'), cell: o => { const next = nextOf(o.billing); return next ? <span>{next.label}{next.status === 'due' ? ` ${reportText('r.due-3', '(due)')}` : ''}{next.due ? ` · ${next.due}` : ''}</span> : '—'; } },
        { header: reportText('r.unscheduled', 'Unscheduled'), align: 'right', cell: o => o.billing.unscheduledPercent ? `${o.billing.unscheduledPercent}%` : '—' },
      ]} />}

    {selected && <div className="space-y-2">
      <h3 className="text-base font-semibold">
        {selected.est.number || selected.est.id}: {selected.billing.rows.length} {reportText('r.milestone-s', 'milestone(s)')}
      </h3>
      <ReportTableScroll allowDisplayedExport={!partial && !loading}>
        <RowTable
          rowClassName="border-b border-[var(--line)]/50"
          caption={(<>{reportText('r.milestones-of', 'Milestones of')} {selected.est.number || selected.est.id}</>)}
          rows={selected.billing.rows}
          rowKey={row => `${row.label}|${row.percent}|${row.due || ''}|${row.invoicedAt || ''}`}
          captionClassName=""
          tableClassName="w-full text-sm"
          headRowClassName=""
          bodyClassName=""
          footer={<tr className="font-semibold">
              <th scope="row" className="text-start py-1 px-2">{reportText('r.total', 'Total')}</th>
              <td className="py-1 px-2">{selected.billing.unscheduledPercent ? fill(reportText('r.0-scheduled', '{0}% scheduled'), { 0: 100 - selected.billing.unscheduledPercent }) : '100%'}</td>
              <td className="py-1 px-2">{formatCurrency(selected.billing.orderTotalCents, home)}</td>
              <td className="py-1 px-2" colSpan={3}>{reportText('r.invoiced', 'invoiced')} {formatCurrency(selected.billing.invoicedCents, home)} {reportText('r.left-3', '· left')} {formatCurrency(selected.billing.leftCents, home)}</td>
            </tr>}
          columns={[
            { header: reportText('r.milestone', 'Milestone'), className: "text-start font-normal py-1 px-2", headClassName: "text-start py-1 px-2", cell: (row) => <bdi>{row.label}</bdi> },
            { header: reportText('r.percent', 'Percent'), className: "py-1 px-2", headClassName: "text-start py-1 px-2", cell: (row) => (<>{row.percent}%</>) },
            { header: reportText('r.amount', 'Amount'), className: "py-1 px-2", headClassName: "text-start py-1 px-2", cell: (row) => formatCurrency(row.amountCents, home) },
            { header: reportText('r.due-2', 'Due'), className: "py-1 px-2", headClassName: "text-start py-1 px-2", cell: (row) => row.due || '—' },
            { header: reportText('r.status', 'Status'), className: "py-1 px-2", headClassName: "text-start py-1 px-2", cell: (row) => statusLabels[row.status] },
            { header: reportText('r.invoiced-on', 'Invoiced on'), className: "py-1 px-2", headClassName: "text-start py-1 px-2", cell: (row) => row.invoicedAt || '—' },
          ]}
        />
      </ReportTableScroll>
    </div>}
  </section>;
}
