import { usePartialReportInputs } from '../../hooks/usePartialReportInputs';
import React, { useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useEntityOperations } from '../../hooks/useEntityOperations';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import InlineEdit from '../ui/InlineEdit';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { downloadCsv } from '../../lib/csvExport';
import ReportSchedule from './ReportSchedule';
import {
  customerCreditLimits, customerCreditLimitsCsvRows, creditLimitOf, CREDIT_LIMITS_CSV_HEADERS, CREDIT_LIMIT_METADATA_KEY,
  type CreditLimitRow,
} from '../../lib/customerCreditLimits';
import { useReportText, fill } from './useReportText';

const stateLabelsFor = (reportText: ReturnType<typeof useReportText>): Record<CreditLimitRow['state'], string> => ({
  over: reportText('r.over-limit', 'Over limit'),
  within: reportText('r.within-limit', 'Within limit'),
  'not-limited': reportText('r.no-limit-recorded', 'No limit recorded'),
});

/**
 * A-69: customer credit limits. Each customer's recorded limit beside what they owe now (the unpaid
 * part of issued invoices), so a business can see who is past their limit before the next sale. The
 * limit is edited in place, on the customer's own record (`metadata.creditLimitCents`), and the
 * report changes no amount, posts nothing and decides nothing.
 */
export default function CustomerCreditLimitReportView() {
  const reportText = useReportText();
  const customers = useLedgerStore(state => state.customers);
  const invoices = useLedgerStore(state => state.invoices);
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  const { loading } = useLedgerCollections('customers', 'invoices');
  const { updateEntity } = useEntityOperations();
  const canEdit = useCurrentRole() !== 'viewer';
  const [state, setState] = useState<CreditLimitRow['state'] | 'all'>('all');

  const home = workspace?.currency || 'USD';
  const report = useMemo(() => {
    const rows = customerCreditLimits({
      customers: customers.filter(customer => !workspaceId || customer.workspaceId === workspaceId),
      invoices: invoices.filter(invoice => !workspaceId || invoice.workspaceId === workspaceId),
      homeCurrency: home,
      asOfDate: getLocalDateISO(),
    });
    return state === 'all' ? rows : rows.filter(row => row.state === state);
  }, [customers, invoices, workspaceId, home, state]);
  const overLimit = report.filter(row => row.state === 'over');

  const partial = usePartialReportInputs(['customers', 'invoices']);

  return <section aria-label={reportText('r.customer-credit-limits', 'Customer credit limits')} className="p-4 space-y-4 min-w-0">
    <h2>{reportText('r.customer-credit-limits', 'Customer credit limits')}</h2>
    <p className="text-sm text-[var(--muted)]">
      {reportText('r.what-each-customer-owes-now-against-the-limit-re', 'What each customer owes now against the limit recorded on their own record, in the workspace base currency (')}{home}{reportText('r.what-they-owe-is-the-unpaid-part-of-issued-invoi', '). What they owe is the unpaid part of issued invoices; drafts, void and cancelled invoices are not sales, and a credit note or refund is already reflected in what was paid. Invoices in another currency are listed beside the row and never added in or converted. A customer with no recorded limit is "no limit recorded" — never treated as over it. Click a limit to type a new one; nothing here posts, blocks a sale or changes an amount.')}
    </p>

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1 text-sm">{reportText('r.show', 'Show')}
        <select aria-label={reportText('r.which-customers', 'Which customers')} className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]"
          value={state} onChange={event => setState(event.target.value as CreditLimitRow['state'] | 'all')}>
          <option value="all">{reportText('r.every-customer-with-a-limit-or-a-balance', 'Every customer with a limit or a balance')}</option>
          <option value="over">{reportText('r.over-limit-only', 'Over limit only')}</option>
          <option value="within">{reportText('r.within-limit-only', 'Within limit only')}</option>
          <option value="not-limited">{reportText('r.no-limit-recorded-only', 'No limit recorded only')}</option>
        </select>
      </label>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={!report.length}
        onClick={() => downloadCsv('customer-credit-limits', CREDIT_LIMITS_CSV_HEADERS, customerCreditLimitsCsvRows(report, home))}>{reportText('r.export-csv', 'Export CSV')}</button>
    </div>

    {loading && <p role="status" className="text-sm text-[var(--muted)]">{reportText('r.loading-customers-and-invoices', 'Loading customers and invoices…')}</p>}
    {partial && <p role="alert" className="text-sm text-[var(--muted)]">{reportText('r.the-loaded-customers-or-invoices-are-capped-or-f-2', 'The loaded customers or invoices are capped or failed at the database. These figures may be incomplete.')}</p>}
    <p className="text-sm">
      {overLimit.length} {reportText('r.customer-s-over-their-recorded-limit', 'customer(s) over their recorded limit')}{state !== 'all' ? ` ${fill(reportText('r.0-shown-with-this-filter', '· {0} shown with this filter'), { 0: report.length })}` : ''}
    </p>

    <ReportSchedule
      columnControls
      allowDisplayedExport={!canEdit && !partial && !loading}
      empty={!loading && !partial ? <p role="status" data-report-empty-state className="text-sm text-[var(--muted)]">{state === 'all' ? reportText('r.no-customer-has-a-recorded-limit-or-an-open-bala', 'No customer has a recorded limit or an open balance yet.') : reportText('r.no-customer-matches-this-filter', 'No customer matches this filter.')}</p> : null}
      caption={reportText('r.customer-credit-limits-and-what-each-customer-ow', 'Customer credit limits and what each customer owes')}
      rowClassName="border-b border-[var(--line)]/50"
      bodyClassName=""
      rows={report} rowKey={row => row.customerId}
      columns={[
        { header: reportText('r.customer', 'Customer'), cell: row => <bdi>{row.name}</bdi> },
        { header: reportText('r.state', 'State'), cell: row => stateLabelsFor(reportText)[row.state] },
        { header: reportText('r.limit', 'Limit'), align: 'right', cell: row => { const customer = customers.find(c => c.id === row.customerId); return <InlineEdit kind="money" value={creditLimitOf({ id: row.customerId, name: row.name, metadata: customer?.metadata })}
                  display={row.limitCents === undefined ? reportText('r.set-a-limit', 'Set a limit') : formatCurrency(row.limitCents, home)}
                  label={fill(reportText('r.credit-limit-of-0', 'Credit limit of {0}'), { 0: row.name })} canEdit={canEdit && Boolean(customer)}
                  validate={next => typeof next === 'number' && next >= 0 ? null : reportText('r.limit-not-negative', 'The limit cannot be negative.')}
                  onSave={async next => {
                    if (!customer) return;
                    const cents = typeof next === 'number' ? next : 0;
                    await updateEntity('customers', customer.id, {
                      metadata: { [CREDIT_LIMIT_METADATA_KEY]: cents },
                    }, `Credit limit of ${row.name} saved`);
                  }} />; } },
        { header: reportText('r.open-balance', 'Open balance'), align: 'right', cell: row => formatCurrency(row.openCents, home) },
        { header: reportText('r.overdue-2', 'Overdue'), align: 'right', cell: row => row.overdueCents ? formatCurrency(row.overdueCents, home) : '—' },
        { header: reportText('r.headroom', 'Headroom'), align: 'right', cell: row => row.headroomCents === undefined ? '—' : formatCurrency(row.headroomCents, home) },
        { header: reportText('r.used-2', 'Used'), align: 'right', cell: row => row.utilizationPct === undefined ? '—' : `${row.utilizationPct.toFixed(2)}%` },
        { header: reportText('r.open-invoices-2', 'Open invoices'), align: 'right', cell: row => <>{row.openInvoices}{row.openInvoices !== row.invoices ? <span className="text-[var(--muted)]"> {reportText('r.of', 'of')} {row.invoices}</span> : null}</> },
        { header: reportText('r.oldest-due', 'Oldest due'), cell: row => row.oldestDueDate || '—' },
        { header: reportText('r.other-currencies', 'Other currencies'), cell: row => row.otherCurrencies.length
                ? row.otherCurrencies.map(currency => <span key={currency.currency} className="inline-block me-2"><bdi>{currency.currency} {formatCurrency(currency.openCents, currency.currency)}</bdi></span>)
                : '—' },
      ]} />

    <p className="text-xs text-[var(--muted)]">
      {reportText('r.the-limit-is-the-customer-s-own-recorded-figure', 'The limit is the customer\'s own recorded figure and is compared only with base-currency balances; whether a sale may go on credit is still a person\'s decision. The warning on the invoice form itself is the sales screen\'s job (asked of AI #1), and overdue is measured on today\'s date.')}
    </p>
  </section>;
}
