import React, { useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { isCollectionCapped } from '../../lib/ledgerCollections';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { type SpreadSide } from '../../lib/spreadWaterfall';
import { useServerSpreadWaterfall } from '../../hooks/useServerSpreadWaterfall';
import { RangeReportSourceNote } from './RangeReportSourceNote';
import { validCustomReportPeriod } from '../../lib/reportCustomPeriod';
import { formatCurrency } from '../../lib/utils';
import ReportTableScroll from './ReportTableScroll';

/**
 * Deferred-revenue waterfall (J-14): invoices spread over months (K-16) with what is earned in each
 * month of the period, earned by its end, and still deferred after it; switchable to prepaid
 * expenses (bills, K-17). Read-only, from the monthly entries.
 */
export default function SpreadWaterfallView({ startDate = '', endDate = '' }: { startDate?: string; endDate?: string }) {
  const [side, setSide] = useState<SpreadSide>('invoice');
  const truncated = useLedgerStore(s => s.truncatedCollections);
  const failed = useDataNeedsStore(s => s.failed);
  const currency = useAuthStore(s => s.getCurrentWorkspace()?.currency);
  const { loading } = useLedgerCollections('transactions', 'invoices', 'bills');
  // A list that failed to load counts as settled (its first read never marks it loaded): the server answers then.
  const settled = useDataNeedsStore(s => (['transactions', side === 'invoice' ? 'invoices' : 'bills'] as const).every(k => s.loaded[k] || Boolean(s.failed[k])));
  const waiting = loading && !settled;
  const valid = validCustomReportPeriod({ startDate, endDate });
  const { waterfall: result, source } = useServerSpreadWaterfall(side, startDate, endDate, valid && !waiting);
  const title = side === 'invoice' ? 'Deferred revenue waterfall' : 'Prepaid expenses waterfall';
  const done = side === 'invoice' ? 'Earned' : 'Expensed';
  const left = side === 'invoice' ? 'Still deferred' : 'Still prepaid';
  const money = (cents: number) => formatCurrency(cents, currency);

  return (
    <section aria-label="Deferred revenue waterfall" className="p-4 space-y-4 min-w-0">
      <h2>{title}</h2>
      <p>
        {startDate} – {endDate}. {side === 'invoice'
          ? 'Invoices spread over the months their income is earned in (Sales → Spread): what is earned each month, by the end of the period, and what is still deferred after it.'
          : 'Bills spread over the months they cover (Purchases → Spread): what is expensed each month, by the end of the period, and what is still prepaid after it.'}
      </p>
      <label className="inline-flex items-center gap-2 text-sm">
        Show
        <select value={side} onChange={e => setSide(e.target.value as SpreadSide)} className="p-1 border border-[var(--line)] rounded bg-[var(--panel)]">
          <option value="invoice">Income (invoices)</option>
          <option value="bill">Expenses (bills)</option>
        </select>
      </label>
      {waiting && <p role="status">Loading entries…</p>}
      {!valid && <p role="alert">Choose a valid report period.</p>}
      {source !== 'server' && (['transactions', 'invoices', 'bills'] as const).some(k => isCollectionCapped(truncated, k) || failed[k]) && <p role="alert">Loaded ledger history is incomplete or failed. These figures are provisional.</p>}
      <RangeReportSourceNote source={source} testId="spread-waterfall-source" what="these figures" />
      {result && (
        <ReportTableScroll>
          <table className="w-full text-sm">
            <caption>{title}: {startDate} – {endDate}</caption>
            <thead>
              <tr>
                <th scope="col" className="text-left">{side === 'invoice' ? 'Invoice' : 'Bill'}</th>
                {result.months.map(m => <th key={m} scope="col">{m}</th>)}
                <th scope="col">{done} by {endDate}</th>
                <th scope="col">{left} after {endDate}</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map(r => (
                <tr key={r.id}>
                  <th scope="row" className="text-left"><bdi>{r.label}</bdi></th>
                  {result.months.map(m => <td key={m} className="text-right font-mono">{r.byMonth[m] ? money(r.byMonth[m]) : '—'}</td>)}
                  <td className="text-right font-mono">{money(r.earnedCents)}</td>
                  <td className="text-right font-mono">{money(r.deferredCents)}</td>
                </tr>
              ))}
            </tbody>
            {result.rows.length > 0 && (
              <tfoot>
                <tr>
                  <th scope="row" className="text-left">Total</th>
                  {result.months.map(m => <td key={m} className="text-right font-mono font-bold">{money(result.totals.byMonth[m] || 0)}</td>)}
                  <td className="text-right font-mono font-bold">{money(result.totals.earnedCents)}</td>
                  <td className="text-right font-mono font-bold">{money(result.totals.deferredCents)}</td>
                </tr>
              </tfoot>
            )}
          </table>
          {result.rows.length === 0 && <p>{side === 'invoice' ? 'No invoice is spread over months yet.' : 'No bill is spread over months yet.'}</p>}
        </ReportTableScroll>
      )}
    </section>
  );
}
