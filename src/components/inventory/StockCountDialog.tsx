import ReportSchedule from '../reporting/ReportSchedule';
import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { useDialog } from '../../hooks/useDialog';
import type { ChartAccount, InventoryItem } from '../../types';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { countDifferences, defaultOffsetAccount, inventoryAccountsOf, offsetAccountChoices } from '../../lib/inventoryAccounts';
import { countStockRequest } from '../../services/stockRequests';
import { StockAccountFields } from './StockAccountFields';
import { stockFieldClass } from './stockStyles';

interface StockCountDialogProps {
  items: InventoryItem[];
  workspaceId: string;
  accounts: ChartAccount[];
  currency?: string;
  onClose: () => void;
}

/**
 * A stock count (W-04 W-05): enter what is on the shelf; the differences go to the variance
 * account in one entry and the quantities become the counted ones. Blank rows are not counted.
 */
export default function StockCountDialog({ items, workspaceId, accounts, currency, onClose }: StockCountDialogProps) {
  const inventoryChoices = useMemo(() => inventoryAccountsOf(accounts), [accounts]);
  const offsetChoices = useMemo(() => offsetAccountChoices(accounts), [accounts]);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState('');
  const [inventoryAccountId, setInventoryAccountId] = useState(inventoryChoices[0]?.id || '');
  const [offsetAccountId, setOffsetAccountId] = useState(defaultOffsetAccount(accounts, 'count')?.id || '');
  const [date, setDate] = useState(getLocalDateISO());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const { dialogProps, titleId } = useDialog(onClose, true);

  const differences = useMemo(() => countDifferences(items, counted), [items, counted]);
  const totalCents = differences.reduce((s, r) => s + r.valueCents, 0);
  const shown = items.filter(i => !filter || `${i.name} ${i.sku || ''} ${i.category || ''}`.toLowerCase().includes(filter.toLowerCase()));
  const problem = !inventoryAccountId ? 'Add an Inventory account to the chart of accounts first.'
    : !offsetAccountId ? 'Choose the variance account.'
    : differences.length === 0 ? 'Enter counted quantities that differ from the books.'
    : '';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (problem) return;
    setSaving(true);
    try {
      const result = await countStockRequest({
        workspaceId, inventoryAccountId, offsetAccountId, date,
        ...(note.trim() ? { reason: note.trim() } : {}),
        counts: differences.map(r => ({ itemId: r.item.id, counted: r.counted })),
      });
      toast.success(`Stock count saved: ${result.items.length} item${result.items.length === 1 ? '' : 's'} changed (${formatCurrency(result.valueCents, currency)})`);
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div {...dialogProps} className="fixed inset-0 z-[210] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-[var(--surface)] rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col border border-[var(--line)]">
        <div className="flex items-center justify-between p-5 border-b border-[var(--line)]">
          <div>
            <h2 id={titleId} className="text-lg font-bold text-[var(--text)]">Stock count</h2>
            <p className="text-xs text-[var(--muted)]">Enter what you counted. Leave a row blank to skip it.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close stock count" className="p-1 rounded-lg text-[var(--muted)] hover:text-[var(--text)]">
            <X aria-hidden="true" className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4 overflow-y-auto">
          <input aria-label="Filter items to count" placeholder="Filter by name, SKU or category" value={filter} onChange={e => setFilter(e.target.value)} className={stockFieldClass} />
          <ReportSchedule
            caption="Items to count"
            captionClassName="sr-only"
            tableClassName="w-full text-sm"
            headRowClassName="text-left text-xs text-[var(--muted)] border-b border-[var(--line)]"
            bodyClassName=""
            rowClassName="border-b border-[var(--line)]/50"
            rows={shown.map((item) => {
              const row = differences.find((r) => r.item.id === item.id);
              return { item, row };
            })}
            rowKey={({ item }) => item.id}
            rowHeaderClassName="font-normal text-start"
            columns={[
              {
                header: 'Item',
                headClassName: 'py-2', className: 'py-1.5 text-[var(--text)]',
                cell: ({ item }) => (
                  <>
                    {item.name}
                    {item.sku ? <span className="text-[var(--muted)]"> · {item.sku}</span> : null}
                  </>
                ),
              },
              { header: 'On the books', headClassName: 'py-2 text-right', className: 'py-1.5 text-right tabular-nums', cell: ({ item }) => item.quantityAtHand },
              {
                header: 'Counted',
                headClassName: 'py-2 text-right', className: 'py-1.5 text-right',
                cell: ({ item }) => (
                  <input
                    aria-label={`Counted quantity of ${item.name}`}
                    type="number"
                    min="0"
                    step="any"
                    value={counted[item.id] ?? ''}
                    onChange={(e) => setCounted((c) => ({ ...c, [item.id]: e.target.value }))}
                    className="w-24 px-2 py-1 text-right bg-[var(--ink)] border border-[var(--line)] rounded-md tabular-nums"
                  />
                ),
              },
              {
                header: 'Difference',
                headClassName: 'py-2 text-right', className: 'py-1.5 text-right tabular-nums',
                cell: ({ row }) => (row ? `${row.difference > 0 ? '+' : ''}${row.difference}` : ''),
              },
              {
                header: 'Value',
                headClassName: 'py-2 text-right', className: 'py-1.5 text-right tabular-nums',
                cell: ({ row }) => (row ? formatCurrency(row.valueCents, currency) : ''),
              },
            ]}
          />
          <StockAccountFields
            inventoryChoices={inventoryChoices} offsetChoices={offsetChoices}
            inventoryAccountId={inventoryAccountId} offsetAccountId={offsetAccountId}
            onInventoryChange={setInventoryAccountId} onOffsetChange={setOffsetAccountId}
            offsetLabel="Variance account" date={date} onDateChange={setDate} note={note} onNoteChange={setNote}
          />
          <div className="p-3 rounded-lg bg-[var(--ink)] border border-[var(--line)] text-sm flex justify-between" aria-live="polite">
            <span className="text-[var(--muted)]">{differences.length} item{differences.length === 1 ? '' : 's'} differ</span>
            <span className="font-mono tabular-nums text-[var(--text)]" data-testid="stock-count-total">{formatCurrency(totalCents, currency)}</span>
          </div>
          {problem && Object.keys(counted).length > 0 && <p role="alert" className="text-xs text-[var(--neg)]">{problem}</p>}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-[var(--text)] hover:bg-[var(--ink)]">Cancel</button>
            <button type="submit" disabled={saving || !!problem} className="px-4 py-2 text-sm font-semibold rounded-lg bg-emerald-700 text-white disabled:opacity-50">
              {saving ? 'Saving…' : 'Save count'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
