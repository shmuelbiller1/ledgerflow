import React from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useCollection } from '../../hooks/useCollection';
import type { PurchaseOrder } from '../../types';
import { backorders, ordersReadyToRelease, releasableLines, shortages } from '../../lib/backorders';
import { RowTable } from '../ui/RowTable';
import { useReportText } from './useReportText';

const qty = (n: number) => String(Math.round(n * 100) / 100);
const th = 'font-semibold py-1 px-2';

/**
 * Backorders (W-08): the sales orders' item lines still to deliver, oldest first, against stock on
 * hand; what each is short, and what is already ordered from vendors (src/lib/backorders.ts). Above,
 * each short item in all, to know what to buy. First, the release list (A-121): the lines the stock
 * on hand already covers in full, which is where a goods receipt shows up when stock arrives.
 */
export default function BackordersReportView() {
  const reportText = useReportText();
  const { loading } = useLedgerCollections('estimates', 'transactions', 'inventory');
  const estimates = useLedgerStore(s => s.estimates);
  const transactions = useLedgerStore(s => s.transactions);
  const inventory = useLedgerStore(s => s.inventory);
  const { data: purchaseOrders, loading: loadingOrders } = useCollection<PurchaseOrder>('purchaseOrders', { limit: 1000 });
  const rows = backorders(estimates || [], transactions || [], inventory || [], purchaseOrders || []);
  const short = shortages(rows);
  const releasable = releasableLines(rows);
  const readyOrders = ordersReadyToRelease(rows);

  return (
    <section aria-labelledby="backorders-title" className="space-y-6">
      <div>
        <h2 id="backorders-title" className="text-lg font-bold text-[var(--text)]">{reportText('r.backorders', 'Backorders')}</h2>
        <p className="text-sm text-[var(--muted)]">{reportText('r.items-sold-on-orders-and-not-delivered-yet-oldes', 'Items sold on orders and not delivered yet, oldest order first, against the stock on hand — first what can go out today, then what is short. Nothing is reserved.')}</p>
      </div>
      {(loading || loadingOrders) && <p className="text-sm text-[var(--muted)]">{reportText('r.loading', 'Loading…')}</p>}
      <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
        <RowTable
          rowClassName="border-b border-[var(--line)]/50"
          caption={(<>{reportText('r.ready-to-release', 'Ready to release (')}{releasable.length})</>)}
          rows={releasable}
          rowKey={r => `ready-${r.orderId}-${r.itemId}-${r.left}`}
          captionClassName="text-left font-semibold text-[var(--text)] pb-1"
          tableClassName="w-full text-sm"
          headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)]"
          bodyClassName=""
          emptyRow={<tr><td colSpan={4} className="py-2 px-2 text-[var(--muted)]">{reportText('r.stock-on-hand-does-not-fully-cover-any-waiting-l', 'Stock on hand does not fully cover any waiting line yet. When stock arrives, the lines it completes appear here.')}</td></tr>}
          columns={[
            { header: reportText('r.order', 'Order'), className: "text-left font-mono font-normal py-1 px-2", headClassName: `text-left ${th}`, cell: (r) => r.number },
            { header: reportText('r.customer', 'Customer'), className: "py-1 px-2", headClassName: `text-left ${th}`, cell: (r) => <bdi>{r.customerName}</bdi> },
            { header: reportText('r.item', 'Item'), className: "py-1 px-2", headClassName: `text-left ${th}`, cell: (r) => <bdi>{r.item}</bdi> },
            { header: reportText('r.to-deliver', 'To deliver'), align: 'right', className: "font-mono py-1 px-2", headClassName: `text-right ${th}`, cell: (r) => qty(r.left) },
          ]}
        />
        {releasable.length > 0 && <p className="text-sm text-[var(--muted)] pt-2">
          {readyOrders.length > 0
            ? <>{readyOrders.length} {reportText('r.order-s-can-be-delivered-in-full-from-stock-on-h', 'order(s) can be delivered in full from stock on hand.')} </>
            : <>{reportText('r.no-single-order-is-covered-in-full-yet-the-lines', 'No single order is covered in full yet; the lines above are covered, the rest of their orders are short below.')} </>}
          {reportText('r.the-cover-follows-the-same-oldest-first-allocati', 'The cover follows the same oldest-first allocation as the table below and is computed, not held: deliver from the order to use it.')}
        </p>}
      </div>
      <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
        <RowTable
          rowClassName="border-b border-[var(--line)]/50"
          caption={(<>{reportText('r.short-items', 'Short items (')}{short.length})</>)}
          rows={short}
          rowKey={s => s.itemId}
          captionClassName="text-left font-semibold text-[var(--text)] pb-1"
          tableClassName="w-full text-sm"
          headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)]"
          bodyClassName=""
          emptyRow={<tr><td colSpan={4} className="py-2 px-2 text-[var(--muted)]">{reportText('r.stock-on-hand-covers-every-order', 'Stock on hand covers every order.')}</td></tr>}
          columns={[
            { header: reportText('r.item', 'Item'), className: "text-left font-normal py-1 px-2", headClassName: `text-left ${th}`, cell: (s) => <bdi>{s.item}</bdi> },
            { header: reportText('r.short-2', 'Short'), align: 'right', className: "font-mono py-1 px-2", headClassName: `text-right ${th}`, cell: (s) => qty(s.short) },
            { header: reportText('r.on-order-from-vendors', 'On order from vendors'), align: 'right', className: "font-mono py-1 px-2", headClassName: `text-right ${th}`, cell: (s) => qty(s.onOrder) },
            { header: reportText('r.still-to-buy', 'Still to buy'), align: 'right', className: "font-mono py-1 px-2", headClassName: `text-right ${th}`, cell: (s) => qty(Math.max(0, s.short - s.onOrder)) },
          ]}
        />
      </div>
      <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
        <table className="w-full text-sm">
          <caption className="text-left font-semibold text-[var(--text)] pb-1">{reportText('r.order-lines-to-deliver', 'Order lines to deliver (')}{rows.length})</caption>
          <thead><tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
            <th scope="col" className={`text-left ${th}`}>{reportText('r.order', 'Order')}</th><th scope="col" className={`text-left ${th}`}>{reportText('r.customer', 'Customer')}</th><th scope="col" className={`text-left ${th}`}>{reportText('r.item', 'Item')}</th>
            <th scope="col" className={`text-right ${th}`}>{reportText('r.to-deliver', 'To deliver')}</th><th scope="col" className={`text-right ${th}`}>{reportText('r.from-stock', 'From stock')}</th><th scope="col" className={`text-right ${th}`}>{reportText('r.short-2', 'Short')}</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="py-2 px-2 text-[var(--muted)]">{reportText('r.no-order-is-waiting-for-goods', 'No order is waiting for goods.')}</td></tr>}
            {rows.map(r => (
              <tr key={`${r.orderId}-${r.itemId}-${r.left}`} className="border-b border-[var(--line)]/50">
                <th scope="row" className="text-left font-mono font-normal py-1 px-2">{r.number}</th>
                <td className="py-1 px-2"><bdi>{r.customerName}</bdi></td>
                <td className="py-1 px-2"><bdi>{r.item}</bdi></td>
                <td className="text-right font-mono py-1 px-2">{qty(r.left)}</td>
                <td className="text-right font-mono py-1 px-2">{qty(r.covered)}</td>
                <td className={`text-right font-mono py-1 px-2 ${r.short > 0 ? 'font-semibold text-rose-600' : ''}`}>{r.short > 0 ? qty(r.short) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
