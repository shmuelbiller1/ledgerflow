/**
 * A-113: lots with expiry dates. Lots arrive on goods receipts (Purchase orders → Receive goods);
 * this screen groups what was received by lot, says how many days each lot has left, and flags
 * expired and expiring lots with their receipts and vendors. Units recorded with a lot at sale are
 * shown as a reference only: the stock ledger does not track lots, so how much of a lot is still
 * on hand is not known and is never computed here. Read-only.
 */
import React, { useMemo, useState } from 'react';
import { ShowMoreRows } from '../common/ShowMoreRows';
import { usePagedRows } from '../../hooks/usePagedRows';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useCollection } from '../../hooks/useCollection';
import { downloadCsv } from '../../lib/csvExport';
import { getLocalDateISO } from '../../lib/utils';
import {
  expiringLotRows, expiringLotsCsvRows, EXPIRING_LOTS_CSV_HEADERS,
  type LotExpiryStatus, type ReceivedLot, type SaleLotRef,
} from '../../lib/expiringLots';
import type { InventoryItem, Invoice, PurchaseOrder } from '../../types';
import ReportTableScroll from './ReportTableScroll';
import { RowTable } from '../ui/RowTable';
import { useReportText } from './useReportText';

const STATUS_LABEL: Record<LotExpiryStatus, string> = {
  expired: 'Expired',
  expiring: 'Expiring soon',
  ok: 'OK',
  'no-date': 'No expiry recorded',
  'sale-only': 'Recorded at sale only',
};

export default function ExpiringLotsReportView({ purchaseOrders: purchaseOrdersProp }: { purchaseOrders?: PurchaseOrder[] } = {}) {
  const reportText = useReportText();
  const inventory = useLedgerStore(s => s.inventory) as InventoryItem[];
  const invoices = useLedgerStore(s => s.invoices) as Invoice[];
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const truncated = useLedgerStore(s => s.truncatedCollections);
  const failed = useDataNeedsStore(s => s.failed);
  const { loading } = useLedgerCollections('inventory', 'invoices');
  const { data: loadedOrders, loading: ordersLoading, truncated: ordersTruncated } = useCollection<PurchaseOrder>('purchaseOrders', { orderByField: 'createdAt', orderDirection: 'desc', limit: 500 });
  const purchaseOrders = purchaseOrdersProp ?? loadedOrders;
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | LotExpiryStatus>('all');
  const [warnDays, setWarnDays] = useState('30');

  const today = getLocalDateISO();
  const itemsById = useMemo(
    () => new Map((inventory || []).filter(i => !workspaceId || !i.workspaceId || i.workspaceId === workspaceId).map(i => [i.id, i])),
    [inventory, workspaceId],
  );

  const received = useMemo(() => {
    const lots: ReceivedLot[] = [];
    for (const po of purchaseOrders || []) {
      const itemOf = new Map((po.items || []).map(i => [i.id, i.itemId] as const));
      for (const receipt of po.receipts || []) {
        for (const line of receipt.items || []) {
          const itemId = itemOf.get(line.poItemId);
          const lot = (line.lotNumber || '').trim();
          if (!itemId || !lot) continue;
          lots.push({
            itemId,
            itemName: itemsById.get(itemId)?.name || itemId,
            lotNumber: lot,
            ...(line.lotExpiryDate ? { expiryDate: line.lotExpiryDate } : {}),
            quantity: Number(line.quantityReceived) || 0,
            receiptNumber: receipt.receiptNumber,
            receivedDate: String(receipt.receivedDate || '').slice(0, 10),
            ...(receipt.vendorName ? { vendorName: receipt.vendorName } : {}),
          });
        }
      }
    }
    return lots;
  }, [purchaseOrders, itemsById]);

  const sales = useMemo(() => {
    const refs: SaleLotRef[] = [];
    for (const inv of invoices || []) {
      if (workspaceId && inv.workspaceId && inv.workspaceId !== workspaceId) continue;
      if (inv.status === 'void' || inv.status === 'cancelled' || inv.status === 'rejected' || inv.status === 'draft') continue;
      const day = String(inv.date || '').slice(0, 10);
      for (const line of inv.items || []) {
        const lot = (line.lotNumber || '').trim();
        if (!line.itemId || !lot) continue;
        refs.push({ itemId: line.itemId, lotNumber: lot, quantity: Number(line.quantity) || 0, lastDate: day });
      }
    }
    return refs;
  }, [invoices, workspaceId]);

  const rows = useMemo(
    () => expiringLotRows(received, sales, today, Number(warnDays) || 0),
    [received, sales, today, warnDays],
  );
  const visible = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return rows.filter(r =>
      (status === 'all' || r.status === status)
      && (!term || `${r.itemName} ${r.lotNumber}`.toLocaleLowerCase().includes(term)));
  }, [rows, status, search]);

  // R-5: the first page of lots draws at once; counts and the CSV keep using every lot
  const paged = usePagedRows(visible, `${status}|${search}|${warnDays}`);
  const counts = useMemo(() => {
    const by: Record<LotExpiryStatus, number> = { expired: 0, expiring: 0, ok: 0, 'no-date': 0, 'sale-only': 0 };
    for (const r of rows) by[r.status] += 1;
    return by;
  }, [rows]);

  const partial = Boolean(truncated.inventory || truncated.invoices || ordersTruncated || failed.inventory || failed.invoices);

  return (
    <section aria-label={reportText('r.expiring-lots', 'Expiring lots')} className="p-4 space-y-4 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2>{reportText('r.expiring-lots', 'Expiring lots')}</h2>
          <p className="text-sm text-[var(--muted)]">
            {reportText('r.lots-received-on-goods-receipts-with-their-expir', 'Lots received on goods receipts with their expiry dates:')} {counts.expired} {reportText('r.expired-2', 'expired,')} {counts.expiring} {reportText('r.expiring-within', 'expiring within')} {Math.max(0, Math.floor(Number(warnDays) || 0))} {reportText('r.days-units-recorded-with-a-lot-at-sale-are-a-ref', 'days. Units recorded with a lot at sale are a reference only — how much of a lot is still on hand is not tracked, so it is never shown here.')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => downloadCsv('expiring-lots', EXPIRING_LOTS_CSV_HEADERS, expiringLotsCsvRows(visible))}
          disabled={!visible.length}
          className="min-h-11 px-3 py-1.5 rounded border text-sm disabled:opacity-50"
          data-print-hide
        >
          {reportText('r.download-csv', 'Download CSV')}
        </button>
      </div>

      {(loading || ordersLoading) && <p role="status" className="text-sm text-[var(--muted)]">{reportText('r.loading-receipts-and-invoices', 'Loading receipts and invoices…')}</p>}
      {partial && (
        <p role="alert" className="text-sm text-amber-700">
          {reportText('r.items-invoices-or-purchase-orders-are-only-partl-2', 'Items, invoices or purchase orders are only partly loaded; lots outside the loaded lists are not shown.')}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3" data-print-hide>
        <label className="flex flex-col gap-1 text-sm">{reportText('r.find-item-or-lot', 'Find item or lot')}
          <input aria-label={reportText('r.find-item-or-lot', 'Find item or lot')} dir="auto" value={search} onChange={e => setSearch(e.target.value)}
            className="min-h-11 max-w-full border rounded px-3 bg-[var(--panel)] text-[var(--text)]" />
        </label>
        <label className="flex flex-col gap-1 text-sm">{reportText('r.status', 'Status')}
          <select aria-label={reportText('r.status', 'Status')} value={status} onChange={e => setStatus(e.target.value as typeof status)}
            className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]">
            <option value="all">{reportText('r.all-statuses', 'All statuses')}</option>
            {(Object.keys(STATUS_LABEL) as LotExpiryStatus[]).map(s => <option key={s} value={s}>{STATUS_LABEL[s]} ({counts[s]})</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">{reportText('r.expiring-soon-within-days', '“Expiring soon” within (days)')}
          <input aria-label={reportText('r.expiring-soon-within-days', '“Expiring soon” within (days)')} type="number" min="0" step="1" value={warnDays}
            onChange={e => setWarnDays(e.target.value)}
            className="min-h-11 w-28 border rounded px-3 bg-[var(--panel)] text-[var(--text)]" />
        </label>
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          {rows.length === 0
            ? reportText('r.no-lots-are-recorded-yet-record-the-lot-and-its', 'No lots are recorded yet. Record the lot (and its expiry, when the goods expire) while receiving goods on a purchase order.')
            : reportText('r.no-lots-match-these-filters', 'No lots match these filters.')}
        </p>
      ) : (
        <ReportTableScroll>
          <RowTable
            rowClassName="border-b border-[var(--line)]/50"
            caption={(<>{reportText('r.lots-with-their-expiry-receipts-and-recorded-sal', 'Lots with their expiry, receipts and recorded sales')}</>)}
            rows={paged.visible}
            rowKey={row => `${row.itemId}:${row.lotNumber}`}
            captionClassName=""
            tableClassName="w-full text-sm"
            headRowClassName=""
            bodyClassName=""
            columns={[
              { header: reportText('r.item', 'Item'), className: "text-left font-normal py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => <bdi>{row.itemName}</bdi> },
              { header: reportText('r.lot', 'Lot'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => <bdi>{row.lotNumber}</bdi> },
              { header: reportText('r.status', 'Status'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => STATUS_LABEL[row.status] },
              { header: reportText('r.days-left', 'Days left'), className: "py-1 px-2 tabular-nums", headClassName: "text-left py-1 px-2", cell: (row) => row.daysLeft ?? '—' },
              { header: reportText('r.expiry', 'Expiry'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.expiryDates.join(', ') || '—' },
              { header: reportText('r.received-units', 'Received units'), className: "py-1 px-2 tabular-nums", headClassName: "text-left py-1 px-2", cell: (row) => row.receivedQty },
              { header: reportText('r.receipts', 'Receipts'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.receiptNumbers.join(', ') || '—' },
              { header: reportText('r.received-from', 'Received from'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => <bdi>{row.receivedFrom.join(', ') || '—'}</bdi> },
              { header: reportText('r.first-received', 'First received'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.firstReceived || '—' },
              { header: reportText('r.last-received', 'Last received'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.lastReceived || '—' },
              { header: reportText('r.recorded-at-sale', 'Recorded at sale'), className: "py-1 px-2 tabular-nums", headClassName: "text-left py-1 px-2", cell: (row) => row.soldQty || '—' },
              { header: reportText('r.last-sold', 'Last sold'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.lastSold || '—' },
            ]}
          />
          <ShowMoreRows shown={paged.visible.length} total={paged.total} noun="lots" onMore={paged.more} onAll={paged.all} />
        </ReportTableScroll>
      )}
    </section>
  );
}
