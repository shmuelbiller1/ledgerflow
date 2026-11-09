import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { db } from '../../firebase';
import { collection, getDocs, query, where } from '../../lib/db/firestore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useCollection } from '../../hooks/useCollection';
import { useEntityOperations } from '../../hooks/useEntityOperations';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { downloadCsv } from '../../lib/csvExport';
import { resolveDimensionLabel } from '../../lib/dimensionUtils';
import ReportTableScroll from './ReportTableScroll';
import { reorderSuggestions, reorderDraftOrders, type ReorderGroup } from '../../lib/reorderSuggestions';
import { locationReorderSuggestions, type UnplacedItem } from '../../lib/locationLevels';
import type { StockMove } from '../../lib/stockMoves';
import type { InventoryItem, PurchaseOrder } from '../../types';

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
  const inventory = useLedgerStore(state => state.inventory);
  const vendors = useLedgerStore(state => state.vendors);
  const bills = useLedgerStore(state => state.bills);
  const truncated = useLedgerStore(state => state.truncatedCollections);
  const failed = useDataNeedsStore(state => state.failed);
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  const { loading } = useLedgerCollections('inventory', 'vendors', 'bills');
  const { data: purchaseOrders, loading: ordersLoading, truncated: ordersTruncated } = useCollection<PurchaseOrder>('purchaseOrders', { orderByField: 'createdAt', orderDirection: 'desc', limit: PURCHASE_ORDER_CAP });
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
  const itemsHere = useMemo(() => ((inventory || []) as InventoryItem[]).filter(inWorkspace), [inventory, inWorkspace]);
  const billsHere = useMemo(() => (bills || []).filter(inWorkspace).filter(homeDoc), [bills, inWorkspace, homeDoc]);
  const ordersHere = useMemo(() => (purchaseOrders || []).filter(inWorkspace).filter(homeDoc), [purchaseOrders, inWorkspace, homeDoc]);
  const vendorsHere = useMemo(() => (vendors || []).filter(inWorkspace), [vendors, inWorkspace]);

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
  const partial = truncated.inventory || truncated.vendors || truncated.bills || failed.inventory || failed.vendors || failed.bills || ordersTruncated;

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

  const heads = mode === 'location'
    ? ['Item', 'SKU', 'Location', 'On hand', 'Minimum', 'Maximum', 'To order', 'Unit cost', 'Value', 'Cost from']
    : ['Item', 'SKU', 'On hand', 'Reorder point', 'To order', 'Unit cost', 'Value', 'Cost from'];
  const movesLoading = mode === 'location' && movesByItem === null && !movesError;

  return <section aria-label="Reorder suggestions" className="p-4 space-y-4 min-w-0">
    <h2>Reorder suggestions</h2>
    <p className="text-sm text-[var(--muted)]">
      Stock items whose quantity on hand dropped below their reorder point, grouped by the vendor each was
      last bought from (bills and purchase orders, in the workspace currency {home}), with the suggested
      quantity rounded up to whole packages. Creating purchase orders writes <b>drafts</b> only: they carry
      the next order numbers and a note to check them, and nothing is approved, received or posted. Items in
      the &quot;no preferred vendor yet&quot; group were never bought, so they cannot be drafted — order them once or
      set a price on the item. Purchases recorded in another currency are not used as unit costs here.
      By location, items with a minimum and maximum per location suggest a top-up to the maximum where a
      location fell below its minimum — only when the stock history proves where the stock sits.
    </p>

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1 text-sm">Suggest by
        <select aria-label="Suggest by" value={mode} onChange={e => setMode(e.target.value as typeof mode)}
          className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]">
          <option value="total">Total stock (reorder point)</option>
          <option value="location">Location (minimum / maximum)</option>
        </select>
      </label>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={!vendorGroups.length || busy || !canCreate || isGuest || loading || ordersLoading || movesLoading}
        onClick={createDrafts}>
        {busy ? 'Creating drafts…' : `Create ${vendorGroups.length ? vendorGroups.length : ''} draft purchase order${vendorGroups.length === 1 ? '' : 's'}`}
      </button>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={!shown.length}
        onClick={() => downloadCsv('reorder-suggestions', mode === 'location' ? LOCATION_CSV_HEADERS : CSV_HEADERS, csvRows(shown))}>Export CSV</button>
    </div>
    {!canCreate && <p className="text-sm text-[var(--muted)]">A viewer reads this report; creating drafts takes an owner, accountant or bookkeeper.</p>}
    {isGuest && <p className="text-sm text-[var(--muted)]">A guest workspace has no signed-in user, so drafts cannot be saved here.</p>}
    {created.length > 0 && <p role="status" className="text-sm">Created: {created.join(', ')} — drafts wait under Purchases.</p>}

    {(loading || ordersLoading) && <p role="status" className="text-sm text-[var(--muted)]">Loading items, vendors and purchases…</p>}
    {movesLoading && <p role="status" className="text-sm text-[var(--muted)]">Reading where the stock sits…</p>}
    {movesError && <p role="alert" className="text-sm text-amber-700">The stock history could not be read: {movesError}</p>}
    {partial && <p role="alert" className="text-sm text-[var(--muted)]">Some loaded lists are capped or failed at the database. Suggestions may be incomplete.</p>}
    {mode === 'total' && !loading && !shown.length && <p className="text-sm text-[var(--muted)]">Nothing is below its reorder point. Reorder points are set on the items in Inventory.</p>}
    {mode === 'location' && !movesLoading && !leveledItems.length && <p className="text-sm text-[var(--muted)]">No item has stock levels per location yet. Set a minimum and maximum per location on the item in Inventory.</p>}
    {mode === 'location' && !movesLoading && leveledItems.length > 0 && !shown.length && !located.unplaced.length && <p className="text-sm text-[var(--muted)]">Nothing is below its location minimum.</p>}
    <p className="text-sm">
      {mode === 'location'
        ? `${totalLines} location(s) below their minimum across ${shown.length} group(s)`
        : `${totalLines} item(s) below their reorder point across ${shown.length} group(s)`}
    </p>
    {mode === 'location' && located.unplaced.length > 0 && (
      <div className="space-y-1">
        <h3 className="text-base font-semibold">Not placed by location ({located.unplaced.length})</h3>
        <p className="text-sm text-[var(--muted)]">These items have levels, but the stock history does not prove where their stock sits — so nothing is suggested for them.</p>
        <ul className="text-sm list-disc list-inside">
          {located.unplaced.map(u => <li key={u.itemId}><bdi>{u.name}</bdi> — {u.reason}</li>)}
        </ul>
      </div>
    )}

    {shown.map(group => <div key={group.vendorId || 'none'} className="space-y-1">
      <h3 className="text-base font-semibold">
        <bdi>{group.vendorName}</bdi> · {group.lines.length} item(s) · about {formatCurrency(group.totalCents, home)}
      </h3>
      <ReportTableScroll>
        <table className="w-full text-sm">
          <caption>What to reorder from {group.vendorName}</caption>
          <thead>
            <tr>{heads.map(head =>
              <th key={head} scope="col" className="text-left py-1 px-2">{head}</th>)}</tr>
          </thead>
          <tbody>
            {group.lines.map(line => <tr key={line.locationId ? `${line.itemId}:${line.locationId}` : line.itemId} className="border-b border-[var(--line)]/50">
              <th scope="row" className="text-left font-normal py-1 px-2"><bdi>{line.name}</bdi></th>
              <td className="py-1 px-2"><bdi>{line.sku || '—'}</bdi></td>
              {mode === 'location' && <td className="py-1 px-2"><bdi>{line.locationName || '—'}</bdi></td>}
              <td className="py-1 px-2">{line.onHand}{line.unit ? ` ${line.unit}` : ''}</td>
              <td className="py-1 px-2">{line.reorderPoint}{line.unit ? ` ${line.unit}` : ''}</td>
              {mode === 'location' && <td className="py-1 px-2">{line.maxLevel ?? '—'}{line.maxLevel !== undefined && line.unit ? ` ${line.unit}` : ''}</td>}
              <td className="py-1 px-2"><b>{line.suggestedQuantity}</b>{line.unit ? ` ${line.unit}` : ''}</td>
              <td className="py-1 px-2">{line.unitCostCents ? formatCurrency(line.unitCostCents, home) : '—'}</td>
              <td className="py-1 px-2">{line.unitCostCents ? formatCurrency(Math.round(line.unitCostCents * line.suggestedQuantity), home) : '—'}</td>
              <td className="py-1 px-2">{line.costSource === 'vendor-history' ? 'last purchase' : 'item record'}</td>
            </tr>)}
          </tbody>
        </table>
      </ReportTableScroll>
    </div>)}
  </section>;
}
