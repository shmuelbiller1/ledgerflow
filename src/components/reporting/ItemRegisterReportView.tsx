import React, { useMemo, useState } from 'react';
import { ShowMoreRows } from '../common/ShowMoreRows';
import { usePagedRows } from '../../hooks/usePagedRows';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useUIStore } from '../../stores/useUIStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { formatCurrency, formatDate, getLocalDateISO } from '../../lib/utils';
import { purchaseRegister, registerTotals, salesRegister } from '../../lib/itemRegister';
import { RowTable } from '../ui/RowTable';
import { useReportText } from './useReportText';
import { LoadingState } from '../ui/LoadingState';
import ReportEmptyState from './ReportEmptyState';

const field = 'px-2 py-1.5 border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]';
const qty = (n: number) => String(Math.round(n * 1e6) / 1e6);

/**
 * Item-wise registers (CB-12, CB-13): every invoice line that sold a stock item, or every bill line
 * that bought one, in a period, one row per line, for one item or all; each opens its document, and
 * each item's units and amount add up below (src/lib/itemRegister.ts).
 */
export default function ItemRegisterReportView() {
  const reportText = useReportText();
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
      <h2 id="item-register-title" className="text-lg font-bold text-[var(--text)]">{reportText('r.item-wise-register', 'Item-wise register')}</h2>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1 text-[var(--muted)]">{reportText('r.lines', 'Lines')}
          <select value={side} onChange={e => setSide(e.target.value === 'purchases' ? 'purchases' : 'sales')} className={field}>
            <option value="sales">{reportText('r.sold-invoices', 'Sold (invoices)')}</option>
            <option value="purchases">{reportText('r.bought-bills', 'Bought (bills)')}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[var(--muted)]">{reportText('r.item', 'Item')}
          <select value={itemId} onChange={e => setItemId(e.target.value)} className={field}>
            <option value="">{reportText('r.every-item', 'Every item')}</option>
            {[...(items || [])].sort((a, b) => a.name.localeCompare(b.name)).map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[var(--muted)]">{reportText('r.from', 'From')}<input type="date" value={from} onChange={e => setFrom(e.target.value)} className={field} /></label>
        <label className="flex flex-col gap-1 text-[var(--muted)]">{reportText('r.to', 'To')}<input type="date" value={to} onChange={e => setTo(e.target.value)} className={field} /></label>
      </div>
      {loading && <LoadingState label={reportText('r.loading', 'Loading…')} rows={3} />}
      {/* R-11 / #926: "nothing loaded" is not "nothing in this period" */}
      {!loading && rows.length === 0 && ((items || []).length === 0
        ? <ReportEmptyState
            title={reportText('r.no-items-loaded-yet-2', 'No items loaded yet')}
            description={reportText('r.add-items-in-inventory-then-the-lines-that-moved', 'Add items in Inventory; the invoice and bill lines that moved them then appear here.')}
          />
        : <ReportEmptyState
            title={side === 'sales' ? reportText('r.no-invoice-stock-lines', 'No invoice lines with a stock item in this period.') : reportText('r.no-bill-stock-lines', 'No bill lines with a stock item in this period.')}
            description={reportText('r.choose-another-period-or-pick-a-single-item-above', 'Choose another period, or pick a single item above to see only its lines.')}
          />)}
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
          <RowTable
            rowHeaderColumn={false}
            rowClassName="border-b border-[var(--line)]/50"
            caption={(<>{side === 'sales' ? reportText('r.each-invoice-line-that-sold-a-stock-item-issued', 'Each invoice line that sold a stock item (issued invoices only)') : reportText('r.each-bill-line-that-bought-a-stock-item', 'Each bill line that bought a stock item')}{reportText('r.oldest-first', ', oldest first.')}</>)}
            rows={paged.visible}
            rowKey={r => `${r.documentId}:${r.line}`}
            captionClassName="text-left text-xs text-[var(--muted)] pb-1"
            tableClassName="w-full text-sm"
            headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)]"
            bodyClassName=""
            footer={totals.map(t => (
                <tr key={t.itemId} className="font-semibold">
                  <th scope="row" colSpan={4} className="text-left py-1 px-2">{reportText('r.total', 'Total')} <bdi>{t.itemName}</bdi></th>
                  <td className="text-right font-mono py-1 px-2">{qty(t.quantity)}</td>
                  <td />
                  <td className="text-right font-mono py-1 px-2">{Object.entries(t.amounts).map(([c, cents]) => formatCurrency(cents, c)).join(' + ')}</td>
                </tr>
              ))}
            columns={[
              { header: reportText('r.date-2', 'Date'), className: "py-1 px-2 font-mono text-xs", headClassName: "text-left font-semibold py-1 px-2", cell: (r) => formatDate(r.date) },
              { header: side === 'sales' ? reportText('r.invoice-2', 'Invoice') : reportText('r.bill-2', 'Bill'), className: "py-1 px-2", headClassName: "text-left font-semibold py-1 px-2", cell: (r) => <button type="button" className="font-mono text-indigo-600 dark:text-indigo-400 hover:underline" onClick={() => openRecord({ type: r.documentType, id: r.documentId })}>
                      {r.number}<span className="sr-only">{reportText('r.open-it', ': open it')}</span>
                    </button> },
              { header: side === 'sales' ? reportText('r.customer', 'Customer') : reportText('r.vendor', 'Vendor'), className: "py-1 px-2", headClassName: "text-left font-semibold py-1 px-2", cell: (r) => <bdi>{r.party}</bdi> },
              { header: reportText('r.item', 'Item'), className: "py-1 px-2", headClassName: "text-left font-semibold py-1 px-2", cell: (r) => <bdi>{r.itemName}</bdi> },
              { header: reportText('r.units', 'Units'), align: 'right', className: "font-mono py-1 px-2", headClassName: "font-semibold py-1 px-2", cell: (r) => qty(r.quantity) },
              { header: reportText('r.price', 'Price'), align: 'right', className: "font-mono py-1 px-2", headClassName: "font-semibold py-1 px-2", cell: (r) => formatCurrency(r.unitCents, r.currency || home) },
              { header: reportText('r.amount', 'Amount'), align: 'right', className: "font-mono py-1 px-2", headClassName: "font-semibold py-1 px-2", cell: (r) => formatCurrency(r.amountCents, r.currency || home) },
            ]}
          />
          <ShowMoreRows shown={paged.visible.length} total={paged.total} noun="lines" onMore={paged.more} onAll={paged.all} />
        </div>
      )}
    </section>
  );
}
