import React, { useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { rateHistory } from '../../lib/exchangeRates';
import { validCustomReportPeriod } from '../../lib/reportCustomPeriod';
import ReportTableScroll from './ReportTableScroll';
import { byCodeUnit } from '../../lib/codeUnitOrder';

interface RatedDoc { currency?: string; exchangeRate?: number; date?: string }

/**
 * Exchange rates used (K-29): for each foreign currency, the rates the books were posted at in the
 * period, by day, with how many documents used each — read from the invoices, bills, payments and
 * journal entries themselves.
 */
export default function ExchangeRateHistoryView({ startDate = '', endDate = '' }: { startDate?: string; endDate?: string }) {
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
    <section aria-label="Exchange rates used" className="p-4 space-y-4 min-w-0">
      <h2>Exchange rates used</h2>
      <p>{startDate} – {endDate}. The rates the books were posted at for each foreign currency ({home} for 1 unit), by day, from the documents and journal entries themselves.</p>
      {currencies.length > 1 && (
        <label className="inline-flex items-center gap-2 text-sm">
          Currency
          <select value={currency} onChange={e => setChosen(e.target.value)} className="p-1 border border-[var(--line)] rounded bg-[var(--panel)]">
            {currencies.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      )}
      {loading && <p role="status">Loading documents…</p>}
      {!valid && <p role="alert">Choose a valid report period.</p>}
      {(truncated.invoices || truncated.bills || truncated.payments || truncated.transactions || failed.transactions) && <p role="alert">Loaded history is incomplete. These rates are provisional.</p>}
      {valid && !loading && (
        <ReportTableScroll>
          <table className="w-full text-sm">
            <caption>{currency ? `${currency} rates used: ${startDate} – ${endDate}` : `Exchange rates used: ${startDate} – ${endDate}`}</caption>
            <thead><tr><th scope="col" className="text-left">Date</th><th scope="col">{home} for 1 {currency || '…'}</th><th scope="col">Documents</th></tr></thead>
            <tbody>
              {uses.map(u => (
                <tr key={`${u.date}-${u.rate}`}><th scope="row" className="text-left">{u.date}</th><td className="text-right font-mono">{u.rate}</td><td className="text-right">{u.count}</td></tr>
              ))}
            </tbody>
          </table>
          {currencies.length === 0 && <p>No document in another currency yet.</p>}
          {currencies.length > 0 && uses.length === 0 && <p>No {currency} rate was used in this period.</p>}
          {rates.length > 1 && <p className="text-xs text-[var(--muted)]">Lowest {Math.min(...rates)}, highest {Math.max(...rates)}, latest {uses[0].rate} ({uses[0].date}).</p>}
        </ReportTableScroll>
      )}
    </section>
  );
}
