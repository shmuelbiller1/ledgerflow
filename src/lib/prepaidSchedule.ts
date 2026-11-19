/**
 * Prepaid expenses spread over months (K-17): a year of insurance paid in September is not all
 * September's cost. Spreading a bill moves the amount from the expense to a Prepaid asset on the
 * bill's date, then back to the expense at the end of each month, one share a month: whole cents,
 * the remainder in the last month, so the shares always add up to the amount. Shared by the server
 * (src/server/services/prepaidService.ts) and the screen.
 */
import { resolveAccountRole } from './accountUtils';
import { convertMinorUnits } from './currencyMinorUnits';
import type { ChartAccount } from '../types';

export const MAX_SPREAD_MONTHS = 60;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** 'YYYY-MM' plus n months (integer maths, no time zones). */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const index = y * 12 + (m - 1) + n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** The last day of a 'YYYY-MM' month. */
export function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const days = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return `${month}-${String(days).padStart(2, '0')}`;
}

/** `totalCents` in `parts` whole-cent shares; the last one takes the remainder. */
export function splitEvenly(totalCents: number, parts: number): number[] {
  const share = Math.floor(totalCents / parts);
  return Array.from({ length: parts }, (_, i) => (i === parts - 1 ? totalCents - share * (parts - 1) : share));
}

export interface SpreadInput {
  /** The bill's date: the amount moves to Prepaid on this day. */
  date: string;
  amountCents: number;
  months: number;
  /** The first month that carries a share ('YYYY-MM'); not before the bill's month. */
  startMonth: string;
}

/** Why the spread can't be made, or null when it can. */
export function spreadProblem(input: SpreadInput, maxCents?: number, word: 'bill' | 'invoice' = 'bill'): string | null {
  if (!DAY.test(input.date)) return `The ${word} has no valid date`;
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) return 'Enter the amount to spread';
  if (maxCents !== undefined && input.amountCents > maxCents) return `That is more than the ${word}`;
  if (!Number.isInteger(input.months) || input.months < 2 || input.months > MAX_SPREAD_MONTHS) return `Spread over 2 to ${MAX_SPREAD_MONTHS} months`;
  if (!MONTH.test(input.startMonth)) return 'Choose the first month';
  if (input.startMonth < input.date.slice(0, 7)) return `The first month cannot be before the ${word}`;
  return null;
}

/** The month-end dates and shares of a spread. */
export function spreadPlan(input: SpreadInput): Array<{ date: string; amountCents: number; installment: number }> {
  return splitEvenly(input.amountCents, input.months).map((amountCents, i) => ({ date: monthEnd(addMonths(input.startMonth, i)), amountCents, installment: i + 1 }));
}

/** The Prepaid Expenses asset (Settings → Defaults, else an asset account named "prepaid"), or undefined. */
export function prepaidAccount(accounts: ChartAccount[], mappings?: Record<string, string | undefined>): ChartAccount | undefined {
  const usable = accounts.filter(a => !a.isArchived && a.isActive !== false);
  return usable.find(a => a.id === mappings?.['prepaid expenses'] && resolveAccountRole(a) === 'asset')
    || usable.find(a => resolveAccountRole(a) === 'asset' && /prepaid|prepayment/i.test(a.name || '') && !/vendor/i.test(a.name || ''));
}

interface BillLines {
  amountCents?: number;
  currency?: string;
  exchangeRate?: number;
  items?: Array<{ accountId?: string; amountCents?: number }>;
  splits?: Array<{ accountId?: string; amountCents?: number }>;
}

/**
 * The document's biggest line on an account of `role` (expense for a bill, revenue for an invoice) in
 * the home currency (what is usually spread), or undefined. `fallbackAccountId` takes lines without
 * an account of their own (they post to the default one).
 */
export function documentLine(doc: BillLines, accounts: ChartAccount[], role: 'expense' | 'revenue', fallbackAccountId?: string, homeCurrency?: string): { accountId: string; baseCents: number } | undefined {
  const rate = typeof doc.exchangeRate === 'number' && doc.exchangeRate > 0 ? doc.exchangeRate : 1;
  const fits = new Set(accounts.filter(a => resolveAccountRole(a) === role).map(a => a.id));
  const byAccount = new Map<string, number>();
  for (const line of [...(doc.items || []), ...(doc.splits || [])]) {
    const accountId = line.accountId || fallbackAccountId;
    if (accountId && fits.has(accountId)) byAccount.set(accountId, (byAccount.get(accountId) || 0) + (Number(line.amountCents) || 0));
  }
  // the rate is per major unit, so yen and dinars scale by their own minor units (#844)
  const toHome = (cents: number) => convertMinorUnits(cents, rate, doc.currency || homeCurrency, homeCurrency);
  const [best] = [...byAccount.entries()].sort((a, b) => b[1] - a[1]);
  return best ? { accountId: best[0], baseCents: Math.min(toHome(best[1]), toHome(Number(doc.amountCents) || 0)) } : undefined;
}

/** The bill's biggest expense line (K-17). */
export const billExpenseLine = (bill: BillLines, accounts: ChartAccount[]) => documentLine(bill, accounts, 'expense');

/** The Deferred Revenue liability (Settings → Defaults, else a liability named "deferred/unearned revenue"), or undefined. */
export function deferredRevenueAccount(accounts: ChartAccount[], mappings?: Record<string, string | undefined>): ChartAccount | undefined {
  const usable = accounts.filter(a => !a.isArchived && a.isActive !== false);
  const isLiability = (a: ChartAccount) => resolveAccountRole(a) === 'liability' || a.type === 'liability';
  return usable.find(a => a.id === mappings?.['deferred revenue'] && isLiability(a))
    || usable.find(a => isLiability(a) && /deferred (revenue|income)|unearned (revenue|income)/i.test(a.name || ''));
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Spread over 12 months from Sep 2026 · 2 of 12 taken", as of `today`. */
export function spreadProgress(schedule: { months: number; startMonth: string }, today: string): string {
  const [y, m] = schedule.startMonth.split('-').map(Number);
  const name = `${MONTH_NAMES[m - 1]} ${y}`;
  const taken = Array.from({ length: schedule.months }, (_, i) => monthEnd(addMonths(schedule.startMonth, i))).filter(d => d <= today).length;
  return `Spread over ${schedule.months} months from ${name} · ${taken} of ${schedule.months} taken`;
}
