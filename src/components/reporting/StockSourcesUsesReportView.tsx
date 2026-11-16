import React, { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { csvMoney, downloadCsv } from '../../lib/csvExport';
import { resolveDimensionLabel } from '../../lib/dimensionUtils';
import type { ItemDetails } from '../../lib/stockMoves';
import { stockSourcesUses, stockSourcesUsesCsv, type FlowLine, type ItemSourcesUses } from '../../lib/stockSourcesUses';
import { runCommand } from '../../lib/runCommand';

const field = 'px-2 py-1.5 border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]';
const qty = (n: number) => String(Math.round(n * 1e6) / 1e6);

/**
 * Stock sources and uses (DIM-2 phase 4, GitHub #132): for a period, each item's opening stock, where its units came
 * from (each vendor, Adjust stock, origin not recorded, returns), where they went (each customer and the sold line's
 * labels, vendors sent back to, adjustments by their reason) and its closing stock, with a check that they add up.
 * Read from the stock history the server keeps (src/lib/stockSourcesUses.ts); nothing is written and nothing guessed.
 */
export default function StockSourcesUsesReportView() {
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  useLedgerCollections('vendors', 'customers');
  const vendors = useLedgerStore(s => s.vendors);
  const customers = useLedgerStore(s => s.customers);
  const nodes = useLedgerStore(s => s.dimensionNodes || []);
  const [startDate, setStartDate] = useState(`${getLocalDateISO().slice(0, 4)}-01-01`);
  const [endDate, setEndDate] = useState(getLocalDateISO());
  const [result, setResult] = useState<{ key: string; items?: ItemDetails[]; error?: string } | null>(null);
  const currency = workspace?.currency || 'USD';
  const key = workspace && startDate && endDate && startDate <= endDate ? new URLSearchParams({ workspaceId: workspace.id, startDate, endDate }).toString() : '';

  useEffect(() => {
    if (!key) return;
    let live = true;
    (async () => {
      const body = await runCommand<{ items?: ItemDetails[] }>({ path: `/api/v1/reports/inventory-details?${key}` }) ?? {};
      if (!Array.isArray(body.items)) throw new Error('The stock history could not be read');
      return body.items as ItemDetails[];
    })().then(items => { if (live) setResult({ key, items }); }).catch(err => { if (live) setResult({ key, error: err instanceof Error ? err.message : String(err) }); });
    return () => { live = false; };
  }, [key]);
  const shown = result && result.key === key ? result : null;

  const rows = useMemo(() => {
    if (!shown?.items) return null;
    const vendorName = new Map(vendors.map(v => [v.id, v.name]));
    const customerName = new Map(customers.map(c => [c.id, c.name]));
    return stockSourcesUses(shown.items, {
      vendor: id => vendorName.get(id), customer: id => customerName.get(id), label: (dim, id) => resolveDimensionLabel(nodes, dim, id),
    });
  }, [shown, vendors, customers, nodes]);

  const exportCsv = () => {
    if (!rows) return;
    const [headers, ...data] = stockSourcesUsesCsv(rows, csvMoney);
    downloadCsv(`stock-sources-uses-${startDate}-to-${endDate}.csv`, headers, data);
  };

  return (
    <section aria-labelledby="stock-sources-uses-title" className="space-y-4">
      <h2 id="stock-sources-uses-title" className="text-lg font-bold text-[var(--text)]">Stock sources and uses</h2>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1 text-[var(--muted)]">From<input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={field} /></label>
        <label className="flex flex-col gap-1 text-[var(--muted)]">To<input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={field} /></label>
        <button type="button" onClick={exportCsv} disabled={!rows || rows.length === 0} className="min-h-11 rounded-lg border border-[var(--line)] px-3 py-2 font-semibold text-[var(--text)] disabled:opacity-50">Export CSV</button>
      </div>
      {startDate > endDate && <p role="status" className="text-xs text-amber-700 dark:text-amber-400">The period starts after it ends.</p>}
      {key && !shown && <p className="text-sm text-[var(--muted)]">Loading…</p>}
      {shown?.error && <p role="alert" className="text-sm text-rose-600">{shown.error}</p>}
      {rows && rows.length === 0 && <p className="text-sm text-[var(--muted)]">No stock and no movements in this period.</p>}
      {rows?.map(r => <ItemFlow key={r.itemId} row={r} currency={currency} />)}
    </section>
  );
}

function FlowRows({ lines, currency }: { lines: FlowLine[]; currency: string }) {
  return <>{lines.map(l => (
    <tr key={l.key} className="border-b border-[var(--line)]/50">
      <th scope="row" className="text-left font-normal py-1 pl-4"><bdi>{l.label}</bdi>{l.unknown && <span className="ml-1 text-xs text-amber-700 dark:text-amber-400">(not recorded)</span>}</th>
      <td className="text-right font-mono py-1">{qty(l.quantity)}</td>
      <td className="text-right font-mono py-1">{formatCurrency(l.valueCents, currency)}</td>
    </tr>
  ))}</>;
}

function ItemFlow({ row, currency }: { row: ItemSourcesUses; currency: string }) {
  const head = (text: string) => <tr><th scope="rowgroup" colSpan={3} className="text-left text-xs font-semibold text-[var(--muted)] pt-2">{text}</th></tr>;
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3" data-testid="stock-flow">
      <table className="w-full text-sm">
        <caption className="text-left font-semibold text-[var(--text)] pb-1"><bdi>{row.itemName}</bdi></caption>
        <thead>
          <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
            <th scope="col" className="text-left font-semibold py-1">Line</th>
            <th scope="col" className="text-right font-semibold py-1">Units</th>
            <th scope="col" className="text-right font-semibold py-1">Value</th>
          </tr>
        </thead>
        <tbody>
          <tr><th scope="row" className="text-left font-normal py-1">Opening</th><td className="text-right font-mono py-1">{qty(row.opening.quantity)}</td><td className="text-right font-mono py-1">{formatCurrency(row.opening.valueCents, currency)}</td></tr>
          {row.sources.length > 0 && head('Came from')}
          <FlowRows lines={row.sources} currency={currency} />
          {row.uses.length > 0 && head('Went to')}
          <FlowRows lines={row.uses} currency={currency} />
          {row.costChanges.moves > 0 && <tr><th scope="row" className="text-left font-normal py-1">Cost changes (no units)</th><td className="text-right font-mono py-1">0</td><td className="text-right font-mono py-1">{formatCurrency(row.costChanges.valueCents, currency)}</td></tr>}
          {row.transfers.moves > 0 && <tr className="text-[var(--muted)]"><th scope="row" className="text-left font-normal py-1">Moved between locations ({row.transfers.moves} moves, not counted twice)</th><td className="text-right font-mono py-1">{qty(row.transfers.net)}</td><td /></tr>}
        </tbody>
        <tfoot>
          <tr className="font-semibold"><th scope="row" className="text-left py-1">Closing</th><td className="text-right font-mono py-1">{qty(row.closing.quantity)}</td><td className="text-right font-mono py-1">{formatCurrency(row.closing.valueCents, currency)}</td></tr>
        </tfoot>
      </table>
      {row.differenceUnits !== 0
        ? <p role="alert" className="mt-1 text-xs text-rose-600">These do not add up: {qty(row.differenceUnits)} units are not explained by the stock history.</p>
        : <p className="mt-1 text-xs text-[var(--muted)]">Opening + came from − went to = closing.</p>}
      {row.unknownUnits > 0 && <p className="text-xs text-amber-700 dark:text-amber-400">{qty(row.unknownUnits)} units have no vendor, customer or reason recorded.</p>}
    </div>
  );
}
