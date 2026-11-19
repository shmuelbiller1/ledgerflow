import React from 'react';
import { Package } from 'lucide-react';
import { formatCurrency, cn } from '../../lib/utils';
import { yearRange } from '../../server/reports/itemReports';
import { useServerSalesByItem } from '../../hooks/useServerSalesByItem';
import ReportSkeleton from './ReportSkeleton';
import { ScreenDataNotice } from '../ui/ScreenDataNotice';
import { useReportText } from './useReportText';

interface Props {
  selectedYear?: number;
  startDate?: string;
  endDate?: string;
}

const pct = (value: number | null) => (value === null ? '—' : `${value.toFixed(1)}%`);

export const SalesByItemReportView: React.FC<Props> = ({ selectedYear, startDate, endDate }) => {
  const reportText = useReportText();
  const title = reportText('r.sales-by-item-profit-margin', 'Sales by Item & Profit Margin');

  const { startDate: from, endDate: to } = startDate || endDate ? { startDate, endDate } : yearRange(selectedYear);
  // L-123 step 4b: the whole report from the server when the loaded invoices or entries are capped
  const { report, source, failed, retryFull } = useServerSalesByItem(from, to);
  const retry = retryFull && <button type="button" onClick={retryFull} className="mt-2 min-h-11 rounded border border-[var(--line)] px-3 text-sm">
    {reportText('r.retry-full-report', 'Retry full report')}
  </button>;
  if (!report || (source === 'loaded-incomplete' && !report.rows.length)) {
    return <section id="sales-by-item-report" className="mx-auto max-w-6xl space-y-3 p-4 text-[var(--text)] sm:p-6">
      <h2 className="text-lg font-bold">{title}</h2>
      {failed ? <ScreenDataNotice failedKeys={failed.failedKeys} message={failed.message} onRetry={failed.retry} />
        : !report ? <ReportSkeleton rows={3} label={reportText('r.loading-report-records', 'Loading report records…')} />
        : <p role="status">{reportText('r.no-matches-in-subset', 'No matching records were loaded. This report is incomplete; the full period may contain activity.')}</p>}
      {retry}
    </section>;
  }
  const { rows, totals } = report;
  return (
    <div className="space-y-6 max-w-6xl mx-auto p-4 sm:p-6 text-[var(--text)]" id="sales-by-item-report">
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-[var(--line)] pb-4 gap-4">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Package className="w-5 h-5 text-[var(--brass)]" />
            {title}
          </h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            {reportText('r.items-sold-on-issued-invoices-in-your-base-curre', 'Items sold on issued invoices, in your base currency, with cost of goods sold and margin.')}
          </p>
          {source === 'server' && <p className="text-xs text-[var(--muted)] mt-1" data-testid="sales-by-item-source">{reportText('r.every-invoice-in-this-period-read-from-the-serve', 'Every invoice in this period, read from the server.')}</p>}
          {source === 'loaded-incomplete' && <p role="status" className="text-xs text-amber-700 dark:text-amber-300 mt-1" data-testid="sales-by-item-source">{reportText('r.only-the-invoices-loaded-in-this-browser-some-sa', 'Only the invoices loaded in this browser: some sales or posted costs may be missing.')}</p>}
          {retry}
        </div>
        <div className="flex items-center gap-6 bg-[var(--panel)] p-3 rounded-xl border border-[var(--line)]">
          <div>
            <div className="text-[10px] text-[var(--muted)] uppercase font-bold">{reportText('r.sales', 'Sales')}</div>
            <div className="text-sm font-mono font-bold text-[var(--pos)]">{formatCurrency(totals.salesCents)}</div>
          </div>
          <div>
            <div className="text-[10px] text-[var(--muted)] uppercase font-bold">{reportText('r.gross-profit', 'Gross profit')}</div>
            <div className="text-sm font-mono font-bold">{formatCurrency(totals.marginCents)}</div>
          </div>
          <div>
            <div className="text-[10px] text-[var(--muted)] uppercase font-bold">{reportText('r.margin-2', 'Margin')}</div>
            <div className="text-sm font-mono font-bold">{pct(totals.marginPct)}</div>
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-12 bg-[var(--panel)] rounded-lg border border-[var(--line)] text-[var(--muted)] text-xs">
          {reportText('r.no-invoice-lines-found-for-the-selected-period', 'No invoice lines found for the selected period.')}
        </div>
      ) : (
        <div className="bg-[var(--panel)] rounded-lg border border-[var(--line)] overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">{reportText('r.sales-by-item', 'Sales by item')}</caption>
            <thead className="bg-[var(--surface)] border-b border-[var(--line)] text-[var(--muted)] font-semibold uppercase tracking-wider">
              <tr>
                <th scope="col" className="py-3 px-4">{reportText('r.item-sku', 'Item / SKU')}</th>
                <th scope="col" className="py-3 px-4 text-right">{reportText('r.qty-sold', 'Qty sold')}</th>
                <th scope="col" className="py-3 px-4 text-right">{reportText('r.sales', 'Sales')}</th>
                <th scope="col" className="py-3 px-4 text-right">{reportText('r.cost', 'Cost')}</th>
                <th scope="col" className="py-3 px-4 text-right">{reportText('r.gross-profit', 'Gross profit')}</th>
                <th scope="col" className="py-3 px-4 text-right">{reportText('r.margin-2', 'Margin')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {rows.map(row => (
                <tr key={row.key}>
                  <td className="py-3 px-4">
                    <div className={cn('font-semibold', !row.itemId && 'italic text-[var(--muted)]')}>{row.name}</div>
                    {row.sku && <div className="text-[10px] text-[var(--muted)] font-mono">{reportText('r.sku', 'SKU:')} {row.sku}</div>}
                  </td>
                  <td className="py-3 px-4 text-right font-mono">{row.quantity}</td>
                  <td className="py-3 px-4 text-right font-mono font-semibold text-[var(--pos)]">{formatCurrency(row.salesCents)}</td>
                  <td className="py-3 px-4 text-right font-mono">
                    {formatCurrency(row.costCents)}
                    {row.costIsEstimate && <span className="ml-1 text-[10px] text-[var(--muted)]" title={reportText('r.cost-of-goods-sold-not-posted-yet-quantity-unit', 'Cost of goods sold not posted yet: quantity × unit cost')}>{reportText('r.est', '(est.)')}</span>}
                  </td>
                  <td className={cn('py-3 px-4 text-right font-mono font-semibold', row.marginCents < 0 && 'text-[var(--neg)]')}>{formatCurrency(row.marginCents)}</td>
                  <td className="py-3 px-4 text-right font-mono font-bold">{pct(row.marginPct)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-[var(--line)] font-bold">
              <tr>
                <th scope="row" className="py-3 px-4 text-left">{reportText('r.total', 'Total')}</th>
                <td className="py-3 px-4 text-right font-mono">{totals.quantity}</td>
                <td className="py-3 px-4 text-right font-mono text-[var(--pos)]">{formatCurrency(totals.salesCents)}</td>
                <td className="py-3 px-4 text-right font-mono">
                  {formatCurrency(totals.costCents)}
                  {totals.costIsEstimate && <span className="ml-1 text-[10px] text-[var(--muted)]">{reportText('r.est', '(est.)')}</span>}
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
          {reportText('r.est-no-cost-of-goods-sold-posted-yet-for-some-of', '(est.) = no cost of goods sold posted yet for some of these sales, so cost is quantity × the item\'s unit cost.')}
        </p>
      )}
    </div>
  );
};

export default SalesByItemReportView;
