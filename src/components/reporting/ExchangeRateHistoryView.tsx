import React, { useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { rateHistory } from '../../lib/exchangeRates';
import { validCustomReportPeriod } from '../../lib/reportCustomPeriod';
import ReportTableScroll from './ReportTableScroll';
import { byCodeUnit } from '../../lib/codeUnitOrder';
import { RowTable } from '../ui/RowTable';
import { useReportText, fill } from './useReportText';

interface RatedDoc { currency?: string; exchangeRate?: number; date?: string }

/**
 * Exchange rates used (K-29): for each foreign currency, the rates the books were posted at in the
 * period, by day, with how many documents used each — read from the invoices, bills, payments and
 * journal entries themselves.
 */
export default function ExchangeRateHistoryView({ startDate = '', endDate = '' }: { startDate?: string; endDate?: string }) {
  const reportText = useReportText();
  const invoices = useLedgerStore(s => s.invoices);
  const bills = useLedgerStore(s => s.bills);
  const payments = useLedgerStore(s => s.payments);
  const transactions = useLedgerStore(s => s.transactions);
  const truncated = useLedgerStore(s => s.truncatedCollections);
  const failed = useDataNeedsStore(s => s.failed);
  const home = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';
  const { loading } = useLedgerCollections('invoices', 'bills', 'payments', 'transactions');
  const valid = validCustomReportPeriod({ startDate, endDate });

  const docs = useMemo<RatedDoc[]>(() => [
    ...(invoices || []), ...(bills || []), ...(payments || []),
    // journal entries keep the foreign currency apart (documents' own postings are counted on the document)
    ...(transactions || []).filter(t => t.type === 'journal' && (t as { originalCurrency?: string }).originalCurrency)
      .map(t => ({ currency: (t as { originalCurrency?: string }).originalCurrency, exchangeRate: t.exchangeRate, date: t.date })),
  ].filter(d => (d as { status?: string }).status !== 'void'), [invoices, bills, payments, transactions]);
  const currencies = useMemo(() => [...new Set(docs.map(d => d.currency).filter((c): c is string => Boolean(c) && c !== home))].sort(byCodeUnit), [docs, home]);
  const [chosen, setChosen] = useState('');
  const currency = currencies.includes(chosen) ? chosen : currencies[0] || '';
  const uses = useMemo(() => (valid && currency ? rateHistory(currency, docs).filter(u => u.date >= startDate && u.date <= endDate) : []), [valid, currency, docs, startDate, endDate]);
  const rates = uses.map(u => u.rate);

  return (
    <section aria-label={reportText('r.exchange-rates-used', 'Exchange rates used')} className="p-4 space-y-4 min-w-0">
      <h2>{reportText('r.exchange-rates-used', 'Exchange rates used')}</h2>
      <p>{startDate} – {endDate}{reportText('r.the-rates-the-books-were-posted-at-for-each-fore', '. The rates the books were posted at for each foreign currency (')}{home} {reportText('r.for-1-unit-by-day-from-the-documents-and-journal', 'for 1 unit), by day, from the documents and journal entries themselves.')}</p>
      {currencies.length > 1 && (
        <label className="inline-flex items-center gap-2 text-sm">
          {reportText('r.currency-2', 'Currency')}
          <select value={currency} onChange={e => setChosen(e.target.value)} className="p-1 border border-[var(--line)] rounded bg-[var(--panel)]">
            {currencies.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      )}
      {loading && <p role="status">{reportText('r.loading-documents', 'Loading documents…')}</p>}
      {!valid && <p role="alert">{reportText('r.choose-a-valid-report-period', 'Choose a valid report period.')}</p>}
      {(truncated.invoices || truncated.bills || truncated.payments || truncated.transactions || failed.transactions) && <p role="alert">{reportText('r.loaded-history-is-incomplete-these-rates-are-pro', 'Loaded history is incomplete. These rates are provisional.')}</p>}
      {valid && !loading && (
        <ReportTableScroll>
          <RowTable
            caption={currency ? fill(reportText('r.0-rates-used-1-2', '{0} rates used: {1} – {2}'), { 0: currency, 1: startDate, 2: endDate }) : fill(reportText('r.exchange-rates-used-0-1', 'Exchange rates used: {0} – {1}'), { 0: startDate, 1: endDate })}
            rows={uses}
            rowKey={u => `${u.date}-${u.rate}`}
            captionClassName=""
            tableClassName="w-full text-sm"
            headRowClassName=""
            bodyClassName=""
            columns={[
              { header: reportText('r.date-2', 'Date'), className: "text-left", headClassName: "text-left", cell: (u) => u.date },
              { header: (<>{home} {reportText('r.for-1', 'for 1')} {currency || '…'}</>), className: "text-right font-mono", headClassName: "", cell: (u) => u.rate },
              { header: reportText('r.documents-heading', 'Documents'), className: "text-right", headClassName: "", cell: (u) => u.count },
            ]}
          />
          {currencies.length === 0 && <p>{reportText('r.no-document-in-another-currency-yet', 'No document in another currency yet.')}</p>}
          {currencies.length > 0 && uses.length === 0 && <p>{fill(reportText('r.no-currency-rate-used', 'No {0} rate was used in this period.'), { 0: currency })}</p>}
          {rates.length > 1 && <p className="text-xs text-[var(--muted)]">{reportText('r.lowest-2', 'Lowest')} {Math.min(...rates)}{reportText('r.highest-2', ', highest')} {Math.max(...rates)}{reportText('r.latest', ', latest')} {uses[0].rate} ({uses[0].date}).</p>}
        </ReportTableScroll>
      )}
    </section>
  );
}
