import { ExternalLink } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { ChartAccount, Transaction } from '../../types';
import { isPostable, isTransactionInDateRange } from '../../lib/txFilters';
import type { AccountGroupLayoutRow } from '../../lib/accountGroups';
import { AccountGroupRow, AccountGroupSubtotal } from './AccountGroupControls';
import type { ExplainRequest } from '../layout/DrillDownModal';

export interface BalanceSheetDrillTarget {
  accountName: string;
  transactions: Transaction[];
  explain?: ExplainRequest;
}

interface BalanceSheetAccountRowsProps {
  /** The section's rows (parents, children, subtotals) for the sort and the open groups. */
  rows: AccountGroupLayoutRow<ChartAccount>[];
  /** Subtotal per account group, from `groupSubtotals`. */
  subtotals: Map<string, { amount: number }>;
  /** This section's balance per account id, on the report date. */
  balances: Record<string, number>;
  /** The same on the prior date (only read when comparative). */
  priorBalances: Record<string, number>;
  isComparative: boolean;
  /** Which way moves the balance the wrong way in this section (assets up, claims down). */
  greenWhen: 'up' | 'down';
  /** Shown under an account that has no category of its own. */
  fallbackCategory: string;
  formatCurrency: (cents: number) => string;
  collapsedGroups: Set<string>;
  onToggleGroup: (accountId: string) => void;
  onDrillDown: (target: BalanceSheetDrillTarget) => void;
  transactions: Transaction[];
  asOfDate: string;
}

/**
 * One balance-sheet section's accounts: the assets, the liabilities and the equity all print the
 * same row — code, name, category, the balance, the prior figure and its change — so this is the
 * only place that row is written. A group's subtotal stops the list where its children end.
 */
export function BalanceSheetAccountRows({
  rows, subtotals, balances, priorBalances, isComparative, greenWhen, fallbackCategory,
  formatCurrency, collapsedGroups, onToggleGroup, onDrillDown, transactions, asOfDate,
}: BalanceSheetAccountRowsProps) {
  return (
    <>
      {rows.map(row => {
        if (row.kind === 'subtotal') return (
          <AccountGroupSubtotal key={row.key} label={row.label} depth={row.depth}
            amount={subtotals.get(row.member.id)?.amount || 0} formatMoney={formatCurrency} />
        );
        const acc = row.member;
        const curVal = balances[acc.id] || 0;
        const prVal = isComparative ? priorBalances[acc.id] || 0 : curVal;
        const pct = variancePct(curVal, prVal);
        const green = greenWhen === 'up' ? pct !== null && pct >= 0 : pct !== null && pct <= 0;

        return (
          <AccountGroupRow key={row.key} depth={row.depth} hasChildren={row.hasChildren} label={acc.name}
            expanded={!collapsedGroups.has(acc.id)}
            onToggle={() => onToggleGroup(acc.id)}>
            <button
              type="button" onClick={() => {
                const matchedTxs = transactions.filter(t => isPostable(t) && isTransactionInDateRange(t, undefined, asOfDate) && t.lines?.some(l => l.accountId === acc.id || l.accountName === acc.name));
                onDrillDown({ accountName: acc.name, transactions: matchedTxs, explain: { accountIds: [acc.id], endDate: asOfDate || undefined, expectedCents: curVal, sign: greenWhen === 'up' ? 1 : -1 } });
              }}
              title={`Click to drill down into ${acc.name}`}
              className="w-full text-start flex justify-between items-center hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20 p-2 rounded-lg transition-all border border-transparent hover:border-indigo-300 dark:hover:border-indigo-800 min-w-0 cursor-pointer group/row"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 bg-[var(--ink)] text-[var(--muted)] rounded-md flex items-center justify-center text-[9px] font-bold font-mono border border-[var(--line)] shrink-0">
                  {acc.code}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-[var(--text)] group-hover/row:text-indigo-600 transition-colors uppercase tracking-tight truncate flex items-center gap-1.5">
                    <span className="truncate" title={acc.name}>{acc.name}</span>
                    <ExternalLink aria-hidden="true" size={10} className="opacity-0 group-hover/row:opacity-100 text-indigo-500 transition-opacity" />
                  </p>
                  <p className="text-[9px] font-bold text-[var(--muted)] uppercase tracking-wider truncate">{acc.category || fallbackCategory}</p>
                </div>
              </div>
              <div className="flex flex-col items-end shrink-0 ms-2">
                <span className="font-mono font-bold text-[var(--text)] text-xs tabular-nums whitespace-nowrap"><bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(curVal)}</bdi></span>
                {isComparative && (
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="font-mono text-[8px] text-[var(--muted)] tabular-nums whitespace-nowrap">prev: <bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(prVal)}</bdi></span>
                    {pct !== null && prVal !== 0 && (
                      <span className={cn('text-[8px] font-bold', green ? 'text-emerald-500' : 'text-rose-500')}>
                        {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
                      </span>
                    )}
                  </div>
                )}
              </div>
            </button>
          </AccountGroupRow>
        );
      })}
    </>
  );
}

/** The change against the prior figure, as the report shows it beside the balance. */
function variancePct(current: number, prior: number): number | null {
  return prior !== 0 ? ((current - prior) / Math.abs(prior)) * 100 : null;
}
