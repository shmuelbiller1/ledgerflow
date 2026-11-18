import React, { useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { subscriptionPlans, subscriptionPlansCsvRows, SUBSCRIPTION_PLANS_CSV_HEADERS, type SubscriptionPlansReport } from '../../lib/subscriptionPlans';
import { formatCurrency } from '../../lib/utils';
import { downloadCsv } from '../../lib/csvExport';
import ReportTableScroll from './ReportTableScroll';
import { RowTable } from '../ui/RowTable';
import { useReportText, fill } from './useReportText';

const field = 'min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]';

/**
 * A-68: subscription plans. The customers' recurring invoices seen as plans: what each brings a
 * month (MRR) and a year (ARR), what started and what stopped in each month of the window.
 * Read-only analytics; recurring rules are edited where they live, and nothing here sends a draft.
 */
export default function SubscriptionPlansReportView({ startDate = '', endDate = '' }: { startDate?: string; endDate?: string }) {
  return <SubscriptionPlansPanel from={startDate.slice(0, 7)} to={endDate.slice(0, 7)} />;
}

/** The report for the month window it is given (the wrapper takes the dates from the Reports page). */
export function SubscriptionPlansPanel({ from = '', to = '' }: { from?: string; to?: string }) {
  const reportText = useReportText();
  const plans = useLedgerStore(state => state.recurring);
  const customers = useLedgerStore(state => state.customers);
  const truncated = useLedgerStore(state => state.truncatedCollections);
  const failed = useDataNeedsStore(state => state.failed);
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  const { loading } = useLedgerCollections('recurring', 'customers');
  const [status, setStatus] = useState<'all' | 'active' | 'paused' | 'completed'>('all');

  const report: SubscriptionPlansReport = useMemo(() => subscriptionPlans({
    plans: plans.filter(plan => !workspaceId || plan.workspaceId === workspaceId),
    customers: customers.filter(customer => !workspaceId || customer.workspaceId === workspaceId),
    homeCurrency: workspace?.currency || 'USD',
    from: from || undefined,
    to: to || undefined,
  }), [plans, customers, workspaceId, workspace, from, to]);

  const rows = status === 'all' ? report.rows : report.rows.filter(row => row.status === status);
  const partial = truncated.recurring || failed.recurring || truncated.customers || failed.customers;
  const home = workspace?.currency || 'USD';

  return <section aria-label={reportText('r.subscription-plans', 'Subscription plans')} className="p-4 space-y-4 min-w-0">
    <h2>{reportText('r.subscription-plans', 'Subscription plans')}</h2>
    <p className="text-sm text-[var(--muted)]">
      {reportText('r.the-recurring-invoices-grouped-as-plans', 'The recurring invoices, grouped as plans:')} {report.window.from || '—'} {reportText('r.to-2', 'to')} {report.window.to || '—'}{reportText('r.the-monthly-value-normalises-each-plan-s-own-amo', '. The monthly value normalises each plan\'s own amount to a month (quarterly ÷ 3, yearly ÷ 12, weekly × 52 ÷ 12, daily × 365.25 ÷ 12); weekly and daily plans are marked approximate because a month is not a whole number of weeks. Currencies are never added together — every total is per currency. Read-only: nothing here sends, posts or changes a plan.')}
    </p>

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1 text-sm">{reportText('r.status', 'Status')}
        <select aria-label={reportText('r.plan-status', 'Plan status')} className={field} value={status} onChange={event => setStatus(event.target.value as typeof status)}>
          <option value="all">{reportText('r.all-plans', 'All plans')}</option>
          <option value="active">{reportText('r.active', 'Active')}</option>
          <option value="paused">{reportText('r.paused', 'Paused')}</option>
          <option value="completed">{reportText('r.stopped', 'Stopped')}</option>
        </select>
      </label>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" onClick={() => downloadCsv('subscription-plans', SUBSCRIPTION_PLANS_CSV_HEADERS, subscriptionPlansCsvRows(report))} disabled={!report.rows.length}>{reportText('r.export-csv', 'Export CSV')}</button>
    </div>

    {loading && <p role="status" className="text-sm text-[var(--muted)]">{reportText('r.loading-recurring-rules', 'Loading recurring rules…')}</p>}
    {partial && <p role="alert" className="text-sm text-[var(--muted)]">{reportText('r.the-loaded-recurring-rule-list-is-capped-or-fail', 'The loaded recurring-rule list is capped or failed at the database. Figures may be incomplete.')}</p>}

    <div className="flex flex-wrap gap-4">
      {report.byCurrency.length === 0 && <p className="text-sm text-[var(--muted)]">{reportText('r.no-recurring-invoice-names-a-customer-yet', 'No recurring invoice names a customer yet.')}</p>}
      {report.byCurrency.map(total => (
        <div key={total.currency} className="rounded border border-[var(--line)] bg-[var(--panel)] p-3 min-w-[16rem]">
          <h3 className="font-semibold text-[var(--text)]">{total.currency}</h3>
          <p className="text-sm">{reportText('r.monthly-mrr', 'Monthly (MRR)')} <strong>{formatCurrency(total.monthlyCents, total.currency)}</strong> {reportText('r.yearly-arr', '· yearly (ARR)')} <strong>{formatCurrency(total.annualCents, total.currency)}</strong></p>
          <p className="text-sm text-[var(--muted)]">{total.activePlans} {reportText('r.active-plans-started', 'active plans · started')} {total.startedPlans} ({formatCurrency(total.newMonthlyCents, total.currency)}{reportText('r.month-stopped', '/month) · stopped')} {total.stoppedPlans} ({formatCurrency(total.stoppedMonthlyCents, total.currency)}{reportText('r.month-2', '/month)')}</p>
          {total.approximatePlans > 0 && <p className="text-xs text-[var(--muted)]">{total.approximatePlans} {reportText('r.plan-s-priced-per-week-or-day-their-monthly-valu', 'plan(s) priced per week or day: their monthly value is approximate.')}</p>}
        </div>
      ))}
    </div>

    {report.undatedStops > 0 && <p className="text-sm text-[var(--muted)]">{report.undatedStops} {reportText('r.stopped-plan-s-record-no-occurrence-so-the-month', 'stopped plan(s) record no occurrence, so the month they stopped is not known and they are left out of the monthly movements.')}</p>}

    <MonthlyChart report={report} />

    <ReportTableScroll>
      <RowTable
        rowClassName="border-b border-[var(--line)]/50"
        caption={(<>{reportText('r.plans-in-the-window', 'Plans in the window')} {report.window.from || '—'} – {report.window.to || '—'}</>)}
        rows={rows}
        rowKey={row => row.planId}
        captionClassName=""
        tableClassName="w-full text-sm"
        headRowClassName=""
        bodyClassName=""
        columns={[
          { header: reportText('r.customer', 'Customer'), className: "text-left font-normal py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => <bdi>{row.customerName}</bdi> },
          { header: reportText('r.plan', 'Plan'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => <bdi>{row.description}</bdi> },
          { header: reportText('r.frequency', 'Frequency'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.frequency },
          { header: reportText('r.status', 'Status'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.status === 'completed' ? 'Stopped' : row.status },
          { header: reportText('r.amount', 'Amount'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => formatCurrency(row.amountCents, row.currency) },
          { header: reportText('r.per-month', 'Per month'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => (<>{formatCurrency(row.monthlyCents, row.currency)}{row.approximate ? ` ${reportText('r.approx', '(approx.)')}` : ''}</>) },
          { header: reportText('r.per-year', 'Per year'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => formatCurrency(row.annualCents, row.currency) },
          { header: reportText('r.next-occurrence', 'Next occurrence'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.nextOccurrence?.slice(0, 10) || '—' },
          { header: reportText('r.drafts-generated', 'Drafts generated'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.generatedCount },
        ]}
      />
      {!loading && !rows.length && <p className="text-sm text-[var(--muted)]">{reportText('r.no-recurring-invoice-matches-this-status', 'No recurring invoice matches this status.')}</p>}
    </ReportTableScroll>

    {report.byCustomer.length > 0 && <ReportTableScroll>
      <RowTable
        rowClassName="border-b border-[var(--line)]/50"
        caption={(<>{reportText('r.monthly-value-per-customer-each-currency-on-its', 'Monthly value per customer (each currency on its own)')}</>)}
        rows={report.byCustomer}
        rowKey={row => `${row.customerId}:${row.currency}`}
        captionClassName=""
        tableClassName="w-full text-sm"
        headRowClassName=""
        bodyClassName=""
        columns={[
          { header: reportText('r.customer', 'Customer'), className: "text-left font-normal py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => <bdi>{row.customerName}</bdi> },
          { header: reportText('r.currency-2', 'Currency'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.currency },
          { header: reportText('r.plans', 'Plans'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.plans },
          { header: reportText('r.active', 'Active'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.activePlans },
          { header: reportText('r.per-month', 'Per month'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => formatCurrency(row.monthlyCents, row.currency) },
        ]}
      />
      <p className="text-xs text-[var(--muted)]">{reportText('r.a-stopped-plan-s-month-is-when-it-last-ran-the-r', 'A stopped plan\'s month is when it last ran: the rules record the last occurrence, not a cancellation date. Nothing here proves a plan is still wanted.')}</p>
    </ReportTableScroll>}

    <p className="text-xs text-[var(--muted)]">{reportText('r.workspace-currency-for-plans-that-name-none', 'Workspace currency for plans that name none:')} {home}.</p>
  </section>;
}

/** The monthly value that was running each month, per currency, as bars. */
function MonthlyChart({ report }: { report: SubscriptionPlansReport }) {
  const reportText = useReportText();
  const currencies = report.byCurrency.map(total => total.currency);
  const [currency, setCurrency] = useState(currencies[0]);
  if (!report.months.length || !currencies.length) return null;
  const chosen = report.months.map(month => ({ month: month.month, cents: month.monthlyCents }));
  const peak = Math.max(...chosen.map(point => point.cents), 1);

  return <div className="space-y-2">
    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1 text-sm">{reportText('r.currency-2', 'Currency')}
        <select aria-label={reportText('r.chart-currency', 'Chart currency')} className={field} value={currency} onChange={event => setCurrency(event.target.value)}>
          {report.byCurrency.map(total => <option key={total.currency} value={total.currency}>{total.currency}</option>)}
        </select>
      </label>
    </div>
    <svg role="img" aria-label={fill(reportText('r.mrr-chart-aria', 'Monthly value running each month in {currency}, from {from} to {to}'), { currency, from: report.months[0].month, to: report.months[report.months.length - 1].month })}
      viewBox={`0 0 ${Math.max(report.months.length * 40, 120)} 160`} className="w-full max-w-[40rem] h-auto border border-[var(--line)] rounded bg-[var(--panel)]">
      {report.months.map((month, index) => {
        const barHeight = Math.round((chosen[index].cents / peak) * 100);
        return <g key={month.month}>
          <rect x={index * 40 + 8} y={130 - barHeight} width={24} height={barHeight} fill="currentColor" fillOpacity="0.75">
            <title>{fill(reportText('r.mrr-bar-title', '{month}: {amount} a month, {plans} plans'), { month: month.month, amount: formatCurrency(chosen[index].cents, currency), plans: month.activePlans })}</title>
          </rect>
          <text x={index * 40 + 20} y={146} fontSize="9" textAnchor="middle" fill="currentColor">{month.month.slice(2)}</text>
          <text x={index * 40 + 20} y={122 - barHeight} fontSize="9" textAnchor="middle" fill="currentColor">{month.startedPlans ? `+${month.startedPlans}` : ''}{month.stoppedPlans ? ` −${month.stoppedPlans}` : ''}</text>
        </g>;
      })}
    </svg>
    <p className="text-xs text-[var(--muted)]">
      {reportText('r.monthly-value-running-in-each-month-reconstructe', 'Monthly value running in each month, reconstructed from the plans\' own dates: a plan counts from its created month until the month it last ran (or now, while it is active). +n plans started that month, −n stopped.')}
    </p>
  </div>;
}
