/**
 * A-268: Standard cost variance report screen. Reports → Inventory → "Standard cost variance".
 *
 * Reads inventory items and compares each item's actual unit cost (`unitCostCents`, the moving
 * weighted average) against its planned `standardCostCents`. Shows per-unit variance, percentage,
 * and variance on stock on hand, plus a notice linking to Inventory for items without a standard cost.
 * Read-only: nothing is recorded or posted here.
 */
import React, { useMemo } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useUIStore } from '../../stores/useUIStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { downloadCsv } from '../../lib/csvExport';
import { paymentMethodCsvAmount as csvAmount } from '../../lib/paymentMethodCsvAmount';
import { formatCurrency } from '../../lib/utils';
import { formatVariancePct, standardCostReport } from '../../lib/standardCost';
import type { InventoryItem } from '../../types';
import ReportSchedule from './ReportSchedule';
import ReportEmptyState from './ReportEmptyState';
import { useReportText, fill } from './useReportText';

const CSV_HEADERS = [
  'Item',
  'SKU',
  'On hand',
  'Standard cost',
  'Actual cost',
  'Variance / unit',
  'Variance %',
  'Variance on hand',
];

export default function StandardCostReportView() {
  const reportText = useReportText();
  const inventory = useLedgerStore(s => s.inventory) as InventoryItem[];
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const currency = useAuthStore(s => s.workspaces?.find(w => w.id === s.currentWorkspaceId)?.currency || 'USD');
  const truncated = useLedgerStore(s => s.truncatedCollections);
  const failed = useDataNeedsStore(s => s.failed);
  const setActiveTab = useUIStore(s => s.setActiveTab);
  const { loading } = useLedgerCollections('inventory');

  const scopedItems = useMemo(
    () => (inventory || []).filter(i => !workspaceId || !i.workspaceId || i.workspaceId === workspaceId),
    [inventory, workspaceId],
  );

  const report = useMemo(() => standardCostReport(scopedItems), [scopedItems]);
  const partial = Boolean(truncated.inventory || failed.inventory);

  return (
    <section aria-label={reportText('r.standard-cost-variance', 'Standard cost variance')} className="p-4 space-y-4 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2>{reportText('r.standard-cost-variance', 'Standard cost variance')}</h2>
          <p className="text-sm text-[var(--muted)]">
            {reportText('r.compares-each-stock-item-s-moving-weighted-avera', 'Compares each stock item’s moving weighted average cost against its planned standard cost. A positive variance means the stock cost more than planned (unfavourable). This screen is read-only.')}
          </p>
        </div>
        {report.rows.length > 0 && (
          <button
            type="button"
            data-print-hide
            disabled={loading || partial}
            title={loading || partial ? reportText('r.wait-until-every-item-is-loaded-a-partial-list-i', 'Wait until every item is loaded; a partial list is not exported.') : undefined}
            onClick={() =>
              downloadCsv(
                'standard-cost-variance',
                CSV_HEADERS,
                report.rows.map(r => {
                  const item = scopedItems.find(i => i.id === r.itemId);
                  return [
                    r.itemName,
                    item?.sku || '',
                    r.quantity,
                    csvAmount(r.standardCostCents, currency),
                    csvAmount(r.actualUnitCostCents, currency),
                    csvAmount(r.varianceUnitCents, currency),
                    formatVariancePct(r.variancePct),
                    csvAmount(r.varianceValueCents, currency),
                  ];
                }),
              )
            }
            className="min-h-11 px-3 py-1.5 rounded border border-[var(--line)] bg-[var(--surface)] text-[var(--text)] text-sm disabled:opacity-50"
          >
            {reportText('r.download-csv', 'Download CSV')}
          </button>
        )}
      </div>

      {loading && <p role="status" className="text-sm text-[var(--muted)]">{reportText('r.loading-items', 'Loading items…')}</p>}
      {partial && (
        <p role="alert" className="text-sm text-amber-700 dark:text-amber-400">
          {reportText('r.items-are-only-partly-loaded-items-outside-the-l', 'Items are only partly loaded; items outside the loaded list are not shown.')}
        </p>
      )}

      {report.withoutStandard > 0 && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm rounded border border-[var(--line)] bg-[var(--panel)] text-[var(--text)]"
        >
          <span>
            {report.withoutStandard === 1 ? reportText('r.one-item-no-standard-cost', '1 item has no standard cost.') : fill(reportText('r.n-items-no-standard-cost', '{n} items have no standard cost.'), { n: report.withoutStandard })}
          </span>
          <button
            type="button"
            onClick={() => setActiveTab('inventory')}
            className="min-h-11 px-3 py-1 text-xs font-semibold rounded border border-[var(--brass)] text-[var(--brass)] hover:bg-[var(--brass)]/10"
          >
            {reportText('r.go-to-inventory', 'Go to Inventory')}
          </button>
        </div>
      )}

      {!loading && report.rows.length === 0 ? (
        <ReportEmptyState
          title={scopedItems.length === 0 ? reportText('r.no-inventory-items-found', 'No inventory items found') : reportText('r.no-items-with-a-standard-cost-found', 'No items with a standard cost found')}
          description={
            scopedItems.length === 0
              ? reportText('r.add-items-to-your-inventory-to-track-standard-co', 'Add items to your inventory to track standard costs.')
              : reportText('r.set-a-standard-cost-on-your-items-in-inventory-t', 'Set a standard cost on your items in Inventory to see variances.')
          }
          actionLabel={reportText('r.go-to-inventory', 'Go to Inventory')}
          onAction={() => setActiveTab('inventory')}
        />
      ) : (
        report.rows.length > 0 && (
          <>
            <ReportSchedule
              columnControls
              allowDisplayedExport={!partial && !loading}
              caption={reportText('r.standard-cost-variances-by-stock-item', 'Standard cost variances by stock item')}
              captionClassName="sr-only"
              headRowClassName="border-b border-[var(--line)] text-start text-[var(--muted)]"
              rowClassName="border-b border-[var(--line)]/50 hover:bg-[var(--panel)]/40"
              bodyClassName=""
              rows={report.rows} rowKey={r => r.itemId}
              footer={<tr className="border-t-2 border-[var(--line)] font-semibold">
                    <th scope="row" colSpan={6} className="py-2.5 pe-3 text-start">
                      {reportText('r.total-variance-on-hand', 'Total variance on hand')}
                    </th>
                    <td className="py-2.5 text-right font-mono">
                      <span className={report.totalVarianceCents > 0 ? 'text-[var(--neg,#ef4444)]' : report.totalVarianceCents < 0 ? 'text-[var(--pos,#22c55e)]' : ''}>
                        {formatCurrency(report.totalVarianceCents, currency)}
                      </span>
                    </td>
                  </tr>}
              columns={[
                { header: reportText('r.item', 'Item'), cell: r => { const item = scopedItems.find(i => i.id === r.itemId); return <><span>{r.itemName}</span>
                          {item?.sku && <span className="ms-2 font-mono text-xs text-[var(--muted)]">{item.sku}</span>}</>; } },
                { header: reportText('r.on-hand', 'On hand'), align: 'right', className: 'font-mono', cell: r => r.quantity },
                { header: reportText('r.standard-cost', 'Standard cost'), align: 'right', className: 'font-mono', cell: r => formatCurrency(r.standardCostCents, currency) },
                { header: reportText('r.actual-cost', 'Actual cost'), align: 'right', className: 'font-mono', cell: r => formatCurrency(r.actualUnitCostCents, currency) },
                { header: reportText('r.variance-unit', 'Variance / unit'), align: 'right', className: 'font-mono', cell: r => <span className={r.varianceUnitCents > 0 ? 'text-[var(--neg,#ef4444)]' : r.varianceUnitCents < 0 ? 'text-[var(--pos,#22c55e)]' : ''}>
                            {formatCurrency(r.varianceUnitCents, currency)}
                          </span> },
                { header: reportText('r.variance-3', 'Variance %'), align: 'right', className: 'font-mono', cell: r => <span className={r.variancePct !== null && r.variancePct > 0 ? 'text-[var(--neg,#ef4444)]' : r.variancePct !== null && r.variancePct < 0 ? 'text-[var(--pos,#22c55e)]' : ''}>
                            {formatVariancePct(r.variancePct)}
                          </span> },
                { header: reportText('r.variance-on-hand', 'Variance on hand'), align: 'right', className: 'font-mono font-medium', cell: r => <span className={r.varianceValueCents > 0 ? 'text-[var(--neg,#ef4444)]' : r.varianceValueCents < 0 ? 'text-[var(--pos,#22c55e)]' : ''}>
                            {formatCurrency(r.varianceValueCents, currency)}
                          </span> },
              ]} />
            <p className="text-xs text-[var(--muted)]">
              {reportText('r.variance-on-hand-is-based-on-stock-on-hand-multi', 'Variance on hand is based on stock on hand multiplied by unit variance (actual − standard). Negative stock counts as 0 on hand. Standard costing does not post any entries or change inventory valuation.')}
            </p>
          </>
        )
      )}
    </section>
  );
}
