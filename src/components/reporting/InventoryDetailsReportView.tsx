import { isItemDetails } from '../../lib/reportListRows';
import ReportSchedule from './ReportSchedule';
import { useReportDates } from './useReportDates';
import { useReportList } from '../../hooks/useReportList';
import { useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useUIStore } from '../../stores/useUIStore';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { purchasesByItem } from '../../lib/stockMoves';
import { stockMovementText } from './stockMovementText';
import ReportEmptyState from './ReportEmptyState';
import { useReportText } from './useReportText';
import { LoadingState } from '../ui/LoadingState';

const field = 'min-h-11 px-2 py-1.5 border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]';
const qty = (n: number) => String(Math.round(n * 1e6) / 1e6);

/**
 * Inventory item details (J-10): for a period, each item's opening quantity and value, every movement
 * (sold, bought, returned, adjusted, counted, moved) with its entry, what came in and went out, and
 * the closing quantity and value. Read by the server from the stock-moves ledger, the same history
 * as Stock history on Inventory (src/lib/stockMoves.ts `itemDetails`). Above them, what was bought of
 * each item in the period (J-08: on bills or on Inventory), with its cost per unit.
 */
export default function InventoryDetailsReportView() {
  const reportText = useReportText();
  const dates = useReportDates();
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const openRecord = useUIStore(s => s.openRecord);
  const [startDate, setStartDate] = useState(`${getLocalDateISO().slice(0, 7)}-01`);
  const [endDate, setEndDate] = useState(getLocalDateISO());
  const currency = workspace?.currency || 'USD';
  const key = workspace && startDate && endDate && startDate <= endDate ? new URLSearchParams({ workspaceId: workspace.id, startDate, endDate }).toString() : '';

  const { rows: items, loading, failed, error, retry } = useReportList(
    key ? `/api/v1/reports/inventory-details?${key}` : null, 'items', isItemDetails);

  const purchases = purchasesByItem(items || []);
  return (
    <section aria-labelledby="inventory-details-title" className="space-y-4">
      <h2 id="inventory-details-title" className="text-lg font-bold text-[var(--text)]">{reportText('r.inventory-item-details', 'Inventory item details')}</h2>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1 text-[var(--muted)]">{reportText('r.from', 'From')}<input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={field} /></label>
        <label className="flex flex-col gap-1 text-[var(--muted)]">{reportText('r.to', 'To')}<input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={field} /></label>
      </div>
      {startDate > endDate && <p role="status" className="text-xs text-amber-700 dark:text-amber-400">{reportText('r.the-period-starts-after-it-ends', 'The period starts after it ends.')}</p>}
      {loading && <LoadingState label={reportText('r.loading', 'Loading…')} rows={3} />}
      {failed && <div>
        <p role="alert">{reportText('r.the-stock-history-could-not-be-read', 'The stock history could not be read:')} {error || reportText('r.missing-report-rows', 'The response did not contain report rows.')}</p>
        <button type="button" className="min-h-11 rounded border px-3" onClick={retry}>{reportText('r.retry', 'Retry')}</button>
      </div>}
      {items && items.length === 0 && <ReportEmptyState
        title={reportText('r.no-stock-and-no-movements-in-this-period', 'No stock and no movements in this period.')}
        description={reportText('r.choose-another-period-or-receive-stock-in-inventor', 'Choose another period, or receive stock in Inventory; every movement of the period is listed here.')}
      />}
      {purchases.length > 0 && <ReportSchedule rows={purchases} rowKey={p => p.itemId}
        caption={reportText('r.bought-in-the-period', 'Bought in the period')}
        columns={[
          { header: reportText('r.item', 'Item'), cell: p => <bdi>{p.itemName}</bdi> },
          { header: reportText('r.units', 'Units'), align: 'right', cell: p => qty(p.quantity) },
          { header: reportText('r.cost', 'Cost'), align: 'right', cell: p => formatCurrency(p.valueCents, currency) },
          { header: reportText('r.per-unit-2', 'Per unit'), align: 'right', cell: p => formatCurrency(p.averageCents, currency) },
        ]} />}
      {items?.map(item => <ReportSchedule key={item.itemId} rows={item.moves} rowKey={m => m.key} caption={<bdi>{item.itemName}</bdi>}
        bodyStart={<tr className="text-[var(--muted)]">
          <th scope="row" colSpan={3}>{reportText('r.opening-2', 'Opening')}</th>
          <td className="text-right">{qty(item.opening.quantity)}</td><td className="text-right">{formatCurrency(item.opening.valueCents, currency)}</td>
        </tr>}
        columns={[
          { header: reportText('r.date-2', 'Date'), cell: m => <time dateTime={m.date} className="whitespace-nowrap">{dates.dateText(m.date)}</time> },
          { header: reportText('r.movement', 'Movement'), rowHeader: true, cell: m => m.transactionId ? (
            <button type="button" className="min-h-11 underline text-start" onClick={() => openRecord({ type: 'transaction', id: String(m.transactionId) })}>
              {stockMovementText(reportText, m.kind)}<span className="sr-only"> {reportText('r.on-2', 'on')} {dates.dateText(m.date)}{reportText('r.open-its-entry', ': open its entry')}</span>
            </button>) : stockMovementText(reportText, m.kind) },
          { header: reportText('r.quantity', 'Quantity'), align: 'right', cell: m => `${m.quantity > 0 ? '+' : ''}${qty(m.quantity)}` },
          { header: reportText('r.on-hand-after', 'On hand after'), align: 'right', cell: m => qty(m.quantityAfter) },
          { header: reportText('r.value', 'Value'), align: 'right', cell: m => formatCurrency(m.valueCents, currency) },
        ]}
        footer={<tr><th colSpan={3} scope="row">{reportText('r.closing', 'Closing')} <span className="font-normal text-xs">{reportText('r.in-3', '(in')} {qty(item.received)}{reportText('r.out-2', ', out')} {qty(item.issued)})</span></th>
          <td>{qty(item.closing.quantity)}</td><td>{formatCurrency(item.closing.valueCents, currency)}</td>
        </tr>} />)}
    </section>
  );
}
