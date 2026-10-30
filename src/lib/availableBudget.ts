/**
 * Available budget (M-20): when money is about to be spent on an account, how much of its budget is
 * left for the period that date falls in (a month, a quarter or a year, as the budget is set), and
 * whether this amount would go over. Spent is what the books already show on the account in that
 * period (src/lib/budgetActual.ts); the budget is the same amount the Budget vs Actual report uses.
 */
import type { ChartAccount, Transaction } from '../types';
import { budgetMonthAmount, computeBudgetActual, type SavedBudget } from './budgetActual';
import { budgetPeriodMonths } from './bookAlerts';
import { naturalNet, sumActivity, withoutReplacedPostings, type ActivityByMonth, type PreviewLock } from './periodActivity';

export interface AvailableBudget {
  name: string;
  /** e.g. "October 2026", "Oct–Dec 2026", "2026" */
  period: string;
  budgetCents: number;
  spentCents: number;
  leftCents: number;
  /** this amount would take spending past the budget */
  wouldExceed: boolean;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function label(months: string[]): string {
  const [y1, m1] = [months[0].slice(0, 4), Number(months[0].slice(5, 7))];
  const last = months[months.length - 1];
  const [y2, m2] = [last.slice(0, 4), Number(last.slice(5, 7))];
  if (months.length === 1) return `${FULL[m1 - 1]} ${y1}`;
  if (months.length === 12 && m1 === 1) return y1;
  return y1 === y2 ? `${MONTHS[m1 - 1]}–${MONTHS[m2 - 1]} ${y1}` : `${MONTHS[m1 - 1]} ${y1}–${MONTHS[m2 - 1]} ${y2}`;
}

const lastDay = (month: string) => {
  const [y, m] = [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
  const days = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return `${month}-${String(days).padStart(2, '0')}`;
};

/** The budget left on `accountId` for the period `date` falls in, or null when it has no budget then. */
export function availableBudget(input: {
  budgets: SavedBudget[]; accounts: ChartAccount[]; transactions: Transaction[];
  accountId: string; date: string; addingCents?: number;
  /** the document being edited: its own posting is not counted as already spent */
  excludeDocumentId?: string;
  /**
   * L-123 step 3e: the activity per month that includes the server's months (useServerActivity), given only when the
   * loaded entries are capped: spent is then the account's net movement in the period from it. That activity already
   * leaves the edited document out, on the server's months too (useServerActivity's excludeDocumentId), so a posting
   * older than the loaded entries is not counted twice. Without it, spent is summed from the loaded entries as before.
   */
  activity?: ActivityByMonth;
  /** #444: the workspace lock, so a posting on a locked day stays in its period and its reversal lands today */
  lock?: PreviewLock;
}): AvailableBudget | null {
  if (!input.accountId || !/^\d{4}-\d{2}-\d{2}/.test(input.date)) return null;
  const month = input.date.slice(0, 7);
  const account = input.accounts.find(a => a.id === input.accountId);
  if (!account) return null;
  const exclude = input.excludeDocumentId;
  const transactions = exclude ? withoutReplacedPostings(input.transactions, exclude, input.transactions, input.lock) : input.transactions;
  for (const budget of input.budgets) {
    if (budget.targetType !== 'account') continue;
    const target = String(budget.targetId).toLocaleLowerCase();
    if (budget.targetId !== account.id && target !== account.name.toLocaleLowerCase() && target !== String(account.code || '').toLocaleLowerCase()) continue;
    const months = budgetPeriodMonths(budget, month);
    if (!months) continue;
    const budgetCents = months.reduce((sum, m) => sum + budgetMonthAmount(budget, m), 0);
    if (budgetCents <= 0) continue;
    if (input.activity) {
      const [first, last] = [months[0], months[months.length - 1]];
      const spentCents = naturalNet(account, sumActivity(input.activity, first, last, id => id === account.id, a => a.net));
      const leftCents = budgetCents - spentCents;
      return { name: budget.name || account.name, period: label(months), budgetCents, spentCents, leftCents, wouldExceed: (input.addingCents || 0) > leftCents };
    }
    const result = computeBudgetActual(budget, input.accounts, transactions, [{ id: 'period', label: 'period', startDate: `${months[0]}-01`, endDate: lastDay(months[months.length - 1]) }]);
    if (!result) continue;
    const spentCents = result.columns[0].actualCents;
    const leftCents = budgetCents - spentCents;
    return { name: budget.name || account.name, period: label(months), budgetCents, spentCents, leftCents, wouldExceed: (input.addingCents || 0) > leftCents };
  }
  return null;
}
