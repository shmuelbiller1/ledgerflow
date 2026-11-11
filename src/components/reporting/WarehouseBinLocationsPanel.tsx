import React, { useMemo, useState } from 'react';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useEntityOperations } from '../../hooks/useEntityOperations';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { deleteField } from '../../lib/db/firestore';
import { binLocationFieldPath, binLocationProblem, itemBinForLocation, warehouseLocationOptions, NO_LOCATION_VALUE } from '../../lib/warehouseWorkflows';
import type { InventoryItem, ItemBinLocation } from '../../types';
import InlineEdit from '../ui/InlineEdit';
import ReportTableScroll from './ReportTableScroll';

const field = 'min-h-11 min-w-0 max-w-full border rounded px-3 bg-[var(--panel)] text-[var(--text)]';

export default function WarehouseBinLocationsPanel() {
  const inventory = useLedgerStore(state => state.inventory) as InventoryItem[];
  const nodes = useLedgerStore(state => state.dimensionNodes || []);
  const truncated = useLedgerStore(state => state.truncatedCollections);
  const failed = useDataNeedsStore(state => state.failed);
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const user = useAuthStore(state => state.user);
  const isGuest = useAuthStore(state => state.isGuest);
  const role = useCurrentRole();
  const { loading } = useLedgerCollections('inventory');
  const { updateEntity } = useEntityOperations();
  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [query, setQuery] = useState('');

  const items = useMemo(() => inventory.filter(item => Boolean(workspaceId) && item.workspaceId === workspaceId && item.itemType !== 'service')
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })), [inventory, workspaceId]);
  const locations = useMemo(() => warehouseLocationOptions(nodes, items), [nodes, items]);
  const locationId = locations.some(option => option.id === selectedLocationId)
    ? selectedLocationId
    : locations.find(option => option.status !== 'archived')?.id || locations[0]?.id || NO_LOCATION_VALUE;
  const location = locations.find(option => option.id === locationId);
  const locationUnarchived = Boolean(location && location.status !== 'archived');
  const canEdit = Boolean(user && !isGuest && ['owner', 'accountant', 'bookkeeper'].includes(role) && workspaceId && locationUnarchived && !loading);
  const partial = Boolean(truncated.inventory || failed.inventory);

  const visibleItems = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    if (!term) return items;
    return items.filter(item => `${item.name} ${item.sku}`.toLocaleLowerCase().includes(term));
  }, [items, query]);

  const saveBin = async (item: InventoryItem, next: string | number) => {
    const bin = String(next).trim();
    const problem = binLocationProblem(locationId, bin);
    if (problem) throw new Error(problem);
    if (!workspaceId || !user || isGuest || !['owner', 'accountant', 'bookkeeper'].includes(role)) throw new Error('Your workspace session or edit permission is no longer available.');
    if (loading) throw new Error('Wait for the current workspace inventory to finish loading before editing bins.');
    const path = binLocationFieldPath(locationId);
    if (!path) throw new Error('Choose a Location before assigning a bin.');
    const value: ItemBinLocation = {
      locationId,
      bin,
      updatedAt: new Date().toISOString(),
      updatedByUid: user.uid,
      updatedByName: user.displayName || user.email || 'Workspace user',
    };
    await updateEntity('inventory', item.id, {
      [path]: bin ? value : deleteField(),
    } as Record<string, unknown>, bin ? `Bin ${bin} saved for ${item.name}.` : `Bin cleared for ${item.name}.`);
  };

  return <section aria-label="Bin locations" className="space-y-4 min-w-0">
    <div>
      <h3 className="text-lg font-semibold">Bin locations</h3>
      <p className="text-sm text-[var(--muted)]">Assign a bin within an existing Location dimension. A bin is a label only: it does not allocate, reserve, count, or move stock.</p>
    </div>
    {loading && <p role="status" className="text-sm text-[var(--muted)]">Loading inventory…</p>}
    {partial && <p role="alert" className="text-sm text-[var(--muted)]">The inventory list is capped or failed. Only the loaded items are shown; an edit here changes only the selected item.</p>}

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex min-w-0 max-w-full flex-col gap-1 text-sm">Location
        <select aria-label="Bin location" className={field} value={locationId} onChange={event => setSelectedLocationId(event.target.value)}>
          {!locations.length && <option value={NO_LOCATION_VALUE}>No Location values are configured</option>}
          {locations.map(option => <option key={option.id} value={option.id}>{option.description || option.id}{option.status === 'archived' ? ' (archived)' : ''}</option>)}
        </select>
      </label>
      <label className="flex min-w-0 max-w-full flex-col gap-1 text-sm">Find item
        <input aria-label="Find item for bin" type="search" className={field} value={query} onChange={event => setQuery(event.target.value)} placeholder="Name or SKU" />
      </label>
      <span className="text-sm text-[var(--muted)]">{visibleItems.length} of {items.length} loaded stock item(s)</span>
    </div>

    {!locations.length && <p className="text-sm text-[var(--muted)]">Create a Location value in Labels before assigning bins. You can still view the loaded inventory below.</p>}
    {location?.status === 'archived' && <p className="text-sm text-[var(--muted)]">This Location is archived. Existing bin labels are shown read-only and cannot be changed.</p>}

    <ReportTableScroll>
      <table className="w-full text-sm">
        <caption>Inventory bin assignments{location ? ` at ${location.description || location.id}` : ''}</caption>
        <thead><tr>
          <th scope="col" className="text-left py-2 px-2">Item</th>
          <th scope="col" className="text-left py-2 px-2">SKU</th>
          <th scope="col" className="text-left py-2 px-2">Bin</th>
        </tr></thead>
        <tbody>
          {visibleItems.map(item => {
            const current = location && location.id !== NO_LOCATION_VALUE ? itemBinForLocation(item, location.id) : '';
            const label = `Bin for ${item.name} at ${location?.description || location?.id || 'Location'}`;
            return <tr key={item.id} className="border-b border-[var(--line)]/50">
              <th scope="row" className="text-left font-medium py-2 px-2">{item.name}</th>
              <td className="py-2 px-2"><bdi>{item.sku || '—'}</bdi></td>
              <td className="py-2 px-2 min-w-48">
                {location && location.id !== NO_LOCATION_VALUE
                  ? <InlineEdit kind="text" label={label} value={current} placeholder="Assign bin" canEdit={canEdit}
                    onSave={next => saveBin(item, next)} />
                  : <span className="text-[var(--muted)]">{current || 'No Location assigned'}</span>}
              </td>
            </tr>;
          })}
        </tbody>
      </table>
      {visibleItems.length === 0 && <p className="p-3 text-sm text-[var(--muted)]">No inventory items match this search.</p>}
    </ReportTableScroll>
  </section>;
}
