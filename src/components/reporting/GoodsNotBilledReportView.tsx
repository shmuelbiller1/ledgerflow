import React from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useCollection } from '../../hooks/useCollection';
import type { PurchaseOrder } from '../../types';
import { formatCurrency } from '../../lib/utils';
import { ageInDays, billedNotReceived, deliveredNotInvoiced, orderedNotReceived, receivedNotBilled, totalsByCurrency } from '../../lib/unbilledGoods';
import { csvMoney, downloadCsv } from '../../lib/csvExport';
import { getLocalDateISO } from '../../lib/utils';
import { RowTable } from '../ui/RowTable';

const qty = (n: number) => String(Math.round(n * 100) / 100);
const th = 'font-semibold py-1 px-2';

/**
 * Goods not yet billed (CB-18, CB-19, CB-17): goods delivered to customers that are not invoiced yet,
 * goods received from vendors whose order has no bill yet, and goods billed by vendors that have not
 * arrived, each at its order's price (src/lib/unbilledGoods.ts). Income to invoice, costs still to
 * come, and goods paid for but still to come.
 */
export default function GoodsNotBilledReportView() {
  const { loading } = useLedgerCollections('estimates', 'invoices', 'transactions', 'bills');
  const bills = useLedgerStore(s => s.bills);
  const { data: purchaseOrders, loading: loadingOrders } = useCollection<PurchaseOrder>('purchaseOrders', { limit: 1000 });
  const home = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';
  const estimates = useLedgerStore(s => s.estimates);
  const invoices = useLedgerStore(s => s.invoices);
  const transactions = useLedgerStore(s => s.transactions);
  const sold = deliveredNotInvoiced(estimates || [], invoices || [], transactions || []);
  const bought = receivedNotBilled(purchaseOrders || [], bills || []);
  const prepaid = billedNotReceived(purchaseOrders || [], bills || []);
  const ordered = orderedNotReceived(purchaseOrders || []);
  const today = getLocalDateISO();
  const exportList = (name: string, headers: string[], rows: Array<Array<string | number>>) => downloadCsv(`${name}_${today}.csv`, headers, rows);
  const totals = (rows: Array<{ currency?: string; valueCents: number }>) => totalsByCurrency(rows, home).map(t => formatCurrency(t.cents, t.currency)).join(' + ');

  return (
    <section aria-labelledby="goods-not-billed-title" className="space-y-6">
      <div>
        <h2 id="goods-not-billed-title" className="text-lg font-bold text-[var(--text)]">Goods not yet billed</h2>
        <p className="text-sm text-[var(--muted)]">Goods that left or came in before their invoice or bill, at each order's price.</p>
      </div>
      {(loading || loadingOrders) && <p className="text-sm text-[var(--muted)]">Loading…</p>}
      <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
        <RowTable
          rowClassName="border-b border-[var(--line)]/50"
          caption={(<>Delivered, not invoiced{sold.length > 0 ? `: ${totals(sold)}` : ''}</>)}
          rows={sold}
          rowKey={r => `${r.orderId}-${r.description}-${r.delivered}`}
          captionClassName="text-left font-semibold text-[var(--text)] pb-1"
          tableClassName="w-full text-sm"
          headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)]"
          bodyClassName=""
          emptyRow={<tr><td colSpan={7} className="py-2 px-2 text-[var(--muted)]">Nothing delivered is waiting for its invoice.</td></tr>}
          columns={[
            { header: "Order", className: "text-left font-mono font-normal py-1 px-2", headClassName: `text-left ${th}`, cell: (r) => r.number },
            { header: "Customer", className: "py-1 px-2", headClassName: `text-left ${th}`, cell: (r) => <bdi>{r.customerName}</bdi> },
            { header: "Line", className: "py-1 px-2", headClassName: `text-left ${th}`, cell: (r) => <bdi>{r.description}</bdi> },
            { header: "Delivered", align: 'right', className: "font-mono py-1 px-2", headClassName: `text-right ${th}`, cell: (r) => qty(r.delivered) },
            { header: "Invoiced", align: 'right', className: "font-mono py-1 px-2", headClassName: `text-right ${th}`, cell: (r) => qty(r.invoiced) },
            { header: "To invoice", align: 'right', className: "font-mono py-1 px-2", headClassName: `text-right ${th}`, cell: (r) => qty(r.units) },
            { header: "Value", align: 'right', className: "font-mono py-1 px-2", headClassName: `text-right ${th}`, cell: (r) => formatCurrency(r.valueCents, r.currency || home) },
          ]}
        />
      </div>
      <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
        <RowTable
          rowClassName="border-b border-[var(--line)]/50"
          caption={(<>Received, not billed{bought.length > 0 ? `: ${totals(bought)}` : ''}</>)}
          rows={bought}
          rowKey={r => `${r.orderId}-${r.description}-${r.received}`}
          captionClassName="text-left font-semibold text-[var(--text)] pb-1"
          tableClassName="w-full text-sm"
          headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)]"
          bodyClassName=""
          emptyRow={<tr><td colSpan={7} className="py-2 px-2 text-[var(--muted)]">Nothing received is waiting for its bill.</td></tr>}
          columns={[
            { header: "Purchase order", className: "text-left font-mono font-normal py-1 px-2", headClassName: `text-left ${th}`, cell: (r) => r.number },
            { header: "Vendor", className: "py-1 px-2", headClassName: `text-left ${th}`, cell: (r) => <bdi>{r.vendorName}</bdi> },
            { header: "Line", className: "py-1 px-2", headClassName: `text-left ${th}`, cell: (r) => <bdi>{r.description}</bdi> },
            { header: "Received", align: 'right', className: "font-mono py-1 px-2", headClassName: `text-right ${th}`, cell: (r) => qty(r.received) },
            { header: "Not yet billed", align: 'right', className: "font-mono py-1 px-2", headClassName: `text-right ${th}`, cell: (r) => qty(r.units) },
            { header: "Value", align: 'right', className: "font-mono py-1 px-2", headClassName: `text-right ${th}`, cell: (r) => formatCurrency(r.valueCents, r.currency || home) },
            { header: "Age (days)", align: 'right', className: "font-mono py-1 px-2", headClassName: `text-right ${th}`, cell: (r) => ageInDays(r.issueDate, today) ?? '—' },
          ]}
        />
        <button type="button" onClick={() => exportList('received_not_billed', ['Purchase order', 'Vendor', 'Line', 'Received', 'Not yet billed', 'Value', 'Currency', 'Age (days)'],
          bought.map(r => [r.number, r.vendorName, r.description, r.received, r.units, csvMoney(r.valueCents), r.currency || home, ageInDays(r.issueDate, today) ?? '']))}
          disabled={bought.length === 0} className="mt-2 min-h-[44px] px-3 py-2 rounded border border-[var(--line)] text-xs text-[var(--text)] disabled:opacity-50">Export CSV</button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
        <RowTable
          rowClassName="border-b border-[var(--line)]/50"
          caption={(<>Ordered, not received{ordered.length > 0 ? `: ${totals(ordered)}` : ''}</>)}
          rows={ordered}
          rowKey={r => `${r.orderId}-${r.description}-${r.ordered}`}
          captionClassName="text-left font-semibold text-[var(--text)] pb-1"
          tableClassName="w-full text-sm"
          headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)]"
          bodyClassName=""
          emptyRow={<tr><td colSpan={8} className="py-2 px-2 text-[var(--muted)]">Every open order is received.</td></tr>}
          columns={[
            { header: "Purchase order", className: "text-left font-mono font-normal py-1 px-2", headClassName: `text-left ${th}`, cell: (r) => r.number },
            { header: "Vendor", className: "py-1 px-2", headClassName: `text-left ${th}`, cell: (r) => <bdi>{r.vendorName}</bdi> },
            { header: "Line", className: "py-1 px-2", headClassName: `text-left ${th}`, cell: (r) => <bdi>{r.description}</bdi> },
            { header: "Ordered", align: 'right', className: "font-mono py-1 px-2", headClassName: `text-right ${th}`, cell: (r) => qty(r.ordered) },
            { header: "Received", align: 'right', className: "font-mono py-1 px-2", headClassName: `text-right ${th}`, cell: (r) => qty(r.received) },
            { header: "Still to come", align: 'right', className: "font-mono py-1 px-2", headClassName: `text-right ${th}`, cell: (r) => qty(r.units) },
            { header: "Value", align: 'right', className: "font-mono py-1 px-2", headClassName: `text-right ${th}`, cell: (r) => formatCurrency(r.valueCents, r.currency || home) },
            { header: "Age (days)", align: 'right', className: "font-mono py-1 px-2", headClassName: `text-right ${th}`, cell: (r) => ageInDays(r.issueDate, today) ?? '—' },
          ]}
        />
        <button type="button" onClick={() => exportList('ordered_not_received', ['Purchase order', 'Vendor', 'Line', 'Ordered', 'Received', 'Still to come', 'Value', 'Currency', 'Age (days)'],
          ordered.map(r => [r.number, r.vendorName, r.description, r.ordered, r.received, r.units, csvMoney(r.valueCents), r.currency || home, ageInDays(r.issueDate, today) ?? '']))}
          disabled={ordered.length === 0} className="mt-2 min-h-[44px] px-3 py-2 rounded border border-[var(--line)] text-xs text-[var(--text)] disabled:opacity-50">Export CSV</button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
        <RowTable
          rowClassName="border-b border-[var(--line)]/50"
          caption={(<>Billed, not received{prepaid.length > 0 ? `: ${totals(prepaid)}` : ''}</>)}
          rows={prepaid}
          rowKey={r => `${r.orderId}-${r.description}-${r.billed}`}
          captionClassName="text-left font-semibold text-[var(--text)] pb-1"
          tableClassName="w-full text-sm"
          headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)]"
          bodyClassName=""
          emptyRow={<tr><td colSpan={7} className="py-2 px-2 text-[var(--muted)]">Nothing billed is waiting to arrive (bills made from an order since 10 Oct are counted).</td></tr>}
          columns={[
            { header: "Purchase order", className: "text-left font-mono font-normal py-1 px-2", headClassName: `text-left ${th}`, cell: (r) => r.number },
            { header: "Vendor", className: "py-1 px-2", headClassName: `text-left ${th}`, cell: (r) => <bdi>{r.vendorName}</bdi> },
            { header: "Line", className: "py-1 px-2", headClassName: `text-left ${th}`, cell: (r) => <bdi>{r.description}</bdi> },
            { header: "Billed", align: 'right', className: "font-mono py-1 px-2", headClassName: `text-right ${th}`, cell: (r) => qty(r.billed) },
            { header: "Received", align: 'right', className: "font-mono py-1 px-2", headClassName: `text-right ${th}`, cell: (r) => qty(r.received) },
            { header: "Still to come", align: 'right', className: "font-mono py-1 px-2", headClassName: `text-right ${th}`, cell: (r) => qty(r.units) },
            { header: "Value", align: 'right', className: "font-mono py-1 px-2", headClassName: `text-right ${th}`, cell: (r) => formatCurrency(r.valueCents, r.currency || home) },
          ]}
        />
        <button type="button" onClick={() => exportList('billed_not_received', ['Purchase order', 'Vendor', 'Line', 'Billed', 'Received', 'Still to come', 'Value', 'Currency'],
          prepaid.map(r => [r.number, r.vendorName, r.description, r.billed, r.received, r.units, csvMoney(r.valueCents), r.currency || home]))}
          disabled={prepaid.length === 0} className="mt-2 min-h-[44px] px-3 py-2 rounded border border-[var(--line)] text-xs text-[var(--text)] disabled:opacity-50">Export CSV</button>
      </div>
    </section>
  );
}
