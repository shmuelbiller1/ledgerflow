import { useReportDates } from './useReportDates';
import React, { useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useServerCustomerLifetimeValue } from '../../hooks/useServerCustomerLifetimeValue';
import { RangeReportSourceNote } from './RangeReportSourceNote';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { isCollectionCapped } from '../../lib/ledgerCollections';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { customerLifetimeValueCsvRows, CUSTOMER_LIFETIME_VALUE_CSV_HEADERS, DEFAULT_LIFESPAN_YEARS } from '../../lib/customerLifetimeValue';
import { validCustomReportPeriod } from '../../lib/reportCustomPeriod';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { downloadCsv } from '../../lib/csvExport';
import ReportSchedule from './ReportSchedule';
import { useReportText, fill } from './useReportText';

const field = 'min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]';

/**
 * A-143: customer lifetime value. Sales, credit notes, cost, gross profit, orders and the recorded
 * history per customer, and the average annual profit repeated for a lifespan the reader chooses.
 * The projection is an assumption shown on the screen, not a forecast. Read-only.
 */
export default function CustomerLifetimeValueReportView({ startDate = '', asOfDate = '' }: { startDate?: string; asOfDate?: string }) {
  return <CustomerLifetimeValuePanel from={startDate} asOf={asOfDate || getLocalDateISO()} />;
}

/** The report for the window and the as-of date it is given (see the wrapper above). */
export function CustomerLifetimeValuePanel({ from = '', asOf }: { from?: string; asOf: string }) {
  const dates = useReportDates();
  const reportText = useReportText();
  const truncated = useLedgerStore(state => state.truncatedCollections);
  const failed = useDataNeedsStore(state => state.failed);
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  const { loading } = useLedgerCollections('customers', 'invoices', 'creditNotes', 'inventory', 'transactions', 'accounts');
  const [lifespan, setLifespan] = useState(String(DEFAULT_LIFESPAN_YEARS));
  const [lifespanProblem, setLifespanProblem] = useState('');

  const valid = validCustomReportPeriod({ startDate: asOf, endDate: asOf }) && (!from || validCustomReportPeriod({ startDate: from, endDate: asOf }));
  const lifespanYears = Number(lifespan);
  const usableLifespan = Number.isInteger(lifespanYears) && lifespanYears >= 1 && lifespanYears <= 20;

  // a list that failed to load counts as settled (its first read never marks it loaded): the server answers then
  const settled = useDataNeedsStore(state => (['customers', 'invoices', 'creditNotes', 'inventory', 'transactions', 'accounts'] as const).every(key => state.loaded[key] || Boolean(state.failed[key])));
  const waiting = loading && !settled;
  const { report, source } = useServerCustomerLifetimeValue(asOf, from, usableLifespan ? lifespanYears : DEFAULT_LIFESPAN_YEARS, valid && usableLifespan && !waiting);

  const partial = source !== 'server' && (['customers', 'invoices', 'creditNotes', 'inventory', 'transactions', 'accounts'] as const).some(key => isCollectionCapped(truncated, key) || failed[key]);
  const currency = workspace?.currency || 'USD';

  return <section aria-label={reportText('r.customer-lifetime-value', 'Customer lifetime value')} className="p-4 space-y-4 min-w-0">
    <h2>{reportText('r.customer-lifetime-value', 'Customer lifetime value')}</h2>
    <p className="text-sm text-[var(--muted)]">
      {reportText('r.everything-recorded-up-to', 'Everything recorded up to')} {dates.dateText(asOf)}{from ? fill(reportText('r.from-0', ', from {0}'), { 0: dates.dateText(from) }) : ''}{reportText('r.in-the-workspace-base-currency-issued-invoice-it', ', in the workspace base currency: issued invoice item amounts and their posted or estimated cost, less the credit notes issued to the customer. Orders are the issued invoices; a customer with no issued invoice in the window is not listed. The projected lifetime value repeats the recorded average annual gross profit for the lifespan you choose — an assumption on the screen, not a forecast, and a customer with one order carries a very thin history.')}
    </p>

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1 text-sm">{reportText('r.lifespan-years', 'Lifespan (years)')}
        <input aria-label={reportText('r.lifespan-in-years', 'Lifespan in years')} inputMode="numeric" className={field} value={lifespan}
          onChange={event => setLifespan(event.target.value)}
          onBlur={() => setLifespanProblem(usableLifespan ? '' : 'The lifespan must be a whole number of years between 1 and 20.')} />
      </label>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={!report?.rows.length}
        onClick={() => report && downloadCsv('customer-lifetime-value', CUSTOMER_LIFETIME_VALUE_CSV_HEADERS, customerLifetimeValueCsvRows(report))}>{reportText('r.export-csv', 'Export CSV')}</button>
    </div>
    {lifespanProblem && <p role="alert" className="text-sm">{lifespanProblem}</p>}

    {waiting && <p role="status" className="text-sm text-[var(--muted)]">{reportText('r.loading-customers-and-invoices', 'Loading customers and invoices…')}</p>}
    {!valid && <p role="alert">{reportText('r.choose-a-valid-report-period-and-date', 'Choose a valid report period and date.')}</p>}
    {partial && <p role="alert" className="text-sm text-[var(--muted)]">{reportText('r.the-loaded-history-is-capped-or-failed-at-the-da', 'The loaded history is capped or failed at the database. These figures are provisional.')}</p>}
    <RangeReportSourceNote source={source} testId="customer-lifetime-value-source" what={reportText('r.these-figures', 'these figures')} reads="every issued invoice, the cost of goods sold posted for it, every credit note and every customer" />

    {report && <ReportSchedule
      columnControls
      allowDisplayedExport={!partial && !waiting}
      caption={<>{reportText('r.customer-lifetime-value-to', 'Customer lifetime value to')} {dates.dateText(asOf)}{from ? ` ${fill(reportText('r.from-0-2', '(from {0})'), { 0: dates.dateText(from) })}` : ''}</>}
      rowClassName="border-b border-[var(--line)]/50"
      bodyClassName=""
      rows={report.rows} rowKey={row => row.customerId}
      columns={[
        { header: reportText('r.customer', 'Customer'), cell: row => <bdi>{row.name}</bdi> },
        { header: reportText('r.orders', 'Orders'), align: 'right', cell: row => row.orders },
        { header: reportText('r.net-revenue', 'Net revenue'), align: 'right', cell: row => <>{formatCurrency(row.netRevenueCents, currency)}{row.creditCents ? <span className="text-[var(--muted)]"> {reportText('r.less', '(less')} {formatCurrency(row.creditCents, currency)} {reportText('r.credited', 'credited)')}</span> : null}</> },
        { header: reportText('r.cost', 'Cost'), align: 'right', cell: row => <>{formatCurrency(row.costCents, currency)}{row.costIsEstimate ? <span className="text-[var(--muted)]"> {reportText('r.includes-an-estimate', '(includes an estimate)')}</span> : null}</> },
        { header: reportText('r.gross-profit', 'Gross profit'), align: 'right', cell: row => formatCurrency(row.grossProfitCents, currency) },
        { header: reportText('r.margin', 'Margin %'), align: 'right', cell: row => row.marginPct === null ? '—' : `${row.marginPct.toFixed(1)}%` },
        { header: reportText('r.first-order', 'First order'), cell: row => row.firstOrder ? dates.dateText(row.firstOrder) : '—' },
        { header: reportText('r.last-order', 'Last order'), cell: row => row.lastOrder ? dates.dateText(row.lastOrder) : '—' },
        { header: reportText('r.active', 'Active'), align: 'right', cell: row => row.active ? reportText('r.yes', 'Yes') : reportText('r.no', 'No') },
        { header: reportText('r.average-order', 'Average order'), align: 'right', cell: row => formatCurrency(row.averageOrderCents, currency) },
        { header: reportText('r.orders-year', 'Orders / year'), align: 'right', cell: row => row.ordersPerYear.toFixed(2) },
        { header: reportText('r.average-annual-profit', 'Average annual profit'), cell: row => <>{formatCurrency(row.averageAnnualProfitCents, currency)}<span className="text-[var(--muted)]"> {reportText('r.over', 'over')} {row.monthsOfHistory} {reportText('r.month-s', 'month(s)')}</span></> },
        { header: fill(reportText('r.projected-0-year-profit', 'Projected {0}-year profit'), { 0: report.lifespanYears }), cell: row => formatCurrency(row.projectedProfitCents, currency) },
      ]} />}

    <p className="text-xs text-[var(--muted)]">{reportText('r.credit-notes-reduce-revenue-but-never-the-record', 'Credit notes reduce revenue but never the recorded cost, so a customer who returned everything shows a loss rather than a made-up zero. The average annual profit spreads the whole recorded history, including its first partial year.')}</p>
  </section>;
}
