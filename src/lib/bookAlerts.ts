/**
 * Alerts about the books (S-08, S-10, S-11), sent by the nightly job to owners and accountants:
 * - a reminder to close last month, from a chosen day of the month, until it is closed (S-08);
 * - a budget overspent in its current month, quarter or year (S-10);
 * - the cash in the bank and cash accounts below a chosen amount (S-11), told once when it falls
 *   below and again only after it has been back above.
 * Owners and accountants choose them in Settings → Alerts; the server keeps what it already told
 * (`alertsSent`) so nobody is told the same thing twice. Pure helpers here.
 */
import type { ChartAccount, Transaction } from '../types';
import { balancesAsOf } from './closingSnapshot';
import { isCashAccount } from './txFilters';
import { monthEnd } from './periodLock';
import { budgetMonthAmount, computeBudgetActual, type SavedBudget } from './budgetActual';
import { byCodeUnit } from './codeUnitOrder';

export interface AlertSettings {
  /** Tell when the cash falls below this (home currency, cents); null or missing: off. */
  cashLowCents?: number | null;
  /** From this day of the month, remind to close last month (1–28); null: off; missing: the 5th. */
  closeReminderDay?: number | null;
  /** Tell when a budget is overspent (on unless turned off). */
  budgetAlerts?: boolean;
}

export interface AlertsSent {
  /** The month last reminded about (YYYY-MM). */
  closeReminder?: string;
  /** Cash is below the amount and that was told. */
  cashLow?: boolean;
  /** Budget id → the first month of the period already told about. */
  budgets?: Record<string, string>;
}

export const DEFAULT_CLOSE_REMINDER_DAY = 5;
export const MAX_ALERT_CENTS = 1_000_000_000_000;

export function alertSettingsProblem(input: unknown): string | null {
  const s = (input || {}) as Record<string, unknown>;
  if (s.cashLowCents !== undefined && s.cashLowCents !== null
    && (!Number.isSafeInteger(s.cashLowCents) || (s.cashLowCents as number) < 0 || (s.cashLowCents as number) > MAX_ALERT_CENTS)) return 'The cash amount must be a positive amount';
  if (s.closeReminderDay !== undefined && s.closeReminderDay !== null
    && (!Number.isInteger(s.closeReminderDay) || (s.closeReminderDay as number) < 1 || (s.closeReminderDay as number) > 28)) return 'The reminder day must be between 1 and 28';
  if (s.budgetAlerts !== undefined && typeof s.budgetAlerts !== 'boolean') return 'Budget alerts are on or off';
  return null;
}

export function previousMonth(today: string): string {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** The month to remind about closing today, or null (not the day yet, already closed, already told, off). */
export function closeReminderMonth(
  ws: { lockDate?: string | null; softLockDate?: string | null; alerts?: AlertSettings; alertsSent?: AlertsSent },
  today: string,
): string | null {
  const day = ws.alerts?.closeReminderDay === null ? null : (ws.alerts?.closeReminderDay ?? DEFAULT_CLOSE_REMINDER_DAY);
  if (day === null || Number(today.slice(8, 10)) < day) return null;
  const month = previousMonth(today);
  const closedThrough = [ws.lockDate || '', ws.softLockDate || ''].sort(byCodeUnit).pop() || '';
  if (closedThrough >= monthEnd(month)) return null;
  if (ws.alertsSent?.closeReminder === month) return null;
  return month;
}

/** Cash today: the bank and cash accounts in the home currency, by the ledger. */
export function cashPosition(accounts: ChartAccount[], transactions: Transaction[], today: string, currency: string): number {
  const cash = accounts.filter(a => isCashAccount(a) && !a.isArchived && (!a.currency || a.currency === currency));
  const { balances } = balancesAsOf(cash, transactions, today);
  return cash.reduce((sum, a) => sum + (balances[a.id] || 0), 0);
}

/** What to do about low cash: tell, forget it was told (back above, or turned off), or nothing. */
export function cashLowAction(settings: AlertSettings | undefined, sent: AlertsSent | undefined, cashCents: number): 'tell' | 'reset' | null {
  const threshold = settings?.cashLowCents;
  if (threshold === undefined || threshold === null) return sent?.cashLow ? 'reset' : null;
  if (cashCents < threshold) return sent?.cashLow ? null : 'tell';
  return sent?.cashLow ? 'reset' : null;
}

const SPAN: Record<string, number> = { monthly: 1, quarterly: 3, yearly: 12 };

/** The months of the budget's period that holds `month` (its month, quarter or year), or null. */
export function budgetPeriodMonths(budget: SavedBudget, month: string): string[] | null {
  const dated = /^\d{4}(-\d{2})?$/.test(budget.period);
  const span = dated ? (budget.period.length === 4 ? 12 : 1) : SPAN[budget.period];
  if (!span) return null;
  if (dated && !month.startsWith(budget.period)) return null;
  const origin = dated ? `${budget.period.slice(0, 4)}-${budget.period.length === 7 ? budget.period.slice(5, 7) : '01'}` : (budget.startDate || budget.createdAt || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(origin) || month < origin) return null;
  const index = (Number(month.slice(0, 4)) - Number(origin.slice(0, 4))) * 12 + Number(month.slice(5, 7)) - Number(origin.slice(5, 7));
  const first = index - (index % span);
  return Array.from({ length: span }, (_, i) => {
    const n = Number(origin.slice(0, 4)) * 12 + Number(origin.slice(5, 7)) - 1 + first + i;
    return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`;
  });
}

export interface OverBudget { budget: SavedBudget; account: ChartAccount; firstMonth: string; budgetCents: number; actualCents: number }

/** Account budgets whose period so far (up to today) spent more than the whole period's budget. */
export function budgetsOver(budgets: SavedBudget[], accounts: ChartAccount[], transactions: Transaction[], today: string): OverBudget[] {
  const month = today.slice(0, 7);
  const over: OverBudget[] = [];
  for (const budget of budgets) {
    const months = budgetPeriodMonths(budget, month);
    if (!months) continue;
    const budgetCents = months.reduce((sum, m) => sum + budgetMonthAmount(budget, m), 0);
    if (budgetCents <= 0) continue;
    const result = computeBudgetActual(budget, accounts, transactions, [{ id: 'now', label: 'now', startDate: `${months[0]}-01`, endDate: today }]);
    if (!result) continue;
    const actualCents = result.columns[0].actualCents;
    if (actualCents > budgetCents) over.push({ budget, account: result.account, firstMonth: months[0], budgetCents, actualCents });
  }
  return over;
}
