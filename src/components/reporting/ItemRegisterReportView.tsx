import React, { useMemo, useState } from 'react';
import { ShowMoreRows } from '../common/ShowMoreRows';
import { usePagedRows } from '../../hooks/usePagedRows';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useUIStore } from '../../stores/useUIStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { formatCurrency, formatDate, getLocalDateISO } from '../../lib/utils';
import { purchaseRegister, registerTotals, salesRegister } from '../../lib/itemRegister';

const field = 'px-2 py-1.5 border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]';
const qty = (n: number) => String(Math.round(n * 1e6) / 1e6);

/**
 * Item-wise registers (CB-12, CB-13): every invoice line that sold a stock item, or every bill line
 * that bought one, in a period, one row per line, for one item or all; each opens its document, and
 * each item's units and amount add up below (src/lib/itemRegister.ts).
 */
export default function ItemRegisterReportView() {
  const { loading } = useLedgerCollections('inventory', 'invoices', 'bills');
  const home = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';
  const items = useLedgerStore(s => s.inventory);
  const invoices = useLedgerStore(s => s.invoices);
  const bills = useLedgerStore(s => s.bills);
  const openRecord = useUIStore(s => s.openRecord);
  const [side, setSide] = useState<'sales' | 'purchases'>('sales');
  const [itemId, setItemId] = useState('');
  const [from, setFrom] = useState(`${getLocalDateISO().slice(0, 4)}-01-01`);
  const [to, setTo] = useState(getLocalDateISO());
  // R-5: one name lookup per line from a map (not a search of every item), and the register computed once per input
  const rows = useMemo(() => {
    const names = new Map((items || []).map(i => [i.id, i.name] as const));
    const nameOf = (id: string) => names.get(id) || '';
    return side === 'sales' ? salesRegister(invoices || [], nameOf, from, to, itemId) : purchaseRegister(bills || [], nameOf, from, to, itemId);
  }, [side, items, invoices, bills, from, to, itemId]);
  const totals = useMemo(() => registerTotals(rows, home), [rows, home]);
  const paged = usePagedRows(rows, `${side}|${from}|${to}|${itemId}`);

  return (
    <section aria-labelledby="item-register-title" className="space-y-4">
      <h2 id="item-register-title" className="text-lg font-bold text-[var(--text)]">Item-wise register</h2>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1 text-[var(--muted)]">Lines
          <select value={side} onChange={e => setSide(e.target.value === 'purchases' ? 'purchases' : 'sales')} className={field}>
            <option value="sales">Sold (invoices)</option>
            <option value="purchases">Bought (bills)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[var(--muted)]">Item
          <select value={itemId} onChange={e => setItemId(e.target.value)} className={field}>
            <option value="">Every item</option>
            {[...(items || [])].sort((a, b) => a.name.localeCompare(b.name)).map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[var(--muted)]">From<input type="date" value={from} onChange={e => setFrom(e.target.value)} className={field} /></label>
        <label className="flex flex-col gap-1 text-[var(--muted)]">To<input type="date" value={to} onChange={e => setTo(e.target.value)} className={field} /></label>
      </div>
      {loading && <p className="text-sm text-[var(--muted)]">Loading…</p>}
      {!loading && rows.length === 0 && <p className="text-sm text-[var(--muted)]">No {side === 'sales' ? 'invoice' : 'bill'} lines with a stock item in this period.</p>}
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
          <table className="w-full text-sm">
            <caption className="text-left text-xs text-[var(--muted)] pb-1">{side === 'sales' ? 'Each invoice line that sold a stock item (issued invoices only)' : 'Each bill line that bought a stock item'}, oldest first.</caption>
            <thead>
              <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                <th scope="col" className="text-left font-semibold py-1 px-2">Date</th>
                <th scope="col" className="text-left font-semibold py-1 px-2">{side === 'sales' ? 'Invoice' : 'Bill'}</th>
                <th scope="col" className="text-left font-semibold py-1 px-2">{side === 'sales' ? 'Customer' : 'Vendor'}</th>
                <th scope="col" className="text-left font-semibold py-1 px-2">Item</th>
                <th scope="col" className="text-right font-semibold py-1 px-2">Units</th>
                <th scope="col" className="text-right font-semibold py-1 px-2">Price</th>
                <th scope="col" className="text-right font-semibold py-1 px-2">Amount</th>
              </tr>
            </thead>
            <tbody>
              {paged.visible.map(r => (
                <tr key={`${r.documentId}:${r.line}`} className="border-b border-[var(--line)]/50">
                  <td className="py-1 px-2 font-mono text-xs">{formatDate(r.date)}</td>
                  <td className="py-1 px-2">
                    <button type="button" className="font-mono text-indigo-600 dark:text-indigo-400 hover:underline" onClick={() => openRecord({ type: r.documentType, id: r.documentId })}>
                      {r.number}<span className="sr-only">: open it</span>
                    </button>
                  </td>
                  <td className="py-1 px-2"><bdi>{r.party}</bdi></td>
                  <td className="py-1 px-2"><bdi>{r.itemName}</bdi></td>
                  <td className="text-right font-mono py-1 px-2">{qty(r.quantity)}</td>
                  <td className="text-right font-mono py-1 px-2">{formatCurrency(r.unitCents, r.currency || home)}</td>
                  <td className="text-right font-mono py-1 px-2">{formatCurrency(r.amountCents, r.currency || home)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {totals.map(t => (
                <tr key={t.itemId} className="font-semibold">
                  <th scope="row" colSpan={4} className="text-left py-1 px-2">Total <bdi>{t.itemName}</bdi></th>
                  <td className="text-right font-mono py-1 px-2">{qty(t.quantity)}</td>
                  <td />
                  <td className="text-right font-mono py-1 px-2">{Object.entries(t.amounts).map(([c, cents]) => formatCurrency(cents, c)).join(' + ')}</td>
                </tr>
              ))}
            </tfoot>
          </table>
          <ShowMoreRows shown={paged.visible.length} total={paged.total} noun="lines" onMore={paged.more} onAll={paged.all} />
        </div>
      )}
    </section>
  );
}
