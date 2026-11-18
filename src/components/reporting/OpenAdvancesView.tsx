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
          <ReportTableScroll>
            <table className="w-full text-sm">
              <caption>{title} {reportText('r.as-of-3', 'as of')} {asOf}</caption>
              <thead>
                <tr>
                  <th scope="col" className="text-left">{direction === 'received' ? reportText('r.customer', 'Customer') : reportText('r.vendor', 'Vendor')}</th>
                  <th scope="col" className="text-left">{reportText('r.payment', 'Payment')}</th>
                  <th scope="col" className="text-left">{reportText('r.date-2', 'Date')}</th>
                  <th scope="col" className="text-right">{reportText('r.paid', 'Paid')}</th>
                  <th scope="col" className="text-right">{reportText('r.applied', 'Applied')}</th>
                  <th scope="col" className="text-right">{reportText('r.still-open', 'Still open')}</th>
                  <th scope="col" className="text-right">{reportText('r.days-waiting', 'Days waiting')}</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.length === 0 && <tr><td colSpan={7}>{reportText('r.nothing-open-every-advance-is-applied', 'Nothing open: every advance is applied.')}</td></tr>}
                {result.rows.map(r => (
                  <tr key={r.paymentId}>
                    <td><bdi>{r.partyName}</bdi></td>
                    <td>{r.number}</td>
                    <td>{r.date}</td>
                    <td className="text-right tabular-nums">{money(r.amountCents, r.currency)}</td>
                    <td className="text-right tabular-nums">{money(r.appliedCents, r.currency)}</td>
                    <td className="text-right tabular-nums font-semibold">{money(r.openCents, r.currency)}</td>
                    <td className={`text-right tabular-nums ${r.bucket === '90+' ? 'text-rose-600 font-semibold' : ''}`}>{r.ageDays}</td>
                  </tr>
                ))}
              </tbody>
              {Object.keys(result.totals).length > 0 && (
                <tfoot>
                  {Object.entries(result.totals).map(([currency, cents]) => (
                    <tr key={currency || 'home'}>
                      <th scope="row" className="text-left">{reportText('r.total-still-open', 'Total still open')}{Object.keys(result.totals).length > 1 ? ` (${currency || home})` : ''}</th>
                      <td /><td /><td /><td />
                      <td className="text-right tabular-nums font-bold">{money(cents, currency)}</td>
                      <td />
                    </tr>
                  ))}
                </tfoot>
              )}
            </table>
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
