import React, { useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { useDialog } from '../../hooks/useDialog';
import type { ChartAccount, InventoryItem } from '../../types';
import { formatCurrency } from '../../lib/utils';
import { resolveAccountRole } from '../../lib/accountUtils';
import { inventoryAccountsOf } from '../../lib/inventoryAccounts';
import { getIdToken } from '../../firebase';
import { Labelled } from '../ui/Labelled';

interface CogsDialogProps {
  item: InventoryItem;
  workspaceId: string;
  accounts: ChartAccount[];
  currency?: string;
  onClose: () => void;
}

/**
 * Records the cost of items sold outside an invoice (DR Cost of Goods Sold, CR Inventory at the
 * item's cost). The server lowers the stock in the same database transaction.
 */
export default function CogsDialog({ item, workspaceId, accounts, currency, onClose }: CogsDialogProps) {
  const [quantity, setQuantity] = useState(1);
  const [posting, setPosting] = useState(false);
  const { dialogProps, titleId } = useDialog(onClose, true);
  const inventoryAcc = inventoryAccountsOf(accounts)[0];
  const cogsAcc = accounts.find(a => !a.isArchived && resolveAccountRole(a) === 'cogs');
  const unitCost = item.unitCostCents || 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (quantity <= 0) return;
    if (quantity > item.quantityAtHand) {
      toast.error(`Cannot sell ${quantity} units: only ${item.quantityAtHand} on hand.`);
      return;
    }
    if (!inventoryAcc || !cogsAcc) {
      toast.error('Add an Inventory account and a Cost of Goods Sold account to the chart of accounts first.');
      return;
    }
    setPosting(true);
    try {
      const res = await fetch('/api/v1/inventory/cogs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getIdToken()}` },
        body: JSON.stringify({ workspaceId, itemId: item.id, quantitySold: quantity, inventoryAccountId: inventoryAcc.id, cogsAccountId: cogsAcc.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to record the cost of goods sold');
      toast.success(`Recorded the cost of ${quantity} units (${formatCurrency(data.totalCogsCents, currency)})`);
      onClose();
    } catch (err) {
      toast.error((err as Error).message || 'Failed to record the cost of goods sold');
    } finally {
      setPosting(false);
    }
  };

  return (
    <div {...dialogProps} className="fixed inset-0 z-[200] flex items-center justify-center bg-zinc-900/60 p-4">
      <div className="relative w-full max-w-md bg-[var(--surface)] rounded-[32px] shadow-2xl border border-[var(--line)] overflow-hidden">
        <div className="p-6 border-b border-[var(--line)] flex items-center justify-between">
          <div>
            <h2 id={titleId} className="text-lg font-black text-[var(--text)] tracking-tight">Recognize COGS / Record Sale</h2>
            <p className="text-xs text-[var(--muted)] font-mono mt-0.5">{item.name} ({item.sku})</p>
          </div>
          <button type="button" aria-label="Close cost of goods sold dialog" onClick={onClose} className="p-2 hover:bg-[var(--ink)] rounded-full transition-colors">
            <X aria-hidden="true" size={18} className="text-[var(--muted)]" />
          </button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          <div className="p-4 bg-[var(--ink)] rounded-2xl border border-[var(--line)] text-xs space-y-1.5">
            <div className="flex justify-between">
              <span className="text-[var(--muted)]">Available Stock:</span>
              <span className="font-bold text-[var(--text)]">{item.quantityAtHand} units</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--muted)]">Unit Cost:</span>
              <span className="font-bold text-[var(--text)] tabular-nums">{unitCost > 0 ? formatCurrency(unitCost, currency) : 'Not set'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--muted)]">Total Cost of Goods Sold:</span>
              <span className="font-bold text-emerald-600 font-mono tabular-nums">{formatCurrency(quantity * unitCost, currency)}</span>
            </div>
          </div>
          <Labelled labelClassName="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest" label="Units Sold / Dispatched">
            <input
              type="number" min="1" max={item.quantityAtHand} value={quantity} required
              onChange={(e) => setQuantity(Math.max(1, Number.parseInt(e.target.value, 10) || 1))}
              className="w-full px-5 py-3 bg-[var(--ink)] border border-[var(--line)] rounded-2xl focus:outline-none focus:ring-2 focus:ring-zinc-900 font-bold"
            />
          </Labelled>
          <button
            type="submit" disabled={posting || unitCost <= 0}
            className="w-full py-4 bg-emerald-700 hover:bg-emerald-800 text-white rounded-2xl font-bold text-sm transition-all disabled:opacity-50"
          >
            {posting ? 'Posting to Ledger...' : unitCost <= 0 ? 'Set the unit cost first' : `Post ${quantity} Units COGS to Ledger`}
          </button>
        </form>
      </div>
    </div>
  );
}
