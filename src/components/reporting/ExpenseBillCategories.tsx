import { useMemo, useState } from 'react';
import type { Bill, ChartAccount } from '../../types';
import { formatCurrency } from '../../lib/utils';
import { billsInExpenseCategory, expenseAccountCategories, UNMAPPED_BILL_CATEGORY } from '../../lib/expenseAccountCategories';

interface Props {
  accounts: readonly ChartAccount[];
  bills: readonly Bill[];
  workspaceId: string;
  startDate?: string;
  endDate?: string;
  loading: boolean;
  incomplete: boolean;
  currency: string;
}

/**
 * E-22: a browsable mapping from expense chart accounts to bill split lines.
 * Purely read-only: never assigns accounts, edits bills or posts a journal.
 */
export default function ExpenseBillCategories({
  accounts, bills, workspaceId, startDate, endDate, loading, incomplete, currency,
}: Props) {
  const [selected, setSelected] = useState('');
  const [showList, setShowList] = useState(false);
  const summary = useMemo(
    () => expenseAccountCategories(accounts, bills, workspaceId, startDate, endDate),
    [accounts, bills, workspaceId, startDate, endDate]
  );
  const selectedBills = useMemo(
    () => billsInExpenseCategory(bills, accounts, workspaceId, selected, startDate, endDate),
    [bills, accounts, workspaceId, selected, startDate, endDate]
  );

  return (
    <section aria-label="Expense account categories and bills" className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4 text-xs">
      <h3 className="text-sm font-semibold text-neutral-900">Expense categories mapped to accounts</h3>
      <p className="text-neutral-600">
        Each category is an expense or cost-of-goods account from this workspace&apos;s chart of accounts.
        A bill with split costs can appear under more than one category; no amount is divided or changed here.
      </p>
      {(loading || incomplete) && <p role="status" className="rounded bg-amber-50 p-3 text-amber-900">
        {loading ? 'Bills are loading for this workspace. ' : ''}
        {incomplete ? 'The browser list may be incomplete; displayed bill counts and matches are not full-history totals.' : ''}
      </p>}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-56 flex-col gap-1 font-medium text-neutral-700">
          Filter bills by expense category
          <select
            value={selected} onChange={event => setSelected(event.target.value)}
            className="min-h-11 rounded-lg border border-neutral-300 bg-white px-3 text-sm text-neutral-900"
          >
            <option value="">All bills ({summary.billCount})</option>
            {summary.categories.map(category =>
              <option key={category.accountId} value={category.accountId}>
                {category.name}{category.code ? ` (${category.code})` : ''} — {category.billCount} bills{category.archived ? ' (archived)' : ''}
              </option>
            )}
            <option value={UNMAPPED_BILL_CATEGORY}>No mapped expense account ({summary.withoutCategoryCount})</option>
          </select>
        </label>
        <button type="button" aria-expanded={showList} aria-controls="expense-category-account-list"
          onClick={() => setShowList(value => !value)}
          className="min-h-11 rounded-lg border border-neutral-300 px-3 text-sm font-medium text-neutral-800">
          {showList ? 'Hide category list' : 'Show category list'} ({summary.categories.length})
        </button>
      </div>
      {showList && <div id="expense-category-account-list" className="max-h-60 overflow-auto rounded-lg border border-neutral-200">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">Expense categories and the chart accounts they map to</caption>
          <thead className="sticky top-0 bg-neutral-50">
            <tr><th scope="col" className="p-2">Category</th><th scope="col" className="p-2">Account number</th><th scope="col" className="p-2 text-right">Bills</th></tr>
          </thead>
          <tbody>
            {summary.categories.map(category => <tr key={category.accountId} className="border-t border-neutral-100">
              <td className="p-2">{category.name}{category.archived ? ' (archived)' : ''}</td>
              <td className="p-2">{category.code || '—'}</td>
              <td className="p-2 text-right">{category.billCount}</td>
            </tr>)}
            <tr className="border-t border-neutral-100">
              <td className="p-2">No mapped expense account</td><td className="p-2">—</td>
              <td className="p-2 text-right">{summary.withoutCategoryCount}</td>
            </tr>
          </tbody>
        </table>
      </div>}
      <h4 className="font-semibold text-neutral-900">Matching bills ({selectedBills.length})</h4>
      {selectedBills.length === 0
        ? <p className="text-neutral-500">{loading ? 'Loading bill records…' : 'No loaded bills match this category and period.'}</p>
        : <div role="region" aria-label="Bills by expense category" tabIndex={0} className="max-h-72 overflow-auto rounded-lg border border-neutral-200">{/* NOSONAR: S6845 — tabIndex on scrollable region is the intentional axe scrollable-region-focusable pattern */}
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Bills matching the selected expense account category</caption>
            <thead className="sticky top-0 bg-neutral-50"><tr>
              <th scope="col" className="p-2">Vendor</th>
              <th scope="col" className="p-2">Bill</th>
              <th scope="col" className="p-2">Date</th>
              <th scope="col" className="p-2">Status</th>
              <th scope="col" className="p-2 text-right">Document amount</th>
            </tr></thead>
            <tbody>
              {selectedBills.map(bill => <tr key={bill.id} className="border-t border-neutral-100">
                <td className="p-2">{bill.vendorName || bill.vendorId}</td>
                <td className="p-2">{bill.number || bill.id}</td>
                <td className="p-2">{bill.date || bill.issueDate || 'Unknown'}</td>
                <td className="p-2">{bill.status}</td>
                <td className="p-2 text-right">{formatCurrency(bill.amountCents, bill.currency || currency)}</td>
              </tr>)}
            </tbody>
          </table>
        </div>}
      <p className="text-neutral-500">
        The bill amount is its original document total, not the amount assigned to the selected account.
        Archived accounts remain available for finding historical bills. Edit account names in the chart of accounts.
      </p>
    </section>
  );
}
