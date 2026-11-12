/**
 * EU-E4: one label filter for the reports that can honour it. An entry is kept with only its lines that carry the
 * label value (the P&L's AU-2 rule, `lineHasLabel`: the line's own label, else the entry's), so a report built from
 * the kept lines shows that value alone. Entries with no such line drop out.
 */
import type { DimensionNode, Transaction } from '../types';
import { lineHasLabel } from './dimensionUtils';

export interface ReportLabelFilterValue { dimensionId: string; value: string }

export function scopeTransactionsToLabel<T extends Transaction>(transactions: readonly T[], filter: ReportLabelFilterValue | null, nodes: readonly DimensionNode[] = []): T[] {
  if (!filter) return [...transactions];
  const scoped: T[] = [];
  for (const t of transactions) {
    const lines = (t.lines || []).filter(l => lineHasLabel(l, t, filter, nodes));
    if (lines.length) scoped.push({ ...t, lines });
  }
  return scoped;
}
