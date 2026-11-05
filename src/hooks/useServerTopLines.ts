import { useMemo } from 'react';
import { useLedgerStore } from '../stores/useLedgerStore';
import { computeTopExpensesAndIncome } from '../lib/reportGenerators';
import type { TopLines } from '../lib/serverTopLines';
import { useServerRangeReport, type RangeReportSource } from './useServerRangeReport';

const parseTopLines = (body: Record<string, unknown>): TopLines | null => (Array.isArray(body.topExpenses) && Array.isArray(body.topIncome)
  ? { topExpenses: body.topExpenses as TopLines['topExpenses'], topIncome: body.topIncome as TopLines['topIncome'] }
  : null);

/**
 * L-123 step 4a: the largest single expense and income lines over `from`…`to` (src/lib/serverTopLines.ts). When the
 * loaded list is capped and the range reaches the oldest loaded day, lines may be missing from it, so the whole list
 * comes from the server (GET /api/v1/balances/top-lines, through useServerRangeReport). `source` says which.
 */
export function useServerTopLines(from: string | undefined, to: string | undefined, limit: number): TopLines & { source: RangeReportSource } {
  const transactions = useLedgerStore(s => s.transactions);
  const accounts = useLedgerStore(s => s.accounts);
  const loaded = useMemo(() => computeTopExpensesAndIncome(accounts, transactions, limit, from, to), [accounts, transactions, limit, from, to]);
  const { report, source } = useServerRangeReport({ path: 'top-lines', from, to, query: { limit: String(limit) }, parse: parseTopLines, loaded });
  return { ...report, source };
}
