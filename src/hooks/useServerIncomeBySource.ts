import { computeIncomeBySource, type IncomeBySourceBreakdown } from '../lib/reportGenerators';
import type { RangeReportSource } from './useServerRangeReport';
import { useServerBreakdown } from './useServerBreakdown';

/** L-123 step 4e: income by source (payee, else line description, else account), from the server when the loaded lists may be short. */
export function useServerIncomeBySource(from: string | undefined, to: string | undefined): { sources: IncomeBySourceBreakdown[]; source: RangeReportSource } {
  const { rows, source } = useServerBreakdown('income-by-source', 'sources', from, to, computeIncomeBySource);
  return { sources: rows, source };
}
