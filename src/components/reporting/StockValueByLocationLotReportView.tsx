import { useReportDates } from './useReportDates';
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
import { useReportList } from '../../hooks/useReportList';
import { isItemDetails } from '../../lib/reportListRows';
import { validCustomReportPeriod } from '../../lib/reportCustomPeriod';
import { usePartialReportInputs } from '../../hooks/usePartialReportInputs';
import React, { useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
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
import ReportSchedule from './ReportSchedule';
import { fill, useReportText } from './useReportText';

const HISTORY_START = '1900-01-01';

function isLocationHistory(value: unknown): value is ItemDetails {
  return isItemDetails(value) && value.moves.every(m =>
    (m.locationId == null || typeof m.locationId === 'string') && (m.writtenOn == null || typeof m.writtenOn === 'string'));
}

export default function StockValueByLocationLotReportView({ purchaseOrders: purchaseOrdersProp, history: historyProp }: { purchaseOrders?: PurchaseOrder[]; history?: ItemDetails[] } = {}) {
  const dates = useReportDates();
  const reportText = useReportText();
  const inventory = useLedgerStore(s => s.inventory) as InventoryItem[];
  const invoices = useLedgerStore(s => s.invoices) as Invoice[];
  const dimensionNodes = useLedgerStore(s => s.dimensionNodes);
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const currency = useAuthStore(s => s.getCurrentWorkspace()?.currency || 'USD');
  const inventoryPartial = usePartialReportInputs(['inventory']);
  const invoicesPartial = usePartialReportInputs(['invoices']);
  const { loading: itemsLoading } = useLedgerCollections('inventory');
  const { loading: invoicesLoading } = useLedgerCollections('invoices');
  const { data: loadedOrders, loading: ordersLoading, truncated: ordersTruncated, error: ordersError, refetch: retryOrders } = useCollection<PurchaseOrder>('purchaseOrders', { orderByField: 'createdAt', orderDirection: 'desc', limit: 500 });
  const purchaseOrders = purchaseOrdersProp ?? loadedOrders;

  const today = getLocalDateISO();
  const [asOf, setAsOf] = useState(today);
  const validDate = validCustomReportPeriod({ startDate: asOf, endDate: asOf });
  const valuationDate = asOf > today ? today : asOf;
  // Reconcile against *today's* on-hand first. The existing valuation function then cuts those
  // movements at the selected day. Cutting the read itself compared past stock to today's stock.
  const query = new URLSearchParams({ workspaceId: workspaceId || '', startDate: HISTORY_START, endDate: today });
  const ledger = useReportList(!historyProp && workspaceId && validDate ? `/api/v1/reports/inventory-details?${query}` : null, 'items', isLocationHistory);
  const history = historyProp ?? ledger.rows;

  const itemsForWorkspace = useMemo(
    () => (inventory || []).filter(i => !workspaceId || !i.workspaceId || i.workspaceId === workspaceId),
    [inventory, workspaceId],
  );

  const byLocation = useMemo(() => {
    if (!history || !validDate || itemsLoading) return null;
    return valuationByLocation({ asOf: valuationDate, items: itemsForWorkspace, toToday: history, itemsPartial: inventoryPartial });
  }, [history, validDate, itemsLoading, valuationDate, itemsForWorkspace, inventoryPartial]);
  const locationRows = useMemo(() => (byLocation?.items || []).flatMap(item => {
    // null = no split can be established; '' = a real movement with no location recorded.
    const locations = item.rows.length ? item.rows : [null];
    return locations.map(location => ({ item, location, quantity: location?.quantity ?? item.quantity,
      value: location?.valueCents ?? item.valueCents, cost: location?.unitCostCents ??
        (item.valueCents !== null && item.quantity ? Math.round(item.valueCents / item.quantity) : null) }));
  }), [byLocation]);

  const locationName = useMemo(() => {
    const names = new Map<string, string>();
    for (const node of dimensionNodes) if (node.dimensionId === 'location') names.set(node.id, node.description || node.id);
    return names;
  }, [dimensionNodes]);

  const lotLines = useMemo(() => {
    const itemsById = new Map(itemsForWorkspace.map(i => [i.id, i]));
    const lines: LotReceiptLine[] = [];
    for (const po of purchaseOrders || []) {
      if (workspaceId && po.workspaceId !== workspaceId) continue;
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
  }, [purchaseOrders, itemsForWorkspace, workspaceId]);

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
  const waitingForOrders = !purchaseOrdersProp && ordersLoading;
  const partial = inventoryPartial || invoicesPartial || Boolean(!purchaseOrdersProp && (ordersTruncated || ordersError));
  const lotIncomplete = partial || itemsLoading || invoicesLoading || waitingForOrders;
  const money = (cents: number) => formatCurrency(cents, currency);

  return (
    <section aria-label={reportText('r.stock-value-by-location-and-lot', 'Stock value by location and lot')} className="p-4 space-y-6 min-w-0">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2>{reportText('r.stock-value-by-location-and-lot', 'Stock value by location and lot')}</h2>
          <p className="text-sm text-[var(--muted)]">
            {reportText('r.what-the-stock-is-worth-where-it-sits-from-the-s', 'What the stock is worth where it sits (from the stock-moves ledger), and what each received lot cost when it arrived. Nothing is recorded here; the figures are read from the records you already keep.')}
          </p>
        </div>
        <label className="flex flex-col gap-1 text-sm" data-print-hide>{reportText('r.as-of-2', 'As of')}
          <input type="date" aria-label={reportText('r.as-of-2', 'As of')} value={asOf} max={today} onChange={e => setAsOf(e.target.value)}
            className="px-2 py-1.5 border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]" />
        </label>
      </div>

      {(itemsLoading || invoicesLoading || waitingForOrders) && <p role="status" className="text-sm text-[var(--muted)]">{reportText('r.loading-items-invoices-and-receipts', 'Loading items, invoices and receipts…')}</p>}
      {partial && (
        <p role="alert" className="text-sm text-amber-800 dark:text-amber-300">
          {reportText('r.items-invoices-or-purchase-orders-are-only-partl', 'Items, invoices or purchase orders are only partly loaded; stock outside the loaded lists is not shown.')}
        </p>
      )}
      {asOf > today && (
        <p role="status" className="text-sm text-amber-700 dark:text-amber-400">{reportText('r.a-future-date-is-not-a-valuation-date-showing', 'A future date is not a valuation date; showing')} {dates.dateText(today)}.</p>
      )}

      <section aria-label={reportText('r.value-by-location', 'Value by location')} className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold">{reportText('r.by-location', 'By location')}</h3>
          <button type="button" data-print-hide
            onClick={() => downloadCsv('stock-value-by-location', STOCK_VALUE_LOCATION_CSV_HEADERS, stockValueLocationCsvRows(byLocation?.items || []))}
            disabled={!byLocation?.items.length || inventoryPartial}
            className="min-h-11 px-3 py-1.5 rounded border text-sm disabled:opacity-50">
            {reportText('r.download-csv', 'Download CSV')}
          </button>
        </div>
        {!validDate && <p role="alert">{reportText('r.choose-a-valid-report-as-of-date', 'Choose a valid report as-of date.')}</p>}
        {ledger.failed && <div role="alert">{ledger.error || reportText('r.missing-report-rows', 'The response did not contain report rows.')}
          <button type="button" className="ms-2 min-h-11 px-3 rounded border" onClick={ledger.retry}>{reportText('r.retry', 'Retry')}</button></div>}
        {ledger.loading && <p role="status">{reportText('r.reading-the-stock-history', 'Reading the stock history…')}</p>}
        {byLocation && (
          <>
            <p className="text-sm text-[var(--muted)]">
              {reportText('r.value-is-what-the-stock-moves-booked-the-cost-ea', 'Value is what the stock moves booked (the cost each change carried). An item its history does not explain is shown with the reason and is not split across locations — the same rule as Inventory Valuation.')}
            </p>
            <ReportSchedule columnControls allowDisplayedExport={!inventoryPartial} rows={locationRows}
              rowKey={({ item, location }) => JSON.stringify([item.itemId, location?.locationId ?? null])}
              caption={reportText('r.value-by-location', 'Value by location')} captionClassName="sr-only"
              columns={[
                { header: reportText('r.location', 'Location'), cell: ({ location }) => location === null ? '—' :
                  <bdi>{location.locationId ? locationName.get(location.locationId) || location.locationId : reportText('r.no-location', 'No location')}</bdi> },
                { header: reportText('r.item', 'Item'), rowHeader: true, cell: ({ item }) => <>
                  <bdi>{item.itemName}</bdi>{item.unknownReason && <span className="block text-xs text-amber-800 dark:text-amber-300">{item.unknownReason}</span>}
                  {item.note && <span className="block text-xs text-[var(--muted)]">{item.note}</span>}</> },
                { header: reportText('r.quantity', 'Quantity'), align: 'right', cell: r => r.quantity ?? '' },
                { header: reportText('r.value', 'Value'), align: 'right', cell: r => r.value === null ? '' : money(r.value) },
                { header: reportText('r.average-cost', 'Average cost'), align: 'right', cell: r => r.cost === null ? '' : money(r.cost) },
              ]}
              footer={<><tr className="border-t border-[var(--line)] font-semibold">
                    <th scope="row" colSpan={2} className="py-2 pe-3 text-start">{reportText('r.total-value-of-the-items-the-history-explains', 'Total value of the items the history explains')}</th>
                    <td className="py-2" />
                    <td className="py-2 pe-3 text-right font-mono">{money(byLocation.knownValueCents)}</td>
                    <td className="py-2" />
                  </tr>
                  {byLocation.byLocation.map(t => (
                    <tr key={t.locationId} className="text-[var(--muted)]">
                      <th scope="row" className="py-1.5 pe-3 text-start font-normal">{t.locationId ? locationName.get(t.locationId) || t.locationId : reportText('r.no-location', 'No location')}</th>
                      <td className="py-1.5 pe-3">{t.items} {reportText('r.item-lines', 'item lines')}</td>
                      <td className="py-1.5 pe-3 text-right font-mono">{t.quantity}</td>
                      <td className="py-1.5 pe-3 text-right font-mono">{money(t.valueCents)}</td>
                      <td className="py-1.5" />
                    </tr>
                  ))}</>} />
            <p className="text-xs text-[var(--muted)]">
              {byLocation.unknownItems > 0 && `${fill(reportText('r.0-item-1-could-not-be-valued-the-reason-is-on-it', '{0} item{1} could not be valued (the reason is on its row).'), { 0: byLocation.unknownItems, 1: byLocation.unknownItems === 1 ? '' : 's' })} `}
              {byLocation.negativeStockItems > 0 && `${fill(reportText('r.0-item-1-negative-stock-valued-at-zero', '{0} item{1} negative stock (valued at zero).'), { 0: byLocation.negativeStockItems, 1: byLocation.negativeStockItems === 1 ? ' has' : 's have' })} `}
              {reportText('r.location-rows-for-an-item-add-up-to-the-value-it', 'Location rows for an item add up to the value its moves booked.')}
            </p>
          </>
        )}
      </section>

      <section aria-label={reportText('r.value-by-lot', 'Value by lot')} className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold">{reportText('r.by-lot', 'By lot')}</h3>
          <button type="button" data-print-hide
            onClick={() => downloadCsv('stock-value-by-lot', STOCK_VALUE_LOT_CSV_HEADERS, stockValueLotCsvRows(lots.rows))}
            disabled={!lots.rows.length || lotIncomplete}
            className="min-h-11 px-3 py-1.5 rounded border text-sm disabled:opacity-50">
            {reportText('r.download-csv', 'Download CSV')}
          </button>
        </div>
        <p role="note" className="text-sm text-amber-800 dark:text-amber-300">{reportText('r.lot-scope', 'Lot figures cover all loaded receipts and sales, not stock on the valuation date. On-hand per lot is not tracked.')}</p>
        {ordersError && !purchaseOrdersProp && <div role="alert">{ordersError.message}
          <button className="ms-2 min-h-11 px-3 rounded border" type="button" onClick={retryOrders}>{reportText('r.retry', 'Retry')}</button></div>}
        {lots.rows.length === 0 ? !lotIncomplete && (
          <p className="text-sm text-[var(--muted)]">{reportText('r.no-received-lots-yet-record-a-lot-on-a-goods-rec', 'No received lots yet: record a lot on a goods receipt (Purchase orders → Receive goods).')}</p>
        ) : (
          <ReportSchedule
            columnControls
            allowDisplayedExport={!lotIncomplete}
            caption={reportText('r.value-by-lot', 'Value by lot')}
            captionClassName="sr-only"
            headRowClassName="border-b border-[var(--line)] text-start text-[var(--muted)]"
            rowClassName="border-b border-[var(--line)]/50"
            bodyClassName=""
            rows={lots.rows} rowKey={r => JSON.stringify([r.itemId, r.lotNumber])}
            footer={<tr className="border-t border-[var(--line)] font-semibold">
                  <th scope="row" colSpan={4} className="py-2 pe-3 text-start">{reportText('r.total-received-value', 'Total received value')}</th>
                  <td className="py-2 pe-3 text-right font-mono">{money(lots.receivedValueCents)}</td>
                  <td className="py-2" colSpan={3} />
                </tr>}
            columns={[
              { header: reportText('r.item', 'Item'), className: 'py-1.5', cell: r => r.itemName },
              { header: reportText('r.lot', 'Lot'), rowHeader: true, className: 'py-1.5', cell: r => r.lotNumber },
              { header: reportText('r.expiry', 'Expiry'), className: 'py-1.5', cell: r => r.expiryDates.map(dates.dateText).join('; ') || '—' },
              { header: reportText('r.received', 'Received'), align: 'right', className: 'py-1.5 font-mono', cell: r => r.receivedQty },
              { header: reportText('r.received-value', 'Received value'), align: 'right', className: 'py-1.5 font-mono', cell: r => money(r.receivedValueCents) },
              { header: reportText('r.arrival-cost', 'Arrival cost'), align: 'right', className: 'py-1.5 font-mono', cell: r => money(r.unitCostCents) },
              { header: reportText('r.receipts', 'Receipts'), className: 'py-1.5', cell: r => r.receiptNumbers.join('; ') },
              { header: reportText('r.sold-reference', 'Sold (reference)'), align: 'right', className: 'py-1.5 font-mono', cell: r => r.soldQty || '' },
            ]} />
        )}
      </section>
    </section>
  );
}
