import ReportSchedule from './ReportSchedule';
import React from 'react';
import { Package } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';
import { yearRange } from '../../server/reports/itemReports';
import { useServerSalesByItem } from '../../hooks/useServerSalesByItem';
import ReportSkeleton from './ReportSkeleton';
import { ScreenDataNotice } from '../ui/ScreenDataNotice';
import { useReportText } from './useReportText';
import { useBookCurrency } from '../../hooks/useBookCurrency';
import ReportEmptyState from './ReportEmptyState';

interface Props {
  selectedYear?: number;
  startDate?: string;
  endDate?: string;
}

const pct = (value: number | null) => (value === null ? '—' : `${value.toFixed(1)}%`);

export const SalesByItemReportView: React.FC<Props> = ({ selectedYear, startDate, endDate }) => {
  const reportText = useReportText();
  // R-11 / #926: sales, cost and margin are in the book currency; the amounts follow it, not a default
  const bookCurrency = useBookCurrency();
  const money = (cents: number) => formatCurrency(cents, bookCurrency);
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
        : <ReportEmptyState
            title={reportText('r.no-matches-in-subset', 'No matching records were loaded. This report is incomplete; the full period may contain activity.')}
            description={reportText('r.retry-the-full-report-above-before-concluding-that', 'Retry the full report above before concluding that nothing was sold in the period.')}
          />}
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
          {source === 'refreshing' && <p role="status" className="text-xs text-[var(--muted)] mt-1" data-testid="sales-by-item-source">{reportText('r.updating-item-sales', 'Updating this period. Figures shown are from the previous full report.')}</p>}
          {source === 'server' && <p className="text-xs text-[var(--muted)] mt-1" data-testid="sales-by-item-source">{reportText('r.every-invoice-in-this-period-read-from-the-serve', 'Every invoice in this period, read from the server.')}</p>}
          {source === 'loaded-incomplete' && <p role="status" className="text-xs text-amber-700 dark:text-amber-300 mt-1" data-testid="sales-by-item-source">{reportText('r.only-the-invoices-loaded-in-this-browser-some-sa', 'Only the invoices loaded in this browser: some sales or posted costs may be missing.')}</p>}
          {retry}
        </div>
        <div className="flex flex-wrap items-center gap-4 bg-[var(--panel)] p-3 rounded-xl border border-[var(--line)]">
          <div>
            <div className="text-[10px] text-[var(--muted)] uppercase font-bold">{reportText('r.sales', 'Sales')}</div>
            <div className="text-sm font-mono font-bold text-[var(--pos)]">{money(totals.salesCents)}</div>
          </div>
          <div>
            <div className="text-[10px] text-[var(--muted)] uppercase font-bold">{reportText('r.gross-profit', 'Gross profit')}</div>
            <div className="text-sm font-mono font-bold">{money(totals.marginCents)}</div>
          </div>
          <div>
            <div className="text-[10px] text-[var(--muted)] uppercase font-bold">{reportText('r.margin-2', 'Margin')}</div>
            <div className="text-sm font-mono font-bold">{pct(totals.marginPct)}</div>
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-12 bg-[var(--panel)] rounded-lg border border-[var(--line)] text-[var(--muted)] text-xs">
          <ReportEmptyState
            title={reportText('r.no-invoice-lines-found-for-the-selected-period', 'No invoice lines found for the selected period.')}
            description={source === 'server'
              ? reportText('r.every-invoice-in-this-period-was-read-and-none-ca', 'Every invoice in this period was read and none carries an item line. Choose another period, or sell an item on an invoice.')
              : reportText('r.check-the-period-or-issue-an-invoice-with-an-item-line', 'Check the period, or issue an invoice with an item line; this list is read from issued invoices.')}
          />
        </div>
      ) : (
        <ReportSchedule rows={rows} rowKey={row => row.key} caption={reportText('r.sales-by-item', 'Sales by item')}
          columns={[
            { header: reportText('r.item-sku', 'Item / SKU'), cell: row => <><bdi>{row.itemId ? row.name : reportText('r.no-item', 'No item')}</bdi>
              {row.sku && <div className="text-xs text-[var(--muted)]">{reportText('r.sku', 'SKU:')} <bdi>{row.sku}</bdi></div>}</> },
            { header: reportText('r.qty-sold', 'Qty sold'), align: 'right', cell: row => row.quantity },
            { header: reportText('r.sales', 'Sales'), align: 'right', cell: row => money(row.salesCents) },
            { header: reportText('r.cost', 'Cost'), align: 'right', cell: row => <>{money(row.costCents)}{row.costIsEstimate && <> <span title={reportText('r.cost-of-goods-sold-not-posted-yet-quantity-unit', 'Cost of goods sold not posted yet: quantity × unit cost')}>{reportText('r.est', '(est.)')}</span></>}</> },
            { header: reportText('r.gross-profit', 'Gross profit'), align: 'right', cell: row => <span className={row.marginCents < 0 ? 'text-[var(--neg)]' : undefined}>{money(row.marginCents)}</span> },
            { header: reportText('r.margin-2', 'Margin'), align: 'right', cell: row => pct(row.marginPct) },
          ]}
          footer={<tr>
            <th scope="row">{reportText('r.total', 'Total')}</th><td>{totals.quantity}</td><td>{money(totals.salesCents)}</td>
            <td>{money(totals.costCents)}{totals.costIsEstimate && <> {reportText('r.est', '(est.)')}</>}</td>
            <td>{money(totals.marginCents)}</td><td>{pct(totals.marginPct)}</td>
          </tr>} />
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
