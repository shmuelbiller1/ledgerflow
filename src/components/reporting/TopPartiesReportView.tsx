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
import ReportTableScroll from './ReportTableScroll';

/** A tiny 12-month line. Decorative beside the numbers; the full series is in the label and the CSV. */
function Sparkline({ values, currency }: { values: number[]; currency: string }) {
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
      aria-label={`12-month trend: highest month ${formatCurrency(max, currency)}, latest month ${formatCurrency(last, currency)}`}
      className="inline-block align-middle">
      <title>{`Highest month ${formatCurrency(max, currency)} · latest month ${formatCurrency(last, currency)}`}</title>
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

  return <section aria-label="Top customers and vendors" className="p-4 space-y-4 min-w-0">
    <h2>Top customers and vendors</h2>
    <p className="text-sm text-[var(--muted)]">
      The twenty customers invoiced most in the period (or the twenty vendors who billed most), from the
      customer and supplier period summaries: issued documents only, in {home}. The small line beside each
      name is the same figure per month for the twelve months ending with the period&apos;s last month;
      the numbers are in the CSV. Ranking follows the gross amount {kind === 'customer' ? 'invoiced' : 'billed'} in
      the period — what was paid, credited and still owed at the end is shown beside it.
    </p>

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1 text-sm">Show
        <select aria-label="Customers or vendors" className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]"
          value={kind} onChange={e => setKind(e.target.value as 'customer' | 'vendor')}>
          <option value="customer">Top customers</option>
          <option value="vendor">Top vendors</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">From
        <input type="date" aria-label="Period start" className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]" value={from} onChange={e => setFrom(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-sm">To
        <input type="date" aria-label="Period end" className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]" value={to} onChange={e => setTo(e.target.value)} />
      </label>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={!health.ready || partial || !report.rows.length}
        onClick={() => downloadCsv(kind === 'customer' ? 'top-customers' : 'top-vendors', topPartiesCsvHeaders(kind, report.months), topPartiesCsvRows(report.rows))}>Export CSV</button>
    </div>

    {!periodValid && <p role="alert" className="text-sm">Choose a valid period: the start must not be after the end.</p>}
    {health.loadingKeys.length > 0 && <p role="status" className="text-sm text-[var(--muted)]">Loading parties and documents…</p>}
    <ScreenDataNotice failedKeys={health.failedKeys} message={health.message} onRetry={health.retry} what="this ranking" />
    {partial && <ReportProvenanceNote provenance={provenance} />}
    {health.ready && <>
    {periodValid && report.moreCount > 0 && <p className="text-sm">Showing the top {report.rows.length}; {report.moreCount} more with activity in the period are below the line.</p>}

    <ReportTableScroll>
      <table className="w-full text-sm">
        <caption>Top {kind === 'customer' ? 'customers by amount invoiced' : 'vendors by amount billed'}, {from} to {to} ({home})</caption>
        <thead>
          <tr>
            <th scope="col" className="text-left py-1 px-2">#</th>
            <th scope="col" className="text-left py-1 px-2">{who}</th>
            <th scope="col" className="text-right py-1 px-2">{verb} in period</th>
            <th scope="col" className="text-right py-1 px-2">Paid in period</th>
            <th scope="col" className="text-right py-1 px-2">Credited in period</th>
            <th scope="col" className="text-right py-1 px-2">Balance at period end</th>
            <th scope="col" className="text-left py-1 px-2">Trend, 12 months</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row, index) => (
            <tr key={row.id} className="border-b border-[var(--line)]/50">
              <td className="py-1 px-2 tabular-nums">{index + 1}</td>
              <th scope="row" className="text-left font-normal py-1 px-2"><bdi>{row.name}</bdi></th>
              <td className="py-1 px-2 text-right tabular-nums">{cell(row.invoicedCents, home)}</td>
              <td className="py-1 px-2 text-right tabular-nums">{cell(row.paidCents, home)}</td>
              <td className="py-1 px-2 text-right tabular-nums">{cell(row.creditedCents, home)}</td>
              <td className="py-1 px-2 text-right tabular-nums">{cell(row.closingCents, home)}</td>
              <td className="py-1 px-2"><Sparkline values={row.monthlyCents} currency={home} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {!report.rows.length && periodValid && <p data-report-empty-state className="text-sm text-[var(--muted)]">{partial ? 'No activity in the loaded records. Review the full history before relying on this ranking.' : `Nothing was ${kind === 'customer' ? 'invoiced' : 'billed'} in this period. Choose another period or review the issued documents.`}</p>}
    </ReportTableScroll>
    </>}

    <p className="text-xs text-[var(--muted)]">
      Foreign-currency documents are included at each document&apos;s own recorded rate, as in the period
      summaries. The balance is the summary&apos;s balance at the period end (everything invoiced or billed
      up to then, less payments and credits), not an aging.
    </p>
  </section>;
}
