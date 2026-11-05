import type { Transaction } from '../types';
import { getAbsoluteTotal, isPostable, isTransactionInDateRange } from './txFilters';

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
    const term = q.searchTerm.toLowerCase();
    const hit = (tx.description || '').toLowerCase().includes(term) || (tx.payee || '').toLowerCase().includes(term)
      || (tx.lines || []).some(l => (l.accountName || '').toLowerCase().includes(term) || (l.description || '').toLowerCase().includes(term));
    if (!hit) return false;
  }
  return true;
}

/** The most matches the server sends back; `total` still counts them all. */
export const ENTRY_QUERY_LIMIT = 1000;
