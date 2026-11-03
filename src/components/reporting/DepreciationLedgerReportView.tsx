import React, { useState } from 'react';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { useServerDepreciationLedger } from '../../hooks/useServerAssetRegister';
import { RangeReportSourceNote } from './RangeReportSourceNote';

const field = 'px-2 py-1.5 border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]';

/**
 * Asset depreciation ledger (CB-27): for a period, each fixed asset's cost, depreciation before it,
 * in it (from the monthly runs) and at its end, and its book value, with the totals
 * (src/lib/depreciationLedger.ts).
 */
export default function DepreciationLedgerReportView() {
  const { loading } = useLedgerCollections('assets', 'transactions');
  const [from, setFrom] = useState(`${getLocalDateISO().slice(0, 4)}-01-01`);
  const [to, setTo] = useState(getLocalDateISO());
  // L-123 step 4h: with the loaded assets or entries capped, the ledger comes from the server (every asset and run)
  const ledger = useServerDepreciationLedger(from, to, from <= to);
  const rows = ledger?.rows || [];
  const sum = (k: 'costCents' | 'openingCents' | 'periodCents' | 'closingCents' | 'bookValueCents') => rows.reduce((s, r) => s + r[k], 0);
  const money = (cents: number) => formatCurrency(cents);

  return (
    <section aria-labelledby="depreciation-ledger-title" className="space-y-4">
      <h2 id="depreciation-ledger-title" className="text-lg font-bold text-[var(--text)]">Asset depreciation ledger</h2>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1 text-[var(--muted)]">From<input type="date" value={from} onChange={e => setFrom(e.target.value)} className={field} /></label>
        <label className="flex flex-col gap-1 text-[var(--muted)]">To<input type="date" value={to} onChange={e => setTo(e.target.value)} className={field} /></label>
      </div>
      {ledger && <RangeReportSourceNote source={ledger.source} testId="depreciation-ledger-source" what="these figures" />}
      {from > to && <p role="status" className="text-xs text-amber-700 dark:text-amber-400">The period starts after it ends.</p>}
      {loading && <p className="text-sm text-[var(--muted)]">Loading…</p>}
      {!loading && from <= to && rows.length === 0 && <p className="text-sm text-[var(--muted)]">No fixed assets in this period.</p>}
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
          <table className="w-full text-sm">
            <caption className="text-left text-xs text-[var(--muted)] pb-1">Depreciation posted by the monthly runs (in force), and what each asset came with before its first run.</caption>
            <thead>
              <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                <th scope="col" className="text-left font-semibold py-1 px-2">Asset</th>
                <th scope="col" className="text-right font-semibold py-1 px-2">Cost</th>
                <th scope="col" className="text-right font-semibold py-1 px-2">Depreciation before</th>
                <th scope="col" className="text-right font-semibold py-1 px-2">In the period</th>
                <th scope="col" className="text-right font-semibold py-1 px-2">At the end</th>
                <th scope="col" className="text-right font-semibold py-1 px-2">Book value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.assetId} className="border-b border-[var(--line)]/50">
                  <th scope="row" className="text-left font-normal py-1 px-2">
                    <bdi>{r.name}</bdi>
                    {(r.disposedOn || r.partlyDisposed || r.months.length > 0) && (
                      <span className="block text-[10px] text-[var(--muted)]">
                        {[r.months.length ? `${r.months.length} month${r.months.length === 1 ? '' : 's'} run` : '', r.disposedOn ? `disposed ${r.disposedOn}` : '', r.partlyDisposed ? 'partly sold: the cost is what is left' : ''].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </th>
                  <td className="text-right font-mono py-1 px-2">{money(r.costCents)}</td>
                  <td className="text-right font-mono py-1 px-2">{money(r.openingCents)}</td>
                  <td className="text-right font-mono py-1 px-2">{money(r.periodCents)}</td>
                  <td className="text-right font-mono py-1 px-2">{money(r.closingCents)}</td>
                  <td className="text-right font-mono py-1 px-2">{money(r.bookValueCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <th scope="row" className="text-left py-1 px-2">Total</th>
                <td className="text-right font-mono py-1 px-2">{money(sum('costCents'))}</td>
                <td className="text-right font-mono py-1 px-2">{money(sum('openingCents'))}</td>
                <td className="text-right font-mono py-1 px-2">{money(sum('periodCents'))}</td>
                <td className="text-right font-mono py-1 px-2">{money(sum('closingCents'))}</td>
                <td className="text-right font-mono py-1 px-2">{money(sum('bookValueCents'))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
