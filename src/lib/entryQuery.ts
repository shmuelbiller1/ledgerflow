import type { Transaction } from '../types';
import { getAbsoluteTotal, isPostable, isTransactionInDateRange } from './txFilters';
import { normalizeSearchText } from './textNormalization';

/** The Query screen's filter (the fields of a saved view it uses); browser and server share it. */
export interface EntryQuery {
  searchTerm?: string;
  startDate?: string;
  endDate?: string;
  minAmountCents?: number;
  maxAmountCents?: number;
  accountIds?: string[];
}

/** Whether a posted entry matches the query (date range, any of the accounts, total between the bounds, text). */
export function entryMatches(tx: Transaction, q: EntryQuery): boolean {
  if (!isPostable(tx)) return false;
  if ((q.startDate || q.endDate) && !isTransactionInDateRange(tx, q.startDate, q.endDate)) return false;
  if (q.accountIds && q.accountIds.length > 0) {
    const ids = (tx.lines || []).map(l => l.accountId);
    if (!q.accountIds.some(id => ids.includes(id))) return false;
  }
  const total = getAbsoluteTotal(tx);
  if (q.minAmountCents !== undefined && total < q.minAmountCents) return false;
  if (q.maxAmountCents !== undefined && total > q.maxAmountCents) return false;
  if (q.searchTerm) {
    // Hebrew marks and direction controls aside, as everywhere else text is searched (CodeRabbit on #516)
    const term = normalizeSearchText(q.searchTerm);
    const has = (text: string | undefined) => normalizeSearchText(text).includes(term);
    const hit = has(tx.description) || has(tx.payee) || (tx.lines || []).some(l => has(l.accountName) || has(l.description));
    if (!hit) return false;
  }
  return true;
}

/** The most matches the server sends back; `total` still counts them all. */
/** the longest search text the entry query takes (the route refuses longer; QueryView stops the field there) */
export const ENTRY_QUERY_TEXT_MAX = 200;

export const ENTRY_QUERY_LIMIT = 1000;

/**
 * A typed amount ("19.99", "5000000000.004") in cents, from the text itself rather than by multiplying a float by 100,
 * so no float noise reaches the bound: whole cents come back as integers, and any part cent stays as a fraction
 * (19.994 → 1999.4) for the caller to round toward its bound. Undefined when the text is not a plain amount.
 */
export function typedAmountCents(text: string): number | undefined {
  const m = /^\s*(-?)(\d*)(?:\.(\d*))?\s*$/.exec(text);
  if (!m || (!m[2] && !m[3])) return undefined;
  const frac = m[3] || '';
  const whole = Number(m[2] || '0') * 100 + Number((frac + '00').slice(0, 2));
  const rest = frac.length > 2 ? Number(`0.${frac.slice(2)}`) : 0;
  const cents = whole + rest;
  if (!Number.isFinite(cents)) return undefined;
  return m[1] ? -cents : cents;
}
