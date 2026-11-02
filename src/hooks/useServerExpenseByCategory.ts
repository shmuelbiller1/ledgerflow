import { computeExpenseByCategory, type CategoryExpenseBreakdown } from '../lib/reportGenerators';
import type { RangeReportSource } from './useServerRangeReport';
import { useServerBreakdown } from './useServerBreakdown';

/** L-123 step 4d: the expense breakdown by category (a line can carry its own), from the server when the loaded lists may be short. */
export function useServerExpenseByCategory(from: string | undefined, to: string | undefined): { categories: CategoryExpenseBreakdown[]; source: RangeReportSource } {
  const { rows, source } = useServerBreakdown('expense-by-category', 'categories', from, to, computeExpenseByCategory);
  return { categories: rows, source };
}
