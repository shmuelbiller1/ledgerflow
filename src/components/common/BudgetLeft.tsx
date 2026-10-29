import React, { useMemo } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { availableBudget } from '../../lib/availableBudget';
import type { SavedBudget } from '../../lib/budgetActual';
import { formatCurrency } from '../../lib/utils';
import { useServerActivity } from '../../hooks/useServerActivity';
import { monthEnd } from '../../lib/periodActivity';

/** Every month a budget period (at most 12 months) holding `date` can span: 11 months either side, first to last day. */
function budgetWindow(date: string): [string, string] {
  if (!/^\d{4}-\d{2}/.test(date)) return ['', ''];
  const n = Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
  const month = (k: number) => `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, '0')}`;
  return [`${month(n - 11)}-01`, monthEnd(month(n + 11))];
}

/**
 * Available budget (M-20) under an expense account where money is entered: "Rent, October 2026:
 * $800.00 left of $2,000.00", amber when this amount would go over. Nothing when the account has no
 * budget for that date. Amounts in the home currency.
 */
export function BudgetLeft({ accountId, date, addingCents = 0, excludeDocumentId, currency }: { accountId: string; date: string; addingCents?: number; excludeDocumentId?: string; currency?: string }) {
  useLedgerCollections('budgets');
  const budgets = useLedgerStore(s => s.budgets) as SavedBudget[];
  const accounts = useLedgerStore(s => s.accounts);
  const transactions = useLedgerStore(s => s.transactions);
  // L-123 step 3e: when the loaded entries are capped, the months they may miss are the server's
  const [from, to] = budgetWindow(date);
  const { activity, serverMonths } = useServerActivity(from, to, excludeDocumentId);
  const left = useMemo(() => availableBudget({ budgets: budgets || [], accounts: accounts || [], transactions: transactions || [], accountId, date, addingCents, excludeDocumentId, ...(serverMonths ? { activity } : {}) }),
    [budgets, accounts, transactions, accountId, date, addingCents, excludeDocumentId, serverMonths, activity]);
  if (!left) return null;
  const money = (cents: number) => formatCurrency(cents, currency);
  const over = left.leftCents < 0;
  return (
    <p role="status" className={`text-[11px] ${left.wouldExceed || over ? 'text-amber-700 font-semibold' : 'text-[var(--muted)]'}`}>
      {left.name}, {left.period}: {over ? `${money(-left.leftCents)} over` : `${money(left.leftCents)} left`} of {money(left.budgetCents)}
      {left.wouldExceed && !over ? `; this goes ${money(addingCents - left.leftCents)} over` : ''}
    </p>
  );
}
