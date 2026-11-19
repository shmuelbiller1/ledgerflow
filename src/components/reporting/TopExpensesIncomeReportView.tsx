import { ReportInputBoundary } from './ReportInputBoundary';
import React, { useMemo, useState } from 'react';
import { formatCurrency, formatDate } from '../../lib/utils';
import { useServerTopLines } from '../../hooks/useServerTopLines';
import { AccountReportResult } from './AccountReportResult';
import { BarChart3, TrendingDown, TrendingUp } from 'lucide-react';
import { TanStackDataGrid } from '../ui/TanStackDataGrid';
import { EmptyState } from '../ui/EmptyState';
import { csvMoneyForBook } from '../../lib/csvExport';
import type { ColumnDef } from '@tanstack/react-table';
import { useReportText } from './useReportText';
import { useAuthStore } from '../../stores/useAuthStore';

interface Props {
  selectedYear?: number;
  startDate?: string;
  endDate?: string;
}

const LoadedReport: React.FC<Props> = ({
  selectedYear,
  startDate,
  endDate
}) => {
  const reportText = useReportText();
  // #910: the file is in the book's currency, so its decimals come from that currency (JPY yen, KWD fils)
  const bookCurrency = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';
  const moneyCell = useMemo(() => csvMoneyForBook(bookCurrency), [bookCurrency]);
  const [activeTab, setActiveTab] = useState<'expenses' | 'income'>('expenses');

  const start = startDate || (selectedYear ? `${selectedYear}-01-01` : undefined);
  const end = endDate || (selectedYear ? `${selectedYear}-12-31` : undefined);

  // L-123 step 4a: with the loaded list capped, the list comes from the server (every entry of the range)
  const { topExpenses, topIncome, ...read } = useServerTopLines(start, end, 25);

  const activeItems = activeTab === 'expenses' ? topExpenses : topIncome;

  /**
   * The biggest lines of the period, one row each. The description names the row (a payee underneath,
   * as the old table showed); the amount is coloured by the tab, and the sort is on the cents.
   */
  const columns: ColumnDef<(typeof activeItems)[number], unknown>[] = [
    { id: 'date', accessorFn: row => row.date, header: reportText('r.date-2', 'Date'), cell: info => <span className="font-mono whitespace-nowrap">{formatDate(String(info.getValue()))}</span> },
    { id: 'description', accessorFn: row => `${row.description} ${row.payee ?? ''}`.trim(), header: reportText('r.description-payee', 'Description & Payee'), cell: info => {
      const row = info.row.original as (typeof activeItems)[number];
      return <span className="font-medium"><bdi>{row.description}</bdi>{row.payee ? <span className="block text-[11px] text-[var(--muted)] mt-0.5"><bdi>{row.payee}</bdi></span> : null}</span>;
    } },
    { id: 'account', accessorFn: row => row.accountName, header: reportText('r.account-category', 'Account / Category'), cell: info => (
      <span className="bg-[var(--elevated)] px-2 py-0.5 rounded-sm border border-[var(--line)] text-[11px]"><bdi>{String(info.getValue())}</bdi></span>
    ) },
    { id: 'amount', accessorFn: row => row.amountCents, header: reportText('r.amount', 'Amount'), cell: info => (
      <span className={`font-mono font-bold ${activeTab === 'expenses' ? 'text-rose-600' : 'text-emerald-600'}`}>{formatCurrency(Number(info.getValue()))}</span>
    ) },
  ];

  return (
    <div className="space-y-6 max-w-5xl mx-auto p-4 sm:p-6" id="top-expenses-income-report">
      <div className="flex items-center justify-between border-b border-neutral-200 pb-4">
        <div>
          <h2 className="text-lg font-bold text-neutral-900 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-neutral-800" />
            {reportText('r.top-financial-line-items', 'Top Financial Line Items')}
          </h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            {reportText('r.identify-the-largest-individual-expenditure-and', 'Identify the largest individual expenditure and revenue transactions across the ledger.')}
          </p>
        </div>
        <div className="flex bg-neutral-100 p-1 rounded-lg border border-neutral-200">
          <button
            onClick={() => setActiveTab('expenses')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 ${
              activeTab === 'expenses'
                ? 'bg-white text-rose-700 shadow-xs'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <TrendingDown className="w-3.5 h-3.5" />
            {reportText('r.top-25-expenses', 'Top 25 Expenses')}
          </button>
          <button
            onClick={() => setActiveTab('income')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 ${
              activeTab === 'income'
                ? 'bg-white text-emerald-700 shadow-xs'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            {reportText('r.top-25-revenue', 'Top 25 Revenue')}
          </button>
        </div>
      </div>

      <AccountReportResult read={read} testId="top-lines-source" hasRows={activeItems.length > 0}>
        <TanStackDataGrid
          caption={reportText('r.top-expenses-and-income', 'Top expenses and income')}
          data={activeItems}
          columns={columns}
          rowHeaderColumn="description"
          pageSize={25}
          searchPlaceholder={reportText('r.search-descriptions-payees-and-accounts', 'Search descriptions, payees and accounts...')}
          searchLabel="Search descriptions, payees and accounts"
          columnScope={`report-top-lines-${activeTab}`}
          columnLabel={`Top ${activeTab} columns`}
          columnNames={['Date', 'Description & Payee', 'Account / Category', 'Amount']}
          exportConfig={read.source === 'loaded-incomplete' ? undefined : {
            filename: `top-${activeTab}.csv`,
            label: reportText('r.export-csv', 'Export CSV'),
            headers: ['Date', 'Description', 'Payee', 'Account / Category', 'Amount'],
            mapRow: row => [row.date, row.description, row.payee || '', row.accountName, moneyCell(row.amountCents)],
          }}
          emptyState={<EmptyState title={activeTab === 'expenses' ? reportText('r.no-expenses-in-period', 'No expenses in this period') : reportText('r.no-income-in-period', 'No income in this period')} description={reportText('r.try-a-wider-period', 'Try a wider period.')} />}
          filteredEmptyState={<EmptyState title={reportText('r.no-record-matches-your-search', 'No record matches your search')} description={reportText('r.try-another-word-or-account', 'Try another word or account.')} />}
        />
      </AccountReportResult>
    </div>
  );
};

export function TopExpensesIncomeReportView(props: Props) {
  return <ReportInputBoundary><LoadedReport {...props} /></ReportInputBoundary>;
}

export default TopExpensesIncomeReportView;
