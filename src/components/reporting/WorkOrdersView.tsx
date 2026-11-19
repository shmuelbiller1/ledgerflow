/**
 * A-169: Manufacturing light — work order screen (build N kits using `kitAssembly.ts`).
 *
 * Tracks numbered kit build work orders (`WO-YYYY-NNN`), required component pick lists, live stock
 * shortages, and status progression (`planned` → `in_progress` → `completed` / `cancelled`) stored
 * durably on the bundle item (`inventory.metadata.workOrders`). Stock movement and GL entries stay
 * strictly server-posted via Inventory adjustments / Sales Invoices.
 */
import React, { useMemo, useState } from 'react';
import { Download, Layers, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useEntityOperations } from '../../hooks/useEntityOperations';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { downloadCsv } from '../../lib/csvExport';
import { isBundle, type BundleHost } from '../../lib/itemBundles';
import { kitBuildPlan } from '../../lib/kitAssembly';
import {
  allWorkOrdersWithPlans,
  nextWorkOrderNumber,
  WORK_ORDERS_CSV_HEADERS,
  workOrdersCsvRows,
  workOrdersFromItem,
  type WorkOrderRecord,
  type WorkOrderStatus,
} from '../../lib/workOrders';
import { RowTable } from '../ui/RowTable';
import { useReportText, fill } from './useReportText';

/** Code names, form numbers, paths and identifiers shown as-is: they are not words to translate (EU-G1). */
const CODE_NAMES = { c0: 'Bench B · retail packaging' } as const;

const field = 'w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white';

export default function WorkOrdersView() {
  const reportText = useReportText();
  const inventory = useLedgerStore(s => s.inventory);
  const { loading } = useLedgerCollections('inventory');
  const canWrite = useCurrentRole() !== 'viewer';
  const { updateEntity } = useEntityOperations();

  const bundles = useMemo(
    () => (inventory || []).filter(i => isBundle(i as BundleHost)),
    [inventory],
  );

  const [kitItemId, setKitItemId] = useState('');
  const [qtyInput, setQtyInput] = useState('5');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');

  const workOrders = useMemo(
    () => allWorkOrdersWithPlans(inventory || []),
    [inventory],
  );

  const selectedKit = bundles.find(b => b.id === kitItemId);
  const previewQty = Math.max(1, Math.floor(Number(qtyInput) || 1));
  const previewPlan = useMemo(
    () => (selectedKit ? kitBuildPlan(selectedKit as BundleHost & { name: string }, inventory || [], previewQty) : null),
    [selectedKit, inventory, previewQty],
  );

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedKit) {
      toast.error('Select a kit / bundle item first.');
      return;
    }
    const qty = Math.floor(Number(qtyInput) || 0);
    if (qty < 1) {
      toast.error('Quantity to build must be at least 1 whole kit.');
      return;
    }
    const year = new Date().toISOString().slice(0, 4);
    const woNumber = nextWorkOrderNumber(workOrders, year);
    const newWo: WorkOrderRecord = {
      id: `wo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      woNumber,
      kitItemId: selectedKit.id,
      kitName: selectedKit.name,
      quantityToBuild: qty,
      status: 'planned',
      ...(dueDate ? { dueDate } : {}),
      ...(notes.trim() ? { notes: notes.trim().slice(0, 240) } : {}),
      createdAt: new Date().toISOString(),
    };
    const nextList = [...workOrdersFromItem(selectedKit), newWo];
    await updateEntity('inventory', selectedKit.id, {
      metadata: { ...(selectedKit.metadata || {}), workOrders: nextList },
    });
    setNotes('');
  };

  const handleStatusChange = async (kitId: string, woId: string, status: WorkOrderStatus) => {
    const kit = (inventory || []).find(i => i.id === kitId);
    if (!kit) return;
    const nextList = workOrdersFromItem(kit).map(w =>
      w.id === woId ? { ...w, status, updatedAt: new Date().toISOString() } : w);
    await updateEntity('inventory', kit.id, {
      metadata: { ...(kit.metadata || {}), workOrders: nextList },
    });
  };

  if (loading) {
    return <p className="p-6 text-sm text-slate-600 dark:text-slate-400">{reportText('r.loading-kit-work-orders', 'Loading kit work orders…')}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <Layers className="w-6 h-6 text-indigo-600" aria-hidden="true" />
            {reportText('r.work-orders-kit-assembly', 'Work Orders (Kit Assembly)')}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            {reportText('r.plan-and-track-shop-floor-runs-to-assemble-n-kit', 'Plan and track shop-floor runs to assemble N kits from component stock using each bundle\'s bill of materials. Work orders schedule builds and pick lists only — component stock moves and ledger entries are posted strictly when recording an inventory adjustment or issuing an invoice.')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => downloadCsv('work-orders.csv', WORK_ORDERS_CSV_HEADERS, workOrdersCsvRows(workOrders))}
          className="min-h-11 px-4 py-2 text-sm font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-2"
        >
          <Download className="w-4 h-4" aria-hidden="true" /> {reportText('r.export-csv', 'Export CSV')}
        </button>
      </div>

      {canWrite && (
        <form onSubmit={handleCreate} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">{reportText('r.new-kit-work-order', 'New kit work order')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label htmlFor="wo-kit" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">{reportText('r.kit-bundle-item', 'Kit / bundle item')}</label>
              <select id="wo-kit" value={kitItemId} onChange={e => setKitItemId(e.target.value)} className={field}>
                <option value="">{reportText('r.select-bundle', 'Select bundle (')}{bundles.length})…</option>
                {bundles.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="wo-qty" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">{reportText('r.quantity-to-build', 'Quantity to build')}</label>
              <input id="wo-qty" type="number" min="1" step="1" value={qtyInput} onChange={e => setQtyInput(e.target.value)} className={field} />
            </div>
            <div>
              <label htmlFor="wo-due" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">{reportText('r.target-date', 'Target date')}</label>
              <input id="wo-due" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={field} />
            </div>
            <div>
              <label htmlFor="wo-notes" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">{reportText('r.bench-batch-note', 'Bench / batch note')}</label>
              <input id="wo-notes" type="text" maxLength={240} placeholder={CODE_NAMES.c0} value={notes} onChange={e => setNotes(e.target.value)} className={field} />
            </div>
          </div>

          {previewPlan && (
            <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 p-3 text-xs space-y-1">
              <div className="font-semibold text-slate-900 dark:text-white">
                {reportText('r.buildable-from-current-stock-right-now', 'Buildable from current stock right now:')} {previewPlan.buildableKits} {reportText('r.kit-s', 'kit(s)')}
                {previewPlan.problem ? ` — ${previewPlan.problem}` : ` ${reportText('r.all-components-on-hand', '— all components on hand')}`}
              </div>
              <div className="text-slate-600 dark:text-slate-400">
                {reportText('r.components-needed', 'Components needed:')} {(previewPlan.consumption || []).map(c => `${c.name} × ${c.needed} (on hand: ${c.onHand})`).join(' · ')}
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <button type="submit" className="min-h-11 px-4 py-2 text-sm font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white inline-flex items-center gap-1.5">
              <Plus className="w-4 h-4" aria-hidden="true" /> {reportText('r.create-work-order', 'Create work order')}
            </button>
          </div>
        </form>
      )}

      {workOrders.length === 0 ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">{reportText('r.no-kit-work-orders-yet', 'No kit work orders yet')}</p>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
            {reportText('r.define-bundle-components-on-an-item-in-inventory', 'Define bundle components on an item in Inventory, then open a work order above to schedule builds and check component shortages.')}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <RowTable
            rowHeaderColumn={false}
            caption={(<>{reportText('r.kit-assembly-work-orders', 'Kit assembly work orders')}</>)}
            rows={workOrders}
            rowKey={wo => wo.id}
            tableClassName="w-full text-sm text-start"
            headRowClassName="border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-400"
            bodyClassName="divide-y divide-slate-200 dark:divide-slate-800"
            columns={[
              { header: reportText('r.work-order', 'Work order'), className: "px-4 py-3 font-mono font-semibold text-indigo-700 dark:text-indigo-300", headClassName: "px-4 py-3 text-start", cell: (wo) => wo.woNumber },
              { header: reportText('r.kit', 'Kit'), className: "px-4 py-3 font-medium text-slate-900 dark:text-white", headClassName: "px-4 py-3 text-start", cell: (wo) => (<>{wo.kitName}
                    {wo.notes && <div className="text-xs text-slate-500">{wo.notes}</div>}</>) },
              { header: reportText('r.qty-to-build', 'Qty to build'), className: "px-4 py-3 text-end tabular-nums font-semibold", headClassName: "px-4 py-3 text-end", cell: (wo) => wo.quantityToBuild },
              { header: reportText('r.component-check', 'Component check'), className: "px-4 py-3 text-xs", headClassName: "px-4 py-3 text-start", cell: (wo) => wo.plan?.problem ? (
                      <span className="text-amber-700 dark:text-amber-300 font-medium">{wo.plan.problem}</span>
                    ) : (
                      <span className="text-emerald-700 dark:text-emerald-300 font-medium">{reportText('r.all-parts-on-hand', 'All parts on hand')}</span>
                    ) },
              { header: reportText('r.target-date', 'Target date'), className: "px-4 py-3 tabular-nums text-slate-600 dark:text-slate-400", headClassName: "px-4 py-3 text-start", cell: (wo) => wo.dueDate || '—' },
              { header: reportText('r.status', 'Status'), className: "px-4 py-3", headClassName: "px-4 py-3 text-start", cell: (wo) => canWrite ? (
                      <select
                        aria-label={fill(reportText('r.status-for-0', 'Status for {0}'), { 0: wo.woNumber })}
                        value={wo.status}
                        onChange={e => handleStatusChange(wo.kitItemId, wo.id, e.target.value as WorkOrderStatus)}
                        className="px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                      >
                        <option value="planned">{reportText('r.planned', 'Planned')}</option>
                        <option value="in_progress">{reportText('r.in-progress', 'In progress')}</option>
                        <option value="completed">{reportText('r.completed', 'Completed')}</option>
                        <option value="cancelled">{reportText('r.cancelled', 'Cancelled')}</option>
                      </select>
                    ) : (
                      <span className="text-xs font-semibold">{wo.status}</span>
                    ) },
            ]}
          />
        </div>
      )}
    </div>
  );
}
