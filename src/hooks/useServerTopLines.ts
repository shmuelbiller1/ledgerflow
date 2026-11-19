import { useCallback } from 'react';
import type { ChartAccount, Transaction } from '../types';
import { useServerAccountReport } from './useServerBreakdown';
import { computeTopExpensesAndIncome } from '../lib/reportGenerators';
import type { TopLines } from '../lib/serverTopLines';
import type { RangeReportRead } from './useServerRangeReport';

const parseTopLines = (body: Record<string, unknown>): TopLines | null => (Array.isArray(body.topExpenses) && Array.isArray(body.topIncome)
  ? { topExpenses: body.topExpenses as TopLines['topExpenses'], topIncome: body.topIncome as TopLines['topIncome'] }
  : null);

/**
 * L-123 step 4a: the largest single expense and income lines over `from`…`to` (src/lib/serverTopLines.ts). When the
 * loaded list is capped and the range reaches the oldest loaded day, lines may be missing from it, so the whole list
 * comes from the server (GET /api/v1/balances/top-lines, through useServerRangeReport). `source` says which.
 */
export function useServerTopLines(from: string | undefined, to: string | undefined, limit: number): TopLines & RangeReportRead {
  const compute = useCallback((accounts: ChartAccount[], transactions: Transaction[]) =>
    computeTopExpensesAndIncome(accounts, transactions, limit, from, to), [limit, from, to]);
  const { report, ...read } = useServerAccountReport('top-lines', from, to, compute, parseTopLines, { limit: String(limit) });
  return { ...report, ...read };
}
