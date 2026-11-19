import { usePartialReportInputs } from '../../hooks/usePartialReportInputs';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { db } from '../../firebase';
import { collection, getDocs, query, where } from '../../lib/db/firestore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useCollection } from '../../hooks/useCollection';
import { useEntityOperations } from '../../hooks/useEntityOperations';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { downloadCsv } from '../../lib/csvExport';
import { resolveDimensionLabel } from '../../lib/dimensionUtils';
import ReportSchedule from './ReportSchedule';
import { reorderSuggestions, reorderDraftOrders, type ReorderGroup } from '../../lib/reorderSuggestions';
import { locationReorderSuggestions, type UnplacedItem } from '../../lib/locationLevels';
import type { StockMove } from '../../lib/stockMoves';
import type { InventoryItem, PurchaseOrder } from '../../types';
import { useReportText, fill } from './useReportText';

const CSV_HEADERS = ['Vendor', 'Item', 'SKU', 'On hand', 'Reorder point', 'Suggested quantity', 'Unit', 'Unit cost (minor units)', 'Value (minor units)', 'Unit cost source', 'Currency'];
const LOCATION_CSV_HEADERS = ['Vendor', 'Item', 'SKU', 'Location', 'On hand', 'Minimum', 'Maximum', 'Suggested quantity', 'Unit', 'Unit cost (minor units)', 'Value (minor units)', 'Unit cost source', 'Currency'];
const PURCHASE_ORDER_CAP = 500;

/**
 * A-50 (screen task A-173): reorder suggestions. Stock items below their reorder point, grouped by
 * the vendor they were last bought from, with a suggested quantity made of whole packages. "Create
 * draft purchase orders" writes one draft per vendor through the same addEntity path the purchase
 * order screen uses — drafts carry the next order numbers and a note to check them, and nothing is
 * approved, received or posted. Unit costs come from home-currency bills or orders: amounts recorded
 * in another currency are not used as unit costs, because no rate is guessed here.
 *
 * A-115: the "by location" mode suggests per Location minimum/maximum instead (a top-up to the
 * maximum where a location fell below its minimum). A location's stock is read from the item's
 * stock-moves ledger and used only when the history proves the split; items it does not prove are
 * listed with the reason and never suggested.
 */
export default function ReorderSuggestionsReportView({ loadItemMoves }: { loadItemMoves?: (itemId: string) => Promise<StockMove[]> } = {}) {
  const reportText = useReportText();
  const inventory = useLedgerStore(state => state.inventory);
  const vendors = useLedgerStore(state => state.vendors);
  const bills = useLedgerStore(state => state.bills);
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  const { loading } = useLedgerCollections('inventory', 'vendors', 'bills');
  const { data: purchaseOrders, loading: ordersLoading, truncated: ordersTruncated, error: ordersError } = useCollection<PurchaseOrder>('purchaseOrders', { orderByField: 'createdAt', orderDirection: 'desc', limit: PURCHASE_ORDER_CAP });
  const { addEntity } = useEntityOperations();
  const role = useCurrentRole();
  const isGuest = useAuthStore(state => state.isGuest);
  const canCreate = role === 'owner' || role === 'accountant' || role === 'bookkeeper';
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string[]>([]);
  const [mode, setMode] = useState<'total' | 'location'>('total');
  const [loadedMoves, setLoadedMoves] = useState<{ key: string; byItem: Map<string, StockMove[]> } | null>(null);
  const [movesFailure, setMovesFailure] = useState<{ key: string; message: string } | null>(null);
  const nodes = useLedgerStore(state => state.dimensionNodes || []);

  const home = workspace?.currency || 'USD';
  const today = getLocalDateISO();
  const locationName = useCallback((id: string) => (!id ? 'No location' : resolveDimensionLabel(nodes, 'location', id)), [nodes]);

  const inWorkspace = useCallback(<T extends { workspaceId?: string }>(row: T) => !workspaceId || !row.workspaceId || row.workspaceId === workspaceId, [workspaceId]);
  // Unit prices are read from home-currency purchases only: a bill or order in another currency
  // records the vendor but its price needs a rate, and no rate is guessed on this screen.
  const homeDoc = useCallback((doc: { currency?: string }) => !doc.currency || doc.currency === home, [home]);
  const itemsHere = useMemo(() => ((inventory || []) as InventoryItem[]).filter(row => inWorkspace(row)), [inventory, inWorkspace]);
  const billsHere = useMemo(() => (bills || []).filter(row => inWorkspace(row)).filter(doc => homeDoc(doc)), [bills, inWorkspace, homeDoc]);
  const ordersHere = useMemo(() => (purchaseOrders || []).filter(row => inWorkspace(row)).filter(doc => homeDoc(doc)), [purchaseOrders, inWorkspace, homeDoc]);
  const vendorsHere = useMemo(() => (vendors || []).filter(row => inWorkspace(row)), [vendors, inWorkspace]);

  const groups = useMemo(() => reorderSuggestions({
    items: itemsHere, bills: billsHere, orders: ordersHere, vendors: vendorsHere,
  }), [itemsHere, billsHere, ordersHere, vendorsHere]);

  const leveledItems = useMemo(
    () => itemsHere.filter(i => i.itemType !== 'service' && !i.consignment && Object.keys(i.locationLevels || {}).length > 0),
    [itemsHere],
  );
  // A loader passed inline is a new function every render; reading through a ref keeps one read per mode and item list.
  const movesLoaderRef = useRef(loadItemMoves);
  useEffect(() => { movesLoaderRef.current = loadItemMoves; });

  // What the moves were read for, as one stable string; a result for anything else is still loading, never shown stale.
  const movesKey = JSON.stringify([workspaceId || '', leveledItems.map(i => i.id)]);
  useEffect(() => {
    if (mode !== 'location') return;
    let live = true;
    const key = movesKey;
    const [wid, ids] = JSON.parse(key) as [string, string[]];
    const loader = movesLoaderRef.current;
    const read = (itemId: string) => (loader
      ? loader(itemId)
      : getDocs(query(
        collection(db, 'stockMoves'),
        where('workspaceId', '==', wid),
        where('itemId', '==', itemId),
      )).then(snap => snap.docs.map(d => ({ ...(d.data() as StockMove), id: d.id }))));
    Promise.all(ids.map(async itemId => [itemId, await read(itemId)] as const)).then(
      entries => { if (live) setLoadedMoves({ key, byItem: new Map(entries) }); },
      err => { if (live) setMovesFailure({ key, message: err instanceof Error ? err.message : String(err) }); },
    );
    return () => { live = false; };
  }, [mode, movesKey]);
  const movesByItem = mode === 'location' && loadedMoves?.key === movesKey ? loadedMoves.byItem : null;
  const movesError = mode === 'location' && movesFailure?.key === movesKey ? movesFailure.message : '';

  const located = useMemo(() => (mode === 'location' && movesByItem
    ? locationReorderSuggestions({ items: leveledItems, movesByItem, bills: billsHere, orders: ordersHere, vendors: vendorsHere, locationName })
    : { groups: [] as ReorderGroup[], unplaced: [] as UnplacedItem[] }),
    [mode, movesByItem, leveledItems, billsHere, ordersHere, vendorsHere, locationName]);

  const shown = mode === 'location' ? located.groups : groups;
  const vendorGroups = shown.filter(g => g.vendorId && g.lines.length);
  const totalLines = shown.reduce((sum, g) => sum + g.lines.length, 0);
  const inputsPartial = usePartialReportInputs(['inventory', 'vendors', 'bills']);
  const partial = inputsPartial || ordersTruncated || !!ordersError;

  /**
   * Writes the drafts and reports exactly which order numbers landed: addEntity resolves to
   * nothing when the write is refused, and the failed numbers are named so none is silently lost.
   */
  const createDrafts = async (): Promise<{ made: string[]; failed: string[] }> => {
    if (!vendorGroups.length || busy) return { made: [], failed: [] };
    setBusy(true);
    setCreated([]);
    try {
      const drafts = reorderDraftOrders(vendorGroups, (purchaseOrders || []).map(po => ({ poNumber: po.poNumber })), today, workspaceId || '');
      // The numbers are assigned before this call, so the drafts save independently of order.
      const results = await Promise.all(drafts.map(draft => addEntity('purchaseOrders', draft as Record<string, unknown>)));
      const made: string[] = [];
      const failed: string[] = [];
      results.forEach((ref, at) => (ref ? made : failed).push(drafts[at].poNumber));
      if (made.length) {
        setCreated(made);
        toast.success(made.length === 1
          ? `Draft purchase order ${made[0]} created. Open it under Purchases to check and send.`
          : `${made.length} draft purchase orders created (${made.join(', ')}). Open them under Purchases to check and send.`);
      }
      if (failed.length) toast.error(`${failed.join(', ')} ${failed.length === 1 ? 'was' : 'were'} not created; check the list of drafts before trying again.`);
      return { made, failed };
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The draft purchase orders were not created; no changes were saved.');
      return { made: [], failed: [] };
    } finally {
      setBusy(false);
    }
  };

  const csvRows = (list: ReorderGroup[]) => list.flatMap(g =>
    g.lines.map(line => (mode === 'location'
      ? [g.vendorName, line.name, line.sku, line.locationName || '', line.onHand, line.reorderPoint, line.maxLevel ?? '', line.suggestedQuantity, line.unit, line.unitCostCents, Math.round(line.unitCostCents * line.suggestedQuantity), line.costSource, home]
      : [g.vendorName, line.name, line.sku, line.onHand, line.reorderPoint, line.suggestedQuantity, line.unit, line.unitCostCents, Math.round(line.unitCostCents * line.suggestedQuantity), line.costSource, home])));

  const movesLoading = mode === 'location' && movesByItem === null && !movesError;

  return <section aria-label={reportText('r.reorder-suggestions', 'Reorder suggestions')} className="p-4 space-y-4 min-w-0">
    <h2>{reportText('r.reorder-suggestions', 'Reorder suggestions')}</h2>
    <p className="text-sm text-[var(--muted)]">
      {reportText('r.stock-items-whose-quantity-on-hand-dropped-below', 'Stock items whose quantity on hand dropped below their reorder point, grouped by the vendor each was last bought from (bills and purchase orders, in the workspace currency')} {home}{reportText('r.with-the-suggested-quantity-rounded-up-to-whole', '), with the suggested quantity rounded up to whole packages. Creating purchase orders writes')} <b>{reportText('r.drafts', 'drafts')}</b> {reportText('r.only-they-carry-the-next-order-numbers-and-a-not', 'only: they carry the next order numbers and a note to check them, and nothing is approved, received or posted. Items in the "no preferred vendor yet" group were never bought, so they cannot be drafted — order them once or set a price on the item. Purchases recorded in another currency are not used as unit costs here. By location, items with a minimum and maximum per location suggest a top-up to the maximum where a location fell below its minimum — only when the stock history proves where the stock sits.')}
    </p>

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1 text-sm">{reportText('r.suggest-by', 'Suggest by')}
        <select aria-label={reportText('r.suggest-by', 'Suggest by')} value={mode} onChange={e => setMode(e.target.value as typeof mode)}
          className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]">
          <option value="total">{reportText('r.total-stock-reorder-point', 'Total stock (reorder point)')}</option>
          <option value="location">{reportText('r.location-minimum-maximum', 'Location (minimum / maximum)')}</option>
        </select>
      </label>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={!vendorGroups.length || busy || !canCreate || isGuest || loading || ordersLoading || movesLoading}
        onClick={createDrafts}>
        {busy ? reportText('r.creating-drafts', 'Creating drafts…') : (vendorGroups.length === 1 ? reportText('r.create-one-draft-po', 'Create 1 draft purchase order') : fill(reportText('r.create-n-draft-pos', 'Create {n} draft purchase orders'), { n: vendorGroups.length || '' }))}
      </button>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={!shown.length}
        onClick={() => downloadCsv('reorder-suggestions', mode === 'location' ? LOCATION_CSV_HEADERS : CSV_HEADERS, csvRows(shown))}>{reportText('r.export-csv', 'Export CSV')}</button>
    </div>
    {!canCreate && <p className="text-sm text-[var(--muted)]">{reportText('r.a-viewer-reads-this-report-creating-drafts-takes', 'A viewer reads this report; creating drafts takes an owner, accountant or bookkeeper.')}</p>}
    {isGuest && <p className="text-sm text-[var(--muted)]">{reportText('r.a-guest-workspace-has-no-signed-in-user-so-draft', 'A guest workspace has no signed-in user, so drafts cannot be saved here.')}</p>}
    {created.length > 0 && <p role="status" className="text-sm">{reportText('r.created', 'Created:')} {created.join(', ')} {reportText('r.drafts-wait-under-purchases', '— drafts wait under Purchases.')}</p>}

    {(loading || ordersLoading) && <p role="status" className="text-sm text-[var(--muted)]">{reportText('r.loading-items-vendors-and-purchases', 'Loading items, vendors and purchases…')}</p>}
    {movesLoading && <p role="status" className="text-sm text-[var(--muted)]">{reportText('r.reading-where-the-stock-sits', 'Reading where the stock sits…')}</p>}
    {movesError && <p role="alert" className="text-sm text-amber-700">{reportText('r.the-stock-history-could-not-be-read', 'The stock history could not be read:')} {movesError}</p>}
    {partial && <p role="alert" className="text-sm text-[var(--muted)]">{reportText('r.some-loaded-lists-are-capped-or-failed-at-the-da', 'Some loaded lists are capped or failed at the database. Suggestions may be incomplete.')}</p>}
    {mode === 'total' && !loading && !shown.length && <p className="text-sm text-[var(--muted)]">{reportText('r.nothing-is-below-its-reorder-point-reorder-point', 'Nothing is below its reorder point. Reorder points are set on the items in Inventory.')}</p>}
    {mode === 'location' && !movesLoading && !leveledItems.length && <p className="text-sm text-[var(--muted)]">{reportText('r.no-item-has-stock-levels-per-location-yet-set-a', 'No item has stock levels per location yet. Set a minimum and maximum per location on the item in Inventory.')}</p>}
    {mode === 'location' && !movesLoading && leveledItems.length > 0 && !shown.length && !located.unplaced.length && <p className="text-sm text-[var(--muted)]">{reportText('r.nothing-is-below-its-location-minimum', 'Nothing is below its location minimum.')}</p>}
    <p className="text-sm">
      {mode === 'location'
        ? fill(reportText('r.locations-below-min', '{n} location(s) below their minimum across {groups} group(s)'), { n: totalLines, groups: shown.length })
        : fill(reportText('r.items-below-reorder', '{n} item(s) below their reorder point across {groups} group(s)'), { n: totalLines, groups: shown.length })}
    </p>
    {mode === 'location' && located.unplaced.length > 0 && (
      <div className="space-y-1">
        <h3 className="text-base font-semibold">{reportText('r.not-placed-by-location', 'Not placed by location (')}{located.unplaced.length})</h3>
        <p className="text-sm text-[var(--muted)]">{reportText('r.these-items-have-levels-but-the-stock-history-do', 'These items have levels, but the stock history does not prove where their stock sits — so nothing is suggested for them.')}</p>
        <ul className="text-sm list-disc list-inside">
          {located.unplaced.map(u => <li key={u.itemId}><bdi>{u.name}</bdi> — {u.reason}</li>)}
        </ul>
      </div>
    )}

    {shown.map(group => <div key={group.vendorId || 'none'} className="space-y-1">
      <h3 className="text-base font-semibold">
        <bdi>{group.vendorName}</bdi> · {group.lines.length} {reportText('r.item-s-about', 'item(s) · about')} {formatCurrency(group.totalCents, home)}
      </h3>
      <ReportSchedule
        columnControls
        allowDisplayedExport={!partial && !loading && !ordersLoading && !movesLoading && !movesError}
        caption={<>{reportText('r.what-to-reorder-from', 'What to reorder from')} {group.vendorName}</>}
        rowClassName="border-b border-[var(--line)]/50"
        bodyClassName=""
        rows={group.lines} rowKey={line => JSON.stringify([line.itemId, line.locationId ?? null])}
        columns={[
          { header: reportText('r.item', 'Item'), cell: line => <bdi>{line.name}</bdi> },
          { header: reportText('r.schedule-sku', 'SKU'), cell: line => <bdi>{line.sku || '—'}</bdi> },
          mode === 'location' ? { header: reportText('r.location', 'Location'), cell: line => <bdi>{line.locationName || '—'}</bdi> } : false,
          { header: reportText('r.on-hand', 'On hand'), align: 'right', cell: line => <>{line.onHand}{line.unit ? ` ${line.unit}` : ''}</> },
          { header: mode === 'location' ? reportText('r.schedule-minimum', 'Minimum') : reportText('r.schedule-reorder-point', 'Reorder point'), align: 'right', cell: line => <>{line.reorderPoint}{line.unit ? ` ${line.unit}` : ''}</> },
          mode === 'location' ? { header: reportText('r.schedule-maximum', 'Maximum'), align: 'right', cell: line => <>{line.maxLevel ?? '—'}{line.maxLevel !== undefined && line.unit ? ` ${line.unit}` : ''}</> } : false,
          { header: reportText('r.schedule-to-order', 'To order'), align: 'right', cell: line => <><b>{line.suggestedQuantity}</b>{line.unit ? ` ${line.unit}` : ''}</> },
          { header: reportText('r.unit-cost', 'Unit cost'), align: 'right', cell: line => line.unitCostCents ? formatCurrency(line.unitCostCents, home) : '—' },
          { header: reportText('r.value', 'Value'), align: 'right', cell: line => line.unitCostCents ? formatCurrency(Math.round(line.unitCostCents * line.suggestedQuantity), home) : '—' },
          { header: reportText('r.schedule-cost-from', 'Cost from'), cell: line => line.costSource === 'vendor-history' ? reportText('r.last-purchase', 'last purchase') : reportText('r.item-record', 'item record') },
        ]} />
    </div>)}
  </section>;
}
