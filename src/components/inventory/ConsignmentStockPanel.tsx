/**
 * A-34 (BF-05): the consignment stock report on Inventory — what sits here but a supplier's, and
 * what is ours but elsewhere, at the item's own cost. Read-only: consignment never posts, so there
 * is no action on this panel but the CSV.
 */
import { useMemo } from 'react';
import { downloadCsv } from '../../lib/csvExport';
import { formatCurrency } from '../../lib/utils';
import { CONSIGNMENT_CSV_HEADERS, consignmentCsvRows, consignmentRows, consignmentSummary, type ConsignmentItem } from '../../lib/consignmentStock';

export default function ConsignmentStockPanel({ items, currency }: { items: ConsignmentItem[]; currency: string }) {
  const rows = useMemo(() => consignmentRows(items), [items]);
  const summary = useMemo(() => consignmentSummary(items), [items]);
  if (!rows.length) return null;
  const money = (cents: number) => formatCurrency(cents, currency);

  return (
    <section aria-labelledby="consignment-heading" className="bg-[var(--surface)] rounded-[40px] border border-[var(--line)] p-6 shadow-sm space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="consignment-heading" className="text-lg font-black text-[var(--text)]">Consignment stock</h2>
          <p className="text-xs text-[var(--muted)] font-medium mt-1">
            What is here but a supplier&rsquo;s ({summary.heldCount} items, {money(summary.heldFromSupplierCents)}),
            and what is ours but elsewhere ({summary.atCount} items, {money(summary.atCustomerCents)}), at the item&rsquo;s cost.
            Nothing here is posted to the ledger.
          </p>
        </div>
        <button type="button"
          onClick={() => downloadCsv('consignment-stock.csv', CONSIGNMENT_CSV_HEADERS, consignmentCsvRows(items))}
          className="px-4 py-3 rounded-2xl border border-[var(--line)] text-xs font-black uppercase tracking-widest text-[var(--text)]">
          Download CSV
        </button>
      </div>
      <div className="overflow-x-auto" role="region" aria-label="Consignment stock rows" tabIndex={0}>{/* NOSONAR: S6845 — tabIndex on scrollable region is the intentional axe scrollable-region-focusable pattern */}
        <table className="w-full text-left border-collapse">
          <caption className="sr-only">Consignment stock: item, direction, quantity and value at cost</caption>
          <thead>
            <tr className="border-b border-[var(--line)]">
              <th scope="col" className="px-4 py-3 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Item</th>
              <th scope="col" className="px-4 py-3 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Direction</th>
              <th scope="col" className="px-4 py-3 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-right">Quantity</th>
              <th scope="col" className="px-4 py-3 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-right">Unit cost</th>
              <th scope="col" className="px-4 py-3 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-right">Value at cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.map(row => (
              <tr key={row.id}>
                <td className="px-4 py-3 text-sm font-semibold text-[var(--text)]">{row.name}{row.sku ? <span className="text-[var(--muted)] font-mono text-xs"> · {row.sku}</span> : null}</td>
                <td className="px-4 py-3 text-xs font-semibold text-[var(--muted)]">{row.directionLabel}</td>
                <td className="px-4 py-3 text-sm text-right tabular-nums">{row.quantity}{row.measurementUnit ? ` ${row.measurementUnit}` : ''}</td>
                <td className="px-4 py-3 text-sm text-right tabular-nums">{money(row.unitCostCents)}</td>
                <td className="px-4 py-3 text-sm text-right tabular-nums font-bold">{money(row.valueCents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-[var(--line)]">
              <th scope="row" colSpan={4} className="px-4 py-3 text-right text-xs font-black uppercase tracking-widest text-[var(--muted)]">Total at cost</th>
              <td className="px-4 py-3 text-sm text-right tabular-nums font-black">{money(summary.totalCents)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
