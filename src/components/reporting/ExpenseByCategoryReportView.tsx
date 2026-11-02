import React, { useMemo } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { formatCurrency } from '../../lib/utils';
import { PieChart } from 'lucide-react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { LEDGER_COLLECTIONS } from '../../lib/ledgerCollections';
import ExpenseBillCategories from './ExpenseBillCategories';
import { useServerExpenseByCategory } from '../../hooks/useServerExpenseByCategory';

interface Props {
  selectedYear?: number;
  startDate?: string;
  endDate?: string;
  onDrillDown?: (accountId: string) => void;
}

export const ExpenseByCategoryReportView: React.FC<Props> = ({
  selectedYear,
  startDate,
  endDate
}) => {
  const accounts = useLedgerStore(s => s.accounts);
  const bills = useLedgerStore(s => s.bills);
  const { loading: billsLoading } = useLedgerCollections('bills');
  const workspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  const currency = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';
  const cacheWorkspace = useDataNeedsStore(s => s.loadedWorkspaceId);
  const billsFailed = useDataNeedsStore(s => Boolean(s.failed.bills));
  const listIncomplete = billsFailed || cacheWorkspace !== workspaceId ||
    bills.length >= LEDGER_COLLECTIONS.bills.cap || accounts.length >= LEDGER_COLLECTIONS.accounts.cap;

  const start = startDate || (selectedYear ? `${selectedYear}-01-01` : undefined);
  const end = endDate || (selectedYear ? `${selectedYear}-12-31` : undefined);

  // L-123 step 4d: with the loaded list capped, the breakdown comes from the server (every entry of the range)
  const { categories: breakdowns, source } = useServerExpenseByCategory(start, end);

  const totalExpenseCents = useMemo(() => {
    return breakdowns.reduce((sum, b) => sum + b.totalAmountCents, 0);
  }, [breakdowns]);

  return (
    <div className="space-y-6 max-w-5xl mx-auto p-4 sm:p-6" id="expense-by-category-report">
      <div className="flex items-center justify-between border-b border-neutral-200 pb-4">
        <div>
          <h2 className="text-lg font-bold text-neutral-900 flex items-center gap-2">
            <PieChart className="w-5 h-5 text-rose-600" />
            Expense Breakdown by Category
          </h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            Distribution of all operating and non-operating expenditures across chart of account categories.
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-neutral-500 uppercase font-semibold">Total Expenses</div>
          <div className="text-lg font-mono font-bold text-rose-600">
            {formatCurrency(totalExpenseCents)}
          </div>
        </div>
      </div>

      {source !== 'loaded' && (
        <p className="text-xs text-neutral-600" data-testid="expense-category-source">
          {source === 'server'
            ? 'Not every entry is loaded in this browser: these totals are read from every entry on the server.'
            : 'Not every entry is loaded in this browser and the server could not be asked: these totals cover the loaded entries only, so they may be too low.'}
        </p>
      )}

      <ExpenseBillCategories key={workspaceId} workspaceId={workspaceId}
        accounts={accounts} bills={bills} startDate={start} endDate={end}
        loading={billsLoading} incomplete={listIncomplete} currency={currency} />

      {breakdowns.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-neutral-200 text-neutral-500 text-xs">
          No posted expense transactions found for the selected period.
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden shadow-xs">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Expenses by category</caption>
            <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-600 font-semibold uppercase tracking-wider">
              <tr>
                <th scope="col" className="py-3 px-4">Category</th>
                <th scope="col" className="py-3 px-4 text-center">Transactions</th>
                <th scope="col" className="py-3 px-4 text-right">Share</th>
                <th scope="col" className="py-3 px-4 text-right">Total Outflow</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {breakdowns.map(item => (
                <tr key={item.category} className="hover:bg-neutral-50/80 transition-colors">
                  <td className="py-3 px-4 font-medium text-neutral-900">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0" />
                      <span>{item.category}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-center text-neutral-600 font-mono">
                    {item.transactionCount}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-24 bg-neutral-100 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="bg-rose-500 h-full rounded-full"
                          style={{ width: `${Math.min(100, item.percentage)}%` }}
                        />
                      </div>
                      <span className="font-mono text-neutral-700 w-12 text-right">
                        {item.percentage.toFixed(1)}%
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-right font-mono font-semibold text-rose-600">
                    {formatCurrency(item.totalAmountCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default ExpenseByCategoryReportView;
