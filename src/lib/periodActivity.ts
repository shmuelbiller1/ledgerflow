/**
 * L-123 step 3e: activity per account per month (net, gross debits, gross credits, all base-currency cents), for the
 * screens that sum a month or a year rather than read a balance as of a day. The server answers it over every entry
 * (GET /api/v1/balances/activity, src/server/routes/balanceRoutes.ts); the browser folds its loaded entries into the
 * same shape. When the loaded list is capped (newest first), a month on or before the oldest loaded day's month may
 * be missing entries, so it is taken from the server; later months are fully loaded and come from the browser.
 */
import type { ChartAccount, Transaction } from '../types';
import { isPostable, lineAmount, transactionDate } from './txFilters';
import { isLockedDate, type LockException } from './periodLock';

export interface AccountActivity { net: number; debits: number; credits: number }
export interface MonthActivity {
  accounts: Record<string, AccountActivity>;
  /** postable entries dated in the month */
  entries: number;
  /** of them, entries whose lines do not add to zero */
  unbalanced: number;
}
/** month (YYYY-MM) → its activity; a month without postable entries is absent */
export type ActivityByMonth = Record<string, MonthActivity>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Folds the postable entries dated `from`…`to` (book dates, both included) into activity per month. */
export function activityByMonth(entries: Transaction[], from: string, to: string): ActivityByMonth {
  const out: ActivityByMonth = {};
  for (const tx of entries) {
    if (!tx || typeof tx !== 'object' || !isPostable(tx)) continue;
    const d = transactionDate(tx);
    if (!DATE.test(d) || d < from || d > to) continue;
    const month = out[d.slice(0, 7)] ||= { accounts: {}, entries: 0, unbalanced: 0 };
    month.entries++;
    let sum = 0;
    for (const line of tx.lines || []) {
      if (!line) continue;
      const cents = lineAmount(line, tx);
      sum += cents;
      if (typeof line.accountId !== 'string') continue;
      const a = month.accounts[line.accountId] ||= { net: 0, debits: 0, credits: 0 };
      a.net += cents;
      if (cents > 0) a.debits += cents;
      if (cents < 0) a.credits -= cents;
    }
    if (Math.abs(sum) > 0) month.unbalanced++;
  }
  return out;
}

/** The server's activity for a workspace over `from`…`to`, as the route answers it. */
export interface ServerActivity { workspaceId: string; from: string; to: string; months: ActivityByMonth; pendingReversal?: ActivityByMonth }

/**
 * The activity a screen sums over `from`…`to`: the loaded entries' fold, with each month on or before `cutoff`'s
 * month (the oldest loaded day, `openingCutoff`) replaced by the server's, when the server answered for this
 * workspace and range. Without an answer (not capped, not yet arrived, unreachable), the loaded entries' fold alone.
 */
/** An entry that belongs to document `id`: the document's own posting, or one made for it (a bill's or an invoice's). */
export const ofDocument = (t: Transaction, id: string): boolean =>
  t.id === id || t.metadata?.billId === id || t.metadata?.invoiceId === id;

/**
 * `entries` without the postings that saving document `id` again would replace: its postable entries that are not
 * reversals and that no reversal cancels (the ones billPosting reverses as `existingTxs`). Reversals, and the earlier
 * postings they cancel, stay: they remain in the books after the save.
 */
/** `base` plus `extra` for the months of `extra` after `afterMonth` (YYYY-MM): adjustments the server alone could make. */
export function addActivityAfter(base: ActivityByMonth, extra: ActivityByMonth | undefined, afterMonth: string): ActivityByMonth {
  if (!extra) return base;
  const out: ActivityByMonth = { ...base };
  for (const [m, a] of Object.entries(extra)) {
    if (m <= afterMonth) continue;
    const into = out[m] ? { ...out[m], accounts: { ...out[m].accounts } } : { entries: 0, unbalanced: 0, accounts: {} };
    into.entries += a.entries; into.unbalanced += a.unbalanced;
    for (const [id, x] of Object.entries(a.accounts)) {
      const y = into.accounts[id] || { net: 0, debits: 0, credits: 0 };
      into.accounts[id] = { net: y.net + x.net, debits: y.debits + x.debits, credits: y.credits + x.credits };
    }
    out[m] = into;
  }
  return out;
}

/** The id suffix of a reversal a save would post on a locked posting (#444); never stored. */
export const PENDING_REVERSAL = '~pending-reversal';

export interface PreviewLock {
  lockDate: string | null | undefined;
  lockException?: LockException | null;
  /** the day a save would post on (the reversal of a locked posting is dated today) */
  today: string;
}

export function withoutReplacedPostings(entries: Transaction[], id: string, history: Transaction[] = entries, lock?: PreviewLock): Transaction[] {
  const replaced = replacedPostingIds(history, id);
  if (!replaced.size) return entries;
  const kept = entries.filter(t => !replaced.has(t.id));
  if (!lock?.lockDate) return kept;
  // #444: a posting on a locked day is not taken out of its period; the save reverses it on `today`
  // (postingCore reversalDate). So it stays where it is and its pending reversal is added on today.
  const pending: Transaction[] = [];
  for (const t of history) {
    if (!replaced.has(t.id) || !isLockedDate(transactionDate(t), lock.lockDate, lock.lockException)) continue;
    pending.push({
      ...t, id: `${t.id}${PENDING_REVERSAL}`, date: lock.today,
      lines: (t.lines || []).map(l => ({ ...l, amountCents: -lineAmount(l, t), baseAmountCents: -lineAmount(l, t), exchangeRate: 1 })),
      metadata: { ...(t.metadata || {}), isReversal: true, reversesTxId: t.id },
    } as Transaction);
  }
  const lockedKept = entries.filter(t => replaced.has(t.id) && isLockedDate(transactionDate(t), lock.lockDate, lock.lockException));
  return [...kept, ...lockedKept, ...pending];
}

/** The ids of document `id`'s postings a save would replace, from `history`: pass its whole history, not a date range. */
export function replacedPostingIds(history: Transaction[], id: string): Set<string> {
  const mine = history.filter(t => ofDocument(t, id));
  const reversed = new Set(mine.filter(t => t.metadata?.isReversal).map(t => t.metadata?.reversesTxId || t.metadata?.reversedTransactionId));
  return new Set(mine.filter(t => isPostable(t) && !t.metadata?.isReversal && !reversed.has(t.id)).map(t => t.id));
}

export function mergedActivity(loaded: Transaction[], server: ServerActivity | null, from: string, to: string, cutoff: string, workspaceId?: string): ActivityByMonth {
  const own = activityByMonth(loaded, from, to);
  if (!server || !cutoff || server.from !== from || server.to !== to || (workspaceId && server.workspaceId !== workspaceId)) return own;
  const last = cutoff.slice(0, 7);
  const out: ActivityByMonth = {};
  for (const [m, a] of Object.entries(own)) if (m > last) out[m] = a;
  for (const [m, a] of Object.entries(server.months)) if (m <= last) out[m] = a;
  return out;
}

/** The months of `activity` in `from`…`to` (YYYY-MM, both included). */
const within = (activity: ActivityByMonth, fromMonth: string, toMonth: string) =>
  Object.entries(activity).filter(([m]) => m >= fromMonth && m <= toMonth).map(([, a]) => a);

/** Sum over the months `fromMonth`…`toMonth` of `pick(account activity)` for the accounts `include` accepts. */
export function sumActivity(activity: ActivityByMonth, fromMonth: string, toMonth: string, include: (accountId: string) => boolean, pick: (a: AccountActivity) => number): number {
  let total = 0;
  for (const month of within(activity, fromMonth, toMonth)) {
    for (const [id, a] of Object.entries(month.accounts)) if (include(id)) total += pick(a);
  }
  return total;
}

/** Postable entries and unbalanced entries over the months `fromMonth`…`toMonth`. */
export function countActivity(activity: ActivityByMonth, fromMonth: string, toMonth: string): { entries: number; unbalanced: number } {
  return within(activity, fromMonth, toMonth).reduce((c, m) => ({ entries: c.entries + m.entries, unbalanced: c.unbalanced + m.unbalanced }), { entries: 0, unbalanced: 0 });
}

/** An account's movement in its own direction (debit-natured accounts debit positive, the others credit positive). */
export const naturalNet = (account: ChartAccount | undefined, net: number) =>
  account && ['asset', 'expense', 'cost_of_goods'].includes(account.type) ? net : -net;

/** The last day (YYYY-MM-DD) of the month `month` (YYYY-MM), by the calendar, no clock involved. */
export function monthEnd(month: string): string {
  const [y, m] = [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
  const days = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return `${month}-${String(days).padStart(2, '0')}`;
}

/** A cheap signature (FNV-1a) of the loaded entries dated in or before `lastMonth`: id, update time, whether it posts, status, date, every line field (a void or an edit changes it). */
export function overlapRevision(transactions: Transaction[], lastMonth: string): string {
  let h = 0x811c9dc5;
  const mix = (text: string) => { for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); } };
  for (const tx of transactions) {
    if (!tx || typeof tx !== 'object' || transactionDate(tx).slice(0, 7) > lastMonth) continue;
    mix(`${tx.id}|${isPostable(tx) ? 'p' : 'n'}|${String((tx as { updatedAt?: unknown }).updatedAt ?? '')}|${tx.status}|${tx.date}|`);
    mix(JSON.stringify(tx.lines || []));
  }
  return (h >>> 0).toString(36);
}
