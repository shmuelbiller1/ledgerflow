import React from 'react';
import { TanStackDataGrid } from '../ui/TanStackDataGrid';
import { EmptyState } from '../ui/EmptyState';
import { csvMoney } from '../../lib/csvExport';
import type { ColumnDef } from '@tanstack/react-table';
import { formatCurrency, workspaceYearMonth } from '../../lib/utils';
import { useServerMonthlyAverages } from '../../hooks/useServerMonthlyAverages';
import { RangeReportSourceNote } from './RangeReportSourceNote';
import { Calendar, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react';
import ReportEmptyState from './ReportEmptyState';
import { ReportProvenanceNote } from './ReportProvenanceNote';
import { STATEMENT_COLLECTIONS, useBrowserProvenance } from '../../hooks/useBrowserProvenance';

interface Props {
  selectedYear?: number;
}

export const AverageMonthlyReportView: React.FC<Props> = ({
  selectedYear = workspaceYearMonth().year
}) => {
  const provenance = useBrowserProvenance(STATEMENT_COLLECTIONS, false);
  // L-123 step 4f: with the loaded lists capped, the months come from the server (every entry of the year)
  const { summary, source } = useServerMonthlyAverages(selectedYear);
  const noActivity = summary.monthlyData.every(month => month.incomeCents === 0 && month.expenseCents === 0);

  /** One row per month: what came in, what went out, the difference, and whether it was out of line. */
  const columns: ColumnDef<(typeof summary.monthlyData)[number], unknown>[] = [
    { id: 'month', accessorFn: row => `${row.monthName} ${selectedYear}`, header: 'Month', cell: info => <span className="font-semibold">{String(info.getValue())}</span> },
    { id: 'income', accessorFn: row => row.incomeCents, header: 'Revenue', cell: info => <span className="font-mono text-emerald-600">{formatCurrency(Number(info.getValue()))}</span> },
    { id: 'expense', accessorFn: row => row.expenseCents, header: 'Expense / Burn', cell: info => <span className="font-mono text-rose-600">{formatCurrency(Number(info.getValue()))}</span> },
    { id: 'net', accessorFn: row => row.incomeCents - row.expenseCents, header: 'Net Cash Flow', cell: info => (
      <span className={`font-mono font-bold ${Number(info.getValue()) >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{formatCurrency(Number(info.getValue()))}</span>
    ) },
    { id: 'status', accessorFn: row => (row.isExpenseAnomaly || row.isIncomeAnomaly ? 'Variance spike' : 'Normal'), header: 'Status / Anomaly', cell: info => (
      String(info.getValue()) === 'Variance spike'
        ? <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 rounded-full text-[10px] font-semibold"><AlertTriangle className="w-3 h-3 text-amber-600" aria-hidden="true" />Variance spike</span>
        : <span className="text-neutral-400 text-[11px] font-medium">Normal</span>
    ) },
  ];
  const historyComplete = source === 'server' || provenance.completeness === 'complete';

  return (
    <div className="space-y-6 max-w-5xl mx-auto p-4 sm:p-6" id="monthly-averages-report">
      <div className="flex items-center justify-between border-b border-neutral-200 pb-4">
        <div>
          <h2 className="text-lg font-bold text-neutral-900 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-indigo-600" />
            Monthly Averages & Outlier Forensics ({selectedYear})
          </h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            Baseline run-rate averages with automated statistical anomaly detection (&gt;50% variance).
          </p>
        </div>
      </div>
      <RangeReportSourceNote source={source} testId="monthly-averages-source" what="these figures" />
      {noActivity && !historyComplete && <ReportProvenanceNote provenance={provenance} />}
      {noActivity && <ReportEmptyState title="No income or expenses in the loaded records for this year"
        description={historyComplete
          ? 'Choose another year, or record posted sales and expense entries first. The twelve months remain visible at zero so the selected period is clear.'
          : 'Loaded ledger history is incomplete or failed. Load full history before treating the whole year as inactive; older posted entries may not be in this browser cache.'} />}

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="p-4 bg-white rounded-lg border border-neutral-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-500 uppercase">Monthly Average Revenue</span>
            <TrendingUp className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-xl font-mono font-bold text-emerald-600 mt-2">
            {formatCurrency(summary.monthlyAverageIncomeCents)}
            <span className="text-xs text-neutral-400 font-normal"> / mo</span>
          </div>
        </div>

        <div className="p-4 bg-white rounded-lg border border-neutral-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-500 uppercase">Monthly Average Burn / Expense</span>
            <TrendingDown className="w-4 h-4 text-rose-600" />
          </div>
          <div className="text-xl font-mono font-bold text-rose-600 mt-2">
            {formatCurrency(summary.monthlyAverageExpenseCents)}
            <span className="text-xs text-neutral-400 font-normal"> / mo</span>
          </div>
        </div>
      </div>

      {/* Monthly Breakdown Table */}
      <TanStackDataGrid
        caption="Monthly averages"
        data={summary.monthlyData}
        columns={columns}
        rowHeaderColumn="month"
        pageSize={25}
        searchPlaceholder="Search months..."
        searchLabel="Search months"
        columnScope="report-average-monthly"
        columnLabel="Monthly averages columns"
        columnNames={['Month', 'Revenue', 'Expense / Burn', 'Net Cash Flow', 'Status / Anomaly']}
        exportConfig={{
          filename: 'monthly-averages.csv',
          label: 'Export CSV',
          headers: ['Month', 'Revenue', 'Expense / Burn', 'Net Cash Flow', 'Status / Anomaly'],
          mapRow: row => [
            `${row.monthName} ${selectedYear}`,
            csvMoney(row.incomeCents),
            csvMoney(row.expenseCents),
            csvMoney(row.incomeCents - row.expenseCents),
            row.isExpenseAnomaly || row.isIncomeAnomaly ? 'Variance spike' : 'Normal',
          ],
        }}
        emptyState={<EmptyState title="No months in this year" description="Choose another year." />}
        filteredEmptyState={<EmptyState title="No month matches your search" description="Try another month name." />}
      />
    </div>
  );
};

export default AverageMonthlyReportView;
