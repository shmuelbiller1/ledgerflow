import React, { useEffect, useMemo, useState } from 'react';
import { Boxes } from 'lucide-react';
import { toast } from 'sonner';
import { usePageSyncedState } from '../../hooks/usePageSyncedState';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { PartyReportLayout, ColumnDef } from './PartyReportLayout';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { csvMoney, downloadCsv } from '../../lib/csvExport';
import { computeInventoryValuation, InventoryValuationRow } from '../../server/reports/itemReports';
import { getIdToken } from '../../firebase';
import { useAuthStore } from '../../stores/useAuthStore';
import { inventoryAsOf, type InventoryAsOf } from '../../lib/inventoryAsOf';
import type { ItemDetails } from '../../lib/stockMoves';
import { StockClosingPanel } from './StockClosingPanel';

type Row = InventoryValuationRow & { unknownReason?: string };
/** the start of any stock history: `itemDetails` from here has nothing before it */
const HISTORY_START = '1900-01-01';

/** ISS-131: one reading of the stock-moves ledger from its start to `endDate` (the server's itemDetails). */
async function readHistory(workspaceId: string, endDate: string): Promise<ItemDetails[]> {
  const query = new URLSearchParams({ workspaceId, startDate: HISTORY_START, endDate }).toString();
  const res = await fetch(`/api/v1/reports/inventory-details?${query}`, { headers: { Authorization: `Bearer ${await getIdToken()}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || `The stock history could not be read (${res.status})`);
  return data.items || [];
}

/**
 * Inventory Valuation (J-09): each item's stock at cost, and the total against the Inventory
 * account in the books (src/server/reports/itemReports.ts).
 */
export const InventoryValuationReportView: React.FC<{ asOfDate?: string }> = ({ asOfDate: pageAsOfDate }) => {
  const inventory = useLedgerStore(s => s.inventory);
  const accounts = useLedgerStore(s => s.accounts);
  const transactions = useLedgerStore(s => s.transactions);
  useLedgerCollections('inventory');
  const [searchTerm, setSearchTerm] = useState('');
  const [asOfDate, setAsOfDate] = usePageSyncedState(pageAsOfDate || '', pageAsOfDate || undefined, getLocalDateISO);

  const today = getLocalDateISO();
  // a cleared date means today; a date after today is not a valuation date (the books are not compared for it)
  const future = Boolean(asOfDate) && asOfDate > today;
  const valuationDate = asOfDate && !future ? asOfDate : today;
  const report = useMemo(() => computeInventoryValuation(inventory || [], accounts || [], transactions || [], valuationDate),
    [inventory, accounts, transactions, valuationDate]);
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const ledgerPartial = useLedgerStore(s => Boolean(s.truncatedCollections?.transactions));
  // a capped item list can leave out an item with stock: the stock side is then not complete
  const itemsPartial = useLedgerStore(s => Boolean(s.truncatedCollections?.inventory));
  // ISS-131: a past date takes its quantities and values from the stock history, never from today's items
  const past = Boolean(asOfDate) && asOfDate < today;
  const [history, setHistory] = useState<{ key: string; asOf?: InventoryAsOf; error?: string } | null>(null);
  const historyKey = past && workspaceId ? `${workspaceId}|${asOfDate}|${today}` : '';
  useEffect(() => {
    if (!historyKey || !workspaceId) return;
    let live = true;
    readHistory(workspaceId, today)
      .then(toToday => { if (live) setHistory({ key: historyKey, asOf: inventoryAsOf({ asOf: asOfDate, items: inventory || [], toToday, itemsPartial }) }); })
      .catch((error: unknown) => { if (live) setHistory({ key: historyKey, error: error instanceof Error ? error.message : String(error) }); });
    return () => { live = false; };
  }, [historyKey, workspaceId, asOfDate, today, inventory, itemsPartial]);
  const asOf = past && history?.key === historyKey ? history.asOf : undefined;
  const historyError = past && history?.key === historyKey ? history.error : undefined;

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
  const comparable = !ledgerPartial && !itemsPartial && !future && (!past || Boolean(asOf?.complete));
  const differenceCents = stockValueCents - report.ledgerValueCents;
  const negativeStockItems = past ? asOf?.negativeStockItems ?? 0 : report.negativeStockItems;

  const shown = useMemo(() => {
    const term = searchTerm.trim().toLocaleLowerCase();
    return term ? rows.filter(r => `${r.name} ${r.sku} ${r.category}`.toLocaleLowerCase().includes(term)) : rows;
  }, [rows, searchTerm]);

  const exportCsv = () => {
    // nothing to export until the date's figures are known: an empty file would read as no stock
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

  const unknown = (r: Row) => r.unknownReason ? <span className="text-[var(--muted)]">Unknown</span> : null;
  const columns: ColumnDef<Row>[] = [
    {
      key: 'name',
      header: 'Item',
      render: (r) => (
        <div>
          <div className="font-semibold text-[var(--text)]">{r.name}</div>
          <div className="text-[10px] text-[var(--muted)]">{[r.sku, r.category].filter(Boolean).join(' · ')}</div>
          {r.unknownReason && <div className="text-[10px] text-[var(--muted)]">Not known on {asOfDate}: {r.unknownReason}</div>}
        </div>
      ),
    },
    {
      key: 'quantity',
      header: 'On hand',
      align: 'right',
      render: (r) => unknown(r) || (
        <span className={r.quantity < 0 ? 'text-[var(--neg)] font-semibold' : r.belowReorder ? 'text-[var(--brass)] font-semibold' : ''}>
          {r.quantity}{r.quantity < 0 ? ' (negative)' : r.belowReorder ? ' (reorder)' : ''}
        </span>
      ),
    },
    { key: 'unitCostCents', header: 'Unit cost', align: 'right', render: (r) => unknown(r) || formatCurrency(r.unitCostCents) },
    { key: 'valueCents', header: 'Value', align: 'right', render: (r) => unknown(r) || <span className="font-semibold">{formatCurrency(r.valueCents)}</span> },
    { key: 'sharePct', header: 'Share', align: 'right', render: (r) => unknown(r) || `${r.sharePct}%` },
  ];

  return (
    <div className="space-y-4">
      <PartyReportLayout
        title="Inventory Valuation"
        description={past
          ? `Stock on hand at cost on ${asOfDate}, from the stock history, beside the Inventory account in the books on the same date.`
          : "Stock on hand at cost today, beside the Inventory account in the books today."}
        icon={Boxes}
        totalLabel={past && asOf && !asOf.complete ? 'Stock value of the items known on the date' : 'Stock value'}
        totalAmountCents={stockValueCents}
        totalDisplay={past && !asOf ? (historyError ? 'Not available' : 'Reading…') : undefined}
        secondaryTotalLabel="Inventory account in the books"
        secondaryTotalCents={report.ledgerValueCents}
        exportFilename="inventory_valuation.csv"
        onExportCSV={exportCsv}
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        searchPlaceholder="Search item, SKU or category..."
        asOfDate={asOfDate}
        onAsOfDateChange={setAsOfDate}
        columns={columns}
        data={shown}
        emptyMessage={past ? (asOf ? `No stock on ${asOfDate} in the stock history.` : historyError ? 'The stock on this date is not available.' : 'Reading the stock history…') : 'No items yet. Add them in Inventory.'}
        sumKeys={['valueCents']}
        getRowId={(r) => r.itemId}
      />
      {past && !asOf && !historyError && <p role="status" className="text-xs text-[var(--muted)]">Reading the stock history for {asOfDate}…</p>}
      {historyError && <p role="alert" className="text-xs p-3 rounded-lg border border-[var(--brass)] text-[var(--text)]">
        The stock on {asOfDate} is not available: {historyError}. Today&rsquo;s stock is not shown in its place, and the books are not compared.
      </p>}
      {future && <p role="alert" className="text-xs p-3 rounded-lg border border-[var(--brass)] text-[var(--text)]">{asOfDate} is after today, so there is no stock or books valuation for it yet. Today&rsquo;s stock is shown and not compared.</p>}
      {rows.length > 0 && !future && (
        <p role="status" className={`text-xs p-3 rounded-lg border ${comparable && differenceCents === 0 ? 'border-[var(--line)] text-[var(--muted)]' : 'border-[var(--brass)] text-[var(--text)]'}`}>
          {past && asOf && !asOf.complete
            ? `${asOf.unknownItems} item(s) have no stock history that explains them on ${asOfDate}, so the stock value on that date is not complete and is not compared with the books.`
            : itemsPartial
              ? 'The loaded item list is capped, so the stock value here may leave items out and is not compared with the books.'
            : ledgerPartial
              ? 'The loaded entries are capped, so the Inventory account here may be incomplete and is not compared with the stock.'
              : differenceCents === 0
                ? 'The stock list and the Inventory account agree.'
                : `The stock list is ${formatCurrency(Math.abs(differenceCents))} ${differenceCents > 0 ? 'more' : 'less'} than the Inventory account. A purchase, stock count or sale is recorded on one side only (bills don't add stock to items yet).`}
          {negativeStockItems > 0 && ` ${negativeStockItems} item(s) have negative stock and are valued at 0.`}
        </p>
      )}
      <StockClosingPanel workspaceId={workspaceId} />
    </div>
  );
};

export default InventoryValuationReportView;
