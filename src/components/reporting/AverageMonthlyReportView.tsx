import React from 'react';
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
      <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden shadow-xs">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">Monthly averages</caption>
          <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-600 font-semibold uppercase tracking-wider">
            <tr>
              <th scope="col" className="py-3 px-4">Month</th>
              <th scope="col" className="py-3 px-4 text-right">Revenue</th>
              <th scope="col" className="py-3 px-4 text-right">Expense / Burn</th>
              <th scope="col" className="py-3 px-4 text-right">Net Cash Flow</th>
              <th scope="col" className="py-3 px-4 text-center">Status / Anomaly</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {summary.monthlyData.map((m) => {
              const net = m.incomeCents - m.expenseCents;
              const hasAnomaly = m.isExpenseAnomaly || m.isIncomeAnomaly;

              return (
                <tr key={m.month} className="hover:bg-neutral-50/80 transition-colors">
                  <td className="py-3 px-4 font-semibold text-neutral-900">
                    {m.monthName} {selectedYear}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-emerald-600 font-medium">
                    {formatCurrency(m.incomeCents)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-rose-600 font-medium">
                    {formatCurrency(m.expenseCents)}
                  </td>
                  <td className={`py-3 px-4 text-right font-mono font-bold ${net >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {formatCurrency(net)}
                  </td>
                  <td className="py-3 px-4 text-center">
                    {hasAnomaly ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 rounded-full text-[10px] font-semibold">
                        <AlertTriangle className="w-3 h-3 text-amber-600" />
                        Variance Spike
                      </span>
                    ) : (
                      <span className="text-neutral-400 text-[11px] font-medium">
                        Normal
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AverageMonthlyReportView;
