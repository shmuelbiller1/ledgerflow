import { computeTagReport, type TagBreakdown } from '../lib/reportGenerators';
import type { RangeReportSource } from './useServerRangeReport';
import { useServerBreakdown } from './useServerBreakdown';

/** L-123 step 4g: income and expense by tag (entry and line tags), from the server when the loaded lists may be short. */
export function useServerTagBreakdown(from: string | undefined, to: string | undefined): { tags: TagBreakdown[]; source: RangeReportSource } {
  const { rows, source } = useServerBreakdown('tag-breakdown', 'tags', from, to, computeTagReport);
  return { tags: rows, source };
}
