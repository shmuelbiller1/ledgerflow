import { computeIncomeBySource, type IncomeBySourceBreakdown } from '../lib/reportGenerators';
import type { RangeReportRead } from './useServerRangeReport';
import { useServerBreakdown } from './useServerBreakdown';

/** L-123 step 4e: income by source (payee, else line description, else account), from the server when the loaded lists may be short. */
export function useServerIncomeBySource(from: string | undefined, to: string | undefined): { sources: IncomeBySourceBreakdown[] } & RangeReportRead {
  const { rows, ...read } = useServerBreakdown('income-by-source', 'sources', from, to, computeIncomeBySource);
  return { sources: rows, ...read };
}
