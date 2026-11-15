/**
 * A-140: Aged inventory by lot — ages goods-receipt lots (`0–30`, `31–60`, `61–90`, `91–180`,
 * `181+ days`) as of a chosen date, valued strictly in each PO's currency without mixing currencies.
 */
import React, { useMemo, useState } from 'react';
import { Clock, Download } from 'lucide-react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useCollection } from '../../hooks/useCollection';
import { downloadCsv } from '../../lib/csvExport';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import type { PurchaseOrder } from '../../types';
import {
  AGED_INVENTORY_BY_LOT_CSV_HEADERS,
  agedInventoryByLotCsvRows,
  computeAgedInventoryByLot,
  LOT_AGE_BUCKETS,
  type LotAgeBucketKey,
  type AgedLotRow,
} from '../../lib/agedInventoryByLot';
import { TanStackDataGrid } from '../ui/TanStackDataGrid';
import { EmptyState } from '../ui/EmptyState';
import type { ColumnDef } from '@tanstack/react-table';

const field = 'w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white';

export default function AgedInventoryByLotReportView({
  purchaseOrders: purchaseOrdersProp,
}: { purchaseOrders?: PurchaseOrder[] } = {}) {
  const inventory = useLedgerStore(s => s.inventory);
  const invoices = useLedgerStore(s => s.invoices);
  const { loading } = useLedgerCollections('inventory', 'invoices');
  const { data: loadedOrders, loading: ordersLoading } = useCollection<PurchaseOrder>('purchaseOrders', {
    orderByField: 'createdAt',
    orderDirection: 'desc',
    limit: 500,
  });
  const purchaseOrders = purchaseOrdersProp ?? loadedOrders;
  const workspaceCurrency = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';

  const [asOfDate, setAsOfDate] = useState(() => getLocalDateISO());
  const [bucketFilter, setBucketFilter] = useState<'ALL' | LotAgeBucketKey>('ALL');

  const rows = useMemo(
    () => computeAgedInventoryByLot({
      purchaseOrders: purchaseOrders || [],
      items: inventory || [],
      invoices: invoices || [],
      asOfDate,
      defaultCurrency: workspaceCurrency,
    }),
    [purchaseOrders, inventory, invoices, asOfDate, workspaceCurrency],
  );

  /**
   * One row per lot: what it is, when it arrived, how old it is, what it is worth, and whether it has
   * expired. The lot number names the row. Sorting is on the plain values the cells print beside
   * (days, quantities, cents), never on the formatted text.
   */
  const columns: ColumnDef<AgedLotRow, unknown>[] = [
    { id: 'item', accessorFn: row => row.itemName, header: 'Item', cell: info => <span className="font-medium"><bdi>{String(info.getValue())}</bdi></span> },
    { id: 'lot', accessorFn: row => row.lotNumber, header: 'Lot number', cell: info => <span className="font-mono font-semibold text-indigo-700 dark:text-indigo-300"><bdi>{String(info.getValue())}</bdi></span> },
    { id: 'received', accessorFn: row => row.firstReceivedDate, header: 'Received date', cell: info => <span className="tabular-nums">{String(info.getValue())}</span> },
    { id: 'age', accessorFn: row => row.ageDays, header: 'Age (days)', cell: info => <span className="tabular-nums font-semibold">{String(info.getValue())}</span> },
    { id: 'bucket', accessorFn: row => LOT_AGE_BUCKETS.find(b => b.key === row.bucket)?.label || row.bucket, header: 'Bucket' },
    { id: 'units', accessorFn: row => row.receivedQty, header: 'Received units', cell: info => <span className="tabular-nums">{String(info.getValue())}</span> },
    { id: 'value', accessorFn: row => row.receivedValueCents, header: 'Receipt value', cell: info => <span className="tabular-nums font-semibold">{formatCurrency(Number(info.getValue()), (info.row.original as AgedLotRow).currency)}</span> },
    { id: 'expiry', accessorFn: row => row.expiryDate || '', header: 'Expiry', cell: info => {
      const row = info.row.original as AgedLotRow;
      return <span className="tabular-nums">{row.expiryDate || '—'}{row.expired && <span className="ms-2 inline-block px-2 py-0.5 text-[11px] font-bold rounded bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300">Expired</span>}</span>;
    } },
    { id: 'sold', accessorFn: row => row.recordedSoldQty, header: 'Sold refs', cell: info => <span className="tabular-nums text-[var(--muted)]">{Number(info.getValue()) > 0 ? String(info.getValue()) : '—'}</span> },
  ];

  const visible = useMemo(
    () => (bucketFilter === 'ALL' ? rows : rows.filter(r => r.bucket === bucketFilter)),
    [rows, bucketFilter],
  );

  const countByBucket = useMemo(() => {
    const map: Record<string, number> = {};
    for (const b of LOT_AGE_BUCKETS) map[b.key] = 0;
    for (const r of rows) map[r.bucket] = (map[r.bucket] || 0) + r.receivedQty;
    return map;
  }, [rows]);

  if (loading || (ordersLoading && !purchaseOrdersProp)) {
    return <p className="p-6 text-sm text-slate-600 dark:text-slate-400">Loading lot aging…</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <Clock className="w-6 h-6 text-indigo-600" aria-hidden="true" />
            Aged Inventory by Lot
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Ages each received lot number from its goods-receipt date through the selected date. Because stock moves do not deplete individual lot buckets, received quantities and PO receipt cost are shown faithfully alongside any lot numbers referenced on issued sales invoices.
          </p>
        </div>
        <button
          type="button"
          onClick={() => downloadCsv(`aged-inventory-by-lot-${asOfDate}.csv`, AGED_INVENTORY_BY_LOT_CSV_HEADERS, agedInventoryByLotCsvRows(visible))}
          className="min-h-11 px-4 py-2 text-sm font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-2"
        >
          <Download className="w-4 h-4" aria-hidden="true" /> Export CSV
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
        <div>
          <label htmlFor="lot-age-asof" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            As of date
          </label>
          <input id="lot-age-asof" type="date" value={asOfDate} onChange={e => setAsOfDate(e.target.value)} className={field} />
        </div>
        <div>
          <label htmlFor="lot-age-bucket" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Age bucket
          </label>
          <select id="lot-age-bucket" value={bucketFilter} onChange={e => setBucketFilter(e.target.value as 'ALL' | LotAgeBucketKey)} className={field}>
            <option value="ALL">All age buckets ({rows.length} lots)</option>
            {LOT_AGE_BUCKETS.map(b => (
              <option key={b.key} value={b.key}>{b.label} ({countByBucket[b.key] || 0} received units)</option>
            ))}
          </select>
        </div>
      </div>

      <TanStackDataGrid
        caption="Aged inventory by lot table"
        data={visible}
        columns={columns}
        rowHeaderColumn="lot"
        pageSize={25}
        searchPlaceholder="Search items, lots and buckets..."
        searchLabel="Search items, lots and buckets"
        columnScope="report-aged-inventory-by-lot"
        columnLabel="Aged inventory columns"
        columnNames={['Item', 'Lot number', 'Received date', 'Age (days)', 'Bucket', 'Received units', 'Receipt value', 'Expiry', 'Sold refs']}
        exportConfig={{
          filename: `aged-inventory-by-lot-${asOfDate}.csv`,
          label: 'Export CSV',
          headers: AGED_INVENTORY_BY_LOT_CSV_HEADERS,
          mapRow: row => agedInventoryByLotCsvRows([row])[0],
        }}
        emptyState={<EmptyState title={`No lot-numbered receipts on or before ${asOfDate}`} description="Record lot numbers when receiving goods to track lot age and expiry." />}
        filteredEmptyState={<EmptyState title="No lot matches your search" description="Try another item or lot number." />}
      />
    </div>
  );
}
