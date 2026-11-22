/**
 * T-08: the "since filed" cell shared by the two journey reports — one filed registration's
 * box-by-box differences as words: every changed box with its filed and now figures and the delta.
 * An empty list says "nothing has changed"; `null` (no comparison: no filed copy with figures, or a
 * partial run) says nothing at all, which is not a claim that the return is unchanged.
 */
import type { ComponentType } from 'react';
import { formatCurrency } from '../../lib/utils';
import type { FiledReturnChange } from '../../lib/tax/filedReturns';

export type ReportText = (key: string, fallback: string) => string;

export const FilledChangesCell: ComponentType<{
  changes: FiledReturnChange[] | undefined;
  currency: string;
  reportText: ReportText;
}> = ({ changes, currency, reportText }) => {
  if (!changes) return null;
  if (changes.length === 0) {
    return <span className="text-xs text-[var(--muted)]">{reportText('r.nothing-has-changed-since-it-was-filed', 'Nothing has changed since it was filed.')}</span>;
  }
  return <ul className="text-xs space-y-0.5">{changes.map(c => (
    <li key={c.key} className="tabular-nums">
      {c.label} {reportText('r.filed', ': filed')} {formatCurrency(c.filedCents, currency)}
      {reportText('r.now', ', now')} {formatCurrency(c.nowCents, currency)}
      <span className={c.nowCents > c.filedCents ? 'text-[var(--danger)]' : 'text-[var(--muted)]'}>
        ({c.nowCents - c.filedCents > 0 ? '+' : ''}{formatCurrency(c.nowCents - c.filedCents, currency)})
      </span>
    </li>
  ))}</ul>;
};
