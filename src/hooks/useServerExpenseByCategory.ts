import { useMemo } from 'react';
import { useLedgerStore } from '../stores/useLedgerStore';
import { computeExpenseByCategory, type CategoryExpenseBreakdown } from '../lib/reportGenerators';
import { useServerRangeReport, type RangeReportSource } from './useServerRangeReport';

const parseCategories = (body: Record<string, unknown>) => (Array.isArray(body.categories) ? body.categories as CategoryExpenseBreakdown[] : null);

/**
 * L-123 step 4d: the expense breakdown by category over `from`…`to` (useServerRangeReport). A category can be set on
 * a single line, so per-account sums cannot give it; the whole breakdown comes from the server
 * (GET /api/v1/balances/expense-by-category) when the loaded entries may be short.
 */
export function useServerExpenseByCategory(from: string | undefined, to: string | undefined): { categories: CategoryExpenseBreakdown[]; source: RangeReportSource } {
  const transactions = useLedgerStore(s => s.transactions);
  const accounts = useLedgerStore(s => s.accounts);
  // a capped chart of accounts leaves lines whose account is not loaded out of the sums, whatever the range (CodeRabbit on #495)
  const accountsCapped = useLedgerStore(s => Boolean(s.truncatedCollections?.chartAccounts));
  const loaded = useMemo(() => computeExpenseByCategory(accounts, transactions, from, to), [accounts, transactions, from, to]);
  // the server groups by each account's type, category and name too: a change to any of them asks again (Codex on #495)
  const accountsKey = useMemo(() => JSON.stringify((accounts || []).map(a => [a.id, a.type, a.category, a.name])
    .sort((x, y) => String(x[0]).localeCompare(String(y[0])))), [accounts]);
  const { report, source } = useServerRangeReport({
    path: 'expense-by-category', from, to, extraKey: accountsKey, alsoIncomplete: accountsCapped, parse: parseCategories, loaded,
  });
  return { categories: report, source };
}
