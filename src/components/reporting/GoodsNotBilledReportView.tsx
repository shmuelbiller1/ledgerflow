import { isCollectionCapped } from '../../lib/ledgerCollections';
import React from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useCollection } from '../../hooks/useCollection';
import type { PurchaseOrder } from '../../types';
import { formatCurrency } from '../../lib/utils';
import { ageInDays, billedNotReceived, deliveredNotInvoiced, orderedNotReceived, receivedNotBilled, totalsByCurrency } from '../../lib/unbilledGoods';
import { csvMoneyForBook, downloadCsv } from '../../lib/csvExport';
import { getLocalDateISO } from '../../lib/utils';
import { RowTable } from '../ui/RowTable';
import { useReportText } from './useReportText';
import { LoadingState } from '../ui/LoadingState';
import { CappedCollectionsNote } from '../common/LoadedEntriesOnlyNote';

const qty = (n: number) => String(Math.round(n * 100) / 100);
const th = 'font-semibold py-1 px-2';

/**
 * Goods not yet billed (CB-18, CB-19, CB-17): goods delivered to customers that are not invoiced yet,
 * goods received from vendors whose order has no bill yet, and goods billed by vendors that have not
 * arrived, each at its order's price (src/lib/unbilledGoods.ts). Income to invoice, costs still to
 * come, and goods paid for but still to come.
 */
export default function GoodsNotBilledReportView() {
  const reportText = useReportText();
  const { loading } = useLedgerCollections('estimates', 'invoices', 'transactions', 'bills');
  const bills = useLedgerStore(s => s.bills);
  const { data: purchaseOrders, loading: loadingOrders, truncated: ordersCapped } = useCollection<PurchaseOrder>('purchaseOrders', { limit: 1000 });
  const home = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';
  const truncated = useLedgerStore(s => s.truncatedCollections);
  const estimates = useLedgerStore(s => s.estimates);
  const invoices = useLedgerStore(s => s.invoices);
  const transactions = useLedgerStore(s => s.transactions);
  const sold = deliveredNotInvoiced(estimates || [], invoices || [], transactions || []);
  const bought = receivedNotBilled(purchaseOrders || [], bills || []);
  const prepaid = billedNotReceived(purchaseOrders || [], bills || []);
  const ordered = orderedNotReceived(purchaseOrders || []);
  const today = getLocalDateISO();
  const exportList = (name: string, headers: string[], rows: Array<Array<string | number>>) => downloadCsv(`${name}_${today}.csv`, headers, rows);
  // #940: each row keeps the document's own currency (shown in its own column), so each amount is
  // written with that currency's decimals — not the book's, and not two decimals for every row.
  const moneyForRow = (currency?: string) => csvMoneyForBook(currency || home);
  const totals = (rows: Array<{ currency?: string; valueCents: number }>) => totalsByCurrency(rows, home).map(t => formatCurrency(t.cents, t.currency)).join(' + ');

  return (
    <section aria-labelledby="goods-not-billed-title" className="space-y-6">
      <div>
        <h2 id="goods-not-billed-title" className="text-lg font-bold text-[var(--text)]">{reportText('r.goods-not-yet-billed', 'Goods not yet billed')}</h2>
        <p className="text-sm text-[var(--muted)]">{reportText('r.goods-that-left-or-came-in-before-their-invoice', 'Goods that left or came in before their invoice or bill, at each order\'s price.')}</p>
      </div>
      {(loading || loadingOrders) && <LoadingState label={reportText('r.loading', 'Loading…')} rows={3} />}
      {/* R-11 / #926: the four sections are built from the loaded documents and from at most
          1,000 purchase orders, so a short list must not read as the whole picture. */}
      <CappedCollectionsNote
        testId="goods-not-billed-capped"
        keys={(['bills', 'estimates', 'invoices', 'transactions'] as const).filter(key => isCollectionCapped(truncated, key))}
        what={reportText('r.these-four-lists', 'these four lists')}
      />
      {ordersCapped && <p role="note" data-testid="goods-not-billed-orders-capped" className="text-xs text-[var(--muted)]">
        {reportText('r.only-the-first-1000-purchase-orders-are-read-so-a', 'Only the first 1,000 purchase orders are read, so “received not billed”, “ordered not received” and “billed not received” may be incomplete.')}
      </p>}
      <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
        <RowTable
          rowClassName="border-b border-[var(--line)]/50"
          caption={(<>{reportText('r.delivered-not-invoiced', 'Delivered, not invoiced')}{sold.length > 0 ? `: ${totals(sold)}` : ''}</>)}
          rows={sold}
          rowKey={r => `${r.orderId}-${r.description}-${r.delivered}`}
          captionClassName="text-left font-semibold text-[var(--text)] pb-1"
          tableClassName="w-full text-sm"
          headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)]"
          bodyClassName=""
          emptyRow={<tr><td colSpan={7} className="py-2 px-2 text-[var(--muted)]">{reportText('r.nothing-delivered-is-waiting-for-its-invoice', 'Nothing delivered is waiting for its invoice.')}</td></tr>}
          columns={[
            { header: reportText('r.order', 'Order'), className: "text-left font-mono font-normal py-1 px-2", headClassName: `text-left ${th}`, cell: (r) => r.number },
            { header: reportText('r.customer', 'Customer'), className: "py-1 px-2", headClassName: `text-left ${th}`, cell: (r) => <bdi>{r.customerName}</bdi> },
            { header: reportText('r.line', 'Line'), className: "py-1 px-2", headClassName: `text-left ${th}`, cell: (r) => <bdi>{r.description}</bdi> },
            { header: reportText('r.delivered', 'Delivered'), align: 'right', className: "font-mono py-1 px-2", headClassName: `text-right ${th}`, cell: (r) => qty(r.delivered) },
            { header: reportText('r.invoiced-2', 'Invoiced'), align: 'right', className: "font-mono py-1 px-2", headClassName: `text-right ${th}`, cell: (r) => qty(r.invoiced) },
            { header: reportText('r.to-invoice', 'To invoice'), align: 'right', className: "font-mono py-1 px-2", headClassName: `text-right ${th}`, cell: (r) => qty(r.units) },
            { header: reportText('r.value', 'Value'), align: 'right', className: "font-mono py-1 px-2", headClassName: `text-right ${th}`, cell: (r) => formatCurrency(r.valueCents, r.currency || home) },
          ]}
        />
      </div>
      <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
        <RowTable
          rowClassName="border-b border-[var(--line)]/50"
          caption={(<>{reportText('r.received-not-billed', 'Received, not billed')}{bought.length > 0 ? `: ${totals(bought)}` : ''}</>)}
          rows={bought}
          rowKey={r => `${r.orderId}-${r.description}-${r.received}`}
          captionClassName="text-left font-semibold text-[var(--text)] pb-1"
          tableClassName="w-full text-sm"
          headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)]"
          bodyClassName=""
          emptyRow={<tr><td colSpan={7} className="py-2 px-2 text-[var(--muted)]">{reportText('r.nothing-received-is-waiting-for-its-bill', 'Nothing received is waiting for its bill.')}</td></tr>}
          columns={[
            { header: reportText('r.purchase-order', 'Purchase order'), className: "text-left font-mono font-normal py-1 px-2", headClassName: `text-left ${th}`, cell: (r) => r.number },
            { header: reportText('r.vendor', 'Vendor'), className: "py-1 px-2", headClassName: `text-left ${th}`, cell: (r) => <bdi>{r.vendorName}</bdi> },
            { header: reportText('r.line', 'Line'), className: "py-1 px-2", headClassName: `text-left ${th}`, cell: (r) => <bdi>{r.description}</bdi> },
            { header: reportText('r.received', 'Received'), align: 'right', className: "font-mono py-1 px-2", headClassName: `text-right ${th}`, cell: (r) => qty(r.received) },
            { header: reportText('r.not-yet-billed', 'Not yet billed'), align: 'right', className: "font-mono py-1 px-2", headClassName: `text-right ${th}`, cell: (r) => qty(r.units) },
            { header: reportText('r.value', 'Value'), align: 'right', className: "font-mono py-1 px-2", headClassName: `text-right ${th}`, cell: (r) => formatCurrency(r.valueCents, r.currency || home) },
            { header: reportText('r.age-days', 'Age (days)'), align: 'right', className: "font-mono py-1 px-2", headClassName: `text-right ${th}`, cell: (r) => ageInDays(r.issueDate, today) ?? '—' },
          ]}
        />
        <button type="button" onClick={() => exportList('received_not_billed', ['Purchase order', 'Vendor', 'Line', 'Received', 'Not yet billed', 'Value', 'Currency', 'Age (days)'],
          bought.map(r => [r.number, r.vendorName, r.description, r.received, r.units, moneyForRow(r.currency)(r.valueCents), r.currency || home, ageInDays(r.issueDate, today) ?? '']))}
          disabled={bought.length === 0} className="mt-2 min-h-[44px] px-3 py-2 rounded border border-[var(--line)] text-xs text-[var(--text)] disabled:opacity-50">{reportText('r.export-csv', 'Export CSV')}</button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
        <RowTable
          rowClassName="border-b border-[var(--line)]/50"
          caption={(<>{reportText('r.ordered-not-received', 'Ordered, not received')}{ordered.length > 0 ? `: ${totals(ordered)}` : ''}</>)}
          rows={ordered}
          rowKey={r => `${r.orderId}-${r.description}-${r.ordered}`}
          captionClassName="text-left font-semibold text-[var(--text)] pb-1"
          tableClassName="w-full text-sm"
          headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)]"
          bodyClassName=""
          emptyRow={<tr><td colSpan={8} className="py-2 px-2 text-[var(--muted)]">{reportText('r.every-open-order-is-received', 'Every open order is received.')}</td></tr>}
          columns={[
            { header: reportText('r.purchase-order', 'Purchase order'), className: "text-left font-mono font-normal py-1 px-2", headClassName: `text-left ${th}`, cell: (r) => r.number },
            { header: reportText('r.vendor', 'Vendor'), className: "py-1 px-2", headClassName: `text-left ${th}`, cell: (r) => <bdi>{r.vendorName}</bdi> },
            { header: reportText('r.line', 'Line'), className: "py-1 px-2", headClassName: `text-left ${th}`, cell: (r) => <bdi>{r.description}</bdi> },
            { header: reportText('r.ordered', 'Ordered'), align: 'right', className: "font-mono py-1 px-2", headClassName: `text-right ${th}`, cell: (r) => qty(r.ordered) },
            { header: reportText('r.received', 'Received'), align: 'right', className: "font-mono py-1 px-2", headClassName: `text-right ${th}`, cell: (r) => qty(r.received) },
            { header: reportText('r.still-to-come', 'Still to come'), align: 'right', className: "font-mono py-1 px-2", headClassName: `text-right ${th}`, cell: (r) => qty(r.units) },
            { header: reportText('r.value', 'Value'), align: 'right', className: "font-mono py-1 px-2", headClassName: `text-right ${th}`, cell: (r) => formatCurrency(r.valueCents, r.currency || home) },
            { header: reportText('r.age-days', 'Age (days)'), align: 'right', className: "font-mono py-1 px-2", headClassName: `text-right ${th}`, cell: (r) => ageInDays(r.issueDate, today) ?? '—' },
          ]}
        />
        <button type="button" onClick={() => exportList('ordered_not_received', ['Purchase order', 'Vendor', 'Line', 'Ordered', 'Received', 'Still to come', 'Value', 'Currency', 'Age (days)'],
          ordered.map(r => [r.number, r.vendorName, r.description, r.ordered, r.received, r.units, moneyForRow(r.currency)(r.valueCents), r.currency || home, ageInDays(r.issueDate, today) ?? '']))}
          disabled={ordered.length === 0} className="mt-2 min-h-[44px] px-3 py-2 rounded border border-[var(--line)] text-xs text-[var(--text)] disabled:opacity-50">{reportText('r.export-csv', 'Export CSV')}</button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
        <RowTable
          rowClassName="border-b border-[var(--line)]/50"
          caption={(<>{reportText('r.billed-not-received', 'Billed, not received')}{prepaid.length > 0 ? `: ${totals(prepaid)}` : ''}</>)}
          rows={prepaid}
          rowKey={r => `${r.orderId}-${r.description}-${r.billed}`}
          captionClassName="text-left font-semibold text-[var(--text)] pb-1"
          tableClassName="w-full text-sm"
          headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)]"
          bodyClassName=""
          emptyRow={<tr><td colSpan={7} className="py-2 px-2 text-[var(--muted)]">{reportText('r.nothing-billed-is-waiting-to-arrive-bills-made-f', 'Nothing billed is waiting to arrive (bills made from an order since 10 Oct are counted).')}</td></tr>}
          columns={[
            { header: reportText('r.purchase-order', 'Purchase order'), className: "text-left font-mono font-normal py-1 px-2", headClassName: `text-left ${th}`, cell: (r) => r.number },
            { header: reportText('r.vendor', 'Vendor'), className: "py-1 px-2", headClassName: `text-left ${th}`, cell: (r) => <bdi>{r.vendorName}</bdi> },
            { header: reportText('r.line', 'Line'), className: "py-1 px-2", headClassName: `text-left ${th}`, cell: (r) => <bdi>{r.description}</bdi> },
            { header: reportText('r.billed-2', 'Billed'), align: 'right', className: "font-mono py-1 px-2", headClassName: `text-right ${th}`, cell: (r) => qty(r.billed) },
            { header: reportText('r.received', 'Received'), align: 'right', className: "font-mono py-1 px-2", headClassName: `text-right ${th}`, cell: (r) => qty(r.received) },
            { header: reportText('r.still-to-come', 'Still to come'), align: 'right', className: "font-mono py-1 px-2", headClassName: `text-right ${th}`, cell: (r) => qty(r.units) },
            { header: reportText('r.value', 'Value'), align: 'right', className: "font-mono py-1 px-2", headClassName: `text-right ${th}`, cell: (r) => formatCurrency(r.valueCents, r.currency || home) },
          ]}
        />
        <button type="button" onClick={() => exportList('billed_not_received', ['Purchase order', 'Vendor', 'Line', 'Billed', 'Received', 'Still to come', 'Value', 'Currency'],
          prepaid.map(r => [r.number, r.vendorName, r.description, r.billed, r.received, r.units, moneyForRow(r.currency)(r.valueCents), r.currency || home]))}
          disabled={prepaid.length === 0} className="mt-2 min-h-[44px] px-3 py-2 rounded border border-[var(--line)] text-xs text-[var(--text)] disabled:opacity-50">{reportText('r.export-csv', 'Export CSV')}</button>
      </div>
    </section>
  );
}
