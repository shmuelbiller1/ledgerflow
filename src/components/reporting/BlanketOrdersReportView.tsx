import { RowTable } from '../ui/RowTable';
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
} from '../../lib/blanketOrders';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { inBackground } from '../../lib/inBackground';
import { downloadCsv } from '../../lib/csvExport';
import InlineEdit from '../ui/InlineEdit';
import ReportTableScroll from './ReportTableScroll';
import type { Bill, PurchaseOrder } from '../../types';
import { fill, useReportText } from './useReportText';

/** Code names, paths and URL shapes shown as-is: they are not words to translate (EU-G1). */
const CODE_NAMES = { field: 'blanket', migration: 'supabase/migrations/20261015000000_purchase_order_blanket.sql' } as const;

const field = 'min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]';

export default function BlanketOrdersReportView({ today = '' }: { today?: string }) {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const { data: orders, loading: ordersLoading, truncated: ordersTruncated } = useCollection<PurchaseOrder>('purchaseOrders', { orderByField: 'createdAt', orderDirection: 'desc', limit: 500 });
  return <BlanketOrdersPanel key={workspaceId} orders={orders} ordersLoading={ordersLoading} ordersTruncated={ordersTruncated} today={today} />;
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

  const [drafts, setDrafts] = useState<Record<string, { validUntil?: string; cap?: string }>>({});
  const changeDraft = (id: string, field: 'validUntil' | 'cap', value: string) => setDrafts(current => ({ ...current, [id]: { ...current[id], [field]: value } }));
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
    return updateEntity('purchaseOrders', order.id, {
      blanket,
      updatedAt: new Date().toISOString(),
    } as Record<string, unknown>, message);
  };

  const mark = async (order: PurchaseOrder, validUntil: string, cap: string) => {
    const capCents = cap === '' ? undefined : Math.round(Number(cap) * 100);
    const problem = blanketAgreementProblem({ validUntil, capCents, issueDate: String(order.issueDate || '').slice(0, 10) });
    setProblemFor(problem ? { id: order.id, problem } : null);
    if (problem) return;
    const saved = await saveBlanket(order, {
      validUntil: validUntil.slice(0, 10),
      ...(cap === '' ? {} : { capCents }),
    }, `${order.poNumber} marked as a blanket order`);
    if (saved) setDrafts(current => { const next = { ...current }; delete next[order.id]; return next; });
  };

  return <section aria-label={reportText('r.blanket-purchase-orders', 'Blanket purchase orders')} className="p-4 space-y-4 min-w-0">
    <h2>{reportText('r.blanket-purchase-orders', 'Blanket purchase orders')}</h2>
    <p className="text-sm text-[var(--muted)]">
      {reportText('r.a-blanket-order-is-an-agreement-a-total-and-a-va', 'A blanket order is an agreement — a total and a validity period — that several goods receipts and vendor bills draw down over time. This report shows what has been drawn and what is left. Only documents explicitly linked to the order count (a receipt saved on it, or a bill carrying its order number or id); the three-way match\'s amount guesses never draw an agreement down. A delivery recorded both as a receipt and as a bill is one delivery, so “used” takes the higher of the two recorded totals — when one delivery was only received and another only billed, the true use is higher than shown, and both totals sit beside the figure for the reviewer. Nothing here posts; a bill in another currency is counted, never added in.')}
    </p>

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <p className="text-sm">{reportText('r.as-of-2', 'As of')} <b>{asOf}</b></p>
      <button type="button" className="btn-secondary min-h-11 px-3" disabled={loading || Boolean(partial) || !review.rows.length} onClick={() => downloadCsv(
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
      <ReportTableScroll nameFromCaption allowDisplayedExport={false}><RowTable
        caption={reportText('r.blanket-purchase-orders-with-what-is-drawn-down', 'Blanket purchase orders with what is drawn down and what is left')}
        captionClassName=""
        tableClassName="w-full text-sm"
        headRowClassName=""
        bodyClassName=""
        rowClassName="border-t border-[var(--line)] align-top"
        rows={review.rows}
        rowKey={(row) => row.poId}
        columns={[
          {
            header: reportText('r.order', 'Order'),
            headClassName: '', className: 'text-left',
            cell: (row) => (
              <>
                <bdi>{row.poNumber}</bdi>
                <div className="text-xs text-[var(--muted)]">
                  <bdi>{row.vendorName}</bdi> {reportText('r.issued-2', '· issued')} {row.issueDate}
                </div>
              </>
            ),
          },
          {
            header: reportText('r.valid-until', 'Valid until'),
            headClassName: '',
            cell: (row) => (
              <>
                <InlineEdit
                  kind="date"
                  value={row.validUntil}
                  canEdit={canEdit}
                  label={fill(reportText('r.last-valid-day-of-0', 'Last valid day of {0}'), { 0: row.poNumber })}
                  onSave={(next) => {
                    const order = scopedOrders.find((o) => o.id === row.poId)!;
                    return saveBlanket(order, { validUntil: String(next).slice(0, 10), capCents: row.capCents }, `Validity of ${row.poNumber} changed`);
                  }}
                  validate={(next) => blanketAgreementProblem({ validUntil: next, issueDate: row.issueDate })}
                />
                <div className="text-xs text-[var(--muted)]">
                  {row.daysLeft < 0
                    ? fill(reportText('r.0-day-s-past', '{0} day(s) past'), { 0: -row.daysLeft })
                    : fill(reportText('r.0-day-s-left', '{0} day(s) left'), { 0: row.daysLeft })}
                </div>
              </>
            ),
          },
          {
            header: reportText('r.agreed-2', 'Agreed'),
            headClassName: 'text-right', className: 'text-right tabular-nums',
            cell: (row) => (
              <InlineEdit
                kind="money"
                value={row.capCents}
                canEdit={canEdit}
                label={fill(reportText('r.agreed-total-of-0', 'Agreed total of {0}'), { 0: row.poNumber })}
                onSave={(next) => {
                  const order = scopedOrders.find((o) => o.id === row.poId)!;
                  return saveBlanket(order, { validUntil: row.validUntil, capCents: Math.round(Number(next)) }, `Agreed total of ${row.poNumber} changed`);
                }}
                display={
                  <>
                    {money(row.capCents, row.currency)}
                    {row.billsOtherCurrency > 0 && (
                      <div className="text-xs text-[var(--muted)]">
                        {row.billsOtherCurrency} {reportText('r.linked-bill-s-in-another-currency-not-counted', 'linked bill(s) in another currency not counted')}
                      </div>
                    )}
                  </>
                }
              />
            ),
          },
          {
            header: reportText('r.received', 'Received'),
            headClassName: 'text-right', className: 'text-right tabular-nums',
            cell: (row) => (
              <>
                {money(row.receivedCents, row.currency)}
                <div className="text-xs text-[var(--muted)]">
                  {row.receipts} {reportText('r.receipt-s', 'receipt(s)')}
                </div>
              </>
            ),
          },
          {
            header: reportText('r.billed-2', 'Billed'),
            headClassName: 'text-right', className: 'text-right tabular-nums',
            cell: (row) => (
              <>
                {money(row.billedCents, row.currency)}
                <div className="text-xs text-[var(--muted)]">
                  {row.bills} {reportText('r.bill-s', 'bill(s)')}
                </div>
              </>
            ),
          },
          {
            header: reportText('r.used-2', 'Used'),
            headClassName: 'text-right', className: 'text-right tabular-nums',
            cell: (row) => (
              <>
                {money(row.usedCents, row.currency)}
                <div className="text-xs text-[var(--muted)]">{reportText('r.higher-of-the-two', 'higher of the two')}</div>
              </>
            ),
          },
          {
            header: reportText('r.left-2', 'Left'),
            headClassName: 'text-right', className: 'text-right tabular-nums',
            cell: (row) => <b>{money(row.leftCents, row.currency)}</b>,
          },
          { header: reportText('r.state', 'State'), headClassName: '', cell: (row) => blanketStateLabel(row.state) },
          {
            header: <span className="sr-only">{reportText('r.actions', 'Actions')}</span>,
            headClassName: '',
            cell: (row) =>
              canEdit && (
                <button
                  type="button"
                  className="btn-secondary min-h-11 px-3"
                  onClick={() => {
                    const order = scopedOrders.find((o) => o.id === row.poId)!;
                    return saveBlanket(order, null, `${row.poNumber} is no longer marked as a blanket order`);
                  }}
                >
                  {reportText('r.unmark', 'Unmark')}
                  <span className="sr-only"> {row.poNumber}</span>
                </button>
              ),
          },
        ]}
      /></ReportTableScroll>
      <p className="text-xs text-[var(--muted)]">
        {reportText('r.marking-or-unmarking-an-order-writes-the', 'Marking or unmarking an order writes the')} <code>{CODE_NAMES.field}</code> {reportText('r.field-on-the-order-itself-that-field-needs-the-c', 'field on the order itself. That field needs the checked-in database change (')}<code className="break-all">{CODE_NAMES.migration}</code>{reportText('r.to-be-applied-until-then-the-database-refuses-th', ') to be applied; until then the database refuses the write and the error says so. Editing in place needs an owner, accountant or bookkeeper — a viewer or a guest workspace reads only.')}
      </p>
    </>}

    {!loading && review.rows.length === 0 && <p>
      {reportText('r.no-order-is-marked-as-a-blanket-agreement-yet-ma', 'No order is marked as a blanket agreement yet. Mark one below and its receipts and linked bills start drawing it down.')}
    </p>}

    <h3>{reportText('r.orders-that-are-not-blanket-agreements', 'Orders that are not blanket agreements')}</h3>
    {unmarked.length === 0 && <p>{reportText('r.every-loaded-order-is-either-marked-or-cancelled', 'Every loaded order is either marked or cancelled.')}</p>}
    {unmarked.length > 0 && <ReportTableScroll nameFromCaption allowDisplayedExport={false}><RowTable
      caption={reportText('r.purchase-orders-that-can-be-marked-as-blanket-ag', 'Purchase orders that can be marked as blanket agreements')}
      captionClassName=""
      tableClassName="w-full text-sm"
      headRowClassName=""
      bodyClassName=""
      rowClassName="border-t border-[var(--line)]"
      rows={unmarked}
      rowKey={(order) => order.id}
      columns={[
        { header: reportText('r.order', 'Order'), headClassName: '', className: 'text-left', cell: (order) => <bdi>{order.poNumber}</bdi> },
        { header: reportText('r.vendor', 'Vendor'), headClassName: '', cell: (order) => <bdi>{order.vendorName || '—'}</bdi> },
        { header: reportText('r.issued', 'Issued'), headClassName: '', className: 'tabular-nums', cell: (order) => String(order.issueDate || '').slice(0, 10) },
        {
          header: reportText('r.order-total', 'Order total'),
          headClassName: 'text-right', className: 'text-right tabular-nums',
          cell: (order) => formatCurrency(order.totalAmountCents || 0, order.currency || homeCurrency),
        },
        {
          header: reportText('r.last-valid-day', 'Last valid day'),
          headClassName: '',
          cell: (order) => (
            <input
              aria-label={fill(reportText('r.last-valid-day-of-0', 'Last valid day of {0}'), { 0: order.poNumber })}
              type="date"
              className={field}
              value={drafts[order.id]?.validUntil || ''}
              disabled={!canEdit}
              onChange={(event) => changeDraft(order.id, 'validUntil', event.target.value)}
            />
          ),
        },
        {
          header: reportText('r.agreed-total-optional', 'Agreed total (optional)'),
          headClassName: '',
          cell: (order) => (
            <input
              aria-label={fill(reportText('r.agreed-total-of-0', 'Agreed total of {0}'), { 0: order.poNumber })}
              type="number"
              min="0"
              step="0.01"
              className={field}
              placeholder={reportText('r.order-total-2', 'order total')}
              value={drafts[order.id]?.cap || ''}
              disabled={!canEdit}
              onChange={(event) => changeDraft(order.id, 'cap', event.target.value)}
            />
          ),
        },
        {
          header: <span className="sr-only">{reportText('r.actions', 'Actions')}</span>,
          headClassName: '',
          cell: (order) => (
            <>
              <button
                type="button"
                className="btn-secondary min-h-11 px-3"
                disabled={!canEdit}
                onClick={() => inBackground(mark(order, drafts[order.id]?.validUntil || '', drafts[order.id]?.cap || ''))}
              >
                {reportText('r.mark-as-blanket', 'Mark as blanket')}
                <span className="sr-only">
                  {' '}
                  {reportText('r.order-2', 'order')} {order.poNumber}
                </span>
              </button>
              {problemFor?.id === order.id && (
                <p role="alert" className="text-xs">
                  {problemFor.problem}
                </p>
              )}
            </>
          ),
        },
      ]}
    /></ReportTableScroll>}
    {!canEdit && <p className="text-xs text-[var(--muted)]">{reportText('r.a-viewer-or-a-guest-workspace-reads-the-agreemen', 'A viewer or a guest workspace reads the agreements but cannot mark or change one.')}</p>}
    <p className="text-xs text-[var(--muted)]">
      {reportText('r.not-counted-as-agreements', 'Not counted as agreements:')} {review.skipped.cancelled} {reportText('r.cancelled-order-s', 'cancelled order(s),')} {review.skipped.invalidAgreement} {reportText('r.with-an-unusable-validity-date-refused-never-ass', 'with an unusable validity date (refused, never assumed),')} {review.skipped.draftsBills} {reportText('r.draft-or-void-bill-s-and', 'draft or void bill(s) and')}{' '}
      {review.skipped.billsOtherCurrency} {reportText('r.bill-s-in-another-currency-listed-on-the-row-nev', 'bill(s) in another currency (listed on the row, never added in).')}
    </p>
  </section>;
}
