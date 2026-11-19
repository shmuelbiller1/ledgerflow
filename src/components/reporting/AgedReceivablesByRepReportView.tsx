import { usePartialReportInputs } from '../../hooks/usePartialReportInputs';
import { useReportDates } from './useReportDates';
import React, { useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { downloadCsv } from '../../lib/csvExport';
import { AGING_BUCKETS } from '../../lib/aging';
import {
  agedReceivablesByRep, agedByRepCsvRows, AGED_BY_REP_CSV_HEADERS,
} from '../../lib/agedReceivablesByRep';
import ReportSchedule from './ReportSchedule';
import { useReportText } from './useReportText';

/**
 * A-187: aged receivables by sales rep. The A/R Aging figures grouped by the rep who looks after
 * each customer (Settings → Sales reps), so follow-up on overdue balances has an owner. Customers
 * no rep looks after are their own group. Read-only: nothing is allocated, posted or blocked.
 */
export default function AgedReceivablesByRepReportView() {
  const dates = useReportDates();
  const reportText = useReportText();
  const customers = useLedgerStore(state => state.customers);
  const invoices = useLedgerStore(state => state.invoices);
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  const { loading } = useLedgerCollections('customers', 'invoices');
  const [asOf, setAsOf] = useState(getLocalDateISO());

  const bucketNames: Record<string, string> = { current: reportText('r.bucket.current', 'Current'), d1_30: reportText('r.bucket.d1_30', '1–30 days'), d31_60: reportText('r.bucket.d31_60', '31–60 days'), d61_90: reportText('r.bucket.d61_90', '61–90 days'), d90plus: reportText('r.bucket.d90plus', 'Over 90 days') };
  const home = workspace?.currency || 'USD';
  const reps = useMemo(() => workspace?.salesReps || [], [workspace]);
  const rows = useMemo(() => agedReceivablesByRep({
    customers: customers.filter(c => !workspaceId || c.workspaceId === workspaceId),
    invoices: invoices.filter(i => !workspaceId || i.workspaceId === workspaceId),
    reps,
    asOf,
    baseCurrency: home,
  }), [customers, invoices, workspaceId, reps, asOf, home]);
  const totals = rows.reduce((acc, r) => ({
    total: acc.total + r.totalCents, overdue: acc.overdue + r.overdueCents,
  }), { total: 0, overdue: 0 });
  const partial = usePartialReportInputs(['customers', 'invoices']);

  // A rep subtotal is not an extra customer. Keep it and its children together, in report order.
  const schedule = rows.flatMap(group => [
    { key: JSON.stringify([group.repId]), name: group.repName, summary: group, buckets: group.buckets, total: group.totalCents },
    ...group.customers.map(c => ({ key: JSON.stringify([group.repId, c.partyId]), name: c.partyName,
      summary: null, buckets: c.buckets, total: c.total })),
  ]);

  return <section aria-label={reportText('r.aged-receivables-by-sales-rep', 'Aged receivables by sales rep')} className="p-4 space-y-4 min-w-0">
    <h2>{reportText('r.aged-receivables-by-sales-rep', 'Aged receivables by sales rep')}</h2>
    <p className="text-sm text-[var(--muted)]">
      {reportText('r.what-customers-still-owe-by-how-long-past-the-du', 'What customers still owe, by how long past the due date, grouped by the sales rep recorded for each customer in Settings → Sales reps. This is the A/R Aging report grouped: open issued invoices only, after deposits, payments and credits, in')} {home} {reportText('r.at-each-invoice-s-own-rate-a-customer-no-rep-loo', 'at each invoice\'s own rate. A customer no rep looks after appears under No sales rep — nobody is assigned by guessing.')}
    </p>

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1 text-sm">{reportText('r.as-of-2', 'As of')}
        <input type="date" aria-label={reportText('r.aging-date', 'Aging date')} className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]"
          value={asOf} onChange={e => setAsOf(e.target.value)} />
      </label>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={!rows.length}
        onClick={() => downloadCsv('aged-receivables-by-sales-rep', [...AGED_BY_REP_CSV_HEADERS], agedByRepCsvRows(rows))}>{reportText('r.export-csv', 'Export CSV')}</button>
    </div>

    {loading && <p role="status" className="text-sm text-[var(--muted)]">{reportText('r.loading-customers-and-invoices', 'Loading customers and invoices…')}</p>}
    {partial && <p role="alert" className="text-sm">{reportText('r.the-loaded-customers-or-invoices-are-capped-or-f', 'The loaded customers or invoices are capped or failed. These figures may be incomplete.')}</p>}
    <p className="text-sm">
      {formatCurrency(totals.total, home)} {reportText('r.owed-in-all-of-which', 'owed in all, of which')} {formatCurrency(totals.overdue, home)} {reportText('r.is-past-its-due-date', 'is past its due date.')}
    </p>

    <ReportSchedule columnControls allowDisplayedExport={!partial && !loading} rows={schedule} rowKey={r => r.key}
      rowClassName={r => r.summary ? 'border-b border-[var(--line)] font-semibold' : 'border-b border-[var(--line)]/50'}
      empty={!loading && !partial ? <p role="status" data-report-empty-state className="text-sm text-[var(--muted)]">{reportText('r.no-customer-owes-anything-on-this-date', 'No customer owes anything on this date.')}</p> : null}
      caption={<>{reportText('r.aged-receivables-by-sales-rep-as-of', 'Aged receivables by sales rep as of')} {dates.dateText(asOf)} ({home})</>}
      columns={[
        { header: reportText('r.sales-rep-customer', 'Sales rep / Customer'), cell: r => r.summary ? <>
          <bdi>{r.name}</bdi><span className="font-normal text-[var(--muted)]"> · {r.summary.customers.length} {reportText('r.customer-s-2', 'customer(s) ·')} {formatCurrency(r.summary.overdueCents, home)} {reportText('r.overdue', 'overdue')}</span>
        </> : <bdi className="ps-4 font-normal">{r.name}</bdi> },
        { over: AGING_BUCKETS, head: b => bucketNames[b.key], align: 'right', cell: (r, b) => r.summary || r.buckets[b.key] ? formatCurrency(r.buckets[b.key], home) : '—' },
        { header: reportText('r.total-owed', 'Total owed'), align: 'right', cell: r => formatCurrency(r.total, home) },
      ]} />

    <p className="text-xs text-[var(--muted)]">
      {reportText('r.amounts-are-what-is-still-owed-on-open-invoices', 'Amounts are what is still owed on open invoices as the A/R Aging report reads them; a balance in another currency is included at the invoice\'s own recorded rate, as on that screen. The rep grouping changes nothing about who owes what.')}
    </p>
  </section>;
}
