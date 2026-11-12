import React, { useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { customerCohortReport } from '../../lib/customerCohortReport';
import { validCustomReportPeriod } from '../../lib/reportCustomPeriod';
import { formatCurrency } from '../../lib/utils';
import { downloadCsv, csvMoney } from '../../lib/csvExport';
import ReportTableScroll from './ReportTableScroll';

export default function CustomerCohortsReportView({ endDate = '' }: { endDate?: string }) {
  const invoices = useLedgerStore(s => s.invoices);
  const truncated = useLedgerStore(s => s.truncatedCollections);
  const failed = useDataNeedsStore(s => s.failed);
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const currency = useAuthStore(s => s.getCurrentWorkspace()?.currency);
  const { loading } = useLedgerCollections('invoices');
  const [windowMonths, setWindowMonths] = useState(12);
  const [ageMonths, setAgeMonths] = useState(12);
  const [mode, setMode] = useState<'amount' | 'customers' | 'percent'>('amount');
  const valid = validCustomReportPeriod({ startDate: endDate, endDate });
  const partial = Boolean(truncated.invoices || failed.invoices);
  const report = useMemo(() => valid && !loading
    ? customerCohortReport(invoices.filter(invoice => !workspaceId || invoice.workspaceId === workspaceId), endDate, windowMonths, ageMonths, currency || 'USD')
    : null, [invoices, workspaceId, endDate, windowMonths, ageMonths, currency, valid, loading]);
  const headers = ['First invoice month', 'Customers', ...Array.from({ length: ageMonths }, (_, age) => `Month ${age}`)];
  const show = (cell: NonNullable<typeof report>['rows'][number]['months'][number]) => {
    if (cell.activeCustomers === null) return '—';
    if (mode === 'customers') return String(cell.activeCustomers);
    if (mode === 'percent') return `${cell.activePercent?.toFixed(1)}%`;
    return formatCurrency(cell.invoicedCents ?? 0, currency);
  };
  const exportRows = () => {
    if (!report || partial) return;
    downloadCsv(`customer_cohorts_${endDate}.csv`, headers, report.rows.map(row =>
      [row.cohort, row.customers, ...row.months.map(cell => cell.activeCustomers === null ? '' : mode === 'customers'
        ? cell.activeCustomers : mode === 'percent' ? cell.activePercent : csvMoney(cell.invoicedCents))]));
  };
  return <section aria-label="Customer cohorts" className="p-4 space-y-4 min-w-0">
    <h2 className="text-lg font-semibold">Customer cohorts</h2>
    <p className="text-sm text-[var(--muted)]">Customers are grouped by the first issued invoice in the available history. Month 0 is that first month; later columns show repeat invoicing by those same customers through {endDate}. Amounts are invoice totals including tax in workspace currency, not cash collected. The current month may be incomplete; future months are blank.</p>
    <p className="text-sm text-[var(--muted)]">Cohort selection uses the last {windowMonths} calendar months, but first-invoice detection examines all loaded earlier invoices. The main report start date does not change this history-based grouping.</p>
    {loading && <p role="status">Loading invoice history…</p>}
    {!valid && <p role="alert">Choose a valid report end date.</p>}
    {partial && <p role="alert">Invoice history is incomplete or failed to load. Cohort membership and amounts are provisional; CSV export is disabled.</p>}
    {report && report.excluded > 0 && <p role="status">{report.excluded} issued invoices with missing or invalid customer, date, or amount were excluded.</p>}
    <div data-print-hide className="flex flex-wrap gap-3 items-end">
      <label className="flex flex-col gap-1">Cohort window
        <select aria-label="Cohort window" className="min-h-11 border rounded px-3 bg-[var(--panel)]" value={windowMonths} onChange={e => setWindowMonths(Number(e.target.value))}>
          <option value={6}>6 months</option><option value={12}>12 months</option><option value={24}>24 months</option><option value={36}>36 months</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">Months after first invoice
        <select aria-label="Months to show" className="min-h-11 border rounded px-3 bg-[var(--panel)]" value={ageMonths} onChange={e => setAgeMonths(Number(e.target.value))}>
          <option value={6}>6</option><option value={12}>12</option><option value={24}>24</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">Show
        <select aria-label="Cohort metric" className="min-h-11 border rounded px-3 bg-[var(--panel)]" value={mode} onChange={e => setMode(e.target.value as typeof mode)}>
          <option value="amount">Amount invoiced</option><option value="customers">Active customers</option><option value="percent">Active customers (%)</option>
        </select>
      </label>
      <button type="button" className="min-h-11 border rounded px-3" disabled={!report || partial} onClick={exportRows}>Export CSV</button>
    </div>
    {report && <ReportTableScroll>
      <table className="min-w-full text-sm">
        <caption>Customer cohorts through {endDate}: {mode === 'amount' ? 'invoiced totals' : mode === 'customers' ? 'active customers' : 'active customer percentage'}</caption>
        <thead><tr>{headers.map(heading => <th key={heading} scope="col" className="px-3 py-2 text-right whitespace-nowrap">{heading}</th>)}</tr></thead>
        <tbody>{report.rows.map(row => <tr key={row.cohort} className="border-t border-[var(--line)]">
          <th scope="row" className="px-3 py-2 text-left">{row.cohort}</th>
          <td className="px-3 py-2 text-right tabular-nums">{row.customers}</td>
          {row.months.map(cell => <td key={cell.age} className="px-3 py-2 text-right tabular-nums whitespace-nowrap" title={cell.month}>{show(cell)}</td>)}
        </tr>)}</tbody>
      </table>
      {!report.rows.length && <p>No issued-invoice customer cohorts in this window.</p>}
    </ReportTableScroll>}
  </section>;
}
