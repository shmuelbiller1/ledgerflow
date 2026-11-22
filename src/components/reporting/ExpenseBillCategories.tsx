
import { useMemo, useState } from 'react';
import type { Bill, ChartAccount } from '../../types';
import { formatCurrency } from '../../lib/utils';
import { billsInExpenseCategory, expenseAccountCategories, UNMAPPED_BILL_CATEGORY } from '../../lib/expenseAccountCategories';
import { RowTable } from '../ui/RowTable';
import { useReportText } from './useReportText';

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
  const reportText = useReportText();
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
    <section aria-label={reportText('r.expense-account-categories-and-bills', 'Expense account categories and bills')} className="space-y-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4 text-xs">
      <h3 className="text-sm font-semibold text-[var(--text)]">{reportText('r.expense-categories-mapped-to-accounts', 'Expense categories mapped to accounts')}</h3>
      <p className="text-[var(--muted)]">
        {reportText('r.each-category-is-an-expense-or-cost-of-goods-acc', 'Each category is an expense or cost-of-goods account from this workspace\'s chart of accounts. A bill with split costs can appear under more than one category; no amount is divided or changed here.')}
      </p>
      {(loading || incomplete) && <p role="status" className="rounded bg-amber-50 p-3 text-amber-900">
        {loading ? `${reportText('r.bills-are-loading-for-this-workspace', 'Bills are loading for this workspace.')} ` : ''}
        {incomplete ? reportText('r.the-browser-list-may-be-incomplete-displayed-bil', 'The browser list may be incomplete; displayed bill counts and matches are not full-history totals.') : ''}
      </p>}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-56 flex-col gap-1 font-medium text-[var(--text)]">
          {reportText('r.filter-bills-by-expense-category', 'Filter bills by expense category')}
          <select
            value={selected} onChange={event => setSelected(event.target.value)}
            className="min-h-11 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]"
          >
            <option value="">{reportText('r.all-bills', 'All bills (')}{summary.billCount})</option>
            {summary.categories.map(category =>
              <option key={category.accountId} value={category.accountId}>
                {category.name}{category.code ? ` (${category.code})` : ''} — {category.billCount} {reportText('r.bills', 'bills')}{category.archived ? ` ${reportText('r.archived', '(archived)')}` : ''}
              </option>
            )}
            <option value={UNMAPPED_BILL_CATEGORY}>{reportText('r.no-mapped-expense-account', 'No mapped expense account (')}{summary.withoutCategoryCount})</option>
          </select>
        </label>
        <button type="button" aria-expanded={showList} aria-controls="expense-category-account-list"
          onClick={() => setShowList(value => !value)}
          className="min-h-11 rounded-lg border border-[var(--line)] px-3 text-sm font-medium text-[var(--text)]">
          {showList ? reportText('r.hide-category-list', 'Hide category list') : reportText('r.show-category-list', 'Show category list')} ({summary.categories.length})
        </button>
      </div>
      {showList && <div id="expense-category-account-list" className="max-h-60 overflow-auto rounded-lg border border-[var(--line)]" role="region" aria-label={reportText('r.expense-categories-and-the-chart-accounts-they-m', 'Expense categories and the chart accounts they map to')} tabIndex={0}>{/* NOSONAR: named, keyboard-scrollable schedule */}
        <RowTable
          caption={reportText('r.expense-categories-and-the-chart-accounts-they-m', 'Expense categories and the chart accounts they map to')}
          captionClassName="sr-only"
          tableClassName="w-full text-left text-xs"
          headRowClassName="sticky top-0 bg-[var(--panel)]"
          bodyClassName=""
          rowClassName="border-t border-[var(--line)]"
          rows={[
            ...summary.categories,
            {
              accountId: UNMAPPED_BILL_CATEGORY,
              name: reportText('r.no-mapped-expense-account-2', 'No mapped expense account'),
              code: '',
              archived: false,
              billCount: summary.withoutCategoryCount,
            },
          ]}
          rowKey={(category) => category.accountId}
          rowHeaderClassName="font-normal text-start"
          columns={[
            {
              header: reportText('r.category', 'Category'),
              headClassName: 'p-2', className: 'p-2',
              cell: (category) => (
                <>
                  {category.name}
                  {category.archived ? ` ${reportText('r.archived', '(archived)')}` : ''}
                </>
              ),
            },
            { header: reportText('r.account-number', 'Account number'), headClassName: 'p-2', className: 'p-2', cell: (category) => category.code || '—' },
            { header: reportText('r.bills-2', 'Bills'), headClassName: 'p-2 text-right', className: 'p-2 text-right', cell: (category) => category.billCount },
          ]}
        />
      </div>}
      <h4 className="font-semibold text-[var(--text)]">{reportText('r.matching-bills', 'Matching bills (')}{selectedBills.length})</h4>
      {selectedBills.length === 0
        ? <p className="text-[var(--muted)]">{loading ? reportText('r.loading-bill-records', 'Loading bill records…') : reportText('r.no-loaded-bills-match-this-category-and-period', 'No loaded bills match this category and period.')}</p>
        : <div role="region" aria-label={reportText('r.bills-by-expense-category', 'Bills by expense category')} tabIndex={0} className="max-h-72 overflow-auto rounded-lg border border-[var(--line)]">{/* NOSONAR: S6845 — tabIndex on scrollable region is the intentional axe scrollable-region-focusable pattern */}
          <RowTable
            rowHeaderColumn={false}
            rowClassName="border-t border-[var(--line)]"
            caption={(<>{reportText('r.bills-matching-the-selected-expense-account-cate', 'Bills matching the selected expense account category')}</>)}
            rows={selectedBills}
            rowKey={bill => bill.id}
            tableClassName="w-full text-left text-xs"
            headRowClassName="sticky top-0 bg-[var(--panel)]"
            bodyClassName=""
            columns={[
              { header: reportText('r.vendor', 'Vendor'), className: "p-2", headClassName: "p-2", cell: (bill) => bill.vendorName || bill.vendorId },
              { header: reportText('r.bill-2', 'Bill'), className: "p-2", headClassName: "p-2", cell: (bill) => bill.number || bill.id },
              { header: reportText('r.date-2', 'Date'), className: "p-2", headClassName: "p-2", cell: (bill) => bill.date || bill.issueDate || 'Unknown' },
              { header: reportText('r.status', 'Status'), className: "p-2", headClassName: "p-2", cell: (bill) => bill.status },
              { header: reportText('r.document-amount', 'Document amount'), align: 'right', className: "p-2", headClassName: "p-2", cell: (bill) => formatCurrency(bill.amountCents, bill.currency || currency) },
            ]}
          />
        </div>}
      <p className="text-[var(--muted)]">
        {reportText('r.the-bill-amount-is-its-original-document-total-n', 'The bill amount is its original document total, not the amount assigned to the selected account. Archived accounts remain available for finding historical bills. Edit account names in the chart of accounts.')}
      </p>
    </section>
  );
}
