import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useScreenDataHealth } from '../../hooks/useScreenDataHealth';
import { LoadingState } from '../ui/LoadingState';
import { ReportInputBoundary, ReportInputFailure } from './ReportInputBoundary';
import { useReportText } from './useReportText';
import React, { useMemo } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { formatCurrency } from '../../lib/utils';
import { PieChart } from 'lucide-react';
import { TanStackDataGrid } from '../ui/TanStackDataGrid';
import { EmptyState } from '../ui/EmptyState';
import { csvMoney } from '../../lib/csvExport';
import type { ColumnDef } from '@tanstack/react-table';
import { useAuthStore } from '../../stores/useAuthStore';
import { LEDGER_COLLECTIONS } from '../../lib/ledgerCollections';
import ExpenseBillCategories from './ExpenseBillCategories';
import { useServerExpenseByCategory } from '../../hooks/useServerExpenseByCategory';
import { AccountReportResult } from './AccountReportResult';

interface Props {
  selectedYear?: number;
  startDate?: string;
  endDate?: string;
  onDrillDown?: (accountId: string) => void;
}

const LoadedReport: React.FC<Props> = ({
  selectedYear,
  startDate,
  endDate
}) => {
  const reportText = useReportText();
  const start = startDate || (selectedYear ? `${selectedYear}-01-01` : undefined);
  const end = endDate || (selectedYear ? `${selectedYear}-12-31` : undefined);

  // L-123 step 4d: with the loaded list capped, the breakdown comes from the server (every entry of the range)
  const { categories: breakdowns, ...read } = useServerExpenseByCategory(start, end);

  /**
   * One row per chart-of-accounts category: how many entries, what share of the period they are, and
   * what they came to. The share sorts on the number, not the printed percentage.
   */
  const columns: ColumnDef<(typeof breakdowns)[number], unknown>[] = [
    { id: 'category', accessorFn: row => row.category, header: reportText('r.category', 'Category'), cell: info => (
      <span className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0" aria-hidden="true" />
        <bdi>{String(info.getValue())}</bdi>
      </span>
    ) },
    { id: 'count', accessorFn: row => row.transactionCount, header: reportText('r.transactions', 'Transactions'), cell: info => <span className="font-mono">{String(info.getValue())}</span> },
    { id: 'share', accessorFn: row => row.percentage, header: reportText('r.share', 'Share'), cell: info => (
      <span className="flex items-center justify-end gap-2">
        <span className="w-24 bg-neutral-100 rounded-full h-1.5 overflow-hidden" aria-hidden="true">
          <span className="block bg-rose-500 h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, Number(info.getValue())))}%` }} />
        </span>
        <span className="font-mono w-12 text-right">{Number(info.getValue()).toFixed(1)}%</span>
      </span>
    ) },
    { id: 'total', accessorFn: row => row.totalAmountCents, header: reportText('r.total-outflow', 'Total Outflow'), cell: info => <span className="font-mono font-semibold text-rose-600">{formatCurrency(Number(info.getValue()))}</span> },
  ];

  const totalExpenseCents = useMemo(() => {
    return breakdowns.reduce((sum, b) => sum + b.totalAmountCents, 0);
  }, [breakdowns]);

  return (
    <div className="space-y-6 max-w-5xl mx-auto p-4 sm:p-6" id="expense-by-category-report">
      <div className="flex items-center justify-between border-b border-neutral-200 pb-4">
        <div>
          <h2 className="text-lg font-bold text-neutral-900 flex items-center gap-2">
            <PieChart className="w-5 h-5 text-rose-600" />
            {reportText('r.expense-breakdown-by-category', 'Expense Breakdown by Category')}
          </h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            {reportText('r.distribution-of-all-operating-and-non-operating-', 'Distribution of all operating and non-operating expenditures across chart of account categories.')}
          </p>
        </div>
        {read.source !== 'loaded-incomplete' && <div className="text-right">
          <div className="text-xs text-neutral-500 uppercase font-semibold">{reportText('r.total-expenses', 'Total Expenses')}</div>
          <div className="text-lg font-mono font-bold text-rose-600">
            {formatCurrency(totalExpenseCents)}
          </div>
        </div>}
      </div>

      <AccountReportResult read={read} testId="expense-category-source" hasRows={breakdowns.length > 0}>
        <TanStackDataGrid
          caption={reportText('r.expenses-by-category-caption', 'Expenses by category')}
          data={breakdowns}
          columns={columns}
          rowHeaderColumn="category"
          pageSize={25}
          searchPlaceholder={reportText('r.search-categories', 'Search categories...')}
          searchLabel="Search categories"
          columnScope="report-expense-by-category"
          columnLabel="Expenses by category columns"
          columnNames={['Category', 'Transactions', 'Share', 'Total Outflow']}
          exportConfig={read.source === 'loaded-incomplete' ? undefined : {
            filename: 'expenses-by-category.csv',
            label: reportText('r.export-csv', 'Export CSV'),
            headers: ['Category', 'Transactions', 'Share %', 'Total Outflow'],
            mapRow: row => [row.category, row.transactionCount, row.percentage.toFixed(1), csvMoney(row.totalAmountCents)],
          }}
          emptyState={<EmptyState title={reportText('r.no-posted-expenses-in-this-period', 'No posted expenses in this period')} description={reportText('r.try-a-wider-period', 'Try a wider period.')} />}
          filteredEmptyState={<EmptyState title={reportText('r.no-category-matches-your-search', 'No category matches your search')} description={reportText('r.try-another-category-name', 'Try another category name.')} />}
        />
      </AccountReportResult>
    </div>
  );
};

function BillPanel({ selectedYear, startDate, endDate }: Props) {
  const reportText = useReportText();
  const { loading } = useLedgerCollections('bills');
  const health = useScreenDataHealth(['bills']);
  const accounts = useLedgerStore(s => s.accounts);
  const bills = useLedgerStore(s => s.bills);
  const workspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  const currency = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';
  const capped = useLedgerStore(s => s.truncatedCollections);
  const listIncomplete = Boolean(capped?.bills || capped?.chartAccounts) ||
    bills.length >= LEDGER_COLLECTIONS.bills.cap || accounts.length >= LEDGER_COLLECTIONS.accounts.cap;

  const start = startDate || (selectedYear ? `${selectedYear}-01-01` : undefined);
  const end = endDate || (selectedYear ? `${selectedYear}-12-31` : undefined);

  if (health.failedKeys.length) return <ReportInputFailure onRetry={health.retry} />;
  if (loading) return <LoadingState label={reportText('r.loading-bills', 'Loading bills…')} />;
  return <ExpenseBillCategories key={workspaceId} workspaceId={workspaceId}
    accounts={accounts} bills={bills} startDate={start} endDate={end}
    loading={false} incomplete={listIncomplete} currency={currency} />;
}

export function ExpenseByCategoryReportView(props: Props) {
  return <ReportInputBoundary collections={['accounts']}>
    <ReportInputBoundary collections={['transactions']}><LoadedReport {...props} /></ReportInputBoundary>
    <BillPanel {...props} />
  </ReportInputBoundary>;
}

export default ExpenseByCategoryReportView;
