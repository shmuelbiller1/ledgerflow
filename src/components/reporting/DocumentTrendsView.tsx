import React, { useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useUIStore } from '../../stores/useUIStore';
import { isCollectionCapped } from '../../lib/ledgerCollections';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useServerSalesTrends } from '../../hooks/useServerProfitability';
import { useServerPurchaseTrends } from '../../hooks/useServerPurchaseTrends';
import { RangeReportSourceNote } from './RangeReportSourceNote';
import { validCustomReportPeriod } from '../../lib/reportCustomPeriod';
import { formatCurrency } from '../../lib/utils';
import { RowTable } from '../ui/RowTable';
import ReportTableScroll from './ReportTableScroll';
import ReportEmptyState from './ReportEmptyState';
import PurchaseItemTrendsView from './PurchaseItemTrendsView';
import { useReportText } from './useReportText';

interface Props { endDate?: string; compareEndDate?: string }

function DocumentTrendsView({ kind, endDate = '', compareEndDate = '' }: Props & { kind: 'sales' | 'purchases' }) {
  const reportText = useReportText();
  const setActiveTab = useUIStore(s => s.setActiveTab);
  const truncated = useLedgerStore(s => s.truncatedCollections);
  const hasDocuments = useLedgerStore(s => (kind === 'sales' ? s.invoices : s.bills).length > 0);
  const currency = useAuthStore(s => s.getCurrentWorkspace()?.currency);
  const failed = useDataNeedsStore(s => s.failed);
  const { loading } = useLedgerCollections('customers', 'vendors', 'invoices', 'bills', 'inventory', 'transactions', 'accounts');
  const selling = kind === 'sales';
  const keys = selling ? (['customers', 'invoices', 'inventory', 'transactions', 'accounts'] as const) : (['vendors', 'bills'] as const);
  // A list that failed to load is settled: the server can answer then.
  const settled = useDataNeedsStore(s => keys.every(key => s.loaded[key] || Boolean(s.failed[key])));
  const waiting = loading && !settled;
  const [group, setGroup] = useState<'customer' | 'item'>('customer');
  const valid = validCustomReportPeriod({ startDate: endDate, endDate });
  const compared = validCustomReportPeriod({ startDate: compareEndDate, endDate: compareEndDate });
  const sales = useServerSalesTrends(endDate, group, selling && valid && !waiting);
  const priorSales = useServerSalesTrends(compareEndDate, group, selling && compared && !waiting);
  const purchases = useServerPurchaseTrends(endDate, !selling && valid && !waiting);
  const priorPurchases = useServerPurchaseTrends(compareEndDate, !selling && compared && !waiting);
  const current = selling ? sales : purchases, previous = selling ? priorSales : priorPurchases;
  const displayRows = [...current.rows.map(row => ({ ...row, period: 'Current' })), ...previous.rows.map(row => ({ ...row, period: 'Previous' }))];
  const fromServer = current.source === 'server' && (!compared || previous.source === 'server');
  const partial = !fromServer && keys.some(key => isCollectionCapped(truncated, key) || failed[key]);
  const noCurrent = valid && !waiting && !current.rows.length && !partial && current.source !== 'loaded-incomplete';
  const noResults = noCurrent && !displayRows.length && (!compared || previous.source !== 'loaded-incomplete');
  // A window with no matches isn't a new set of books. Keep its headings and group selector, but
  // only show the layout/export toolbar when there are rows to operate on.
  const emptyBooks = noResults && !hasDocuments && current.source === 'loaded' && (!compared || previous.source === 'loaded');
  const title = selling ? reportText('r.sales-trends', 'Sales trends') : reportText('r.purchase-trends-by-vendor', 'Purchase trends by vendor');
  const party = selling ? (group === 'item' ? reportText('r.item', 'Item') : reportText('r.customer', 'Customer')) : reportText('r.vendor', 'Vendor');
  const noActivity = reportText('r.no-included-activity-in-the-current-twelve-month', 'No included activity in the current twelve-month window.');

  const table = <RowTable
    caption={<>{title}{reportText('r.12-months-through', ': 12 months through')} <bdi dir="ltr" className="whitespace-nowrap">{endDate}</bdi></>}
    captionClassName="" tableClassName="comparison-report-table w-full text-sm" headRowClassName="" bodyClassName=""
    rows={displayRows} rowKey={row => `${row.period}:${row.id}`}
    emptyRow={<tr><td colSpan={compared ? 4 : 3} className="text-center text-[var(--muted)]">{noActivity}</td></tr>}
    columns={[
      compared ? { header: reportText('r.window', 'Window'), headClassName: 'text-start', cell: row => row.period === 'Current' ? reportText('r.period-current', 'Current') : reportText('r.period-previous', 'Previous') } : false,
      { header: reportText('r.month', 'Month'), headClassName: 'text-start', className: 'whitespace-nowrap tabular-nums', cell: row => <bdi>{row.month}</bdi> },
      { header: party, rowHeader: true, headClassName: 'text-start', className: 'text-start', cell: row => <bdi>{row.name}</bdi> },
      { header: reportText('r.amount', 'Amount'), align: 'right', headClassName: '', className: 'whitespace-nowrap tabular-nums', cell: row => <bdi dir="ltr">{formatCurrency(row.cents, currency)}</bdi> },
    ]}
  />;

  return <section aria-label={title} className="p-4 space-y-4 min-w-0">
    <h2 className="text-lg font-semibold">{title}</h2>
    <p>{reportText('r.twelve-calendar-months-ending', 'Twelve calendar months ending')} <bdi dir="ltr" className="whitespace-nowrap">{endDate}</bdi>{reportText('r.the-final-month-stops-on-that-date-the-report-st', '; the final month stops on that date. The report start-date control does not shorten this twelve-month window. Only recorded monthly activity is listed; absent rows mean no included document activity.')}</p>
    <p>{selling
      ? reportText('r.sales-use-the-existing-issued-invoice-item-amoun', 'Sales use the existing issued-invoice item amounts, grouped by customer or item. Drafts and opening documents are excluded; credit notes and document-level tax/discount allocation are outside this item calculation.')
      : reportText('r.purchases-use-the-existing-issued-bill-totals-in', 'Purchases use the existing issued-bill totals in base currency, grouped by vendor. Totals include the document taxes/discounts; opening balances, drafts and undated bills are excluded. Choose Item for the bill-line purchase register, with currencies kept separate; it has a different scope from these vendor totals.')}</p>
    {selling && !emptyBooks && <label className="flex flex-col gap-1 w-fit" data-print-hide>{reportText('r.group-sales-by', 'Group sales by')}
      <select className="min-h-11 border rounded px-3 bg-[var(--panel)]" value={group} onChange={e => setGroup(e.target.value === 'item' ? 'item' : 'customer')}>
        <option value="customer">{reportText('r.customer', 'Customer')}</option><option value="item">{reportText('r.item', 'Item')}</option>
      </select>
    </label>}
    {waiting && <p role="status">{reportText('r.loading-report-records', 'Loading report records…')}</p>}
    {!valid && <p role="alert">{reportText('r.choose-a-valid-report-end-date', 'Choose a valid report end date.')}</p>}
    {partial && <p role="alert">{reportText('r.loaded-history-is-incomplete-or-failed-these-tre', 'Loaded history is incomplete or failed. These trends are provisional.')}</p>}
    <RangeReportSourceNote source={current.source} testId={`${kind}-trends-source`} what={reportText('r.these-trends', 'these trends')}/>
    {compared && <RangeReportSourceNote source={previous.source} testId={`${kind}-trends-compare-source`} what={reportText('r.the-previous-period-trends', 'the previous-period trends')}/>}
    {displayRows.length > 0 && <ReportTableScroll>{table}</ReportTableScroll>}
    {noResults && !emptyBooks && table}
    {emptyBooks && <ReportEmptyState title={noActivity} actionLabel={selling ? reportText('r.open-sales', 'Open Sales') : reportText('r.open-purchases', 'Open Purchases')} onAction={() => setActiveTab(kind)} />}
    {noCurrent && displayRows.length > 0 && <p>{noActivity}</p>}
  </section>;
}

export function SalesTrendsView(props: Props) { return <DocumentTrendsView {...props} kind="sales" />; }

function ScopedPurchaseTrendsView(props: Props) {
  const reportText = useReportText();
  const [group, setGroup] = useState<'vendor' | 'item'>('vendor');
  return <div className="space-y-3 min-w-0">
    <label className="flex flex-col gap-1 w-fit px-4" data-print-hide>{reportText('r.group-purchases-by', 'Group purchases by')}
      <select className="min-h-11 border rounded px-3 bg-[var(--panel)]" value={group} onChange={event => setGroup(event.target.value === 'item' ? 'item' : 'vendor')}>
        <option value="vendor">{reportText('r.vendor', 'Vendor')}</option><option value="item">{reportText('r.item', 'Item')}</option>
      </select>
    </label>
    {group === 'vendor' ? <DocumentTrendsView {...props} kind="purchases" /> : <PurchaseItemTrendsView {...props} />}
  </div>;
}

export function PurchaseTrendsView(props: Props) {
  const uid = useAuthStore(state => state.user?.uid), workspaceId = useAuthStore(state => state.currentWorkspaceId);
  return <ScopedPurchaseTrendsView key={`${uid}:${workspaceId}`} {...props} />;
}
