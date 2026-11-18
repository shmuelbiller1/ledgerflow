import React, { useMemo, useRef, useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { collection, getDocs, query, where } from '../../lib/db/firestore';
import { db } from '../../firebase';
import type { Bill, InventoryItem } from '../../types';
import { formatCurrency } from '../../lib/utils';
import { validCustomReportPeriod } from '../../lib/reportCustomPeriod';
import { purchaseItemCsvRows, purchaseItemTrends, PURCHASE_ITEM_CSV_HEADERS } from '../../lib/purchaseItemTrends';
import { downloadCsv } from '../../lib/csvExport';
import ReportTableScroll from './ReportTableScroll';
import { useReportText, fill } from './useReportText';

interface Props { endDate?: string; compareEndDate?: string }
interface History { bills: Bill[]; items: InventoryItem[]; loadedAt: string }
const validEnd = (date: string) => validCustomReportPeriod({ startDate: date, endDate: date });

function ScopedPurchaseItemTrendsView({ endDate = '', compareEndDate = '' }: Props) {
  const reportText = useReportText();
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const uid = useAuthStore(state => state.user?.uid);
  const guest = useAuthStore(state => state.isGuest);
  const currency = useAuthStore(state => state.getCurrentWorkspace()?.currency) || 'USD';
  const cachedBills = useLedgerStore(state => state.bills);
  const cachedItems = useLedgerStore(state => state.inventory);
  const truncated = useLedgerStore(state => state.truncatedCollections);
  const failed = useDataNeedsStore(state => state.failed);
  const { loading } = useLedgerCollections('bills', 'inventory');
  const [history, setHistory] = useState<History | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const valid = validEnd(endDate);
  const compared = validEnd(compareEndDate);
  const input = useMemo(() => ({
    bills: (history?.bills || cachedBills).filter(bill => bill.workspaceId === workspaceId),
    items: (history?.items || cachedItems).filter(item => item.workspaceId === workspaceId),
  }), [history, cachedBills, cachedItems, workspaceId]);
  const currentRows = useMemo(() => valid && (history || !loading) ? purchaseItemTrends(input.items, input.bills, endDate, currency) : [], [valid, history, loading, input, endDate, currency]);
  const priorRows = useMemo(() => compared && (history || !loading) ? purchaseItemTrends(input.items, input.bills, compareEndDate, currency) : [], [compared, history, loading, input, compareEndDate, currency]);
  const rows = [...currentRows.map(row => ({ ...row, period: 'Current' })), ...priorRows.map(row => ({ ...row, period: 'Previous' }))];
  const incompleteCache = truncated.bills || truncated.inventory || failed.bills || failed.inventory;
  const sameScope = () => {
    const auth = useAuthStore.getState();
    return auth.currentWorkspaceId === workspaceId && auth.user?.uid === uid && auth.isGuest === guest;
  };
  const load = async () => {
    if (!workspaceId || !uid || guest || pending.current) return;
    pending.current = true; setBusy(true); setError('');
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
      if (sameScope()) setError('Could not refresh complete bill history. Retry before relying on these figures.');
    } finally {
      pending.current = false;
      if (sameScope()) setBusy(false);
    }
  };

  return (
    <section aria-label={reportText('r.purchase-trends-by-item', 'Purchase trends by item')} className="p-4 space-y-4 min-w-0">
      <h2>{reportText('r.purchase-trends-by-item', 'Purchase trends by item')}</h2>
      <p>{reportText('r.twelve-calendar-months-ending', 'Twelve calendar months ending')} {endDate}{reportText('r.the-final-month-stops-on-that-date-the-start-dat', '; the final month stops on that date. The start-date control does not shorten this window. Months without included item lines are omitted.')}</p>
      <p>{reportText('r.gross-purchases-from-the-item-wise-bill-register', 'Gross purchases from the item-wise bill register: units and stored line amounts, with each currency kept separate. Drafts, voids, rejected and cancelled bills, opening documents, undated bills and freight-only lines are excluded. Vendor returns and document-level tax/discount allocation are not included; these amounts are not net inventory cost and will not necessarily match the vendor totals.')}</p>
      <div className="flex flex-wrap gap-2" data-print-hide>
        {!guest && <button type="button" className="btn-secondary min-h-11 px-3" disabled={busy || !workspaceId || !uid} onClick={() => void load()}>{busy ? reportText('r.loading', 'Loading…') : reportText('r.load-refresh-full-history', 'Load / refresh full history')}</button>}
        <button type="button" className="btn-secondary min-h-11 px-3" disabled={!valid || !rows.length || busy} onClick={() => downloadCsv(`purchase-items-${endDate}.csv`, PURCHASE_ITEM_CSV_HEADERS, purchaseItemCsvRows(rows))}>{reportText('r.export-item-trends-csv', 'Export item trends CSV')}</button>
      </div>
      {!history && <p role="status">{guest ? reportText('r.guest-sample-figures-use-the-loaded-demonstratio', 'Guest sample: figures use the loaded demonstration records.') : fill(reportText('r.provisional-0-load-full-history-before-relying-o', 'Provisional: {0} Load full history before relying on these figures.'), { 0: incompleteCache ? 'loaded records are incomplete or failed.' : 'loaded records may be incomplete.' })}</p>}
      {history && <p role="status">{reportText('r.full-bill-and-item-history-loaded-at', 'Full bill and item history loaded at')} {history.loadedAt}{reportText('r.refresh-to-include-later-changes', '. Refresh to include later changes.')}</p>}
      {loading && !history && <p role="status">{reportText('r.loading-report-records', 'Loading report records…')}</p>}
      {!valid && <p role="alert">{reportText('r.choose-a-valid-report-end-date', 'Choose a valid report end date.')}</p>}
      {error && <p role="alert">{error}{history ? ` ${reportText('r.the-last-successful-history-remains-displayed', 'The last successful history remains displayed.')}` : ` ${reportText('r.the-cached-figures-remain-provisional', 'The cached figures remain provisional.')}`}</p>}
      <ReportTableScroll>
        <table className="w-full text-sm">
          <caption>{reportText('r.item-purchases-12-months-through', 'Item purchases: 12 months through')} {endDate}{reportText('r.amounts-in-each-bill-s-currency', '; amounts in each bill\'s currency')}</caption>
          <thead><tr>{compared && <th scope="col">{reportText('r.window', 'Window')}</th>}<th scope="col">{reportText('r.month', 'Month')}</th><th scope="col">{reportText('r.item', 'Item')}</th><th scope="col">{reportText('r.currency-2', 'Currency')}</th><th scope="col">{reportText('r.units', 'Units')}</th><th scope="col">{reportText('r.line-amount', 'Line amount')}</th><th scope="col">{reportText('r.item-lines-2', 'Item lines')}</th></tr></thead>
          <tbody>{rows.map(row => <tr key={`${row.period}:${row.id}`}>
            {compared && <td>{row.period}</td>}
            <td>{row.month}</td><th scope="row" className="text-left"><bdi>{row.name}</bdi></th>
            <td>{row.currency}</td><td className="text-right tabular-nums">{row.quantity}</td>
            <td className="text-right tabular-nums"><bdi dir="ltr">{formatCurrency(row.cents, row.currency)}</bdi></td>
            <td className="text-right tabular-nums">{row.lines}</td>
          </tr>)}</tbody>
        </table>
        {valid && !loading && !currentRows.length && <p>{reportText('r.no-included-item-purchases-in-the-current-twelve', 'No included item purchases in the current twelve-month window.')}</p>}
      </ReportTableScroll>
    </section>
  );
}

/** A new identity/workspace receives no cached full-history result or pending state from the old one. */
export default function PurchaseItemTrendsView(props: Props) {
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const uid = useAuthStore(state => state.user?.uid);
  const guest = useAuthStore(state => state.isGuest);
  return <ScopedPurchaseItemTrendsView key={`${uid}:${workspaceId}:${guest}`} {...props} />;
}
