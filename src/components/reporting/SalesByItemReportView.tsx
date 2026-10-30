import React from 'react';
import { Package } from 'lucide-react';
import { formatCurrency, cn } from '../../lib/utils';
import { yearRange } from '../../server/reports/itemReports';
import { useServerSalesByItem } from '../../hooks/useServerSalesByItem';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';

interface Props {
  selectedYear?: number;
  startDate?: string;
  endDate?: string;
}

const pct = (value: number | null) => (value === null ? '—' : `${value.toFixed(1)}%`);

export const SalesByItemReportView: React.FC<Props> = ({ selectedYear, startDate, endDate }) => {
  useLedgerCollections('inventory', 'invoices');

  const { startDate: from, endDate: to } = startDate || endDate ? { startDate, endDate } : yearRange(selectedYear);
  // L-123 step 4b: the whole report from the server when the loaded invoices or entries are capped
  const { rows, totals, source } = useServerSalesByItem(from, to);

  return (
    <div className="space-y-6 max-w-6xl mx-auto p-4 sm:p-6 text-[var(--text)]" id="sales-by-item-report">
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-[var(--line)] pb-4 gap-4">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Package className="w-5 h-5 text-[var(--brass)]" />
            Sales by Item & Profit Margin
          </h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            Items sold on issued invoices, in your base currency, with cost of goods sold and margin.
          </p>
          {source === 'server' && <p className="text-xs text-[var(--muted)] mt-1" data-testid="sales-by-item-source">Every invoice in this period, read from the server.</p>}
          {source === 'loaded-incomplete' && <p role="status" className="text-xs text-amber-700 mt-1" data-testid="sales-by-item-source">Only the invoices loaded in this browser: some sales or posted costs may be missing.</p>}
        </div>
        <div className="flex items-center gap-6 bg-[var(--panel)] p-3 rounded-xl border border-[var(--line)]">
          <div>
            <div className="text-[10px] text-[var(--muted)] uppercase font-bold">Sales</div>
            <div className="text-sm font-mono font-bold text-[var(--pos)]">{formatCurrency(totals.salesCents)}</div>
          </div>
          <div>
            <div className="text-[10px] text-[var(--muted)] uppercase font-bold">Gross profit</div>
            <div className="text-sm font-mono font-bold">{formatCurrency(totals.marginCents)}</div>
          </div>
          <div>
            <div className="text-[10px] text-[var(--muted)] uppercase font-bold">Margin</div>
            <div className="text-sm font-mono font-bold">{pct(totals.marginPct)}</div>
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-12 bg-[var(--panel)] rounded-lg border border-[var(--line)] text-[var(--muted)] text-xs">
          No invoice lines found for the selected period.
        </div>
      ) : (
        <div className="bg-[var(--panel)] rounded-lg border border-[var(--line)] overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Sales by item</caption>
            <thead className="bg-[var(--surface)] border-b border-[var(--line)] text-[var(--muted)] font-semibold uppercase tracking-wider">
              <tr>
                <th scope="col" className="py-3 px-4">Item / SKU</th>
                <th scope="col" className="py-3 px-4 text-right">Qty sold</th>
                <th scope="col" className="py-3 px-4 text-right">Sales</th>
                <th scope="col" className="py-3 px-4 text-right">Cost</th>
                <th scope="col" className="py-3 px-4 text-right">Gross profit</th>
                <th scope="col" className="py-3 px-4 text-right">Margin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {rows.map(row => (
                <tr key={row.key}>
                  <td className="py-3 px-4">
                    <div className={cn('font-semibold', !row.itemId && 'italic text-[var(--muted)]')}>{row.name}</div>
                    {row.sku && <div className="text-[10px] text-[var(--muted)] font-mono">SKU: {row.sku}</div>}
                  </td>
                  <td className="py-3 px-4 text-right font-mono">{row.quantity}</td>
                  <td className="py-3 px-4 text-right font-mono font-semibold text-[var(--pos)]">{formatCurrency(row.salesCents)}</td>
                  <td className="py-3 px-4 text-right font-mono">
                    {formatCurrency(row.costCents)}
                    {row.costIsEstimate && <span className="ml-1 text-[10px] text-[var(--muted)]" title="Cost of goods sold not posted yet: quantity × unit cost">(est.)</span>}
                  </td>
                  <td className={cn('py-3 px-4 text-right font-mono font-semibold', row.marginCents < 0 && 'text-[var(--neg)]')}>{formatCurrency(row.marginCents)}</td>
                  <td className="py-3 px-4 text-right font-mono font-bold">{pct(row.marginPct)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-[var(--line)] font-bold">
              <tr>
                <th scope="row" className="py-3 px-4 text-left">Total</th>
                <td className="py-3 px-4 text-right font-mono">{totals.quantity}</td>
                <td className="py-3 px-4 text-right font-mono text-[var(--pos)]">{formatCurrency(totals.salesCents)}</td>
                <td className="py-3 px-4 text-right font-mono">
                  {formatCurrency(totals.costCents)}
                  {totals.costIsEstimate && <span className="ml-1 text-[10px] text-[var(--muted)]">(est.)</span>}
                </td>
                <td className="py-3 px-4 text-right font-mono">{formatCurrency(totals.marginCents)}</td>
                <td className="py-3 px-4 text-right font-mono">{pct(totals.marginPct)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {totals.costIsEstimate && (
        <p className="text-[11px] text-[var(--muted)]">
          (est.) = no cost of goods sold posted yet for some of these sales, so cost is quantity × the item's unit cost.
        </p>
      )}
    </div>
  );
};

export default SalesByItemReportView;
