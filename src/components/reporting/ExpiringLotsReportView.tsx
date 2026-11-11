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

const STATUS_LABEL: Record<LotExpiryStatus, string> = {
  expired: 'Expired',
  expiring: 'Expiring soon',
  ok: 'OK',
  'no-date': 'No expiry recorded',
  'sale-only': 'Recorded at sale only',
};

export default function ExpiringLotsReportView({ purchaseOrders: purchaseOrdersProp }: { purchaseOrders?: PurchaseOrder[] } = {}) {
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
    <section aria-label="Expiring lots" className="p-4 space-y-4 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2>Expiring lots</h2>
          <p className="text-sm text-[var(--muted)]">
            Lots received on goods receipts with their expiry dates: {counts.expired} expired, {counts.expiring} expiring
            within {Math.max(0, Math.floor(Number(warnDays) || 0))} days. Units recorded with a lot at sale are a
            reference only — how much of a lot is still on hand is not tracked, so it is never shown here.
          </p>
        </div>
        <button
          type="button"
          onClick={() => downloadCsv('expiring-lots', EXPIRING_LOTS_CSV_HEADERS, expiringLotsCsvRows(visible))}
          disabled={!visible.length}
          className="min-h-11 px-3 py-1.5 rounded border text-sm disabled:opacity-50"
          data-print-hide
        >
          Download CSV
        </button>
      </div>

      {(loading || ordersLoading) && <p role="status" className="text-sm text-[var(--muted)]">Loading receipts and invoices…</p>}
      {partial && (
        <p role="alert" className="text-sm text-amber-700">
          Items, invoices or purchase orders are only partly loaded; lots outside the loaded lists are not shown.
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3" data-print-hide>
        <label className="flex flex-col gap-1 text-sm">Find item or lot
          <input aria-label="Find item or lot" dir="auto" value={search} onChange={e => setSearch(e.target.value)}
            className="min-h-11 max-w-full border rounded px-3 bg-[var(--panel)] text-[var(--text)]" />
        </label>
        <label className="flex flex-col gap-1 text-sm">Status
          <select aria-label="Status" value={status} onChange={e => setStatus(e.target.value as typeof status)}
            className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]">
            <option value="all">All statuses</option>
            {(Object.keys(STATUS_LABEL) as LotExpiryStatus[]).map(s => <option key={s} value={s}>{STATUS_LABEL[s]} ({counts[s]})</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">“Expiring soon” within (days)
          <input aria-label="“Expiring soon” within (days)" type="number" min="0" step="1" value={warnDays}
            onChange={e => setWarnDays(e.target.value)}
            className="min-h-11 w-28 border rounded px-3 bg-[var(--panel)] text-[var(--text)]" />
        </label>
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          {rows.length === 0
            ? 'No lots are recorded yet. Record the lot (and its expiry, when the goods expire) while receiving goods on a purchase order.'
            : 'No lots match these filters.'}
        </p>
      ) : (
        <ReportTableScroll>
          <table className="w-full text-sm">
            <caption>Lots with their expiry, receipts and recorded sales</caption>
            <thead>
              <tr>{['Item', 'Lot', 'Status', 'Days left', 'Expiry', 'Received units', 'Receipts', 'Received from', 'First received', 'Last received', 'Recorded at sale', 'Last sold'].map(head =>
                <th key={head} scope="col" className="text-left py-1 px-2">{head}</th>)}</tr>
            </thead>
            <tbody>
              {paged.visible.map(row => (
                <tr key={`${row.itemId}:${row.lotNumber}`} className="border-b border-[var(--line)]/50">
                  <th scope="row" className="text-left font-normal py-1 px-2"><bdi>{row.itemName}</bdi></th>
                  <td className="py-1 px-2"><bdi>{row.lotNumber}</bdi></td>
                  <td className="py-1 px-2">{STATUS_LABEL[row.status]}</td>
                  <td className="py-1 px-2 tabular-nums">{row.daysLeft ?? '—'}</td>
                  <td className="py-1 px-2">{row.expiryDates.join(', ') || '—'}</td>
                  <td className="py-1 px-2 tabular-nums">{row.receivedQty}</td>
                  <td className="py-1 px-2">{row.receiptNumbers.join(', ') || '—'}</td>
                  <td className="py-1 px-2"><bdi>{row.receivedFrom.join(', ') || '—'}</bdi></td>
                  <td className="py-1 px-2">{row.firstReceived || '—'}</td>
                  <td className="py-1 px-2">{row.lastReceived || '—'}</td>
                  <td className="py-1 px-2 tabular-nums">{row.soldQty || '—'}</td>
                  <td className="py-1 px-2">{row.lastSold || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ShowMoreRows shown={paged.visible.length} total={paged.total} noun="lots" onMore={paged.more} onAll={paged.all} />
        </ReportTableScroll>
      )}
    </section>
  );
}
