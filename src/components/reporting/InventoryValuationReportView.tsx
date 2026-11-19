import { runCommand } from '../../lib/runCommand';
import React, { useEffect, useMemo, useState } from 'react';
import { Boxes } from 'lucide-react';
import { toast } from 'sonner';
import { usePageSyncedState } from '../../hooks/usePageSyncedState';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useScreenDataHealth } from '../../hooks/useScreenDataHealth';
import { isCollectionCapped } from '../../lib/ledgerCollections';
import { ScreenDataNotice } from '../ui/ScreenDataNotice';
import ReportSkeleton from './ReportSkeleton';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { PartyReportLayout, ColumnDef } from './PartyReportLayout';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { csvMoney, downloadCsv } from '../../lib/csvExport';
import { computeInventoryValuation, InventoryValuationRow } from '../../server/reports/itemReports';
import { useAuthStore } from '../../stores/useAuthStore';
import { inventoryAsOf, type InventoryAsOf } from '../../lib/inventoryAsOf';
import type { ItemDetails } from '../../lib/stockMoves';
import { StockClosingPanel } from './StockClosingPanel';
import { useReportText, fill } from './useReportText';

type Row = InventoryValuationRow & { unknownReason?: string };
/** the start of any stock history: `itemDetails` from here has nothing before it */
const HISTORY_START = '1900-01-01';

/** ISS-131: one reading of the stock-moves ledger from its start to `endDate` (the server's itemDetails). */
async function readHistory(workspaceId: string, endDate: string): Promise<ItemDetails[]> {
  const query = new URLSearchParams({ workspaceId, startDate: HISTORY_START, endDate }).toString();
  const data = await runCommand<{ items?: ItemDetails[] }>({ path: `/api/v1/reports/inventory-details?${query}` });
  if (!Array.isArray(data?.items)) throw new Error('The stock history was not returned.');
  return data.items;
}

/**
 * Inventory Valuation (J-09): each item's stock at cost, and the total against the Inventory
 * account in the books (src/server/reports/itemReports.ts).
 */
export const InventoryValuationReportView: React.FC<{ asOfDate?: string }> = (props) => {
  const reportText = useReportText();
  useLedgerCollections('inventory');
  const stock = useScreenDataHealth(['inventory']);
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const uid = useAuthStore(s => s.user?.uid);
  const guest = useAuthStore(s => s.isGuest && !s.user);
  const currency = useAuthStore(s => s.getCurrentWorkspace()?.currency);
  const loadedBook = useDataNeedsStore(s => s.loadedWorkspaceId);
  const current = guest || Boolean(workspaceId && loadedBook === workspaceId);
  const scope = JSON.stringify([uid, workspaceId, guest]);
  return <div key={scope} className="space-y-4">
    {current && stock.ready ? <ValuationFigures {...props} /> : <section className="space-y-3 p-4">
      <h2 className="text-xl font-bold">{reportText('r.inventory-valuation', 'Inventory Valuation')}</h2>
      {current && stock.failedKeys.length ? <ScreenDataNotice failedKeys={stock.failedKeys} message={stock.message} onRetry={stock.retry} />
        : <ReportSkeleton rows={3} label={reportText('r.loading-report-records', 'Loading report records…')} />}
    </section>}
    <StockClosingPanel workspaceId={workspaceId} currency={currency} />
  </div>;
};

function ValuationFigures({ asOfDate: pageAsOfDate }: { asOfDate?: string }) {
  const reportText = useReportText();
  const inventory = useLedgerStore(s => s.inventory);
  const accounts = useLedgerStore(s => s.accounts);
  const transactions = useLedgerStore(s => s.transactions);
  const ledger = useScreenDataHealth(['transactions', 'accounts']);
  const [searchTerm, setSearchTerm] = useState('');
  const [asOfDate, setAsOfDate] = usePageSyncedState(pageAsOfDate || '', pageAsOfDate || undefined, getLocalDateISO);

  const today = getLocalDateISO();
  // a cleared date means today; a date after today is not a valuation date (the books are not compared for it)
  const future = Boolean(asOfDate) && asOfDate > today;
  const valuationDate = asOfDate && !future ? asOfDate : today;
  const report = useMemo(() => computeInventoryValuation(inventory || [], accounts || [], transactions || [], valuationDate),
    [inventory, accounts, transactions, valuationDate]);
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const currency = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';
  const unknownCap = useLedgerStore(s => s.isDataTruncated && !Object.values(s.truncatedCollections).some(Boolean));
  const chartCapped = useLedgerStore(s => isCollectionCapped(s.truncatedCollections, 'accounts'));
  const ledgerPartial = useLedgerStore(s => isCollectionCapped(s.truncatedCollections, 'transactions')) || chartCapped || unknownCap;
  // a capped item list can leave out an item with stock: the stock side is then not complete
  const itemsPartial = useLedgerStore(s => isCollectionCapped(s.truncatedCollections, 'inventory')) || unknownCap;
  // ISS-131: a past date takes its quantities and values from the stock history, never from today's items
  const past = Boolean(asOfDate) && asOfDate < today;
  // New item snapshots and A → B → A date changes invalidate the old reconstruction immediately.
  const request = useMemo(() => past && workspaceId ? { workspaceId, asOfDate, today, inventory, itemsPartial } : null,
    [past, workspaceId, asOfDate, today, inventory, itemsPartial]);
  const [history, setHistory] = useState<{ request: NonNullable<typeof request>; asOf?: InventoryAsOf; error?: string } | null>(null);
  useEffect(() => {
    if (!request) return;
    let live = true;
    readHistory(request.workspaceId, request.today)
      .then(toToday => { if (live) setHistory({ request, asOf: inventoryAsOf({ asOf: request.asOfDate, items: request.inventory, toToday, itemsPartial: request.itemsPartial }) }); })
      .catch((error: unknown) => { if (live) setHistory({ request, error: error instanceof Error ? error.message : String(error) }); });
    return () => { live = false; };
  }, [request]);
  const currentHistory = request && history?.request === request ? history : null;
  const asOf = currentHistory?.asOf, historyError = currentHistory?.error;

  const rows: Row[] = useMemo(() => {
    if (!past) return report.rows;
    if (!asOf) return [];
    const total = asOf.knownValueCents;
    const byId = new Map((inventory || []).map(i => [i.id, i]));
    return asOf.rows.map(r => ({
      itemId: r.itemId, name: r.name, sku: byId.get(r.itemId)?.sku || '', category: byId.get(r.itemId)?.category || '',
      quantity: r.quantity ?? 0, unitCostCents: r.unitCostCents ?? 0, valueCents: r.valueCents ?? 0,
      sharePct: r.valueCents && total > 0 ? Math.round((r.valueCents / total) * 1000) / 10 : 0,
      belowReorder: false, ...(r.unknownReason ? { unknownReason: r.unknownReason } : {}),
    }));
  }, [past, asOf, report.rows, inventory]);
  const stockValueCents = past ? asOf?.knownValueCents ?? 0 : report.totalValueCents;
  // the two sides are compared only when both are for the same date and both are complete
  const comparable = ledger.ready && !ledgerPartial && !itemsPartial && !future && (!past || Boolean(asOf?.complete));
  const differenceCents = stockValueCents - report.ledgerValueCents;
  const negativeStockItems = past ? asOf?.negativeStockItems ?? 0 : report.negativeStockItems;

  const shown = useMemo(() => {
    const term = searchTerm.trim().toLocaleLowerCase();
    return term ? rows.filter(r => `${r.name} ${r.sku} ${r.category}`.toLocaleLowerCase().includes(term)) : rows;
  }, [rows, searchTerm]);

  const exportCsv = () => {
    // nothing to export until the date's figures are known: an empty file would read as no stock
    if (itemsPartial) { toast.error(reportText('r.stock-export-incomplete', 'CSV is unavailable because the full item list is not loaded.')); return; }
    if (future) { toast.error(`${asOfDate} is after today: there is no stock valuation for it yet.`); return; }
    if (past && !asOf) { toast.error(historyError ? `The stock on ${asOfDate} is not available: ${historyError}` : `The stock history for ${asOfDate} is still being read.`); return; }
    // what the file holds: the stock on the date from the history (unknowns say so, never 0), or today's stock
    downloadCsv(past ? `inventory_valuation_as_of_${asOfDate}.csv` : `inventory_valuation_${today}.csv`,
      ['Item', 'SKU', 'Category', past ? `On hand ${asOfDate}` : 'On hand', 'Unit cost', 'Value', 'Share %'],
      shown.map(r => r.unknownReason
        ? [r.name, r.sku, r.category, 'unknown', 'unknown', 'unknown', `unknown: ${r.unknownReason}`]
        : [r.name, r.sku, r.category, r.quantity, csvMoney(r.unitCostCents), csvMoney(r.valueCents), r.sharePct]));
    toast.success('Inventory Valuation exported to CSV');
  };

  const unknown = (r: Row) => r.unknownReason ? <span className="text-[var(--muted)]">{reportText('r.unknown', 'Unknown')}</span> : null;
  const columns: ColumnDef<Row>[] = [
    {
      key: 'name',
      header: reportText('r.item', 'Item'),
      render: (r) => (
        <div>
          <div className="font-semibold text-[var(--text)]">{r.name}</div>
          <div className="text-[10px] text-[var(--muted)]">{[r.sku, r.category].filter(Boolean).join(' · ')}</div>
          {r.unknownReason && <div className="text-[10px] text-[var(--muted)]">{reportText('r.not-known-on', 'Not known on')} {asOfDate}: {r.unknownReason}</div>}
        </div>
      ),
    },
    {
      key: 'quantity',
      header: reportText('r.on-hand', 'On hand'),
      align: 'right',
      render: (r) => unknown(r) || (
        <span className={r.quantity < 0 ? 'text-[var(--neg)] font-semibold' : r.belowReorder ? 'text-[var(--brass)] font-semibold' : ''}>
          {r.quantity}{r.quantity < 0 ? ` ${reportText('r.negative', '(negative)')}` : r.belowReorder ? ` ${reportText('r.reorder', '(reorder)')}` : ''}
        </span>
      ),
    },
    { key: 'unitCostCents', header: reportText('r.unit-cost', 'Unit cost'), align: 'right', render: (r) => unknown(r) || formatCurrency(r.unitCostCents, currency) },
    { key: 'valueCents', header: reportText('r.value', 'Value'), align: 'right', render: (r) => unknown(r) || <span className="font-semibold">{formatCurrency(r.valueCents, currency)}</span> },
    { key: 'sharePct', header: reportText('r.share', 'Share'), align: 'right', render: (r) => unknown(r) || `${r.sharePct}%` },
  ];

  const emptyMessage = () => {
    if (searchTerm.trim()) return reportText('r.no-record-matches-your-search', 'No record matches your search');
    if (past && !asOf) return historyError ? reportText('r.the-stock-on-this-date-is-not-available', 'The stock on this date is not available.') : reportText('r.reading-the-stock-history', 'Reading the stock history…');
    if (itemsPartial) return reportText('r.stock-loaded-empty', 'No stock was found among the loaded items. Other items may be missing.');
    return past ? fill(reportText('r.no-stock-on-date', 'No stock on {date} in the stock history.'), { date: asOfDate }) : reportText('r.no-items-yet-add-them-in-inventory', 'No items yet. Add them in Inventory.');
  };
  return (
    <div className="space-y-4">
      {ledger.failedKeys.length > 0 ? <ScreenDataNotice failedKeys={ledger.failedKeys} message={ledger.message} onRetry={ledger.retry} />
        : !ledger.ready && <p role="status">{reportText('r.stock-books-loading', 'Stock is shown without a comparison while the books load.')}</p>}
      {itemsPartial && <p role="status">{reportText('r.stock-export-incomplete', 'CSV is unavailable because the full item list is not loaded.')}</p>}
      <PartyReportLayout
        title={reportText('r.inventory-valuation', 'Inventory Valuation')}
        description={past
          ? fill(reportText('r.stock-on-hand-at-cost-on', 'Stock on hand at cost on {date}, from the stock history, beside the Inventory account in the books on the same date.'), { date: asOfDate })
          : reportText('r.stock-on-hand-at-cost-today-beside-the-inventory', 'Stock on hand at cost today, beside the Inventory account in the books today.')}
        icon={Boxes}
        totalLabel={past && asOf && !asOf.complete ? reportText('r.stock-value-of-the-items-known-on-the-date', 'Stock value of the items known on the date') : reportText('r.stock-value', 'Stock value')}
        totalAmountCents={stockValueCents}
        currency={currency}
        totalDisplay={itemsPartial && !rows.length ? reportText('r.not-available', 'Not available') : past && !asOf ? (historyError ? reportText('r.not-available', 'Not available') : reportText('r.reading', 'Reading…')) : undefined}
        secondaryTotalLabel={reportText('r.inventory-account-in-the-books', 'Inventory account in the books')}
        secondaryTotalCents={ledger.ready && !ledgerPartial ? report.ledgerValueCents : undefined}
        exportFilename="inventory_valuation.csv"
        onExportCSV={exportCsv}
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        searchPlaceholder={reportText('r.search-item-sku-or-category', 'Search item, SKU or category...')}
        asOfDate={asOfDate}
        onAsOfDateChange={setAsOfDate}
        columns={columns}
        data={shown}
        emptyMessage={emptyMessage()}
        sumKeys={['valueCents']}
        getRowId={(r) => r.itemId}
      />
      {past && !asOf && !historyError && <p role="status" className="text-xs text-[var(--muted)]">{reportText('r.reading-the-stock-history-for', 'Reading the stock history for')} {asOfDate}…</p>}
      {historyError && <p role="alert" className="text-xs p-3 rounded-lg border border-[var(--brass)] text-[var(--text)]">
        {reportText('r.the-stock-on', 'The stock on')} {asOfDate} {reportText('r.is-not-available', 'is not available:')} {historyError}{reportText('r.todays-stock-not-shown', '. Today’s stock is not shown in its place, and the books are not compared.')}
      </p>}
      {future && <p role="alert" className="text-xs p-3 rounded-lg border border-[var(--brass)] text-[var(--text)]">{asOfDate} {reportText('r.is-after-today-so-there-is-no-stock-or-books-val', 'is after today, so there is no stock or books valuation for it yet. Today’s stock is shown and not compared.')}</p>}
      {ledger.ready && (rows.length > 0 || itemsPartial || ledgerPartial) && !future && (!past || asOf) && (
        <p role="status" className={`text-xs p-3 rounded-lg border ${comparable && differenceCents === 0 ? 'border-[var(--line)] text-[var(--muted)]' : 'border-[var(--brass)] text-[var(--text)]'}`}>
          {past && asOf && !asOf.complete
            ? fill(reportText('r.items-without-stock-history', '{n} item(s) have no stock history that explains them on {date}, so the stock value on that date is not complete and is not compared with the books.'), { n: asOf.unknownItems, date: asOfDate })
            : itemsPartial
              ? reportText('r.the-loaded-item-list-is-capped-so-the-stock-valu', 'The loaded item list is capped, so the stock value here may leave items out and is not compared with the books.')
            : chartCapped
              ? reportText('r.stock-chart-capped', 'The account list is capped. The Inventory account is not compared with stock.')
            : ledgerPartial
              ? reportText('r.the-loaded-entries-are-capped-so-the-inventory-a', 'The loaded entries are capped, so the Inventory account here may be incomplete and is not compared with the stock.')
              : differenceCents === 0
                ? reportText('r.the-stock-list-and-the-inventory-account-agree', 'The stock list and the Inventory account agree.')
                : fill(differenceCents > 0 ? reportText('r.stock-list-more', 'The stock list is {amount} more than the Inventory account. A purchase, stock count or sale is recorded on one side only (bills don\'t add stock to items yet).') : reportText('r.stock-list-less', 'The stock list is {amount} less than the Inventory account. A purchase, stock count or sale is recorded on one side only (bills don\'t add stock to items yet).'), { amount: formatCurrency(Math.abs(differenceCents), currency) })}
          {negativeStockItems > 0 && ` ${fill(reportText('r.items-negative-stock', '{n} item(s) have negative stock and are valued at 0.'), { n: negativeStockItems })}`}
        </p>
      )}
    </div>
  );
}

export default InventoryValuationReportView;
