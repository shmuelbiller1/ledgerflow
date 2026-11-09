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
import { csvMoney, downloadCsv } from '../../lib/csvExport';
import { formatCurrency } from '../../lib/utils';
import { formatVariancePct, standardCostReport } from '../../lib/standardCost';
import type { InventoryItem } from '../../types';
import ReportTableScroll from './ReportTableScroll';
import ReportEmptyState from './ReportEmptyState';

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
    <section aria-label="Standard cost variance" className="p-4 space-y-4 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2>Standard cost variance</h2>
          <p className="text-sm text-[var(--muted)]">
            Compares each stock item’s moving weighted average cost against its planned standard cost.
            A positive variance means the stock cost more than planned (unfavourable). This screen is read-only.
          </p>
        </div>
        {report.rows.length > 0 && (
          <button
            type="button"
            data-print-hide
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
                    csvMoney(r.standardCostCents),
                    csvMoney(r.actualUnitCostCents),
                    csvMoney(r.varianceUnitCents),
                    formatVariancePct(r.variancePct),
                    csvMoney(r.varianceValueCents),
                  ];
                }),
              )
            }
            className="min-h-11 px-3 py-1.5 rounded border border-[var(--line)] bg-[var(--surface)] text-[var(--text)] text-sm disabled:opacity-50"
          >
            Download CSV
          </button>
        )}
      </div>

      {loading && <p role="status" className="text-sm text-[var(--muted)]">Loading items…</p>}
      {partial && (
        <p role="alert" className="text-sm text-amber-700 dark:text-amber-400">
          Items are only partly loaded; items outside the loaded list are not shown.
        </p>
      )}

      {report.withoutStandard > 0 && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm rounded border border-[var(--line)] bg-[var(--panel)] text-[var(--text)]"
        >
          <span>
            {report.withoutStandard} {report.withoutStandard === 1 ? 'item has' : 'items have'} no standard cost.
          </span>
          <button
            type="button"
            onClick={() => setActiveTab('inventory')}
            className="min-h-11 px-3 py-1 text-xs font-semibold rounded border border-[var(--brass)] text-[var(--brass)] hover:bg-[var(--brass)]/10"
          >
            Go to Inventory
          </button>
        </div>
      )}

      {!loading && report.rows.length === 0 ? (
        <ReportEmptyState
          title={scopedItems.length === 0 ? 'No inventory items found' : 'No items with a standard cost found'}
          description={
            scopedItems.length === 0
              ? 'Add items to your inventory to track standard costs.'
              : 'Set a standard cost on your items in Inventory to see variances.'
          }
          actionLabel="Go to Inventory"
          onAction={() => setActiveTab('inventory')}
        />
      ) : (
        report.rows.length > 0 && (
          <>
            <ReportTableScroll>
              <table className="w-full text-sm">
                <caption className="sr-only">Standard cost variances by stock item</caption>
                <thead>
                  <tr className="border-b border-[var(--line)] text-left text-[var(--muted)]">
                    <th scope="col" className="py-2 pr-3">Item</th>
                    <th scope="col" className="py-2 pr-3 text-right">On hand</th>
                    <th scope="col" className="py-2 pr-3 text-right">Standard cost</th>
                    <th scope="col" className="py-2 pr-3 text-right">Actual cost</th>
                    <th scope="col" className="py-2 pr-3 text-right">Variance / unit</th>
                    <th scope="col" className="py-2 pr-3 text-right">Variance %</th>
                    <th scope="col" className="py-2 text-right">Variance on hand</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map(r => {
                    const item = scopedItems.find(i => i.id === r.itemId);
                    return (
                      <tr key={r.itemId} className="border-b border-[var(--line)]/50 hover:bg-[var(--panel)]/40">
                        <th scope="row" className="py-2 pr-3 text-left font-normal">
                          <span>{r.itemName}</span>
                          {item?.sku && <span className="ml-2 font-mono text-xs text-[var(--muted)]">{item.sku}</span>}
                        </th>
                        <td className="py-2 pr-3 text-right font-mono">{r.quantity}</td>
                        <td className="py-2 pr-3 text-right font-mono">{formatCurrency(r.standardCostCents, currency)}</td>
                        <td className="py-2 pr-3 text-right font-mono">{formatCurrency(r.actualUnitCostCents, currency)}</td>
                        <td className="py-2 pr-3 text-right font-mono">
                          <span className={r.varianceUnitCents > 0 ? 'text-[var(--neg,#ef4444)]' : r.varianceUnitCents < 0 ? 'text-[var(--pos,#22c55e)]' : ''}>
                            {formatCurrency(r.varianceUnitCents, currency)}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-right font-mono">
                          <span className={r.variancePct !== null && r.variancePct > 0 ? 'text-[var(--neg,#ef4444)]' : r.variancePct !== null && r.variancePct < 0 ? 'text-[var(--pos,#22c55e)]' : ''}>
                            {formatVariancePct(r.variancePct)}
                          </span>
                        </td>
                        <td className="py-2 text-right font-mono font-medium">
                          <span className={r.varianceValueCents > 0 ? 'text-[var(--neg,#ef4444)]' : r.varianceValueCents < 0 ? 'text-[var(--pos,#22c55e)]' : ''}>
                            {formatCurrency(r.varianceValueCents, currency)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[var(--line)] font-semibold">
                    <th scope="row" colSpan={6} className="py-2.5 pr-3 text-left">
                      Total variance on hand
                    </th>
                    <td className="py-2.5 text-right font-mono">
                      <span className={report.totalVarianceCents > 0 ? 'text-[var(--neg,#ef4444)]' : report.totalVarianceCents < 0 ? 'text-[var(--pos,#22c55e)]' : ''}>
                        {formatCurrency(report.totalVarianceCents, currency)}
                      </span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </ReportTableScroll>
            <p className="text-xs text-[var(--muted)]">
              Variance on hand is based on stock on hand multiplied by unit variance (actual − standard).
              Negative stock counts as 0 on hand. Standard costing does not post any entries or change inventory valuation.
            </p>
          </>
        )
      )}
    </section>
  );
}
