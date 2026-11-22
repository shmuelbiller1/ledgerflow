import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useScreenDataHealth } from '../../hooks/useScreenDataHealth';
import { useCollection } from '../../hooks/useCollection';
import { usePartialReportInputs } from '../../hooks/usePartialReportInputs';
import type { PurchaseOrder } from '../../types';
import { backorders, ordersReadyToRelease, releasableLines, shortages, type BackorderLine } from '../../lib/backorders';
import { ScreenDataNotice } from '../ui/ScreenDataNotice';
import { useReportText } from './useReportText';
import ReportSchedule from './ReportSchedule';
import { LoadingState } from '../ui/LoadingState';

const inputs = ['estimates', 'transactions', 'inventory'] as const;
const qty = (n: number) => String(Math.round(n * 100) / 100);
const lineKey = (row: BackorderLine) => JSON.stringify([row.orderId, row.position]);

/** Stock allocates oldest-first. Ready / short are conclusions, not safe defaults during a read. */
function BackorderSchedules({ workspace, guest }: { workspace: string; guest: boolean }) {
  const reportText = useReportText();
  useLedgerCollections('estimates', 'transactions', 'inventory');
  const health = useScreenDataHealth(inputs);
  const currentBook = useDataNeedsStore(s => s.loadedWorkspaceId === workspace) || guest;
  const estimates = useLedgerStore(s => s.estimates);
  const transactions = useLedgerStore(s => s.transactions);
  const inventory = useLedgerStore(s => s.inventory);
  const partial = usePartialReportInputs(inputs);
  const orders = useCollection<PurchaseOrder>('purchaseOrders', { limit: 1000 });
  if (currentBook && health.failedKeys.length) return <ScreenDataNotice {...health} onRetry={health.retry} />;
  if (orders.error) return <div><p role="alert">{reportText('r.could-not-read-purchase-orders', 'Could not read purchase orders.')} {orders.error.message}</p>
    <button type="button" className="min-h-11 underline" onClick={orders.refetch}>{reportText('r.retry', 'Retry')}</button></div>;
  if (!currentBook || !health.ready || orders.loading) return <LoadingState label={reportText('r.loading', 'Loading…')} rows={3} />;
  if (partial || orders.truncated) return <p role="alert">{reportText('r.backorders-incomplete', 'Order or stock history is incomplete. Stock coverage and quantities still to buy cannot be confirmed.')}</p>;
  const own = <T extends { workspaceId?: string }>(records: T[]) => records.filter(row => row.workspaceId === workspace);
  const rows = backorders(own(estimates), own(transactions), own(inventory), own(orders.data));
  const ready = releasableLines(rows), short = shortages(rows), readyOrders = ordersReadyToRelease(rows);
  if (!rows.length) return <p role="status">{reportText('r.no-order-is-waiting-for-goods', 'No order is waiting for goods.')}</p>;
  const orderColumns = [
    { header: reportText('r.order', 'Order'), cell: (r: BackorderLine) => <bdi>{r.number}</bdi> },
    { header: reportText('r.customer', 'Customer'), cell: (r: BackorderLine) => <bdi>{r.customerName}</bdi> },
    { header: reportText('r.item', 'Item'), cell: (r: BackorderLine) => <bdi>{r.item}</bdi> },
    { header: reportText('r.to-deliver', 'To deliver'), align: 'right' as const, cell: (r: BackorderLine) => qty(r.left) },
  ];
  return <>
    <ReportSchedule rows={ready} rowKey={lineKey} columns={orderColumns}
      caption={<>{reportText('r.ready-to-release', 'Ready to release (')}{ready.length})</>}
      emptyRow={<tr><td colSpan={4}>{reportText('r.stock-on-hand-does-not-fully-cover-any-waiting-l', 'Stock on hand does not fully cover any waiting line yet. When stock arrives, the lines it completes appear here.')}</td></tr>} />
    {ready.length > 0 && <p className="text-sm text-[var(--muted)]">
      {readyOrders.length ? <>{readyOrders.length} {reportText('r.order-s-can-be-delivered-in-full-from-stock-on-h', 'order(s) can be delivered in full from stock on hand.')}</>
        : reportText('r.no-single-order-is-covered-in-full-yet-the-lines', 'No single order is covered in full yet; the lines above are covered, the rest of their orders are short below.')} {' '}
      {reportText('r.the-cover-follows-the-same-oldest-first-allocati', 'The cover follows the same oldest-first allocation as the table below and is computed, not held: deliver from the order to use it.')}
    </p>}
    <ReportSchedule rows={short} rowKey={s => s.itemId} caption={<>{reportText('r.short-items', 'Short items (')}{short.length})</>}
      emptyRow={<tr><td colSpan={4}>{reportText('r.stock-on-hand-covers-every-order', 'Stock on hand covers every order.')}</td></tr>}
      columns={[
        { header: reportText('r.item', 'Item'), cell: s => <bdi>{s.item}</bdi> },
        { header: reportText('r.short-2', 'Short'), align: 'right', cell: s => qty(s.short) },
        { header: reportText('r.on-order-from-vendors', 'On order from vendors'), align: 'right', cell: s => qty(s.onOrder) },
        { header: reportText('r.still-to-buy', 'Still to buy'), align: 'right', cell: s => qty(Math.max(0, s.short - s.onOrder)) },
      ]} />
    <ReportSchedule rows={rows} rowKey={lineKey} caption={<>{reportText('r.order-lines-to-deliver', 'Order lines to deliver (')}{rows.length})</>}
      columns={[...orderColumns,
        { header: reportText('r.from-stock', 'From stock'), align: 'right', cell: r => qty(r.covered) },
        { header: reportText('r.short-2', 'Short'), align: 'right', cell: r => r.short > 0 ? <strong>{qty(r.short)}</strong> : '' },
      ]} />
  </>;
}

export default function BackordersReportView() {
  const reportText = useReportText();
  const workspace = useAuthStore(s => s.currentWorkspaceId) || '';
  const uid = useAuthStore(s => s.user?.uid);
  const guest = useAuthStore(s => s.isGuest && !s.user);
  return <section aria-labelledby="backorders-title" className="space-y-4 p-4 min-w-0">
    <h2 id="backorders-title" className="text-lg font-bold">{reportText('r.backorders', 'Backorders')}</h2>
    <p className="text-sm text-[var(--muted)]">{reportText('r.items-sold-on-orders-and-not-delivered-yet-oldes', 'Items sold on orders and not delivered yet, oldest order first, against the stock on hand — first what can go out today, then what is short. Nothing is reserved.')}</p>
    {(uid || guest) && workspace && <BackorderSchedules key={JSON.stringify([workspace, uid, guest])} workspace={workspace} guest={guest} />}
  </section>;
}
