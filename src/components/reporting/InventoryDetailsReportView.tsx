import { runCommand, ServerCommandError } from '../../lib/runCommand';
import React, { useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useUIStore } from '../../stores/useUIStore';
import { formatCurrency, formatDate, getLocalDateISO } from '../../lib/utils';
import { purchasesByItem, STOCK_MOVE_LABEL, type ItemDetails } from '../../lib/stockMoves';
import { RowTable } from '../ui/RowTable';

const field = 'px-2 py-1.5 border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]';
const qty = (n: number) => String(Math.round(n * 1e6) / 1e6);

/**
 * Inventory item details (J-10): for a period, each item's opening quantity and value, every movement
 * (sold, bought, returned, adjusted, counted, moved) with its entry, what came in and went out, and
 * the closing quantity and value. Read by the server from the stock-moves ledger, the same history
 * as Stock history on Inventory (src/lib/stockMoves.ts `itemDetails`). Above them, what was bought of
 * each item in the period (J-08: on bills or on Inventory), with its cost per unit.
 */
export default function InventoryDetailsReportView() {
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const openRecord = useUIStore(s => s.openRecord);
  const [startDate, setStartDate] = useState(`${getLocalDateISO().slice(0, 7)}-01`);
  const [endDate, setEndDate] = useState(getLocalDateISO());
  const [result, setResult] = useState<{ key: string; items?: ItemDetails[]; error?: string } | null>(null);
  const currency = workspace?.currency || 'USD';
  const key = workspace && startDate && endDate && startDate <= endDate ? new URLSearchParams({ workspaceId: workspace.id, startDate, endDate }).toString() : '';

  useEffect(() => {
    if (!key) return;
    let live = true;
    (async () => {
      return runCommand({
        path: `/api/v1/reports/inventory-details?${key}`,
        parse: (raw): ItemDetails[] => {
          const items = (raw as { items?: ItemDetails[] }).items;
          if (!Array.isArray(items)) throw new ServerCommandError(200, 'The stock history could not be read');
          return items;
        },
      });
    })().then(items => { if (live) setResult({ key, items }); }).catch(err => { if (live) setResult({ key, error: err instanceof Error ? err.message : String(err) }); });
    return () => { live = false; };
  }, [key]);
  const shown = result && result.key === key ? result : null;

  return (
    <section aria-labelledby="inventory-details-title" className="space-y-4">
      <h2 id="inventory-details-title" className="text-lg font-bold text-[var(--text)]">Inventory item details</h2>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1 text-[var(--muted)]">From<input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={field} /></label>
        <label className="flex flex-col gap-1 text-[var(--muted)]">To<input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={field} /></label>
      </div>
      {startDate > endDate && <p role="status" className="text-xs text-amber-700 dark:text-amber-400">The period starts after it ends.</p>}
      {key && !shown && <p className="text-sm text-[var(--muted)]">Loading…</p>}
      {shown?.error && <p role="alert" className="text-sm text-rose-600">{shown.error}</p>}
      {shown?.items && shown.items.length === 0 && <p className="text-sm text-[var(--muted)]">No stock and no movements in this period.</p>}
      {shown?.items && purchasesByItem(shown.items).length > 0 && (
        <RowTable
          rowClassName="border-b border-[var(--line)]/50"
          caption={(<>Bought in the period</>)}
          rows={purchasesByItem(shown.items)}
          rowKey={p => p.itemId}
          captionClassName="text-left font-semibold text-[var(--text)] pb-1"
          tableClassName="w-full text-sm"
          headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)]"
          bodyClassName=""
          columns={[
            { header: "Item", className: "font-normal py-1", headClassName: "font-semibold py-1", cell: (p) => <bdi>{p.itemName}</bdi> },
            { header: "Units", align: 'right', className: "font-mono py-1", headClassName: "font-semibold py-1", cell: (p) => qty(p.quantity) },
            { header: "Cost", align: 'right', className: "font-mono py-1", headClassName: "font-semibold py-1", cell: (p) => formatCurrency(p.valueCents, currency) },
            { header: "Per unit", align: 'right', className: "font-mono py-1", headClassName: "font-semibold py-1", cell: (p) => formatCurrency(p.averageCents, currency) },
          ]}
        />
      )}
      {shown?.items?.map(item => (
        <div key={item.itemId} className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
          <table className="w-full text-sm">
            <caption className="text-left font-semibold text-[var(--text)] pb-1"><bdi>{item.itemName}</bdi></caption>
            <thead>
              <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                <th scope="col" className="text-left font-semibold py-1">Date</th>
                <th scope="col" className="text-left font-semibold py-1">Movement</th>
                <th scope="col" className="text-right font-semibold py-1">Quantity</th>
                <th scope="col" className="text-right font-semibold py-1">On hand after</th>
                <th scope="col" className="text-right font-semibold py-1">Value</th>
              </tr>
            </thead>
            <tbody>
              <tr className="text-[var(--muted)]">
                <th scope="row" colSpan={3} className="text-left font-normal py-1">Opening</th>
                <td className="text-right font-mono py-1">{qty(item.opening.quantity)}</td>
                <td className="text-right font-mono py-1">{formatCurrency(item.opening.valueCents, currency)}</td>
              </tr>
              {item.moves.map(m => (
                <tr key={m.key} className="border-b border-[var(--line)]/50">
                  <td className="py-1 font-mono text-xs">{formatDate(m.date)}</td>
                  <td className="py-1">
                    {m.transactionId ? (
                      <button type="button" className="text-indigo-600 dark:text-indigo-400 hover:underline" onClick={() => openRecord({ type: 'transaction', id: String(m.transactionId) })}>
                        {STOCK_MOVE_LABEL[m.kind]}<span className="sr-only"> on {m.date}: open its entry</span>
                      </button>
                    ) : STOCK_MOVE_LABEL[m.kind]}
                  </td>
                  <td className="py-1 text-right font-mono">{m.quantity > 0 ? '+' : ''}{qty(m.quantity)}</td>
                  <td className="py-1 text-right font-mono">{qty(m.quantityAfter)}</td>
                  <td className="py-1 text-right font-mono">{formatCurrency(m.valueCents, currency)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <th scope="row" className="text-left py-1" colSpan={2}>Closing <span className="font-normal text-xs text-[var(--muted)]">(in {qty(item.received)}, out {qty(item.issued)})</span></th>
                <td />
                <td className="text-right font-mono py-1">{qty(item.closing.quantity)}</td>
                <td className="text-right font-mono py-1">{formatCurrency(item.closing.valueCents, currency)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ))}
    </section>
  );
}
