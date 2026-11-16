/**
 * Selling below zero (W-06) on Inventory. By default a sale of more than is on hand is recorded and
 * stock goes below zero, with a warning. An owner can turn on "Refuse sales beyond stock": then an
 * invoice that would take an item below zero is not saved. The server decides and enforces it
 * (src/server/services/stockPolicyService.ts, cogsStockService.ts); others see when it is on.
 *
 * BF-08 step 2: the owner also chooses when stock leaves: with the invoice (the default), or with a
 * delivery from the order (src/lib/deliveries.ts). Others see when it is deliveries.
 */
import React, { useState } from 'react';
import { toast } from 'sonner';
import { useAuthStore } from '../../stores/useAuthStore';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { goodsLeaveWith, type GoodsLeaveWith } from '../../lib/deliveries';
import { runCommand, type CommandBody } from '../../lib/runCommand';

export default function StockPolicySwitch() {
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const setWorkspaces = useAuthStore(s => s.setWorkspaces);
  const isOwner = useCurrentRole() === 'owner';
  const [saving, setSaving] = useState(false);
  if (!workspace) return null;
  const refuse = workspace.refuseNegativeStock === true;
  const leaves = goodsLeaveWith(workspace);
  if (!isOwner) {
    return (
      <>
        {refuse && <p className="text-xs text-[var(--muted)]">Sales beyond stock are refused: record stock received before invoicing it.</p>}
        {leaves === 'delivery' && <p className="text-xs text-[var(--muted)]">Stock leaves with deliveries: deliver from the order (Sales → Estimates); invoices book no cost of goods.</p>}
      </>
    );
  }

  const save = async (body: { refuseNegativeStock: boolean } | { goodsLeaveWith: GoodsLeaveWith }, done: string) => {
    setSaving(true);
    try {
      await runCommand<CommandBody>({ path: '/api/v1/inventory/stock-policy', method: 'PUT', body: { workspaceId: workspace.id, ...body } });
      setWorkspaces(useAuthStore.getState().workspaces.map(w => (w.id === workspace.id ? { ...w, ...body } : w)));
      toast.success(done);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };
  const change = (next: boolean) => save({ refuseNegativeStock: next }, next ? 'Sales beyond stock are now refused' : 'Sales may take stock below zero again, with a warning');
  const leaveWith = (next: GoodsLeaveWith) => save({ goodsLeaveWith: next }, next === 'delivery' ? 'Stock now leaves with deliveries from orders' : 'Stock leaves with the invoice again');

  return (
    <div className="space-y-2 max-w-md">
      <label className="flex items-start gap-2 text-xs text-[var(--text)]">
        <input type="checkbox" className="mt-0.5" checked={refuse} disabled={saving} onChange={e => void change(e.target.checked)} />
        <span>Refuse sales beyond stock <span className="text-[var(--muted)]">(an invoice that would take an item below zero is not saved; when off, it is saved with a warning)</span></span>
      </label>
      <fieldset disabled={saving} className="text-xs text-[var(--text)]">
        <legend className="font-semibold">Stock leaves with</legend>
        <label className="flex items-start gap-2">
          <input type="radio" name="goods-leave-with" className="mt-0.5" checked={leaves === 'invoice'} onChange={() => void leaveWith('invoice')} />
          <span>The invoice <span className="text-[var(--muted)]">(invoicing an item lowers stock and books its cost)</span></span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" name="goods-leave-with" className="mt-0.5" checked={leaves === 'delivery'} onChange={() => void leaveWith('delivery')} />
          <span>A delivery from the order <span className="text-[var(--muted)]">(Deliver on the order lowers stock and books the cost; invoices book none)</span></span>
        </label>
      </fieldset>
    </div>
  );
}
