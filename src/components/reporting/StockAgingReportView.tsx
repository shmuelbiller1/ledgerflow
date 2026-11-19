import React, { useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { AGE_BUCKETS, type StockAge } from '../../lib/stockMoves';
import { runCommand } from '../../lib/runCommand';
import { useReportText, fill } from './useReportText';

const field = 'px-2 py-1.5 border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]';
const qty = (n: number) => (n ? String(Math.round(n * 1e6) / 1e6) : '');

/**
 * Stock aging (W-09): as of a day, each item's stock on hand split by how long ago those units came
 * in (first in, first out), with its value, the last sale and how long ago; the oldest stock first.
 * Read by the server from the stock history (src/lib/stockMoves.ts `stockAging`).
 */
export default function StockAgingReportView() {
  const reportText = useReportText();
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const [asOf, setAsOf] = useState(getLocalDateISO());
  const [result, setResult] = useState<{ key: string; items?: StockAge[]; error?: string } | null>(null);
  const currency = workspace?.currency || 'USD';
  const key = workspace && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? new URLSearchParams({ workspaceId: workspace.id, asOf }).toString() : '';

  useEffect(() => {
    if (!key) return;
    let live = true;
    (async () => {
      const body = await runCommand<{ items?: StockAge[] }>({ path: `/api/v1/reports/stock-aging?${key}` }) ?? {};
      if (!Array.isArray(body.items)) throw new Error('The stock history could not be read');
      return body.items as StockAge[];
    })().then(items => { if (live) setResult({ key, items }); }).catch(err => { if (live) setResult({ key, error: err instanceof Error ? err.message : String(err) }); });
    return () => { live = false; };
  }, [key]);
  const shown = result && result.key === key ? result : null;
  const items = shown?.items || [];
  const unknown = items.some(i => i.unknownAge > 0);

  return (
    <section aria-labelledby="stock-aging-title" className="space-y-4">
      <h2 id="stock-aging-title" className="text-lg font-bold text-[var(--text)]">{reportText('r.stock-aging', 'Stock aging')}</h2>
      <label className="flex flex-col gap-1 text-sm text-[var(--muted)] w-fit">{reportText('r.as-of-2', 'As of')}<input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} className={field} /></label>
      {key && !shown && <p className="text-sm text-[var(--muted)]">{reportText('r.loading', 'Loading…')}</p>}
      {shown?.error && <p role="alert" className="text-sm text-rose-600">{shown.error}</p>}
      {shown?.items && items.length === 0 && <p className="text-sm text-[var(--muted)]">{reportText('r.no-stock-on-hand-that-day', 'No stock on hand that day.')}</p>}
      {items.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
          <table className="w-full text-sm">
            <caption className="text-left text-xs text-[var(--muted)] pb-1">{reportText('r.units-on-hand-by-how-long-ago-they-came-in-the-l', 'Units on hand by how long ago they came in, the latest units taken to be the ones still there; the oldest stock first.')}</caption>
            <thead>
              <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                <th scope="col" className="text-left font-semibold py-1 px-2">{reportText('r.item', 'Item')}</th>
                <th scope="col" className="text-right font-semibold py-1 px-2">{reportText('r.on-hand', 'On hand')}</th>
                <th scope="col" className="text-right font-semibold py-1 px-2">{reportText('r.value', 'Value')}</th>
                {AGE_BUCKETS.map(b => <th key={b.key} scope="col" className="text-right font-semibold py-1 px-2">{b.label}</th>)}
                {unknown && <th scope="col" className="text-right font-semibold py-1 px-2">{reportText('r.before-the-history', 'Before the history')}</th>}
                <th scope="col" className="text-right font-semibold py-1 px-2">{reportText('r.last-sold', 'Last sold')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map(i => (
                <tr key={i.itemId} className="border-b border-[var(--line)]/50">
                  <th scope="row" className="text-left font-normal py-1 px-2"><bdi>{i.itemName}</bdi></th>
                  <td className="text-right font-mono py-1 px-2">{qty(i.quantity)}</td>
                  <td className="text-right font-mono py-1 px-2">{formatCurrency(i.valueCents, currency)}</td>
                  {AGE_BUCKETS.map(b => <td key={b.key} className="text-right font-mono py-1 px-2">{qty(i.buckets[b.key])}</td>)}
                  {unknown && <td className="text-right font-mono py-1 px-2">{qty(i.unknownAge)}</td>}
                  <td className="text-right py-1 px-2 text-xs">{i.lastSold ? fill(reportText('r.0-1-days-ago', '{0} ({1} days ago)'), { 0: i.lastSold, 1: i.daysSinceSold ?? '' }) : reportText('r.never', 'never')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
