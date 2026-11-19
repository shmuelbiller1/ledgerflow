import React, { useMemo, useRef, useState } from 'react';
import { currentIdentity, useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { collection, getDocs, query, where } from '../../lib/db/firestore';
import { db } from '../../firebase';
import type { Bill, InventoryItem } from '../../types';
import { formatCurrency } from '../../lib/utils';
import { browserProvenance } from '../../lib/reportProvenance';
import { validCustomReportPeriod } from '../../lib/reportCustomPeriod';
import { purchaseItemCsvRows, purchaseItemTrends, PURCHASE_ITEM_CSV_HEADERS } from '../../lib/purchaseItemTrends';
import { downloadCsv } from '../../lib/csvExport';
import ReportTableScroll from './ReportTableScroll';
import { useReportText } from './useReportText';
import { useReportDates } from './useReportDates';
import { RowTable } from '../ui/RowTable';
import ReportEmptyState from './ReportEmptyState';
import { useUIStore } from '../../stores/useUIStore';

interface Props { endDate?: string; compareEndDate?: string }
interface History { bills: Bill[]; items: InventoryItem[]; loadedAt: string }
const validEnd = (date: string) => validCustomReportPeriod({ startDate: date, endDate: date });

function ScopedPurchaseItemTrendsView({ endDate = '', compareEndDate = '', identity }: Props & { identity: string | null }) {
  const reportText = useReportText();
  const dates = useReportDates();
  const setActiveTab = useUIStore(state => state.setActiveTab);
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const guest = useAuthStore(state => state.isGuest);
  const currency = useAuthStore(state => state.getCurrentWorkspace()?.currency) || 'USD';
  const cachedBills = useLedgerStore(state => state.bills);
  const cachedItems = useLedgerStore(state => state.inventory);
  const truncatedCollections = useLedgerStore(state => state.truncatedCollections);
  const isDataTruncated = useLedgerStore(state => state.isDataTruncated);
  const failed = useDataNeedsStore(state => state.failed);
  const { loading } = useLedgerCollections('bills', 'inventory');
  const [history, setHistory] = useState<History | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const pending = useRef(false);
  const valid = validEnd(endDate);
  const compared = valid && validEnd(compareEndDate);
  const input = useMemo(() => ({
    bills: (history?.bills || cachedBills).filter(bill => bill.workspaceId === workspaceId),
    items: (history?.items || cachedItems).filter(item => item.workspaceId === workspaceId),
  }), [history, cachedBills, cachedItems, workspaceId]);
  const currentRows = useMemo(() => valid && (history || !loading) ? purchaseItemTrends(input.items, input.bills, endDate, currency) : [], [valid, history, loading, input, endDate, currency]);
  const priorRows = useMemo(() => compared && (history || !loading) ? purchaseItemTrends(input.items, input.bills, compareEndDate, currency) : [], [compared, history, loading, input, compareEndDate, currency]);
  const rows = [...currentRows.map(row => ({ ...row, period: 'Current' })), ...priorRows.map(row => ({ ...row, period: 'Previous' }))];
  const incompleteCache = browserProvenance(['bills', 'inventory'], { truncatedCollections, isDataTruncated, failed }).completeness !== 'complete';
  // Live signed-in lists are a preview, even when they have not hit their cap. A complete
  // paged read (or the settled guest sample) is the boundary for *both* CSV paths.
  const confirmed = Boolean(workspaceId && (history || (guest && !loading && !incompleteCache)));
  const settled = valid && confirmed && !busy && !refreshFailed;
  const canExport = settled && rows.length > 0;
  const emptyBooks = settled && input.bills.length === 0;
  const sameScope = () => {
    const auth = useAuthStore.getState();
    return auth.currentWorkspaceId === workspaceId && currentIdentity() === identity && auth.isGuest === guest;
  };
  const load = async () => {
    if (!workspaceId || !identity || guest || pending.current) return;
    pending.current = true; setBusy(true); setRefreshFailed(false);
    try {
      // getDocs without limit exhausts PostgREST pages (same full-history boundary as C-24).
      const [billSnapshot, itemSnapshot] = await Promise.all(['bills', 'inventory'].map(name =>
        getDocs(query(collection(db, name), where('workspaceId', '==', workspaceId)))));
      if (!sameScope()) return;
      setHistory({
        bills: billSnapshot.docs.map(document => ({ ...document.data(), id: document.id } as Bill)),
        items: itemSnapshot.docs.map(document => ({ ...document.data(), id: document.id } as InventoryItem)),
        loadedAt: new Date().toISOString(),
      });
    } catch {
      if (sameScope()) setRefreshFailed(true);
    } finally {
      pending.current = false;
      if (sameScope()) setBusy(false);
    }
  };

  const title = reportText('r.purchase-trends-by-item', 'Purchase trends by item');
  const noActivity = reportText('r.no-included-item-purchases-in-the-current-twelve', 'No included item purchases in the current twelve-month window.');
  const exportItems = () => {
    if (canExport && !pending.current && sameScope()) downloadCsv(`purchase-items-${endDate}.csv`, PURCHASE_ITEM_CSV_HEADERS, purchaseItemCsvRows(rows));
  };

  return (
    <section aria-label={title} className="p-4 space-y-3 min-w-0">
      <h2 className="text-lg font-semibold">{title}</h2>
      {emptyBooks ? <ReportEmptyState title={reportText('r.no-bills-in-books', 'No bills recorded in these books yet.')} actionLabel={reportText('r.open-purchases', 'Open Purchases')} onAction={() => setActiveTab('purchases')} /> : <>
        <p>{reportText('r.twelve-calendar-months-ending', 'Twelve calendar months ending')} <bdi className="whitespace-nowrap">{dates.dateText(endDate)}</bdi>{compared && <> · {reportText('r.previous-window-ending', 'Previous window ending')} <bdi className="whitespace-nowrap">{dates.dateText(compareEndDate)}</bdi></>}</p>
        <details className="text-sm text-[var(--muted)]">
          <summary className="min-h-11 py-3 cursor-pointer">{reportText('r.item-lines-scope', 'Bill lines, with each currency kept separate')}</summary>
          <p>{reportText('r.gross-purchases-from-the-item-wise-bill-register', 'Gross purchases from the item-wise bill register: units and stored line amounts, with each currency kept separate. Drafts, voids, rejected and cancelled bills, opening documents, undated bills and freight-only lines are excluded. Vendor returns and document-level tax/discount allocation are not included; these amounts are not net inventory cost and will not necessarily match the vendor totals.')}</p>
          <p>{reportText('r.item-window-scope', 'The last month stops on the selected end date. The start-date control does not shorten the twelve months. Months without item lines are omitted.')}</p>
        </details>
        <div className="flex flex-wrap gap-2" data-print-hide>
          {!guest && <button type="button" className="btn-tonal min-h-11 px-3" disabled={busy || !workspaceId || !identity} onClick={() => void load()}>{busy ? reportText('r.loading', 'Loading…') : reportText('r.load-refresh-full-history', 'Load / refresh full history')}</button>}
          {(rows.length > 0 || !valid) && <button type="button" className="btn-tonal min-h-11 px-3" disabled={!canExport} onClick={exportItems}>{reportText('r.export-item-trends-csv', 'Export item trends CSV')}</button>}
        </div>
        <p role="status" className="text-sm text-[var(--muted)]">{history ? <>{reportText('r.full-bill-and-item-history-loaded-at', 'Full bill and item history loaded at')} <bdi><time dateTime={history.loadedAt}>{new Date(history.loadedAt).toLocaleString(dates.locale, { dateStyle: 'medium', timeStyle: 'short' })}</time></bdi>{reportText('r.refresh-to-include-later-changes', '. Refresh to include later changes.')}</>
          : incompleteCache ? reportText('r.item-history-incomplete', 'Provisional: some bills or items are missing. CSV is unavailable.')
          : loading ? reportText('r.loading-report-records', 'Loading report records…')
          : guest ? reportText('r.guest-sample-figures-use-the-loaded-demonstratio', 'Guest sample: figures use the loaded demonstration records.')
          : reportText('r.item-history-preview', 'Provisional: showing loaded records. Load full history to export.')}</p>
        {!valid && <p role="alert">{reportText('r.choose-a-valid-report-end-date', 'Choose a valid report end date.')}</p>}
        {refreshFailed && <p role="alert">{reportText('r.item-history-failed', 'Could not refresh complete bill history. Retry before exporting.')} {history ? reportText('r.the-last-successful-history-remains-displayed', 'The last successful history remains displayed.') : reportText('r.the-cached-figures-remain-provisional', 'The cached figures remain provisional.')}</p>}
        {rows.length > 0 && <ReportTableScroll allowDisplayedExport={canExport}>
          <RowTable
            caption={reportText('r.item-lines-by-month', 'Purchased item lines by month and currency')} captionClassName="text-start text-[var(--muted)]"
            tableClassName="comparison-report-table w-full text-sm" rows={rows} rowKey={row => `${row.period}:${row.id}`}
            columns={[
              { header: reportText('r.item', 'Item'), headClassName: 'text-start', className: 'text-start', cell: row => <bdi>{row.name}</bdi> },
              compared ? { header: reportText('r.window', 'Window'), headClassName: 'text-start', cell: row => row.period === 'Current' ? reportText('r.period-current', 'Current') : reportText('r.period-previous', 'Previous') } : false,
              { header: reportText('r.month', 'Month'), headClassName: 'text-start', cell: row => <bdi dir="ltr" className="whitespace-nowrap">{row.month}</bdi> },
              { header: reportText('r.line-amount', 'Line amount'), align: 'right', className: 'whitespace-nowrap tabular-nums', cell: row => <bdi dir="ltr">{formatCurrency(row.cents, row.currency)}</bdi> },
              { header: reportText('r.currency-2', 'Currency'), headClassName: 'text-start', cell: row => <bdi>{row.currency}</bdi> },
              { header: reportText('r.units', 'Units'), align: 'right', className: 'tabular-nums', cell: row => <bdi>{row.quantity}</bdi> },
              { header: reportText('r.item-lines-2', 'Item lines'), align: 'right', className: 'tabular-nums', cell: row => row.lines },
            ]}
          />
        </ReportTableScroll>}
        {settled && !currentRows.length && <p>{noActivity}</p>}
      </>}
    </section>
  );
}

/** A new identity/workspace receives no cached full-history result or pending state from the old one. */
export default function PurchaseItemTrendsView(props: Props) {
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const identity = useAuthStore(currentIdentity);
  const guest = useAuthStore(state => state.isGuest);
  return <ScopedPurchaseItemTrendsView key={JSON.stringify([identity, workspaceId, guest])} identity={identity} {...props} />;
}
