import { usePartialReportInputs } from '../../hooks/usePartialReportInputs';
/**
 * A-116: kits assembled on demand. Reports → Kit Assembly.
 *
 * A kit is an A-19 bundle (an item with parts) that is built out of its parts when it is needed — a
 * bundle never keeps stock of its own. This screen shows, for the chosen kit, what the parts on hand
 * can build and what building N would consume. It is a plan only: nothing is recorded, reserved or
 * posted here; stock, cost and posting stay the parts' own (the same rule as a bundle on an invoice).
 */
import React, { useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { downloadCsv } from '../../lib/csvExport';
import { kitBuildPlan, type KitBuildPlan } from '../../lib/kitAssembly';
import { isBundle, type BundleHost } from '../../lib/itemBundles';
import type { InventoryItem } from '../../types';
import ReportSchedule from './ReportSchedule';
import { useReportText } from './useReportText';

const CSV_HEADERS = ['Part', 'SKU', 'Per kit', 'On hand', 'Needed for N', 'Left after'];

export default function KitAssemblyReportView() {
  const reportText = useReportText();
  const inventory = useLedgerStore(s => s.inventory) as InventoryItem[];
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const { loading } = useLedgerCollections('inventory');

  const kits = useMemo(
    () => (inventory || [])
      .filter(i => (!workspaceId || !i.workspaceId || i.workspaceId === workspaceId) && isBundle(i as BundleHost))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [inventory, workspaceId],
  );
  const [picked, setPicked] = useState('');
  const kitId = picked || kits[0]?.id || '';
  const kit = kits.find(k => k.id === kitId);
  const [count, setCount] = useState('1');
  const requested = count.trim() === '' ? undefined : Number(count);
  const plan: KitBuildPlan | null = kit ? kitBuildPlan(kit as BundleHost & { name: string }, inventory || [], requested) : null;
  const partial = usePartialReportInputs(['inventory']);

  return (
    <section aria-label={reportText('r.kit-assembly', 'Kit assembly')} className="p-4 space-y-4 min-w-0">
      <div>
        <h2>{reportText('r.kit-assembly', 'Kit assembly')}</h2>
        <p className="text-sm text-[var(--muted)]">
          {reportText('r.a-kit-assembled-on-demand-is-built-from-its-part', 'A kit assembled on demand is built from its parts when it is needed (a bundle keeps no stock of its own). See how many kits the parts on hand can build and what building N would take. This screen records nothing.')}
        </p>
      </div>

      {loading && <p role="status" className="text-sm text-[var(--muted)]">{reportText('r.loading-items', 'Loading items…')}</p>}
      {partial && (
        <p role="alert" className="text-sm text-amber-700">
          {reportText('r.items-are-only-partly-loaded-a-kit-outside-the-l', 'Items are only partly loaded; a kit outside the loaded list is not shown.')}
        </p>
      )}

      {!loading && !partial && kits.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          {reportText('r.no-kits-yet-make-an-item-a-bundle-of-other-items', 'No kits yet: make an item a bundle of other items on Inventory (its parts editor), then mark it “Assemble on demand”.')}
        </p>
      ) : plan && kit && (
        <>
          <div className="flex flex-wrap items-end gap-3 text-sm">
            <label className="flex flex-col gap-1">{reportText('r.kit', 'Kit')}
              <select aria-label={reportText('r.kit', 'Kit')} value={kitId} onChange={e => { setPicked(e.target.value); }}
                className="px-2 py-1.5 border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]">
                {kits.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">{reportText('r.how-many-kits', 'How many kits')}
              <input aria-label={reportText('r.how-many-kits', 'How many kits')} type="number" min={0} step={1} value={count}
                onChange={e => setCount(e.target.value)}
                className="px-2 py-1.5 border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)] w-28" />
            </label>
            <button type="button" data-print-hide
              onClick={() => downloadCsv(`kit-assembly-${kit.name}`, CSV_HEADERS, plan.parts.map(p => {
                const use = plan.consumption?.find(c => c.itemId === p.itemId);
                return [p.name, p.sku || '', p.perKit, p.onHand, use?.needed ?? '', use?.remaining ?? ''];
              }))}
              disabled={!plan.consumption?.length}
              className="min-h-11 px-3 py-1.5 rounded border disabled:opacity-50">
              {reportText('r.download-csv', 'Download CSV')}
            </button>
          </div>

          <p className="text-sm">
            <bdi>{kit.name}</bdi>: <b>{plan.buildableKits}</b> {plan.buildableKits === 1 ? reportText('r.kit-can-be-built', 'kit can be built from what is on hand.') : reportText('r.kits-can-be-built', 'kits can be built from what is on hand.')}
            {kit.assembleOnDemand ? ` ${reportText('r.marked-assemble-on-demand', 'Marked “Assemble on demand”.')}` : ` ${reportText('r.not-marked-assemble-on-demand-the-mark-is-a-note', 'Not marked “Assemble on demand” (the mark is a note on the item only).')}`}
          </p>
          {plan.problem && <p role="alert" className="text-sm text-amber-700 dark:text-amber-400">{plan.problem}</p>}

          <ReportSchedule
            columnControls
            allowDisplayedExport={!partial && !loading && !!plan.consumption?.length}
            caption={reportText('r.components-needed-for-this-assembly', 'Components needed for this assembly')}
            captionClassName="sr-only"
            headRowClassName="border-b border-[var(--line)] text-start text-[var(--muted)]"
            rowClassName="border-b border-[var(--line)]/50"
            bodyClassName=""
            rows={plan.parts.map(p => ({ ...p, consumption: plan.consumption?.find(c => c.itemId === p.itemId) }))} rowKey={p => p.itemId}
            columns={[
              { header: reportText('r.part', 'Part'), className: 'py-1.5', cell: p => <>{p.name}
                        {p.sku && <span className="ms-2 font-mono text-xs text-[var(--muted)]">{p.sku}</span>}
                        {p.shortfallPerKit > 0 && (
                          <span className="block text-xs text-amber-700 dark:text-amber-400">
                            {reportText('r.short', 'short')} {p.shortfallPerKit} {reportText('r.per-kit-2', 'per kit')}
                          </span>
                        )}</> },
              { header: reportText('r.per-kit', 'Per kit'), align: 'right', className: 'py-1.5 font-mono', cell: p => p.perKit },
              { header: reportText('r.on-hand', 'On hand'), align: 'right', className: 'py-1.5 font-mono', cell: p => p.onHand },
              { header: reportText('r.kits-this-part-can-build', 'Kits this part can build'), align: 'right', className: 'py-1.5 font-mono', cell: p => p.buildable },
              { header: <>{reportText('r.needed-for', 'Needed for')} {plan.requestedKits ?? 0}</>, align: 'right', className: 'py-1.5 font-mono', cell: p => p.consumption?.needed ?? '' },
              { header: reportText('r.left-after', 'Left after'), align: 'right', className: 'py-1.5 font-mono', cell: p => p.consumption?.remaining ?? '' },
            ]} />
          <p className="text-xs text-[var(--muted)]">
            {reportText('r.building-here-is-a-plan-only-nothing-is-reserved', 'Building here is a plan only: nothing is reserved, issued or posted. When the kit is sold, the invoice takes its parts as lines (A-19) and the parts\' own stock and cost move as they always do.')}
          </p>
        </>
      )}
    </section>
  );
}
