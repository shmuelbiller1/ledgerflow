import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { useDialog } from '../../hooks/useDialog';
import type { ChartAccount, InventoryItem } from '../../types';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { TruthEngine } from '../../modules/integrity/TruthEngine';
import { defaultOffsetAccount, inventoryAccountsOf, offsetAccountChoices, revaluationValueCents } from '../../lib/inventoryAccounts';
import { revalueStockRequest } from '../../services/stockRequests';
import { StockAccountFields } from './StockAccountFields';
import { stockFieldClass, stockLabelClass } from './stockStyles';

interface StockRevalueDialogProps {
  item: InventoryItem;
  workspaceId: string;
  accounts: ChartAccount[];
  /** The workspace currency: stock is valued in it. */
  currency?: string;
  onClose: () => void;
}

/** One id per revaluation, kept while the dialog is open: a retry after a lost answer is applied once. */
const newRequestId = () => `reval-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * ISS-130: changes the unit cost of stock on hand. The server posts the change in value (quantity × new cost less
 * quantity × old cost) to the Inventory account against the chosen account, and changes the cost in the same database
 * transaction (stockRevaluationService.ts). Owners and accountants.
 */
export default function StockRevalueDialog({ item, workspaceId, accounts, currency, onClose }: StockRevalueDialogProps) {
  const inventoryChoices = useMemo(() => inventoryAccountsOf(accounts), [accounts]);
  const offsetChoices = useMemo(() => offsetAccountChoices(accounts), [accounts]);
  const [cost, setCost] = useState(((item.unitCostCents || 0) / 100).toFixed(2));
  const [inventoryAccountId, setInventoryAccountId] = useState(inventoryChoices[0]?.id || '');
  const [offsetAccountId, setOffsetAccountId] = useState(defaultOffsetAccount(accounts, 'adjustment')?.id || '');
  const [date, setDate] = useState(getLocalDateISO());
  const [note, setNote] = useState('');
  const [requestId] = useState(newRequestId);
  const [saving, setSaving] = useState(false);
  const { dialogProps, titleId } = useDialog(onClose, true);

  const quantity = item.quantityAtHand || 0;
  const newCostCents = cost.trim() === '' ? Number.NaN : TruthEngine.parseAmountToCents(cost);
  const valueCents = Number.isFinite(newCostCents) ? revaluationValueCents(quantity, item.unitCostCents || 0, newCostCents) : 0;
  const problem = !inventoryAccountId ? 'Add an Inventory account to the chart of accounts first.'
    : !offsetAccountId ? 'Choose the account the difference goes to.'
    : !Number.isFinite(newCostCents) || newCostCents < 0 ? 'Enter the new cost per unit.'
    : newCostCents === (item.unitCostCents || 0) ? 'That is its cost now.'
    : !note.trim() ? 'Say why the cost changes.'
    : '';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (problem) return;
    setSaving(true);
    try {
      const result = await revalueStockRequest({ workspaceId, itemId: item.id, newUnitCostCents: newCostCents, inventoryAccountId, offsetAccountId, date, reason: note.trim(), requestId });
      toast.success(`${item.name}: ${formatCurrency(result.newUnitCostCents, currency)} a unit`, { description: `Stock value changed by ${formatCurrency(result.valueCents, currency)}` });
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div {...dialogProps} className="fixed inset-0 z-[210] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-[var(--surface)] rounded-xl shadow-xl max-w-lg w-full border border-[var(--line)]">
        <div className="flex items-center justify-between p-5 border-b border-[var(--line)]">
          <div>
            <h2 id={titleId} className="text-lg font-bold text-[var(--text)]">Revalue stock</h2>
            <p className="text-xs text-[var(--muted)]">{item.name}{item.sku ? ` (${item.sku})` : ''} · {quantity} on hand at {formatCurrency(item.unitCostCents || 0, currency)}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close revalue stock" className="min-h-11 min-w-11 p-1 rounded-lg text-[var(--muted)] hover:text-[var(--text)]">
            <X aria-hidden="true" className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <label htmlFor="stock-revalue-cost" className={stockLabelClass}>New cost per unit</label>
            <input id="stock-revalue-cost" type="number" min="0" step="0.01" required value={cost} onChange={e => setCost(e.target.value)} className={stockFieldClass} />
          </div>
          <StockAccountFields
            inventoryChoices={inventoryChoices} offsetChoices={offsetChoices}
            inventoryAccountId={inventoryAccountId} offsetAccountId={offsetAccountId}
            onInventoryChange={setInventoryAccountId} onOffsetChange={setOffsetAccountId}
            offsetLabel="Revaluation gain or loss account" noteLabel="Reason" noteRequired date={date} onDateChange={setDate} note={note} onNoteChange={setNote}
          />
          <div className="p-3 rounded-lg bg-[var(--ink)] border border-[var(--line)] text-sm flex justify-between" aria-live="polite">
            <span className="text-[var(--muted)]">Inventory value change</span>
            <span className="font-mono tabular-nums text-[var(--text)]" data-testid="stock-revalue-value">{formatCurrency(valueCents, currency)}</span>
          </div>
          <p className="text-xs text-[var(--muted)]">Sales already posted keep the cost they were posted at. To undo, revalue back to the earlier cost.</p>
          {problem && cost !== '' && <p role="alert" className="text-xs text-[var(--neg)]">{problem}</p>}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="min-h-11 px-4 py-2 text-sm rounded-lg text-[var(--text)] hover:bg-[var(--ink)]">Cancel</button>
            <button type="submit" disabled={saving || !!problem} className="min-h-11 px-4 py-2 text-sm font-semibold rounded-lg bg-emerald-700 text-white disabled:opacity-50">
              {saving ? 'Saving…' : 'Save revaluation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
