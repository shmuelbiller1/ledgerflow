/**
 * Month-end close checklist (R-01, R-08). Pure: computed from the month's data, the same way on
 * every screen. Each item is done, needs attention (someone reviews it and signs it off, R-02),
 * or blocks the close (drafts dated in the month would be stuck once it closes; an unbalanced
 * trial balance means the books are wrong). The server refuses a close with drafts in it too.
 */
import type { Bill, FixedAsset, Invoice, Transaction } from '../types';
import { isPostable, lineAmount } from './txFilters';
import { addDaysYMD } from './fiscalCalendar';
import { monthEnd } from './periodLock';
import { depreciationThrough } from './depreciationEngine';
import { findPostingMismatches } from './postingCheck';
import type { PostingMismatch } from './postingCheck';

export const CLOSE_CHECKLIST_ITEMS = [
  { id: 'drafts', title: 'Drafts dated in the month' },
  { id: 'categorize', title: 'Every transaction has an account' },
  { id: 'reconcile', title: 'Bank lines matched' },
  { id: 'trial-balance', title: 'Trial balance balances' },
  { id: 'anomalies', title: 'Flagged transactions reviewed' },
  { id: 'aging', title: 'Old receivables and payables reviewed' },
  { id: 'depreciation', title: 'Depreciation posted' },
  { id: 'postings', title: 'Invoices and bills match the ledger' },
] as const;

export type CloseItemId = typeof CLOSE_CHECKLIST_ITEMS[number]['id'];
export const CLOSE_ITEM_IDS: readonly string[] = CLOSE_CHECKLIST_ITEMS.map(i => i.id);

export type CloseItemStatus = 'done' | 'attention' | 'blocker';

export interface CloseItem {
  id: CloseItemId;
  title: string;
  status: CloseItemStatus;
  detail: string;
  count: number;
}

interface DatedDoc { date?: string; status?: string; deletedAt?: unknown }

export interface CloseChecklistInput {
  month: string;
  /** The books' currency (a workspace's `currency`); documents in another currency are converted. */
  baseCurrency?: string;
  transactions: Transaction[];
  bankLines: Array<{ date?: string; status?: string; matchedTransactionId?: string | null }>;
  invoices: Invoice[];
  bills: Bill[];
  journalEntries?: DatedDoc[];
  assets?: FixedAsset[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * AF13-002: an invoice or bill with one of these statuses is not owed by anyone, so it is not an
 * overdue receivable or payable. `cancelled` and `rejected` were missing: a cancelled invoice from
 * three months ago kept the month's "Old receivables and payables reviewed" item open (and needed a
 * sign-off) for money nobody owes. Same list the ledger and the server services use
 * (`CLOSED_DOCUMENT_STATUSES` in src/lib/txFilters.ts, `NOT_POSTED` in src/lib/postingCheck.ts).
 */
const NOT_OWED_STATUSES = new Set(['paid', 'void', 'draft', 'rejected', 'cancelled']);
const inMonth = (date: string | undefined, month: string) => !!date && date.slice(0, 7) === month;

export function buildCloseChecklist(input: CloseChecklistInput): CloseItem[] {
  const { month } = input;
  const end = monthEnd(month);
  const title = (id: CloseItemId) => CLOSE_CHECKLIST_ITEMS.find(i => i.id === id)!.title;
  const isDraft = (d: DatedDoc) => d.status === 'draft' && !d.deletedAt && inMonth(d.date, month);

  const drafts = [...input.transactions, ...input.invoices, ...input.bills, ...(input.journalEntries || [])].filter(d => isDraft(d as DatedDoc)).length;

  const posted = input.transactions.filter(t => isPostable(t) && inMonth(t.date, month));
  const uncategorized = posted.filter(t => (t.lines || []).some(l => !l.accountId || l.accountId === 'uncategorized')).length;

  const bankInMonth = input.bankLines.filter(l => inMonth(l.date, month));
  // AF13-003: an `ignored` line was looked at and deliberately left out of the books (a transfer
  // between the business's own accounts, a duplicate). Counting it as "not matched yet" kept the
  // month's "Bank lines matched" item open for something that is finished.
  const unmatched = bankInMonth.filter(l => l.status !== 'ignored' && (l.status === 'pending' || !l.matchedTransactionId)).length;
  const countedBankLines = bankInMonth.filter(l => l.status !== 'ignored').length;

  let balance = 0;
  for (const t of input.transactions) {
    if (!isPostable(t) || !t.date || t.date.slice(0, 10) > end) continue;
    for (const l of t.lines || []) balance += lineAmount(l, t);
  }

  const flagged = posted.filter(t => t.status === 'flagged').length;

  const cutoff = addDaysYMD(end, -60);
  const isOld = (d: { status?: string; dueDate?: string }) => !NOT_OWED_STATUSES.has(String(d.status)) && !!d.dueDate && d.dueDate.slice(0, 10) < cutoff;
  const old = input.invoices.filter(isOld).length + input.bills.filter(isOld).length;

  const mismatches = postingMismatchesThrough(input, end);

  const undepreciated = (input.assets || []).filter(a => a.status !== 'disposed' && depreciationThrough(a, month) > (a.accumulatedDepreciationCents || 0)).length;

  return [
    { id: 'drafts', title: title('drafts'), count: drafts,
      status: drafts ? 'blocker' : 'done',
      detail: drafts ? `${plural(drafts, 'draft')} dated in this month. Post, re-date or delete them first: once the month closes they can't be changed.` : 'No drafts dated in this month.' },
    { id: 'categorize', title: title('categorize'), count: uncategorized,
      status: uncategorized ? 'attention' : 'done',
      detail: uncategorized ? `${plural(uncategorized, 'transaction')} without an account.` : 'All transactions have an account.' },
    { id: 'reconcile', title: title('reconcile'), count: unmatched,
      status: unmatched ? 'attention' : 'done',
      detail: countedBankLines === 0 ? (bankInMonth.length ? 'No bank lines left to match in this month.' : 'No bank lines in this month.') : unmatched ? `${plural(unmatched, 'bank line')} not matched yet.` : `All ${plural(countedBankLines, 'bank line')} matched.` },
    { id: 'trial-balance', title: title('trial-balance'), count: balance === 0 ? 0 : 1,
      status: balance === 0 ? 'done' : 'blocker',
      detail: balance === 0 ? 'Debits equal credits through the end of the month.' : `Out of balance by ${balance} cents through the end of the month. Find the entry before closing.` },
    { id: 'anomalies', title: title('anomalies'), count: flagged,
      status: flagged ? 'attention' : 'done',
      detail: flagged ? `${plural(flagged, 'flagged transaction')} to review.` : 'No flagged transactions.' },
    { id: 'aging', title: title('aging'), count: old,
      status: old ? 'attention' : 'done',
      detail: old ? `${plural(old, 'invoice or bill', 'invoices or bills')} more than 60 days overdue at month end.` : 'Nothing more than 60 days overdue.' },
    { id: 'depreciation', title: title('depreciation'), count: undepreciated,
      status: undepreciated ? 'attention' : 'done',
      detail: undepreciated ? `${plural(undepreciated, 'fixed asset')} not depreciated through this month yet (Fixed Asset Register → Post depreciation).` : 'Fixed assets are depreciated through this month.' },
    { id: 'postings', title: title('postings'), count: mismatches.length,
      status: mismatches.length ? 'attention' : 'done',
      detail: mismatches.length ? `${plural(mismatches.length, 'document')} whose ledger entry is missing, doubled or wrong. Repost them below.` : 'Every invoice and bill is in the ledger once, with the right amount.' },
  ];
}

/** Invoices and bills dated through `end` whose ledger entry doesn't match (src/lib/postingCheck.ts). */
export function postingMismatchesThrough(input: Pick<CloseChecklistInput, 'invoices' | 'bills' | 'transactions' | 'baseCurrency'>, end: string): PostingMismatch[] {
  const through = <T extends { date?: string }>(docs: T[]) => docs.filter(d => !d.date || d.date.slice(0, 10) <= end);
  return findPostingMismatches({
    invoices: through(input.invoices),
    bills: through(input.bills),
    transactions: input.transactions,
    baseCurrency: input.baseCurrency,
  });
}

export interface SignOff { by: string; at: string; note?: string }

/** Ready to close: nothing blocks, and every item that needs attention has been signed off. */
export function readyToClose(items: Array<Pick<CloseItem, 'status' | 'title' | 'detail'> & { id: string }>, signOffs: Record<string, SignOff | undefined> = {}): { ready: boolean; reason?: string } {
  const blocker = items.find(i => i.status === 'blocker');
  if (blocker) return { ready: false, reason: blocker.detail };
  const unsigned = items.filter(i => i.status === 'attention' && !signOffs[i.id]);
  if (unsigned.length) return { ready: false, reason: `Review and sign off: ${unsigned.map(i => i.title).join(', ')}.` };
  return { ready: true };
}
