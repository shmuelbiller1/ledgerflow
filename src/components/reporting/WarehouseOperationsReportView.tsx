import React, { useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import WarehouseBinLocationsPanel from './WarehouseBinLocationsPanel';
import PickPackShipPanel from './PickPackShipPanel';
import ReturnAuthorizationsPanel from './ReturnAuthorizationsPanel';
import WarrantyRegisterPanel from './WarrantyRegisterPanel';
import InventoryWorkflowTabs from './InventoryWorkflowTabs';
import { useReportText } from './useReportText';

type WarehouseTab = 'bins' | 'pick-pack-ship' | 'returns' | 'warranties';
const tabsFor = (reportText: ReturnType<typeof useReportText>): Array<{ id: WarehouseTab; label: string }> => [
  { id: 'bins', label: reportText('r.bin-locations', 'Bin locations') },
  { id: 'pick-pack-ship', label: reportText('r.pick-pack-and-ship', 'Pick, pack and ship') },
  { id: 'returns', label: reportText('r.return-authorizations', 'Return authorizations') },
  { id: 'warranties', label: reportText('r.warranty-register', 'Warranty register') },
];

/** Operational subviews hosted inside Inventory Cycle Count to avoid changing the report registry. */
export default function WarehouseOperationsReportView({ embedded = false }: { embedded?: boolean } = {}) {
  const reportText = useReportText();
  const tabs = tabsFor(reportText);
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const userId = useAuthStore(state => state.user?.uid || 'anonymous');
  const [activeTab, setActiveTab] = useState<WarehouseTab>('bins');
  const contextKey = `${workspaceId || 'no-workspace'}:${userId}`;

  return <section aria-label={reportText('r.warehouse-operations', 'Warehouse operations')} className="p-4 space-y-4 min-w-0">
    <h2>{reportText('r.warehouse-operations', 'Warehouse operations')}</h2>
    <p className="text-sm text-[var(--muted)]">{reportText('r.warehouse-notes-live-on-existing-inventory-sales', 'Warehouse notes live on existing inventory, sales-order and customer records. These workflows record bins, shipment tracking, return-authorization status and warranty dates only; actual stock movements, sales returns, invoices and credits remain in their existing workflows.')}</p>
    <InventoryWorkflowTabs label={reportText('r.warehouse-operations-views', 'Warehouse operations views')} idPrefix="warehouse-operations"
      value={activeTab} onChange={setActiveTab}
      tabs={tabs.map(tab => ({ ...tab, panelId: `warehouse-operations-panel-${tab.id}` }))} />
    {tabs.map(tab => <div key={tab.id} role="tabpanel" id={`warehouse-operations-panel-${tab.id}`}
      aria-labelledby={`warehouse-operations-tab-${tab.id}`} hidden={activeTab !== tab.id} tabIndex={0}>
      {activeTab === tab.id && <>
        {tab.id === 'bins' && <WarehouseBinLocationsPanel key={`${contextKey}:bins`} />}
        {tab.id === 'pick-pack-ship' && <PickPackShipPanel key={`${contextKey}:pick-pack-ship`} embedded={embedded} />}
        {tab.id === 'returns' && <ReturnAuthorizationsPanel key={`${contextKey}:returns`} />}
        {tab.id === 'warranties' && <WarrantyRegisterPanel key={`${contextKey}:warranties`} />}
      </>}
    </div>)}
  </section>;
}
