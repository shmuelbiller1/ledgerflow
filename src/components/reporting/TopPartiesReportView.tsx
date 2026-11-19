import React, { useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useBrowserProvenance } from '../../hooks/useBrowserProvenance';
import { useScreenDataHealth } from '../../hooks/useScreenDataHealth';
import { ReportProvenanceNote } from './ReportProvenanceNote';
import { ScreenDataNotice } from '../ui/ScreenDataNotice';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { downloadCsv } from '../../lib/csvExport';
import { topParties, topPartiesCsvHeaders, topPartiesCsvRows } from '../../lib/topParties';
import ReportSchedule from './ReportSchedule';
import { useReportText, fill } from './useReportText';

/** A tiny 12-month line. Decorative beside the numbers; the full series is in the label and the CSV. */
function Sparkline({ values, currency }: { values: number[]; currency: string }) {
  const reportText = useReportText();
  const width = 96, height = 28, pad = 2;
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min;
  const points = values.map((value, index) => {
    const x = pad + (index * (width - pad * 2)) / Math.max(1, values.length - 1);
    const y = span === 0 ? height / 2 : height - pad - ((value - min) / span) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const last = values[values.length - 1] || 0;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label={fill(reportText('r.trend-aria', '12-month trend: highest month {max}, latest month {last}'), { max: formatCurrency(max, currency), last: formatCurrency(last, currency) })}
      className="inline-block align-middle">
      <title>{fill(reportText('r.trend-title', 'Highest month {max} · latest month {last}'), { max: formatCurrency(max, currency), last: formatCurrency(last, currency) })}</title>
      <polyline points={points} fill="none" stroke="var(--brass, #b08d3e)" strokeWidth="1.5" />
    </svg>
  );
}

const cell = (cents: number, home: string) => formatCurrency(cents, home);

/**
 * A-190: the top 20 customers and vendors for a period, each with its last twelve months. Figures
 * are the customer/supplier period summary's own (issued documents, base currency, credits and
 * payments as that summary reads them). Read-only.
 */
export default function TopPartiesReportView() {
  const reportText = useReportText();
  const customers = useLedgerStore(state => state.customers);
  const vendors = useLedgerStore(state => state.vendors);
  const invoices = useLedgerStore(state => state.invoices);
  const bills = useLedgerStore(state => state.bills);
  const payments = useLedgerStore(state => state.payments);
  const creditNotes = useLedgerStore(state => state.creditNotes);
  const vendorCredits = useLedgerStore(state => state.vendorCredits);
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  useLedgerCollections('customers', 'vendors', 'invoices', 'bills', 'payments', 'creditNotes', 'vendorCredits');

  const today = getLocalDateISO();
  const [kind, setKind] = useState<'customer' | 'vendor'>('customer');
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);

  const home = workspace?.currency || 'USD';
  const keys = kind === 'customer' ? ['customers', 'invoices', 'payments', 'creditNotes'] as const : ['vendors', 'bills', 'payments', 'vendorCredits'] as const;
  const health = useScreenDataHealth(keys);
  const provenance = useBrowserProvenance(keys, false);
  const partial = provenance.completeness !== 'complete';
  const report = useMemo(() => {
    const inWorkspace = <T extends { workspaceId?: string }>(rows: T[]) =>
      rows.filter(r => !workspaceId || r.workspaceId === workspaceId);
    return topParties({
      kind,
      parties: {
        customers: inWorkspace(customers), vendors: inWorkspace(vendors),
        invoices: inWorkspace(invoices), bills: inWorkspace(bills),
        payments: inWorkspace(payments), creditNotes: inWorkspace(creditNotes), baseCurrency: home,
        vendorCredits: inWorkspace(vendorCredits),
      },
      period: { startDate: from, endDate: to },
      limit: 20,
    });
  }, [kind, customers, vendors, invoices, bills, payments, creditNotes, vendorCredits, workspaceId, from, to, home]);

  const who = kind === 'customer' ? 'Customer' : 'Vendor';
  const verb = kind === 'customer' ? 'Invoiced' : 'Billed';
  const periodValid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;

  return <section aria-label={reportText('r.top-customers-and-vendors', 'Top customers and vendors')} className="p-4 space-y-4 min-w-0">
    <h2>{reportText('r.top-customers-and-vendors', 'Top customers and vendors')}</h2>
    <p className="text-sm text-[var(--muted)]">
      {reportText('r.the-twenty-customers-invoiced-most-in-the-period', 'The twenty customers invoiced most in the period (or the twenty vendors who billed most), from the customer and supplier period summaries: issued documents only, in')} {home}{reportText('r.the-small-line-beside-each-name-is-the-same-figu', '. The small line beside each name is the same figure per month for the twelve months ending with the period\'s last month; the numbers are in the CSV. Ranking follows the gross amount')} {kind === 'customer' ? reportText('r.invoiced', 'invoiced') : reportText('r.billed', 'billed')} {reportText('r.in-the-period-what-was-paid-credited-and-still-o', 'in the period — what was paid, credited and still owed at the end is shown beside it.')}
    </p>

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1 text-sm">{reportText('r.show', 'Show')}
        <select aria-label={reportText('r.customers-or-vendors', 'Customers or vendors')} className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]"
          value={kind} onChange={e => setKind(e.target.value as 'customer' | 'vendor')}>
          <option value="customer">{reportText('r.top-customers', 'Top customers')}</option>
          <option value="vendor">{reportText('r.top-vendors', 'Top vendors')}</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">{reportText('r.from', 'From')}
        <input type="date" aria-label={reportText('r.period-start', 'Period start')} className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]" value={from} onChange={e => setFrom(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-sm">{reportText('r.to', 'To')}
        <input type="date" aria-label={reportText('r.period-end', 'Period end')} className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]" value={to} onChange={e => setTo(e.target.value)} />
      </label>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={!health.ready || partial || !report.rows.length}
        onClick={() => downloadCsv(kind === 'customer' ? 'top-customers' : 'top-vendors', topPartiesCsvHeaders(kind, report.months), topPartiesCsvRows(report.rows))}>{reportText('r.export-csv', 'Export CSV')}</button>
    </div>

    {!periodValid && <p role="alert" className="text-sm">{reportText('r.choose-a-valid-period-the-start-must-not-be-afte', 'Choose a valid period: the start must not be after the end.')}</p>}
    {health.loadingKeys.length > 0 && <p role="status" className="text-sm text-[var(--muted)]">{reportText('r.loading-parties-and-documents', 'Loading parties and documents…')}</p>}
    <ScreenDataNotice failedKeys={health.failedKeys} message={health.message} onRetry={health.retry} what={reportText('r.this-ranking', 'this ranking')} />
    {partial && <ReportProvenanceNote provenance={provenance} />}
    {health.ready && <>
    {periodValid && report.moreCount > 0 && <p className="text-sm">{reportText('r.showing-the-top', 'Showing the top')} {report.rows.length}; {report.moreCount} {reportText('r.more-with-activity-in-the-period-are-below-the-l', 'more with activity in the period are below the line.')}</p>}

    <ReportSchedule
      columnControls
      allowDisplayedExport={health.ready && !partial}
      caption={<>{reportText('r.top', 'Top')} {kind === 'customer' ? reportText('r.customers-by-amount-invoiced', 'customers by amount invoiced') : reportText('r.vendors-by-amount-billed', 'vendors by amount billed')}, {from} {reportText('r.to-2', 'to')} {to} ({home})</>}
      rowClassName="border-b border-[var(--line)]/50"
      bodyClassName=""
      rows={report.rows.map((row, i) => ({ ...row, rank: i + 1 }))} rowKey={row => row.id}
      columns={[
        { header: "#", className: 'tabular-nums', cell: row => row.rank },
        { header: who, rowHeader: true, cell: row => <bdi>{row.name}</bdi> },
        { header: <>{verb} {reportText('r.in-period', 'in period')}</>, align: 'right', className: 'tabular-nums', cell: row => cell(row.invoicedCents, home) },
        { header: reportText('r.paid-in-period', 'Paid in period'), align: 'right', className: 'tabular-nums', cell: row => cell(row.paidCents, home) },
        { header: reportText('r.credited-in-period', 'Credited in period'), align: 'right', className: 'tabular-nums', cell: row => cell(row.creditedCents, home) },
        { header: reportText('r.balance-at-period-end', 'Balance at period end'), align: 'right', className: 'tabular-nums', cell: row => cell(row.closingCents, home) },
        { header: reportText('r.trend-12-months', 'Trend, 12 months'), cell: row => <Sparkline values={row.monthlyCents} currency={home} /> },
      ]} />
    </>}

    <p className="text-xs text-[var(--muted)]">
      {reportText('r.foreign-currency-documents-are-included-at-each', 'Foreign-currency documents are included at each document\'s own recorded rate, as in the period summaries. The balance is the summary\'s balance at the period end (everything invoiced or billed up to then, less payments and credits), not an aging.')}
    </p>
  </section>;
}
