import React, { useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { downloadCsv } from '../../lib/csvExport';
import { AGING_BUCKETS } from '../../lib/aging';
import {
  agedReceivablesByRep, agedByRepCsvRows, AGED_BY_REP_CSV_HEADERS,
} from '../../lib/agedReceivablesByRep';
import ReportTableScroll from './ReportTableScroll';
import { useReportText } from './useReportText';

/**
 * A-187: aged receivables by sales rep. The A/R Aging figures grouped by the rep who looks after
 * each customer (Settings → Sales reps), so follow-up on overdue balances has an owner. Customers
 * no rep looks after are their own group. Read-only: nothing is allocated, posted or blocked.
 */
export default function AgedReceivablesByRepReportView() {
  const reportText = useReportText();
  const customers = useLedgerStore(state => state.customers);
  const invoices = useLedgerStore(state => state.invoices);
  const truncated = useLedgerStore(state => state.truncatedCollections);
  const failed = useDataNeedsStore(state => state.failed);
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  const { loading } = useLedgerCollections('customers', 'invoices');
  const [asOf, setAsOf] = useState(getLocalDateISO());

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
  const partial = truncated.customers || truncated.invoices || failed.customers || failed.invoices;

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

    <ReportTableScroll>
      <table className="w-full text-sm">
        <caption>{reportText('r.aged-receivables-by-sales-rep-as-of', 'Aged receivables by sales rep as of')} {asOf} ({home})</caption>
        <thead>
          <tr>
            <th scope="col" className="text-left py-1 px-2">{reportText('r.sales-rep-customer', 'Sales rep / Customer')}</th>
            {AGING_BUCKETS.map(b => <th key={b.key} scope="col" className="text-right py-1 px-2">{b.label}</th>)}
            <th scope="col" className="text-right py-1 px-2">{reportText('r.total-owed', 'Total owed')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.flatMap(group => [
            <tr key={`rep-${group.repId || 'none'}`} className="border-b border-[var(--line)] font-semibold">
              <th scope="row" className="text-left py-1 px-2"><bdi>{group.repName}</bdi>
                <span className="font-normal text-[var(--muted)]"> · {group.customers.length} {reportText('r.customer-s-2', 'customer(s) ·')} {formatCurrency(group.overdueCents, home)} {reportText('r.overdue', 'overdue')}</span></th>
              {AGING_BUCKETS.map(b => <td key={b.key} className="py-1 px-2 text-right tabular-nums">{formatCurrency(group.buckets[b.key], home)}</td>)}
              <td className="py-1 px-2 text-right tabular-nums">{formatCurrency(group.totalCents, home)}</td>
            </tr>,
            ...group.customers.map(customer => (
              <tr key={`${group.repId || 'none'}-${customer.partyId}`} className="border-b border-[var(--line)]/50">
                <th scope="row" className="text-left font-normal py-1 px-2 pl-6"><bdi>{customer.partyName}</bdi></th>
                {AGING_BUCKETS.map(b => <td key={b.key} className="py-1 px-2 text-right tabular-nums">{customer.buckets[b.key] ? formatCurrency(customer.buckets[b.key], home) : '—'}</td>)}
                <td className="py-1 px-2 text-right tabular-nums">{formatCurrency(customer.total, home)}</td>
              </tr>
            )),
          ])}
        </tbody>
      </table>
      {!rows.length && !loading && <p className="text-sm text-[var(--muted)]">{reportText('r.no-customer-owes-anything-on-this-date', 'No customer owes anything on this date.')}</p>}
    </ReportTableScroll>

    <p className="text-xs text-[var(--muted)]">
      {reportText('r.amounts-are-what-is-still-owed-on-open-invoices', 'Amounts are what is still owed on open invoices as the A/R Aging report reads them; a balance in another currency is included at the invoice\'s own recorded rate, as on that screen. The rep grouping changes nothing about who owes what.')}
    </p>
  </section>;
}
