import { useCallback } from 'react';
import { computeMonthlyAverages, type MonthlyAverageSummary } from '../lib/reportGenerators';
import type { ChartAccount, Transaction } from '../types';
import type { RangeReportSource } from './useServerRangeReport';
import { useServerAccountReport } from './useServerBreakdown';

const parseSummary = (body: Record<string, unknown>): MonthlyAverageSummary | null => {
  const summary = body.summary as MonthlyAverageSummary | undefined;
  return summary && Array.isArray(summary.monthlyData) ? summary : null;
};

/**
 * L-123 step 4f: income and expense per month of `year` and their averages (computeMonthlyAverages), from the server
 * (GET /api/v1/balances/monthly-averages) when the loaded lists may be short; transfers are left out, as on screen.
 */
export function useServerMonthlyAverages(year: number): { summary: MonthlyAverageSummary; source: RangeReportSource } {
  const compute = useCallback((accounts: ChartAccount[], transactions: Transaction[]) => computeMonthlyAverages(accounts, transactions, year), [year]);
  const { report, source } = useServerAccountReport('monthly-averages', `${year}-01-01`, `${year}-12-31`, compute, parseSummary);
  return { summary: report, source };
}
