/**
 * A-117: stock valuation by location and by lot. Reports → Stock Value by Location & Lot.
 *
 * By location: the stock-moves ledger read from the start of its history (the server's
 * /reports/inventory-details), valued the way Inventory Valuation values stock (ISS-131's method —
 * an item its history does not explain is unknown with the reason, never split across locations).
 * By lot: what each received goods-receipt lot cost when it arrived (Purchase orders → Receive
 * goods), with the units recorded at sale as a reference only — on-hand per lot is not tracked and
 * is never computed here. Read-only; nothing posts.
 */
import { runCommand } from '../../lib/runCommand';
import React, { useEffect, useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useCollection } from '../../hooks/useCollection';
import { downloadCsv } from '../../lib/csvExport';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import {
  valuationByLocation, valuationByLots,
  stockValueLocationCsvRows, stockValueLotCsvRows,
  STOCK_VALUE_LOCATION_CSV_HEADERS, STOCK_VALUE_LOT_CSV_HEADERS,
  type LotReceiptLine, type LotSaleRef,
} from '../../lib/stockValuation';
import type { ItemDetails } from '../../lib/stockMoves';
import type { InventoryItem, Invoice, PurchaseOrder } from '../../types';
import ReportTableScroll from './ReportTableScroll';

const HISTORY_START = '1900-01-01';

/** one reading of the stock-moves ledger from its start to `endDate` (the server's itemDetails) */
async function readHistory(workspaceId: string, endDate: string): Promise<ItemDetails[]> {
  const query = new URLSearchParams({ workspaceId, startDate: HISTORY_START, endDate }).toString();
  const data = await runCommand<{ items?: ItemDetails[] }>({ path: `/api/v1/reports/inventory-details?${query}` });
  return data.items || [];
}

export default function StockValueByLocationLotReportView({ purchaseOrders: purchaseOrdersProp, history: historyProp }: { purchaseOrders?: PurchaseOrder[]; history?: ItemDetails[] } = {}) {
  const inventory = useLedgerStore(s => s.inventory) as InventoryItem[];
  const invoices = useLedgerStore(s => s.invoices) as Invoice[];
  const dimensionNodes = useLedgerStore(s => s.dimensionNodes);
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const currency = useAuthStore(s => s.getCurrentWorkspace()?.currency || 'USD');
  const truncated = useLedgerStore(s => s.truncatedCollections);
  const failed = useDataNeedsStore(s => s.failed);
  const { loading } = useLedgerCollections('inventory', 'invoices');
  const { data: loadedOrders, loading: ordersLoading, truncated: ordersTruncated } = useCollection<PurchaseOrder>('purchaseOrders', { orderByField: 'createdAt', orderDirection: 'desc', limit: 500 });
  const purchaseOrders = purchaseOrdersProp ?? loadedOrders;

  const today = getLocalDateISO();
  const [asOf, setAsOf] = useState(today);
  const valuationDate = asOf && asOf <= today ? asOf : today;

  const [fetched, setFetched] = useState<{ key: string; items?: ItemDetails[]; error?: string } | null>(null);
  useEffect(() => {
    if (historyProp || !workspaceId || !valuationDate) return;
    const key = `${workspaceId}|${valuationDate}`;
    let live = true;
    readHistory(workspaceId, valuationDate)
      .then(items => { if (live) setFetched({ key, items }); })
      .catch(err => { if (live) setFetched({ key, error: err instanceof Error ? err.message : String(err) }); });
    return () => { live = false; };
  }, [historyProp, workspaceId, valuationDate]);
  const history = useMemo(
    () => (historyProp ? { key: `${workspaceId}|${valuationDate}`, items: historyProp } : fetched),
    [historyProp, fetched, workspaceId, valuationDate],
  );

  const itemsForWorkspace = useMemo(
    () => (inventory || []).filter(i => !workspaceId || !i.workspaceId || i.workspaceId === workspaceId),
    [inventory, workspaceId],
  );

  const byLocation = useMemo(() => {
    if (!history || history.key !== `${workspaceId}|${valuationDate}` || !history.items) return null;
    return valuationByLocation({ asOf: valuationDate, items: itemsForWorkspace, toToday: history.items, itemsPartial: Boolean(truncated.inventory) });
  }, [history, workspaceId, valuationDate, itemsForWorkspace, truncated.inventory]);

  const locationName = useMemo(() => {
    const names = new Map<string, string>();
    for (const node of dimensionNodes) if (node.dimensionId === 'location') names.set(node.id, node.description || node.id);
    return names;
  }, [dimensionNodes]);

  const lotLines = useMemo(() => {
    const itemsById = new Map(itemsForWorkspace.map(i => [i.id, i]));
    const lines: LotReceiptLine[] = [];
    for (const po of purchaseOrders || []) {
      const itemOf = new Map((po.items || []).map(i => [i.id, i.itemId] as const));
      for (const receipt of po.receipts || []) {
        for (const line of receipt.items || []) {
          const itemId = itemOf.get(line.poItemId);
          const lot = (line.lotNumber || '').trim();
          if (!itemId || !lot) continue;
          lines.push({
            itemId,
            itemName: itemsById.get(itemId)?.name || itemId,
            lotNumber: lot,
            ...(line.lotExpiryDate ? { expiryDate: line.lotExpiryDate } : {}),
            quantity: Number(line.quantityReceived) || 0,
            unitPriceCents: Number(line.unitPriceCents) || 0,
            receiptNumber: receipt.receiptNumber,
            receivedDate: String(receipt.receivedDate || '').slice(0, 10),
            ...(receipt.vendorName ? { vendorName: receipt.vendorName } : {}),
          });
        }
      }
    }
    return lines;
  }, [purchaseOrders, itemsForWorkspace]);

  const sales = useMemo(() => {
    const refs: LotSaleRef[] = [];
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

  const lots = useMemo(() => valuationByLots(lotLines, sales), [lotLines, sales]);
  const partial = Boolean(truncated.inventory || truncated.invoices || ordersTruncated || failed.inventory || failed.invoices);
  const money = (cents: number) => formatCurrency(cents, currency);

  return (
    <section aria-label="Stock value by location and lot" className="p-4 space-y-6 min-w-0">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2>Stock value by location and lot</h2>
          <p className="text-sm text-[var(--muted)]">
            What the stock is worth where it sits (from the stock-moves ledger), and what each received lot
            cost when it arrived. Nothing is recorded here; the figures are read from the records you already keep.
          </p>
        </div>
        <label className="flex flex-col gap-1 text-sm" data-print-hide>As of
          <input type="date" aria-label="As of" value={asOf} max={today} onChange={e => setAsOf(e.target.value)}
            className="px-2 py-1.5 border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]" />
        </label>
      </div>

      {(loading || ordersLoading) && <p role="status" className="text-sm text-[var(--muted)]">Loading items, invoices and receipts…</p>}
      {partial && (
        <p role="alert" className="text-sm text-amber-700">
          Items, invoices or purchase orders are only partly loaded; stock outside the loaded lists is not shown.
        </p>
      )}
      {asOf > today && (
        <p role="status" className="text-sm text-amber-700 dark:text-amber-400">A future date is not a valuation date; showing {today}.</p>
      )}

      <section aria-label="Value by location" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold">By location</h3>
          <button type="button" data-print-hide
            onClick={() => downloadCsv('stock-value-by-location', STOCK_VALUE_LOCATION_CSV_HEADERS, stockValueLocationCsvRows(byLocation?.items || []))}
            disabled={!byLocation?.items.length}
            className="min-h-11 px-3 py-1.5 rounded border text-sm disabled:opacity-50">
            Download CSV
          </button>
        </div>
        {history?.error && <p role="alert" className="text-sm text-rose-600">{history.error}</p>}
        {history && history.key === `${workspaceId}|${valuationDate}` && !history.items && !history.error && (
          <p role="status" className="text-sm text-[var(--muted)]">Reading the stock history…</p>
        )}
        {byLocation && (
          <>
            <p className="text-sm text-[var(--muted)]">
              Value is what the stock moves booked (the cost each change carried). An item its history does not
              explain is shown with the reason and is not split across locations — the same rule as Inventory Valuation.
            </p>
            <ReportTableScroll>
              <table className="w-full text-sm">
                <caption className="sr-only">Value by location</caption>
                <thead>
                  <tr className="border-b border-[var(--line)] text-left text-[var(--muted)]">
                    <th scope="col" className="py-2 pr-3">Location</th>
                    <th scope="col" className="py-2 pr-3">Item</th>
                    <th scope="col" className="py-2 pr-3 text-right">Quantity</th>
                    <th scope="col" className="py-2 pr-3 text-right">Value</th>
                    <th scope="col" className="py-2 text-right">Average cost</th>
                  </tr>
                </thead>
                <tbody>
                  {byLocation.items.map(item => (
                    item.rows.length === 0 ? (
                      <tr key={item.itemId} className="border-b border-[var(--line)]/50">
                        <td className="py-1.5 pr-3">—</td>
                        <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                          {item.itemName}
                          {item.unknownReason && <span className="block text-xs text-amber-700 dark:text-amber-400">{item.unknownReason}</span>}
                          {item.note && <span className="block text-xs text-[var(--muted)]">{item.note}</span>}
                        </th>
                        <td className="py-1.5 pr-3 text-right font-mono">{item.quantity ?? ''}</td>
                        <td className="py-1.5 pr-3 text-right font-mono">{item.valueCents === null ? '' : money(item.valueCents)}</td>
                        <td className="py-1.5 text-right font-mono">{item.valueCents !== null && item.quantity ? money(Math.round(item.valueCents / item.quantity)) : ''}</td>
                      </tr>
                    ) : item.rows.map(row => (
                      <tr key={`${item.itemId}-${row.locationId}`} className="border-b border-[var(--line)]/50">
                        <td className="py-1.5 pr-3">{row.locationId ? locationName.get(row.locationId) || row.locationId : 'No location'}</td>
                        <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                          {item.itemName}
                          {item.note && <span className="block text-xs text-[var(--muted)]">{item.note}</span>}
                        </th>
                        <td className="py-1.5 pr-3 text-right font-mono">{row.quantity}</td>
                        <td className="py-1.5 pr-3 text-right font-mono">{money(row.valueCents)}</td>
                        <td className="py-1.5 text-right font-mono">{money(row.unitCostCents)}</td>
                      </tr>
                    ))
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-[var(--line)] font-semibold">
                    <th scope="row" colSpan={2} className="py-2 pr-3 text-left">Total value of the items the history explains</th>
                    <td className="py-2" />
                    <td className="py-2 pr-3 text-right font-mono">{money(byLocation.knownValueCents)}</td>
                    <td className="py-2" />
                  </tr>
                  {byLocation.byLocation.map(t => (
                    <tr key={t.locationId || 'none'} className="text-[var(--muted)]">
                      <td className="py-1.5 pr-3">{t.locationId ? locationName.get(t.locationId) || t.locationId : 'No location'}</td>
                      <td className="py-1.5 pr-3">{t.items} item lines</td>
                      <td className="py-1.5 pr-3 text-right font-mono">{t.quantity}</td>
                      <td className="py-1.5 pr-3 text-right font-mono">{money(t.valueCents)}</td>
                      <td className="py-1.5" />
                    </tr>
                  ))}
                </tfoot>
              </table>
            </ReportTableScroll>
            <p className="text-xs text-[var(--muted)]">
              {byLocation.unknownItems > 0 && `${byLocation.unknownItems} item${byLocation.unknownItems === 1 ? '' : 's'} could not be valued (the reason is on its row). `}
              {byLocation.negativeStockItems > 0 && `${byLocation.negativeStockItems} item${byLocation.negativeStockItems === 1 ? ' has' : 's have'} negative stock (valued at zero). `}
              Location rows for an item add up to the value its moves booked.
            </p>
          </>
        )}
      </section>

      <section aria-label="Value by lot" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold">By lot</h3>
          <button type="button" data-print-hide
            onClick={() => downloadCsv('stock-value-by-lot', STOCK_VALUE_LOT_CSV_HEADERS, stockValueLotCsvRows(lots.rows))}
            disabled={!lots.rows.length}
            className="min-h-11 px-3 py-1.5 rounded border text-sm disabled:opacity-50">
            Download CSV
          </button>
        </div>
        <p role="note" className="text-sm text-amber-700 dark:text-amber-400">{lots.limit}</p>
        {lots.rows.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No received lots yet: record a lot on a goods receipt (Purchase orders → Receive goods).</p>
        ) : (
          <ReportTableScroll>
            <table className="w-full text-sm">
              <caption className="sr-only">Value by lot</caption>
              <thead>
                <tr className="border-b border-[var(--line)] text-left text-[var(--muted)]">
                  <th scope="col" className="py-2 pr-3">Item</th>
                  <th scope="col" className="py-2 pr-3">Lot</th>
                  <th scope="col" className="py-2 pr-3">Expiry</th>
                  <th scope="col" className="py-2 pr-3 text-right">Received</th>
                  <th scope="col" className="py-2 pr-3 text-right">Received value</th>
                  <th scope="col" className="py-2 pr-3 text-right">Arrival cost</th>
                  <th scope="col" className="py-2 pr-3">Receipts</th>
                  <th scope="col" className="py-2 text-right">Sold (reference)</th>
                </tr>
              </thead>
              <tbody>
                {lots.rows.map(r => (
                  <tr key={`${r.itemId}-${r.lotNumber}`} className="border-b border-[var(--line)]/50">
                    <td className="py-1.5 pr-3">{r.itemName}</td>
                    <th scope="row" className="py-1.5 pr-3 text-left font-normal">{r.lotNumber}</th>
                    <td className="py-1.5 pr-3">{r.expiryDates.join('; ') || '—'}</td>
                    <td className="py-1.5 pr-3 text-right font-mono">{r.receivedQty}</td>
                    <td className="py-1.5 pr-3 text-right font-mono">{money(r.receivedValueCents)}</td>
                    <td className="py-1.5 pr-3 text-right font-mono">{money(r.unitCostCents)}</td>
                    <td className="py-1.5 pr-3">{r.receiptNumbers.join('; ')}</td>
                    <td className="py-1.5 text-right font-mono">{r.soldQty || ''}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-[var(--line)] font-semibold">
                  <th scope="row" colSpan={4} className="py-2 pr-3 text-left">Total received value</th>
                  <td className="py-2 pr-3 text-right font-mono">{money(lots.receivedValueCents)}</td>
                  <td className="py-2" colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </ReportTableScroll>
        )}
      </section>
    </section>
  );
}
