import { RowTable } from '../ui/RowTable';
import React, { useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { openAdvances, type AgeBucket, type PaymentDirection } from '../../lib/advancePayments';
import { formatCurrency } from '../../lib/utils';
import ReportTableScroll from './ReportTableScroll';
import { useReportText, fill } from './useReportText';

const BUCKETS: AgeBucket[] = ['0-30', '31-60', '61-90', '90+'];

/**
 * Open advances (CA-09): customer deposits (or vendor prepayments) not yet applied to an invoice or
 * bill, oldest first, with their age at the end of the period and totals per contact. Applying one
 * is on the customer's or vendor's page ("Apply to invoices/bills").
 */
export default function OpenAdvancesView({ endDate = '' }: { startDate?: string; endDate?: string }) {
  const reportText = useReportText();
  const [direction, setDirection] = useState<PaymentDirection>('received');
  const payments = useLedgerStore(s => s.payments);
  const truncated = useLedgerStore(s => s.truncatedCollections);
  const failed = useDataNeedsStore(s => s.failed);
  const home = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';
  const { loading } = useLedgerCollections('payments');
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? endDate : '';
  const result = useMemo(() => (asOf && !loading ? openAdvances(payments || [], direction, asOf) : null), [asOf, loading, payments, direction]);
  const title = direction === 'received' ? 'Open customer deposits' : 'Open vendor prepayments';
  const money = (cents: number, currency?: string) => formatCurrency(cents, currency || home);

  return (
    <section aria-label={reportText('r.open-advances', 'Open advances')} className="p-4 space-y-4 min-w-0">
      <h2>{title}</h2>
      <p>
        {fill(direction === 'received' ? reportText('r.open-advances-customers', 'As of {date}. Money customers paid before an invoice and not applied yet, oldest first. Apply it on the customer\'s page ("Apply to invoices").') : reportText('r.open-advances-vendors', 'As of {date}. Money paid to vendors before a bill and not applied yet, oldest first. Apply it on the vendor\'s page ("Apply to bills").'), { date: asOf || '—' })}
      </p>
      <label className="flex items-center gap-2 text-sm">
        {reportText('r.show', 'Show')}
        <select aria-label={reportText('r.which-advances', 'Which advances')} value={direction} onChange={e => setDirection(e.target.value as PaymentDirection)} className="px-2 py-1 border border-[var(--line)] rounded bg-[var(--panel)]">
          <option value="received">{reportText('r.customer-deposits', 'Customer deposits')}</option>
          <option value="made">{reportText('r.vendor-prepayments', 'Vendor prepayments')}</option>
        </select>
      </label>
      {loading && <p role="status">{reportText('r.loading-payments', 'Loading payments…')}</p>}
      {(truncated.payments || failed.payments) && <p role="alert">{reportText('r.loaded-payment-history-is-incomplete-or-failed-t', 'Loaded payment history is incomplete or failed. These figures are provisional.')}</p>}
      {result && (
        <>
          <ReportTableScroll allowDisplayedExport={!loading && !truncated.payments && !failed.payments}>
            <RowTable
              caption={
                <>
                  {title} {reportText('r.as-of-3', 'as of')} {asOf}
                </>
              }
              captionClassName=""
              tableClassName="w-full text-sm"
              headRowClassName=""
              bodyClassName=""
              rows={result.rows}
              rowKey={(r) => r.paymentId}
              rowHeaderClassName="font-normal text-start"
              emptyRow={
                result.rows.length === 0 && (
                  <tr>
                    <td colSpan={7}>{reportText('r.nothing-open-every-advance-is-applied', 'Nothing open: every advance is applied.')}</td>
                  </tr>
                )
              }
              footer={
                Object.keys(result.totals).length > 0
                  ? Object.entries(result.totals).map(([currency, cents]) => (
                      <tr key={currency || 'home'}>
                        <th scope="row" className="text-left">
                          {reportText('r.total-still-open', 'Total still open')}
                          {Object.keys(result.totals).length > 1 ? ` (${currency || home})` : ''}
                        </th>
                        <td />
                        <td />
                        <td />
                        <td />
                        <td className="text-right tabular-nums font-bold">{money(cents, currency)}</td>
                        <td />
                      </tr>
                    ))
                  : undefined
              }
              columns={[
                {
                  header: direction === 'received' ? reportText('r.customer', 'Customer') : reportText('r.vendor', 'Vendor'),
                  headClassName: 'text-left',
                  cell: (r) => <bdi>{r.partyName}</bdi>,
                },
                { header: reportText('r.payment', 'Payment'), headClassName: 'text-left', cell: (r) => r.number },
                { header: reportText('r.date-2', 'Date'), headClassName: 'text-left', cell: (r) => r.date },
                { header: reportText('r.paid', 'Paid'), headClassName: 'text-right', className: 'text-right tabular-nums', cell: (r) => money(r.amountCents, r.currency) },
                { header: reportText('r.applied', 'Applied'), headClassName: 'text-right', className: 'text-right tabular-nums', cell: (r) => money(r.appliedCents, r.currency) },
                {
                  header: reportText('r.still-open', 'Still open'),
                  headClassName: 'text-right', className: 'text-right tabular-nums font-semibold',
                  cell: (r) => money(r.openCents, r.currency),
                },
                {
                  header: reportText('r.days-waiting', 'Days waiting'),
                  headClassName: 'text-right',
                  cellProps: (r) => ({ className: `text-right tabular-nums ${r.bucket === '90+' ? 'text-rose-600 font-semibold' : ''}` }),
                  cell: (r) => r.ageDays,
                },
              ]}
            />
          </ReportTableScroll>
          {result.rows.length > 0 && (
            <p className="text-sm text-[var(--muted)]">
              {reportText('r.by-age', 'By age:')} {BUCKETS.map(b => `${b} days ${result.rows.filter(r => r.bucket === b).length}`).join(' · ')}.
              {' '}{reportText('r.most-open', 'Most open:')} {result.byParty.slice(0, 3).map(p => `${p.partyName} ${money(p.openCents, p.currency)}`).join(', ')}.
            </p>
          )}
        </>
      )}
    </section>
  );
}
