import React, { useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useCollection } from '../../hooks/useCollection';
import { useEntityOperations } from '../../hooks/useEntityOperations';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import {
  BLANKET_CSV_HEADERS, blanketAgreementProblem, blanketCsvRows, blanketOrderReview, blanketStateLabel,
  type BlanketOrderRow,
} from '../../lib/blanketOrders';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { downloadCsv } from '../../lib/csvExport';
import InlineEdit from '../ui/InlineEdit';
import ReportTableScroll from './ReportTableScroll';
import type { Bill, PurchaseOrder } from '../../types';
import { fill, useReportText } from './useReportText';

/** Code names, paths and URL shapes shown as-is: they are not words to translate (EU-G1). */
const CODE_NAMES = { field: 'blanket', migration: 'supabase/migrations/20261015000000_purchase_order_blanket.sql' } as const;

const field = 'min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]';

export default function BlanketOrdersReportView({ today = '' }: { today?: string }) {
  const { data: orders, loading: ordersLoading, truncated: ordersTruncated } = useCollection<PurchaseOrder>('purchaseOrders', { orderByField: 'createdAt', orderDirection: 'desc', limit: 500 });
  return <BlanketOrdersPanel orders={orders} ordersLoading={ordersLoading} ordersTruncated={ordersTruncated} today={today} />;
}

/** The review for the orders it is given (the wrapper above reads them). */
export function BlanketOrdersPanel({
  orders, ordersLoading = false, ordersTruncated = false, today = '',
}: {
  orders: PurchaseOrder[];
  ordersLoading?: boolean;
  ordersTruncated?: boolean;
  today?: string;
}) {
  const reportText = useReportText();
  const bills = useLedgerStore(state => state.bills);
  const truncated = useLedgerStore(state => state.truncatedCollections);
  const failed = useDataNeedsStore(state => state.failed);
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  const user = useAuthStore(state => state.user);
  const isGuest = useAuthStore(state => state.isGuest);
  const { loading: loadingLedger } = useLedgerCollections('bills');
  const { updateEntity } = useEntityOperations();
  const role = useCurrentRole();

  const [problemFor, setProblemFor] = useState<{ id: string; problem: string } | null>(null);

  const asOf = today || getLocalDateISO();
  const homeCurrency = (workspace?.currency || 'USD').toUpperCase();
  const canEdit = role !== 'viewer' && !isGuest && !!user;

  const scopedOrders = useMemo(() => (
    (orders || []).filter(order => !workspaceId || order.workspaceId === workspaceId)
  ), [orders, workspaceId]);
  const scopedBills = useMemo(() => (
    (bills as Bill[]).filter(bill => !workspaceId || bill.workspaceId === workspaceId)
  ), [bills, workspaceId]);

  const review = useMemo(() => blanketOrderReview({
    orders: scopedOrders,
    bills: scopedBills.map(bill => ({ id: bill.id, vendorId: bill.vendorId, amountCents: bill.amountCents, currency: bill.currency, status: bill.status, metadata: bill.metadata })),
    today: asOf,
  }), [scopedOrders, scopedBills, asOf]);

  const unmarked = useMemo(() => scopedOrders.filter(order =>
    order.status !== 'cancelled' && !order.blanket
  ), [scopedOrders]);

  const partial = truncated.bills || failed.bills || ordersTruncated || scopedOrders.length >= 500;
  const loading = loadingLedger || ordersLoading;
  const money = (cents: number, currency: string) => formatCurrency(cents, (currency && currency !== '—') ? currency : homeCurrency);

  const saveBlanket = async (order: PurchaseOrder, blanket: { validUntil: string; capCents?: number } | null, message: string) => {
    await updateEntity('purchaseOrders', order.id, {
      blanket,
      updatedAt: new Date().toISOString(),
    } as Record<string, unknown>, message);
  };

  const mark = async (order: PurchaseOrder, validUntil: string, cap: string) => {
    const capCents = cap === '' ? undefined : Math.round(Number(cap) * 100);
    const problem = blanketAgreementProblem({ validUntil, capCents, issueDate: String(order.issueDate || '').slice(0, 10) });
    setProblemFor(problem ? { id: order.id, problem } : null);
    if (problem) return;
    await saveBlanket(order, {
      validUntil: validUntil.slice(0, 10),
      ...(cap === '' ? {} : { capCents }),
    }, `${order.poNumber} marked as a blanket order`);
  };

  return <section aria-label={reportText('r.blanket-purchase-orders', 'Blanket purchase orders')} className="p-4 space-y-4 min-w-0">
    <h2>{reportText('r.blanket-purchase-orders', 'Blanket purchase orders')}</h2>
    <p className="text-sm text-[var(--muted)]">
      {reportText('r.a-blanket-order-is-an-agreement-a-total-and-a-va', 'A blanket order is an agreement — a total and a validity period — that several goods receipts and vendor bills draw down over time. This report shows what has been drawn and what is left. Only documents explicitly linked to the order count (a receipt saved on it, or a bill carrying its order number or id); the three-way match\'s amount guesses never draw an agreement down. A delivery recorded both as a receipt and as a bill is one delivery, so “used” takes the higher of the two recorded totals — when one delivery was only received and another only billed, the true use is higher than shown, and both totals sit beside the figure for the reviewer. Nothing here posts; a bill in another currency is counted, never added in.')}
    </p>

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <p className="text-sm">{reportText('r.as-of-2', 'As of')} <b>{asOf}</b></p>
      <button type="button" className="btn-secondary min-h-11 px-3" disabled={!review.rows.length} onClick={() => downloadCsv(
        `blanket-purchase-orders-${asOf}.csv`, BLANKET_CSV_HEADERS, blanketCsvRows(review),
      )}>{reportText('r.export-csv', 'Export CSV')}</button>
    </div>

    {loading && <p role="status">{reportText('r.loading-purchase-orders-and-bills', 'Loading purchase orders and bills…')}</p>}
    {partial && <p role="alert">{reportText('r.loaded-purchase-order-or-bill-history-is-incompl', 'Loaded purchase-order or bill history is incomplete or failed to load. Documents that are not loaded are not counted, and “left” can look higher than it is until the history is complete.')}</p>}

    {!loading && review.rows.length > 0 && <>
      <p className="text-sm">
        <b>{review.rows.length} {reportText('r.blanket-agreement-s', 'blanket agreement(s)')}</b>
        {review.totals.map(total => <span key={total.currency}> · {total.currency}: {(total.capCents / 100).toFixed(2)} {reportText('r.agreed', 'agreed,')} {(total.usedCents / 100).toFixed(2)} {reportText('r.used', 'used,')} {(total.leftCents / 100).toFixed(2)} {reportText('r.left', 'left')}</span>)}
      </p>
      <ReportTableScroll><table className="w-full text-sm">
        <caption>{reportText('r.blanket-purchase-orders-with-what-is-drawn-down', 'Blanket purchase orders with what is drawn down and what is left')}</caption>
        <thead><tr>
          <th scope="col">{reportText('r.order', 'Order')}</th><th scope="col">{reportText('r.valid-until', 'Valid until')}</th>
          <th scope="col" className="text-right">{reportText('r.agreed-2', 'Agreed')}</th>
          <th scope="col" className="text-right">{reportText('r.received', 'Received')}</th>
          <th scope="col" className="text-right">{reportText('r.billed-2', 'Billed')}</th>
          <th scope="col" className="text-right">{reportText('r.used-2', 'Used')}</th>
          <th scope="col" className="text-right">{reportText('r.left-2', 'Left')}</th>
          <th scope="col">{reportText('r.state', 'State')}</th>
          <th scope="col"><span className="sr-only">{reportText('r.actions', 'Actions')}</span></th>
        </tr></thead>
        <tbody>{review.rows.map(row => <BlanketRow key={row.poId} row={row} canEdit={canEdit}
          money={money}
          onSaveValidUntil={(next) => {
            const order = scopedOrders.find(o => o.id === row.poId)!;
            return saveBlanket(order, { validUntil: String(next).slice(0, 10), capCents: row.capCents }, `Validity of ${row.poNumber} changed`);
          }}
          onSaveCap={(next) => {
            const order = scopedOrders.find(o => o.id === row.poId)!;
            return saveBlanket(order, { validUntil: row.validUntil, capCents: Math.round(Number(next)) }, `Agreed total of ${row.poNumber} changed`);
          }}
          onRemove={() => {
            const order = scopedOrders.find(o => o.id === row.poId)!;
            return saveBlanket(order, null, `${row.poNumber} is no longer marked as a blanket order`);
          }}
        />)}</tbody>
      </table></ReportTableScroll>
      <p className="text-xs text-[var(--muted)]">
        {reportText('r.marking-or-unmarking-an-order-writes-the', 'Marking or unmarking an order writes the')} <code>{CODE_NAMES.field}</code> {reportText('r.field-on-the-order-itself-that-field-needs-the-c', 'field on the order itself. That field needs the checked-in database change (')}<code>{CODE_NAMES.migration}</code>{reportText('r.to-be-applied-until-then-the-database-refuses-th', ') to be applied; until then the database refuses the write and the error says so. Editing in place needs an owner, accountant or bookkeeper — a viewer or a guest workspace reads only.')}
      </p>
    </>}

    {!loading && review.rows.length === 0 && <p>
      {reportText('r.no-order-is-marked-as-a-blanket-agreement-yet-ma', 'No order is marked as a blanket agreement yet. Mark one below and its receipts and linked bills start drawing it down.')}
    </p>}

    <h3>{reportText('r.orders-that-are-not-blanket-agreements', 'Orders that are not blanket agreements')}</h3>
    {unmarked.length === 0 && <p>{reportText('r.every-loaded-order-is-either-marked-or-cancelled', 'Every loaded order is either marked or cancelled.')}</p>}
    {unmarked.length > 0 && <ReportTableScroll><table className="w-full text-sm">
      <caption>{reportText('r.purchase-orders-that-can-be-marked-as-blanket-ag', 'Purchase orders that can be marked as blanket agreements')}</caption>
      <thead><tr>
        <th scope="col">{reportText('r.order', 'Order')}</th><th scope="col">{reportText('r.vendor', 'Vendor')}</th><th scope="col">{reportText('r.issued', 'Issued')}</th>
        <th scope="col" className="text-right">{reportText('r.order-total', 'Order total')}</th>
        <th scope="col">{reportText('r.last-valid-day', 'Last valid day')}</th><th scope="col">{reportText('r.agreed-total-optional', 'Agreed total (optional)')}</th>
        <th scope="col"><span className="sr-only">{reportText('r.actions', 'Actions')}</span></th>
      </tr></thead>
      <tbody>{unmarked.map(order => <MarkRow key={order.id} order={order} canEdit={canEdit} homeCurrency={homeCurrency}
        problem={problemFor?.id === order.id ? problemFor.problem : null}
        onMark={(validUntil, cap) => mark(order, validUntil, cap)}
      />)}</tbody>
    </table></ReportTableScroll>}
    {!canEdit && <p className="text-xs text-[var(--muted)]">{reportText('r.a-viewer-or-a-guest-workspace-reads-the-agreemen', 'A viewer or a guest workspace reads the agreements but cannot mark or change one.')}</p>}
    <p className="text-xs text-[var(--muted)]">
      {reportText('r.not-counted-as-agreements', 'Not counted as agreements:')} {review.skipped.cancelled} {reportText('r.cancelled-order-s', 'cancelled order(s),')} {review.skipped.invalidAgreement} {reportText('r.with-an-unusable-validity-date-refused-never-ass', 'with an unusable validity date (refused, never assumed),')} {review.skipped.draftsBills} {reportText('r.draft-or-void-bill-s-and', 'draft or void bill(s) and')}{' '}
      {review.skipped.billsOtherCurrency} {reportText('r.bill-s-in-another-currency-listed-on-the-row-nev', 'bill(s) in another currency (listed on the row, never added in).')}
    </p>
  </section>;
}

function MarkRow({ order, canEdit, homeCurrency, problem, onMark }: {
  order: PurchaseOrder;
  canEdit: boolean;
  homeCurrency: string;
  problem: string | null;
  onMark: (validUntil: string, cap: string) => Promise<unknown>;
}) {
  const reportText = useReportText();
  const [validUntil, setValidUntil] = useState('');
  const [cap, setCap] = useState('');
  return <tr className="border-t border-[var(--line)]">
    <th scope="row" className="text-left"><bdi>{order.poNumber}</bdi></th>
    <td><bdi>{order.vendorName || '—'}</bdi></td>
    <td className="tabular-nums">{String(order.issueDate || '').slice(0, 10)}</td>
    <td className="text-right tabular-nums">{formatCurrency(order.totalAmountCents || 0, order.currency || homeCurrency)}</td>
    <td>
      <input aria-label={fill(reportText('r.last-valid-day-of-0', 'Last valid day of {0}'), { 0: order.poNumber })} type="date" className={field}
        value={validUntil} disabled={!canEdit} onChange={event => setValidUntil(event.target.value)} />
    </td>
    <td>
      <input aria-label={fill(reportText('r.agreed-total-of-0', 'Agreed total of {0}'), { 0: order.poNumber })} type="number" min="0" step="0.01" className={field} placeholder={reportText('r.order-total-2', 'order total')}
        value={cap} disabled={!canEdit} onChange={event => setCap(event.target.value)} />
    </td>
    <td>
      <button type="button" className="btn-secondary min-h-11 px-3" disabled={!canEdit}
        onClick={() => onMark(validUntil, cap)}>
        {reportText('r.mark-as-blanket', 'Mark as blanket')}<span className="sr-only"> {reportText('r.order-2', 'order')} {order.poNumber}</span>
      </button>
      {problem && <p role="alert" className="text-xs">{problem}</p>}
    </td>
  </tr>;
}

function BlanketRow({ row, canEdit, money, onSaveValidUntil, onSaveCap, onRemove }: {
  row: BlanketOrderRow;
  canEdit: boolean;
  money: (cents: number, currency: string) => string;
  onSaveValidUntil: (next: string | number) => Promise<unknown>;
  onSaveCap: (next: string | number) => Promise<unknown>;
  onRemove: () => Promise<unknown>;
}) {
  const reportText = useReportText();
  return <tr className="border-t border-[var(--line)] align-top">
    <th scope="row" className="text-left">
      <bdi>{row.poNumber}</bdi>
      <div className="text-xs text-[var(--muted)]"><bdi>{row.vendorName}</bdi> {reportText('r.issued-2', '· issued')} {row.issueDate}</div>
    </th>
    <td>
      <InlineEdit kind="date" value={row.validUntil} canEdit={canEdit}
        label={fill(reportText('r.last-valid-day-of-0', 'Last valid day of {0}'), { 0: row.poNumber })} onSave={onSaveValidUntil}
        validate={(next) => blanketAgreementProblem({ validUntil: next, issueDate: row.issueDate })} />
      <div className="text-xs text-[var(--muted)]">{row.daysLeft < 0 ? fill(reportText('r.0-day-s-past', '{0} day(s) past'), { 0: -row.daysLeft }) : fill(reportText('r.0-day-s-left', '{0} day(s) left'), { 0: row.daysLeft })}</div>
    </td>
    <td className="text-right tabular-nums">
      <InlineEdit kind="money" value={row.capCents} canEdit={canEdit}
        label={fill(reportText('r.agreed-total-of-0', 'Agreed total of {0}'), { 0: row.poNumber })} onSave={onSaveCap}
        display={<>{money(row.capCents, row.currency)}{row.billsOtherCurrency > 0 && <div className="text-xs text-[var(--muted)]">{row.billsOtherCurrency} {reportText('r.linked-bill-s-in-another-currency-not-counted', 'linked bill(s) in another currency not counted')}</div>}</>} />
    </td>
    <td className="text-right tabular-nums">{money(row.receivedCents, row.currency)}<div className="text-xs text-[var(--muted)]">{row.receipts} {reportText('r.receipt-s', 'receipt(s)')}</div></td>
    <td className="text-right tabular-nums">{money(row.billedCents, row.currency)}<div className="text-xs text-[var(--muted)]">{row.bills} {reportText('r.bill-s', 'bill(s)')}</div></td>
    <td className="text-right tabular-nums">{money(row.usedCents, row.currency)}<div className="text-xs text-[var(--muted)]">{reportText('r.higher-of-the-two', 'higher of the two')}</div></td>
    <td className="text-right tabular-nums"><b>{money(row.leftCents, row.currency)}</b></td>
    <td>{blanketStateLabel(row.state)}</td>
    <td>
      {canEdit && <button type="button" className="btn-secondary min-h-11 px-3" onClick={() => onRemove()}>
        {reportText('r.unmark', 'Unmark')}<span className="sr-only"> {row.poNumber}</span>
      </button>}
    </td>
  </tr>;
}
