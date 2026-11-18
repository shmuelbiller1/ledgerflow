import { ChevronDown, ChevronRight } from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { ACCOUNT_GROUP_INDENT_PX } from '../../lib/accountGroups';

/**
 * Account groups (K-14): the chevron that hides or shows the accounts inside a group. Each report
 * keeps its own rows and figures; these three pieces are only the controls and the spacing, so a
 * group opens the same way on the P&L, the balance sheet, the trial balance and the statement
 * columns, and a subtotal always looks like a subtotal.
 */
export function AccountGroupToggle({ label, expanded, onToggle, className }: {
  /** The group's account name, so the control says what it opens. */
  label: string;
  /** False while the accounts inside are hidden. */
  expanded: boolean;
  onToggle: (event: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
}) {
  const text = `${expanded ? 'Hide' : 'Show'} the accounts inside ${label}`;
  return (
    <button type="button" onClick={onToggle} aria-expanded={expanded} aria-label={text} title={text}
      className={cn('p-1 rounded text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--ink)] transition-colors shrink-0 cursor-pointer self-center', className)}>
      {expanded ? <ChevronDown aria-hidden="true" size={13} /> : <ChevronRight aria-hidden="true" size={13} className="rtl:rotate-180" />}
    </button>
  );
}

/**
 * One account row of a report card: indented by its level, with the group's chevron beside it (or
 * the same space without it, so the accounts of a section line up).
 */
export function AccountGroupRow({ depth, hasChildren, label, expanded, onToggle, children, className }: {
  depth: number;
  hasChildren: boolean;
  label: string;
  expanded: boolean;
  onToggle: (event: MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-stretch gap-1 min-w-0', className)} style={{ paddingInlineStart: `${depth * ACCOUNT_GROUP_INDENT_PX}px` }}>
      {hasChildren
        ? <AccountGroupToggle label={label} expanded={expanded} onToggle={onToggle} />
        : <span aria-hidden="true" className="w-[21px] shrink-0" />}
      {children}
    </div>
  );
}

/** A group's subtotal: the accounts inside it added up, and nothing else, so no total changes. */
export function AccountGroupSubtotal({ label, depth, amount, formatMoney, className }: {
  label: string;
  depth: number;
  amount: number;
  formatMoney: (cents: number) => string;
  className?: string;
}) {
  return (
    <div className={cn('flex justify-between items-center gap-2 px-2 py-1 mt-1 border-t border-[var(--line)] text-[9px] font-bold uppercase tracking-wider text-[var(--muted)]', className)}
      style={{ marginInlineStart: `${depth * ACCOUNT_GROUP_INDENT_PX}px` }}>
      <span className="truncate">{label}</span>
      <span className="font-mono tabular-nums shrink-0"><bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatMoney(amount)}</bdi></span>
    </div>
  );
}
