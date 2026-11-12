import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useEntityOperations } from '../../hooks/useEntityOperations';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { downloadCsv } from '../../lib/csvExport';
import { getLocalDateISO } from '../../lib/utils';
import {
  buildWarehousePickList,
  createShipmentRecord,
  NO_LOCATION_VALUE,
  shipmentFieldPath,
  shipmentForSource,
  shipmentProblem,
  shipmentRecordsFromMetadata,
  shipmentSourceKey,
  shipmentSourcesForOrder,
  warehouseLocationOptions,
  warehouseOrders,
  type PickListLine,
} from '../../lib/warehouseWorkflows';
import { randomWarehouseToken } from '../../lib/warehouseRecordUtils';
import { goodsLeaveWith } from '../../lib/deliveries';
import type { Estimate, InventoryItem, Invoice, Transaction } from '../../types';
import ReportTableScroll from './ReportTableScroll';

const field = 'min-h-11 min-w-0 max-w-full border rounded px-3 bg-[var(--panel)] text-[var(--text)]';
const PICK_CSV_HEADERS = ['Sales order', 'Customer', 'Location', 'Bin', 'SKU', 'Item', 'Quantity to pick'];
const displayQty = (value: number) => Number(value).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export default function PickPackShipPanel() {
  const estimates = useLedgerStore(state => state.estimates) as Estimate[];
  const invoices = useLedgerStore(state => state.invoices) as Invoice[];
  const inventory = useLedgerStore(state => state.inventory) as InventoryItem[];
  const transactions = useLedgerStore(state => state.transactions) as Transaction[];
  const nodes = useLedgerStore(state => state.dimensionNodes || []);
  const truncated = useLedgerStore(state => state.truncatedCollections);
  const failed = useDataNeedsStore(state => state.failed);
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  const user = useAuthStore(state => state.user);
  const isGuest = useAuthStore(state => state.isGuest);
  const role = useCurrentRole();
  const { loading } = useLedgerCollections('estimates', 'invoices', 'inventory', 'transactions');
  const { updateEntity } = useEntityOperations();

  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [selectedSourceKey, setSelectedSourceKey] = useState('');
  const [carrier, setCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [shippedDate, setShippedDate] = useState(getLocalDateISO());
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState(false);
  const [showPackingSlip, setShowPackingSlip] = useState(false);
  const [printRequest, setPrintRequest] = useState(0);
  const shipmentPending = useRef(false);

  const mode = goodsLeaveWith(workspace);
  const scopedItems = useMemo(() => inventory.filter(item => Boolean(workspaceId) && item.workspaceId === workspaceId), [inventory, workspaceId]);
  const scopedInvoices = useMemo(() => invoices.filter(invoice => Boolean(workspaceId) && invoice.workspaceId === workspaceId), [invoices, workspaceId]);
  const scopedTransactions = useMemo(() => transactions.filter(transaction => Boolean(workspaceId) && transaction.workspaceId === workspaceId), [transactions, workspaceId]);
  const orders = useMemo(() => warehouseOrders(estimates, workspaceId || '').filter(order =>
    order.lines.some(line => Boolean(line.itemId)),
  ), [estimates, workspaceId]);
  const locations = useMemo(() => warehouseLocationOptions(nodes, scopedItems), [nodes, scopedItems]);
  const locationId = locations.some(location => location.id === selectedLocationId)
    ? selectedLocationId
    : locations.find(location => location.status !== 'archived')?.id || locations[0]?.id || NO_LOCATION_VALUE;
  const order = orders.find(candidate => candidate.id === selectedOrderId) || orders[0];
  const canEdit = Boolean(user && !isGuest && ['owner', 'accountant', 'bookkeeper'].includes(role) && workspaceId);
  const partial = Boolean(
    truncated.estimates || failed.estimates || truncated.invoices || failed.invoices ||
    truncated.inventory || failed.inventory || truncated.transactions || failed.transactions,
  );
  const mayUseCurrentRows = !loading && !partial;
  const today = getLocalDateISO();

  const allPickRows = useMemo(() => orders.flatMap(candidate =>
    buildWarehousePickList(candidate, scopedInvoices, scopedTransactions, scopedItems, locationId, mode, nodes),
  ), [orders, scopedInvoices, scopedTransactions, scopedItems, locationId, mode, nodes]);
  const pickRows = allPickRows.filter(row => row.orderId === order?.id);
  const shipmentSources = useMemo(() => order
    ? shipmentSourcesForOrder(order, scopedInvoices, scopedTransactions, scopedItems, mode)
    : [], [order, scopedInvoices, scopedTransactions, scopedItems, mode]);
  const unshippedSources = shipmentSources.filter(source => !order || !shipmentForSource(order.metadata, source));
  const existingShipments = useMemo(() => order
    ? shipmentRecordsFromMetadata(order.metadata).filter(record => record.workspaceId === workspaceId && record.orderId === order.id)
    : [], [order, workspaceId]);
  const currentSource = unshippedSources.find(source => shipmentSourceKey(source.sourceType, source.sourceId) === selectedSourceKey) || unshippedSources[0];

  useEffect(() => {
    if (!showPackingSlip) return;
    const printClass = 'warehouse-packing-print';
    const clear = () => document.body.classList.remove(printClass);
    document.body.classList.add(printClass);
    window.addEventListener('afterprint', clear, { once: true });
    if (typeof window.print === 'function') window.print();
    return () => {
      window.removeEventListener('afterprint', clear);
      clear();
    };
  }, [showPackingSlip, printRequest]);

  const markShipped = async () => {
    if (shipmentPending.current) return;
    setProblem('');
    if (!order || !currentSource) {
      setProblem('Choose an existing delivery or issued invoice first.');
      return;
    }
    if (!mayUseCurrentRows) {
      setProblem('Shipment records are read-only while one of the required lists is still loading, capped, or failed.');
      return;
    }
    if (!user || !workspaceId || !canEdit) {
      setProblem('You do not have permission to record shipment tracking.');
      return;
    }
    const existing = shipmentForSource(order.metadata, currentSource);
    const refused = shipmentProblem({ source: currentSource, existing, carrier, trackingNumber, shippedDate, today });
    if (refused) {
      setProblem(refused);
      return;
    }
    let token: string;
    try {
      token = randomWarehouseToken().toLowerCase();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Secure ID generation is unavailable.');
      return;
    }
    const record = createShipmentRecord({
      id: `ship_${token}`,
      workspaceId,
      orderId: order.id,
      source: currentSource,
      carrier,
      trackingNumber,
      shippedDate,
      recordedAt: new Date().toISOString(),
      actor: { uid: user.uid, name: user.displayName || user.email || 'Workspace user', role },
    });
    const path = shipmentFieldPath(currentSource.sourceType, currentSource.sourceId);
    if (!path) {
      setProblem('The selected fulfilment record has an invalid identifier.');
      return;
    }
    shipmentPending.current = true;
    setSaving(true);
    try {
      await updateEntity('estimates', order.id, { [path]: record } as Record<string, unknown>, `Shipment tracking recorded for ${order.number || order.id}.`);
      setCarrier('');
      setTrackingNumber('');
      setProblem('');
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Shipment tracking could not be saved.');
    } finally {
      shipmentPending.current = false;
      setSaving(false);
    }
  };

  const rowsForCsv = allPickRows.map(row => [
    row.orderNumber, row.customerName, row.locationName, row.bin || 'Unassigned', row.sku, row.description, row.quantityToPick,
  ]);
  const selectedLocation = locations.find(location => location.id === locationId);

  return <section aria-label="Pick, pack and ship" className="space-y-4 min-w-0">
    <style>{`
      @media print {
        /* H-7 (AI #10): the slip is the print root, so the shared rules in src/index.css narrow the
           paper to it. The body class is kept for the one thing those rules do not do here — the
           slip's own white paper box — and as a fallback for an engine without :has(). */
        body.warehouse-packing-print * { visibility: hidden !important; }
        body.warehouse-packing-print [data-warehouse-packing-slip],
        body.warehouse-packing-print [data-warehouse-packing-slip] * { visibility: visible !important; }
        body.warehouse-packing-print [data-warehouse-packing-slip] {
          position: static !important; width: 100% !important;
          padding: 24px !important; background: white !important; color: black !important;
        }
      }
    `}</style>
    <div>
      <h3 className="text-lg font-semibold">Pick, pack and ship</h3>
      <p className="text-sm text-[var(--muted)]">Pick quantities come from open sales-order lines, using issued invoices when goods leave with an invoice, or posted deliveries and returns when goods leave with a delivery. Printing a packing slip is read-only. A shipped mark adds carrier and tracking details to an existing fulfilment record; it does not deliver goods, reduce stock, create an invoice, or post money.</p>
    </div>

    {loading && <p role="status" className="text-sm text-[var(--muted)]">Loading orders, invoices, inventory and stock movements…</p>}
    {partial && <p role="alert" className="text-sm text-[var(--warning,#b45309)]">At least one required list is capped or failed. Pick quantities may be incomplete; printing and shipment edits are disabled until the lists are complete.</p>}
    {mode === 'delivery'
      ? <p className="text-sm text-[var(--muted)]">This workspace moves stock when a delivery is recorded. Use the existing Sales order delivery workflow before adding shipment tracking here.</p>
      : <p className="text-sm text-[var(--muted)]">This workspace moves stock when an invoice is issued. Only issued invoices can be marked shipped here.</p>}

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex min-w-0 max-w-full flex-col gap-1 text-sm">Pick location
        <select aria-label="Warehouse pick location" className={field} value={locationId} onChange={event => setSelectedLocationId(event.target.value)}>
          {!locations.length && <option value={NO_LOCATION_VALUE}>No Location values configured</option>}
          {locations.map(location => <option key={location.id} value={location.id}>{location.description || location.id}{location.status === 'archived' ? ' (archived)' : ''}</option>)}
        </select>
      </label>
      <label className="flex min-w-0 max-w-full flex-col gap-1 text-sm">Sales order
        <select aria-label="Pick and ship sales order" className={field} value={order?.id || ''} onChange={event => {
          setSelectedOrderId(event.target.value);
          setSelectedSourceKey('');
          setCarrier('');
          setTrackingNumber('');
          setProblem('');
          setShowPackingSlip(false);
        }}>
          {orders.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.number || candidate.id} — {candidate.customerName || 'Customer'}</option>)}
        </select>
      </label>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)] disabled:opacity-50"
        disabled={!pickRows.length || !mayUseCurrentRows || locationId === NO_LOCATION_VALUE}
        onClick={() => { setShowPackingSlip(true); setPrintRequest(current => current + 1); }}>Print packing slip</button>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)] disabled:opacity-50"
        disabled={!allPickRows.length || !mayUseCurrentRows}
        onClick={() => downloadCsv(`warehouse-pick-list-${today}`, PICK_CSV_HEADERS, rowsForCsv)}>Export pick list CSV</button>
    </div>

    {!orders.length && !loading && <p className="text-sm text-[var(--muted)]">No accepted sales orders with inventory lines are loaded.</p>}
    {orders.length > 0 && !locations.length && <p className="text-sm text-[var(--muted)]">Create a Location value in Labels and assign bins before printing a location-specific pick list.</p>}

    <ReportTableScroll>
      <table className="w-full text-sm">
        <caption>Open pick list for {order?.number || order?.id || 'selected sales order'}{selectedLocation ? ` at ${selectedLocation.description || selectedLocation.id}` : ''}</caption>
        <thead><tr>
          <th scope="col" className="text-left py-2 px-2">Bin</th>
          <th scope="col" className="text-left py-2 px-2">SKU</th>
          <th scope="col" className="text-left py-2 px-2">Item</th>
          <th scope="col" className="text-right py-2 px-2">Quantity to pick</th>
        </tr></thead>
        <tbody>
          {pickRows.map(row => <PickRow key={`${row.orderId}:${row.linePosition}`} row={row} />)}
        </tbody>
      </table>
      {order && !pickRows.length && <p className="p-3 text-sm text-[var(--muted)]">No remaining stock quantities to pick for this sales order at the selected Location.</p>}
    </ReportTableScroll>

    <div className="rounded border border-[var(--line)] p-3 space-y-3">
      <h4 className="font-semibold">Record an existing shipment</h4>
      {!shipmentSources.length
        ? <p className="text-sm text-[var(--muted)]">No existing {mode === 'delivery' ? 'delivery' : 'issued invoice'} with stock lines is available for this order. Record the normal fulfilment first; this form never creates it.</p>
        : <>
          <label className="flex min-w-0 max-w-full flex-col gap-1 text-sm max-w-2xl">Existing {mode === 'delivery' ? 'delivery' : 'issued invoice'}
            <select aria-label="Existing shipment source" className={field} value={currentSource ? shipmentSourceKey(currentSource.sourceType, currentSource.sourceId) : ''}
              onChange={event => {
                setSelectedSourceKey(event.target.value);
                setCarrier('');
                setTrackingNumber('');
                setProblem('');
              }}>
              {unshippedSources.map(source => <option key={shipmentSourceKey(source.sourceType, source.sourceId)} value={shipmentSourceKey(source.sourceType, source.sourceId)}>{source.label} · {source.date || 'date not recorded'}</option>)}
              {!unshippedSources.length && <option value="">All current fulfilments are marked shipped</option>}
            </select>
          </label>
          {unshippedSources.length > 0 && <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-0 max-w-full flex-col gap-1 text-sm">Carrier
              <input aria-label="Shipment carrier" className={field} maxLength={80} value={carrier} onChange={event => setCarrier(event.target.value)} placeholder="Carrier name" />
            </label>
            <label className="flex min-w-0 max-w-full flex-col gap-1 text-sm">Tracking number
              <input aria-label="Shipment tracking number" className={field} maxLength={120} value={trackingNumber} onChange={event => setTrackingNumber(event.target.value)} placeholder="Tracking reference" />
            </label>
            <label className="flex min-w-0 max-w-full flex-col gap-1 text-sm">Shipment date
              <input aria-label="Shipment date" type="date" className={field} max={today} value={shippedDate} onChange={event => setShippedDate(event.target.value)} />
            </label>
            <button type="button" onClick={() => { void markShipped(); }} disabled={!canEdit || !mayUseCurrentRows || !currentSource || saving}
              className="min-h-11 px-4 rounded bg-[var(--text)] text-[var(--surface)] disabled:opacity-50">{saving ? 'Saving shipment…' : 'Mark shipped'}</button>
          </div>}
          {!unshippedSources.length && <p className="text-sm text-[var(--muted)]">Every existing fulfilment source for this order already has a shipment record.</p>}
        </>}
      {problem && <p role="alert" className="text-sm text-[var(--neg)]">{problem}</p>}

      <ReportTableScroll>
        <table className="w-full text-sm">
          <caption>Shipment tracking history for {order?.number || order?.id || 'selected sales order'}</caption>
          <thead><tr>
            <th scope="col" className="text-left py-2 px-2">Source</th>
            <th scope="col" className="text-left py-2 px-2">Shipped</th>
            <th scope="col" className="text-left py-2 px-2">Carrier</th>
            <th scope="col" className="text-left py-2 px-2">Tracking number</th>
          </tr></thead>
          <tbody>
            {existingShipments.map(record => <tr key={record.id} className="border-b border-[var(--line)]/50">
              <th scope="row" className="text-left font-normal py-2 px-2">{record.label || `${record.sourceType} ${record.sourceNumber}`}</th>
              <td className="py-2 px-2">{record.shippedDate}</td>
              <td className="py-2 px-2"><bdi>{record.carrier}</bdi></td>
              <td className="py-2 px-2"><bdi>{record.trackingNumber}</bdi></td>
            </tr>)}
          </tbody>
        </table>
        {!existingShipments.length && <p className="p-3 text-sm text-[var(--muted)]">No shipment tracking has been recorded for this order.</p>}
      </ReportTableScroll>
    </div>

    {showPackingSlip && order && <article id="warehouse-packing-slip" data-print-root data-warehouse-packing-slip aria-label="Warehouse packing slip" className="rounded border border-[var(--line)] p-4 space-y-3 bg-white text-black">
      <div className="flex flex-wrap justify-between gap-3 items-start">
        <div><h4 className="text-xl font-bold">Packing slip</h4><p>Sales order: {order.number || order.id}</p><p>Customer: {order.customerName || '—'}</p><p>Location: {selectedLocation?.description || selectedLocation?.id || '—'}</p></div>
        <div><p>Printed: {today}</p><p>Goods only — prices omitted.</p></div>
      </div>
      <table className="w-full text-sm border-collapse">
        <caption>Open pick quantities only; this slip does not record a shipment.</caption>
        <thead><tr>
          <th scope="col" className="text-left border-b border-black py-2 px-2">Bin</th>
          <th scope="col" className="text-left border-b border-black py-2 px-2">SKU</th>
          <th scope="col" className="text-left border-b border-black py-2 px-2">Item</th>
          <th scope="col" className="text-right border-b border-black py-2 px-2">Quantity</th>
        </tr></thead>
        <tbody>{pickRows.map(row => <PickRow key={`slip:${row.orderId}:${row.linePosition}`} row={row} />)}</tbody>
      </table>
      <p>Prepared by: ____________________ &nbsp; Packed by: ____________________ &nbsp; Received by: ____________________</p>
      <button type="button" data-print-hide className="min-h-11 px-4 rounded border border-black" onClick={() => setShowPackingSlip(false)}>Close packing slip</button>
    </article>}
  </section>;
}

function PickRow({ row }: { row: PickListLine }) {
  return <tr className="border-b border-[var(--line)]/50">
    <td className="py-2 px-2"><bdi>{row.bin || 'Unassigned'}</bdi></td>
    <td className="py-2 px-2"><bdi>{row.sku || '—'}</bdi></td>
    <th scope="row" className="text-left font-normal py-2 px-2">{row.description}</th>
    <td className="text-right py-2 px-2">{displayQty(row.quantityToPick)}</td>
  </tr>;
}
