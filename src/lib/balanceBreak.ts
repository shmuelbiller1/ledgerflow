/**
 * Since when don't the books balance? (A-4, CA-34, AI #3)
 *
 * When the balance sheet doesn't balance, the answer used to be "somewhere in your history". This
 * finds the day it started by halving the range of dates that have entries: a balance is the same
 * on a day with no entries as on the day before, so only days that carry an entry (and the end
 * date) can be where it broke. Every probe runs the report code's own `computeBalanceSheet` — this
 * module computes no money of its own and keeps no second copy of the report rules — and the first
 * date whose figures are off is the answer.
 *
 * Then the entries of that day are added one at a time, and each entry's amount is what it changed
 * the difference by when it was added — so the numbers add up to that day's change, and the day's
 * biggest share is listed first. An entry can be off by zero and still be the cause: a line whose
 * account is not in the chart is left out of the sheet, and that shows as the amount the entry
 * takes out (and the missing account is named).
 *
 * Read-only: nothing here posts, repairs or changes anything.
 */
import type { ChartAccount, Transaction } from '../types';
import { computeBalanceSheet } from '../server/reports/computeReports';
import { isPostable, transactionDate } from './txFilters';
import { getLocalDateISO } from './utils';
import { byCodeUnit } from './codeUnitOrder';

export interface BalanceBreakEntry {
  transactionId: string;
  date: string;
  description: string;
  /** what this entry does to the difference: its own share of the imbalance, in cents */
  offCents: number;
  /** lines whose account is not in the chart of accounts (the sheet leaves them out) */
  missingAccounts: string[];
}

export interface BalanceBreakResult {
  /** whether the books balance at the end date */
  balanced: boolean;
  /** the date the search ran to (the workspace's today) */
  endDate: string;
  /** how far off the books are at the end date, in cents (0 when they balance) */
  differenceCents: number;
  /** the first date the books did not balance, or null when they always did */
  firstUnbalancedDate: string | null;
  /** the last date they still balanced before that, or null when no earlier entry exists */
  lastBalancedDate: string | null;
  /** how far off they already were before the break day (0 when it broke on the first day) */
  differenceBeforeCents: number;
  /** that day's entries, the biggest share first */
  entries: BalanceBreakEntry[];
  /** how many report probes the search used, for the sentence */
  probes: number;
}

/** The dates worth probing: every day a postable entry falls on, in order, then the end date. */
export function probeDates(transactions: Transaction[], endDate: string): string[] {
  const dates = new Set<string>();
  for (const tx of transactions) {
    if (!isPostable(tx)) continue;
    const date = transactionDate(tx);
    if (date && date <= endDate) dates.add(date);
  }
  dates.add(endDate);
  return [...dates].sort(byCodeUnit);
}

/** How far the balance sheet is off on a date, from the report code's own two totals. */
export function balanceDifferenceCents(accounts: ChartAccount[], transactions: Transaction[], endDate: string): number {
  const sheet = computeBalanceSheet(accounts, transactions, endDate);
  return sheet.totalAssets - sheet.totalClaims;
}

/**
 * The day the books stopped balancing, and what each entry of that day is off by. `endDate`
 * defaults to today; the search never looks past it.
 */
export function findBalanceBreak(accounts: ChartAccount[], transactions: Transaction[], endDate = getLocalDateISO()): BalanceBreakResult {
  const empty: BalanceBreakResult = {
    balanced: true, endDate, differenceCents: 0, firstUnbalancedDate: null, lastBalancedDate: null,
    differenceBeforeCents: 0, entries: [], probes: 0,
  };
  const dates = probeDates(transactions, endDate);
  if (dates.length === 0) return empty;

  let probes = 0;
  const balancedOn = (date: string): boolean => {
    probes += 1;
    const sheet = computeBalanceSheet(accounts, transactions, date);
    return sheet.isBalanced;
  };

  const last = dates[dates.length - 1];
  if (balancedOn(last)) return { ...empty, probes };

  // the last date is known to be off, so the first off date is at or before it: halve the range
  let low = 0;
  let high = dates.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (balancedOn(dates[middle])) low = middle + 1;
    else high = middle;
  }

  const firstUnbalancedDate = dates[low];
  const lastBalancedDate = low > 0 ? dates[low - 1] : null;
  const differenceCents = balanceDifferenceCents(accounts, transactions, last);

  // the entries of the break day, each with its own share of the difference (in the order they
  // come; the shares are per entry, so which one "gets" it does not depend on the others)
  const postable = transactions.filter(isPostable);
  const before = postable.filter(tx => transactionDate(tx) < firstUnbalancedDate);
  const thatDay = postable.filter(tx => transactionDate(tx) === firstUnbalancedDate);
  const missing = new Map<string, string[]>();
  for (const line of computeBalanceSheet(accounts, thatDay, firstUnbalancedDate).orphanedLines) {
    if (!line.transactionId) continue;
    missing.set(line.transactionId, [...(missing.get(line.transactionId) || []), line.accountId]);
  }

  const differenceBeforeCents = balanceDifferenceCents(accounts, before, firstUnbalancedDate);
  // add the day's entries one at a time: each entry's amount is what it changed the difference by
  const added = [...before];
  const entries: BalanceBreakEntry[] = thatDay.map(tx => {
    const differenceBeforeIt = balanceDifferenceCents(accounts, added, firstUnbalancedDate);
    added.push(tx);
    const after = balanceDifferenceCents(accounts, added, firstUnbalancedDate);
    const offCents = after - differenceBeforeIt;
    return {
      transactionId: tx.id,
      date: transactionDate(tx),
      description: tx.description || tx.id,
      offCents,
      missingAccounts: missing.get(tx.id) || [],
    };
  });
  entries.sort((a, b) => Math.abs(b.offCents) - Math.abs(a.offCents) || a.transactionId.localeCompare(b.transactionId));

  return { balanced: false, endDate: last, differenceCents, firstUnbalancedDate, lastBalancedDate, differenceBeforeCents, entries, probes };
}
