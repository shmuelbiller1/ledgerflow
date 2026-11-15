import React, { useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useEntityOperations } from '../../hooks/useEntityOperations';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import InlineEdit from '../ui/InlineEdit';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { downloadCsv } from '../../lib/csvExport';
import ReportTableScroll from './ReportTableScroll';
import {
  customerCreditLimits, customerCreditLimitsCsvRows, creditLimitOf, CREDIT_LIMITS_CSV_HEADERS, CREDIT_LIMIT_METADATA_KEY,
  type CreditLimitRow,
} from '../../lib/customerCreditLimits';

const stateLabels: Record<CreditLimitRow['state'], string> = {
  over: 'Over limit',
  within: 'Within limit',
  'not-limited': 'No limit recorded',
};

/**
 * A-69: customer credit limits. Each customer's recorded limit beside what they owe now (the unpaid
 * part of issued invoices), so a business can see who is past their limit before the next sale. The
 * limit is edited in place, on the customer's own record (`metadata.creditLimitCents`), and the
 * report changes no amount, posts nothing and decides nothing.
 */
export default function CustomerCreditLimitReportView() {
  const customers = useLedgerStore(state => state.customers);
  const invoices = useLedgerStore(state => state.invoices);
  const truncated = useLedgerStore(state => state.truncatedCollections);
  const failed = useDataNeedsStore(state => state.failed);
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

  const partial = truncated.customers || truncated.invoices || failed.customers || failed.invoices;

  return <section aria-label="Customer credit limits" className="p-4 space-y-4 min-w-0">
    <h2>Customer credit limits</h2>
    <p className="text-sm text-[var(--muted)]">
      What each customer owes now against the limit recorded on their own record, in the workspace base currency
      ({home}). What they owe is the unpaid part of issued invoices; drafts, void and cancelled invoices are not
      sales, and a credit note or refund is already reflected in what was paid. Invoices in another currency are
      listed beside the row and never added in or converted. A customer with no recorded limit is &quot;no limit
      recorded&quot; — never treated as over it. Click a limit to type a new one; nothing here posts, blocks a sale or
      changes an amount.
    </p>

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1 text-sm">Show
        <select aria-label="Which customers" className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]"
          value={state} onChange={event => setState(event.target.value as CreditLimitRow['state'] | 'all')}>
          <option value="all">Every customer with a limit or a balance</option>
          <option value="over">Over limit only</option>
          <option value="within">Within limit only</option>
          <option value="not-limited">No limit recorded only</option>
        </select>
      </label>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={!report.length}
        onClick={() => downloadCsv('customer-credit-limits', CREDIT_LIMITS_CSV_HEADERS, customerCreditLimitsCsvRows(report, home))}>Export CSV</button>
    </div>

    {loading && <p role="status" className="text-sm text-[var(--muted)]">Loading customers and invoices…</p>}
    {partial && <p role="alert" className="text-sm text-[var(--muted)]">The loaded customers or invoices are capped or failed at the database. These figures may be incomplete.</p>}
    <p className="text-sm">
      {overLimit.length} customer(s) over their recorded limit{state !== 'all' ? ` · ${report.length} shown with this filter` : ''}
    </p>

    <ReportTableScroll>
      <table className="w-full text-sm">
        <caption>Customer credit limits and what each customer owes</caption>
        <thead>
          <tr>{['Customer', 'State', 'Limit', 'Open balance', 'Overdue', 'Headroom', 'Used', 'Open invoices', 'Oldest due', 'Other currencies'].map(head =>
            <th key={head} scope="col" className="text-left py-1 px-2">{head}</th>)}</tr>
        </thead>
        <tbody>
          {report.map(row => {
            const customer = customers.find(c => c.id === row.customerId);
            return <tr key={row.customerId} className="border-b border-[var(--line)]/50">
              <th scope="row" className="text-left font-normal py-1 px-2"><bdi>{row.name}</bdi></th>
              <td className="py-1 px-2">{stateLabels[row.state]}</td>
              <td className="py-1 px-2">
                <InlineEdit kind="money" value={creditLimitOf({ id: row.customerId, name: row.name, metadata: customer?.metadata })}
                  display={row.limitCents === undefined ? 'Set a limit' : formatCurrency(row.limitCents, home)}
                  label={`Credit limit of ${row.name}`} canEdit={canEdit && Boolean(customer)}
                  validate={next => typeof next === 'number' && next >= 0 ? null : 'The limit cannot be negative.'}
                  onSave={async next => {
                    if (!customer) return;
                    const cents = typeof next === 'number' ? next : 0;
                    await updateEntity('customers', customer.id, {
                      metadata: { [CREDIT_LIMIT_METADATA_KEY]: cents },
                    }, `Credit limit of ${row.name} saved`);
                  }} />
              </td>
              <td className="py-1 px-2">{formatCurrency(row.openCents, home)}</td>
              <td className="py-1 px-2">{row.overdueCents ? formatCurrency(row.overdueCents, home) : '—'}</td>
              <td className="py-1 px-2">{row.headroomCents === undefined ? '—' : formatCurrency(row.headroomCents, home)}</td>
              <td className="py-1 px-2">{row.utilizationPct === undefined ? '—' : `${row.utilizationPct.toFixed(2)}%`}</td>
              <td className="py-1 px-2">{row.openInvoices}{row.openInvoices !== row.invoices ? <span className="text-[var(--muted)]"> of {row.invoices}</span> : null}</td>
              <td className="py-1 px-2">{row.oldestDueDate || '—'}</td>
              <td className="py-1 px-2">{row.otherCurrencies.length
                ? row.otherCurrencies.map(currency => <span key={currency.currency} className="inline-block mr-2"><bdi>{currency.currency} {formatCurrency(currency.openCents, currency.currency)}</bdi></span>)
                : '—'}</td>
            </tr>;
          })}
        </tbody>
      </table>
      {!report.length && <p className="text-sm text-[var(--muted)]">{state === 'all' ? 'No customer has a recorded limit or an open balance yet.' : 'No customer matches this filter.'}</p>}
    </ReportTableScroll>

    <p className="text-xs text-[var(--muted)]">
      The limit is the customer&apos;s own recorded figure and is compared only with base-currency balances; whether a sale may go
      on credit is still a person&apos;s decision. The warning on the invoice form itself is the sales screen&apos;s job (asked of AI #1),
      and overdue is measured on today&apos;s date.
    </p>
  </section>;
}
