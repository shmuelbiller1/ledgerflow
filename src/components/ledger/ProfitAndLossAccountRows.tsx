import { ExternalLink } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Transaction } from '../../types';
import { isTransactionInDateRange } from '../../lib/txFilters';
import { fill, useReportText } from '../reporting/useReportText';
import type { AccountGroupLayoutRow, AccountGroupMember } from '../../lib/accountGroups';
import { AccountGroupRow, AccountGroupSubtotal } from './AccountGroupControls';
import type { ExplainRequest } from '../layout/DrillDownModal';

/** A P&L line as the report holds it, plus the id the account-group rows carry. */
export interface ProfitAndLossRow extends AccountGroupMember {
  id: string;
  name: string;
  code?: string;
  balance?: number;
}

interface ProfitAndLossAccountRowsProps<Row extends ProfitAndLossRow> {
  rows: AccountGroupLayoutRow<Row>[];
  subtotals: Map<string, { amount: number }>;
  /** The same accounts on the reference period (income and expenses read their own section). */
  priorAccounts?: Record<string, { balance: number }>;
  isComparative: boolean;
  /** Income reads an increase as good, an expense a decrease. */
  greenWhen: 'up' | 'down';
  drillSign: 1 | -1;
  formatCurrency: (cents: number) => string;
  collapsedGroups: Set<string>;
  onToggleGroup: (accountId: string) => void;
  onDrillDown: (target: { accountName: string; transactions: Transaction[]; explain?: ExplainRequest }) => void;
  transactions: Transaction[];
  startDate?: string;
  endDate?: string;
  labelFilter?: { dimensionId: string; value: string } | null;
}

/**
 * One section's P&L accounts (income, or expenses): code, name, balance and the change against the
 * reference period. Both sections print the same row, so it is written here once.
 */
export function ProfitAndLossAccountRows<Row extends ProfitAndLossRow>({
  rows, subtotals, priorAccounts, isComparative, greenWhen, drillSign, formatCurrency,
  collapsedGroups, onToggleGroup, onDrillDown, transactions, startDate, endDate, labelFilter,
}: ProfitAndLossAccountRowsProps<Row>) {
  const reportText = useReportText();
  return (
    <>
      {rows.map(row => {
        if (row.kind === 'subtotal') return (
          <AccountGroupSubtotal key={row.key} label={row.label} depth={row.depth}
            amount={subtotals.get(row.member.id)?.amount || 0} formatMoney={formatCurrency} />
        );
        const acc = row.member;
        const id = acc.id;
        const priorBalance = priorAccounts?.[id]?.balance || 0;
        const balance = acc.balance || 0;
        const variance = isComparative && priorBalance !== 0 ? ((balance - priorBalance) / Math.abs(priorBalance)) * 100 : null;
        const green = variance !== null && (greenWhen === 'up' ? variance >= 0 : variance <= 0);

        return (
          <AccountGroupRow key={row.key} depth={row.depth} hasChildren={row.hasChildren} label={acc.name}
            expanded={!collapsedGroups.has(id)}
            onToggle={() => onToggleGroup(id)}>
            <button
              type="button" onClick={() => {
                const matchedTxs = transactions.filter(t =>
                  isTransactionInDateRange(t, startDate, endDate) &&
                  t.lines?.some(l => l.accountId === id || l.accountName === acc.name)
                );
                onDrillDown({
                  accountName: acc.name,
                  transactions: matchedTxs,
                  // N-12: explained from the server, adding up to this figure
                  explain: { accountIds: [id], startDate: startDate || undefined, endDate: endDate || undefined, expectedCents: balance, sign: drillSign, ...(labelFilter ? { labelFilter } : {}) }
                });
              }}
              title={fill(reportText('r.drill-into', 'Click to drill down into {name}'), { name: acc.name })}
              className="w-full text-start flex items-center justify-between p-3 bg-[var(--ink)]/50 rounded-lg border border-transparent hover:border-indigo-300 dark:hover:border-indigo-800 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20 transition-all group gap-4 min-w-0 cursor-pointer"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono text-[8px] font-bold text-[var(--muted)] bg-[var(--ink)] px-1.5 py-0.5 rounded border border-[var(--line)] uppercase shrink-0">{acc.code}</span>
                <span className="text-[var(--text)] font-bold group-hover:text-indigo-600 transition-colors uppercase tracking-tight text-xs break-words min-w-0 flex items-center gap-1.5">
                  {acc.name}
                  <ExternalLink aria-hidden="true" size={10} className="opacity-0 group-hover:opacity-100 text-indigo-500 transition-opacity" />
                </span>
              </div>
              <div className="flex flex-col items-end shrink-0">
                <span className="font-mono text-[var(--text)] text-xs font-semibold tabular-nums"><bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(balance)}</bdi></span>
                {isComparative && (
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="font-mono text-[8px] text-[var(--muted)] tabular-nums">{reportText('r.prev', 'prev: ')}<bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(priorBalance)}</bdi></span>
                    {variance !== null && (
                      <span className={cn('text-[9px] font-bold', green ? 'text-emerald-500' : 'text-rose-500')}>
                        {variance >= 0 ? '+' : ''}{variance.toFixed(1)}%
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
