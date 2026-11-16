import React, { useState } from 'react';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { useServerDepreciationLedger } from '../../hooks/useServerAssetRegister';
import { RangeReportSourceNote } from './RangeReportSourceNote';
import { RowTable } from '../ui/RowTable';

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
          <RowTable
            rowClassName="border-b border-[var(--line)]/50"
            caption={(<>Depreciation posted by the monthly runs (in force), and what each asset came with before its first run.</>)}
            rows={rows}
            rowKey={r => r.assetId}
            captionClassName="text-left text-xs text-[var(--muted)] pb-1"
            tableClassName="w-full text-sm"
            headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)]"
            bodyClassName=""
            footer={<tr className="font-semibold">
                <th scope="row" className="text-left py-1 px-2">Total</th>
                <td className="text-right font-mono py-1 px-2">{money(sum('costCents'))}</td>
                <td className="text-right font-mono py-1 px-2">{money(sum('openingCents'))}</td>
                <td className="text-right font-mono py-1 px-2">{money(sum('periodCents'))}</td>
                <td className="text-right font-mono py-1 px-2">{money(sum('closingCents'))}</td>
                <td className="text-right font-mono py-1 px-2">{money(sum('bookValueCents'))}</td>
              </tr>}
            columns={[
              { header: "Asset", className: "text-left font-normal py-1 px-2", headClassName: "text-left font-semibold py-1 px-2", cell: (r) => (<><bdi>{r.name}</bdi>
                    {(r.disposedOn || r.partlyDisposed || r.months.length > 0) && (
                      <span className="block text-[10px] text-[var(--muted)]">
                        {[r.months.length ? `${r.months.length} month${r.months.length === 1 ? '' : 's'} run` : '', r.disposedOn ? `disposed ${r.disposedOn}` : '', r.partlyDisposed ? 'partly sold: the cost is what is left' : ''].filter(Boolean).join(' · ')}
                      </span>
                    )}</>) },
              { header: "Cost", align: 'right', className: "font-mono py-1 px-2", headClassName: "font-semibold py-1 px-2", cell: (r) => money(r.costCents) },
              { header: "Depreciation before", align: 'right', className: "font-mono py-1 px-2", headClassName: "font-semibold py-1 px-2", cell: (r) => money(r.openingCents) },
              { header: "In the period", align: 'right', className: "font-mono py-1 px-2", headClassName: "font-semibold py-1 px-2", cell: (r) => money(r.periodCents) },
              { header: "At the end", align: 'right', className: "font-mono py-1 px-2", headClassName: "font-semibold py-1 px-2", cell: (r) => money(r.closingCents) },
              { header: "Book value", align: 'right', className: "font-mono py-1 px-2", headClassName: "font-semibold py-1 px-2", cell: (r) => money(r.bookValueCents) },
            ]}
          />
        </div>
      )}
    </section>
  );
}
