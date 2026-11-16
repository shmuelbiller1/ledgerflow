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

  return <section aria-label="Subscription plans" className="p-4 space-y-4 min-w-0">
    <h2>Subscription plans</h2>
    <p className="text-sm text-[var(--muted)]">
      The recurring invoices, grouped as plans: {report.window.from || '—'} to {report.window.to || '—'}. The monthly value normalises each plan&apos;s own amount to a month
      (quarterly ÷ 3, yearly ÷ 12, weekly × 52 ÷ 12, daily × 365.25 ÷ 12); weekly and daily plans are marked approximate because a month is not a whole number of weeks.
      Currencies are never added together — every total is per currency. Read-only: nothing here sends, posts or changes a plan.
    </p>

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1 text-sm">Status
        <select aria-label="Plan status" className={field} value={status} onChange={event => setStatus(event.target.value as typeof status)}>
          <option value="all">All plans</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="completed">Stopped</option>
        </select>
      </label>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" onClick={() => downloadCsv('subscription-plans', SUBSCRIPTION_PLANS_CSV_HEADERS, subscriptionPlansCsvRows(report))} disabled={!report.rows.length}>Export CSV</button>
    </div>

    {loading && <p role="status" className="text-sm text-[var(--muted)]">Loading recurring rules…</p>}
    {partial && <p role="alert" className="text-sm text-[var(--muted)]">The loaded recurring-rule list is capped or failed at the database. Figures may be incomplete.</p>}

    <div className="flex flex-wrap gap-4">
      {report.byCurrency.length === 0 && <p className="text-sm text-[var(--muted)]">No recurring invoice names a customer yet.</p>}
      {report.byCurrency.map(total => (
        <div key={total.currency} className="rounded border border-[var(--line)] bg-[var(--panel)] p-3 min-w-[16rem]">
          <h3 className="font-semibold text-[var(--text)]">{total.currency}</h3>
          <p className="text-sm">Monthly (MRR) <strong>{formatCurrency(total.monthlyCents, total.currency)}</strong> · yearly (ARR) <strong>{formatCurrency(total.annualCents, total.currency)}</strong></p>
          <p className="text-sm text-[var(--muted)]">{total.activePlans} active plans · started {total.startedPlans} ({formatCurrency(total.newMonthlyCents, total.currency)}/month) · stopped {total.stoppedPlans} ({formatCurrency(total.stoppedMonthlyCents, total.currency)}/month)</p>
          {total.approximatePlans > 0 && <p className="text-xs text-[var(--muted)]">{total.approximatePlans} plan(s) priced per week or day: their monthly value is approximate.</p>}
        </div>
      ))}
    </div>

    {report.undatedStops > 0 && <p className="text-sm text-[var(--muted)]">{report.undatedStops} stopped plan(s) record no occurrence, so the month they stopped is not known and they are left out of the monthly movements.</p>}

    <MonthlyChart report={report} />

    <ReportTableScroll>
      <RowTable
        rowClassName="border-b border-[var(--line)]/50"
        caption={(<>Plans in the window {report.window.from || '—'} – {report.window.to || '—'}</>)}
        rows={rows}
        rowKey={row => row.planId}
        captionClassName=""
        tableClassName="w-full text-sm"
        headRowClassName=""
        bodyClassName=""
        columns={[
          { header: "Customer", className: "text-left font-normal py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => <bdi>{row.customerName}</bdi> },
          { header: "Plan", className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => <bdi>{row.description}</bdi> },
          { header: "Frequency", className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.frequency },
          { header: "Status", className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.status === 'completed' ? 'Stopped' : row.status },
          { header: "Amount", className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => formatCurrency(row.amountCents, row.currency) },
          { header: "Per month", className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => (<>{formatCurrency(row.monthlyCents, row.currency)}{row.approximate ? ' (approx.)' : ''}</>) },
          { header: "Per year", className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => formatCurrency(row.annualCents, row.currency) },
          { header: "Next occurrence", className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.nextOccurrence?.slice(0, 10) || '—' },
          { header: "Drafts generated", className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.generatedCount },
        ]}
      />
      {!loading && !rows.length && <p className="text-sm text-[var(--muted)]">No recurring invoice matches this status.</p>}
    </ReportTableScroll>

    {report.byCustomer.length > 0 && <ReportTableScroll>
      <RowTable
        rowClassName="border-b border-[var(--line)]/50"
        caption={(<>Monthly value per customer (each currency on its own)</>)}
        rows={report.byCustomer}
        rowKey={row => `${row.customerId}:${row.currency}`}
        captionClassName=""
        tableClassName="w-full text-sm"
        headRowClassName=""
        bodyClassName=""
        columns={[
          { header: "Customer", className: "text-left font-normal py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => <bdi>{row.customerName}</bdi> },
          { header: "Currency", className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.currency },
          { header: "Plans", className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.plans },
          { header: "Active", className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.activePlans },
          { header: "Per month", className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => formatCurrency(row.monthlyCents, row.currency) },
        ]}
      />
      <p className="text-xs text-[var(--muted)]">A stopped plan&apos;s month is when it last ran: the rules record the last occurrence, not a cancellation date. Nothing here proves a plan is still wanted.</p>
    </ReportTableScroll>}

    <p className="text-xs text-[var(--muted)]">Workspace currency for plans that name none: {home}.</p>
  </section>;
}

/** The monthly value that was running each month, per currency, as bars. */
function MonthlyChart({ report }: { report: SubscriptionPlansReport }) {
  const currencies = report.byCurrency.map(total => total.currency);
  const [currency, setCurrency] = useState(currencies[0]);
  if (!report.months.length || !currencies.length) return null;
  const chosen = report.months.map(month => ({ month: month.month, cents: month.monthlyCents }));
  const peak = Math.max(...chosen.map(point => point.cents), 1);

  return <div className="space-y-2">
    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1 text-sm">Currency
        <select aria-label="Chart currency" className={field} value={currency} onChange={event => setCurrency(event.target.value)}>
          {report.byCurrency.map(total => <option key={total.currency} value={total.currency}>{total.currency}</option>)}
        </select>
      </label>
    </div>
    <svg role="img" aria-label={`Monthly value running each month in ${currency}, from ${report.months[0].month} to ${report.months[report.months.length - 1].month}`}
      viewBox={`0 0 ${Math.max(report.months.length * 40, 120)} 160`} className="w-full max-w-[40rem] h-auto border border-[var(--line)] rounded bg-[var(--panel)]">
      {report.months.map((month, index) => {
        const barHeight = Math.round((chosen[index].cents / peak) * 100);
        return <g key={month.month}>
          <rect x={index * 40 + 8} y={130 - barHeight} width={24} height={barHeight} fill="currentColor" fillOpacity="0.75">
            <title>{`${month.month}: ${formatCurrency(chosen[index].cents, currency)} a month, ${month.activePlans} plans`}</title>
          </rect>
          <text x={index * 40 + 20} y={146} fontSize="9" textAnchor="middle" fill="currentColor">{month.month.slice(2)}</text>
          <text x={index * 40 + 20} y={122 - barHeight} fontSize="9" textAnchor="middle" fill="currentColor">{month.startedPlans ? `+${month.startedPlans}` : ''}{month.stoppedPlans ? ` −${month.stoppedPlans}` : ''}</text>
        </g>;
      })}
    </svg>
    <p className="text-xs text-[var(--muted)]">
      Monthly value running in each month, reconstructed from the plans&apos; own dates: a plan counts from its created month until the month it last ran (or now, while it is active).
      +n plans started that month, −n stopped.
    </p>
  </div>;
}
