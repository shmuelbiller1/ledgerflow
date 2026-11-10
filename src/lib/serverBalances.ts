/**
 * L-123 step 3 (docs/design/L-123-server-balances.md): an account balance on screen = the server's balance through a
 * cut-off day (GET /api/v1/balances, every entry of the books, past the browser's loading cap) + the loaded entries
 * dated after that day.
 *
 * The cut-off is the oldest day among the loaded entries: the browser loads the newest entries first (cap in
 * LEDGER_COLLECTIONS), so every entry after that day is loaded, and the day itself may be cut part-way, which is why
 * the server counts it whole. Step 4 moves the cut-off to the newest fresh snapshot.
 */
import type { ChartAccount, Transaction } from '../types';
import { LedgerEngine } from '../kernel/ledger/LedgerEngine';
import { isPostable, lineAmount, transactionDate } from './txFilters';

/** What the server answered: base-currency cents per account id, debit positive, entries dated ≤ asOf (no account openings). */
export interface ServerOpening {
  workspaceId: string;
  asOf: string;
  accounts: Record<string, number>;
}

let closedThroughFallback = '';

/**
 * L-123 step 4: the day the loaded entries start after when the closed years are left to the server (set by
 * useLedgerStore.setEntriesClosedThrough; '' when every entry is loaded). With no entry after it, that day is the
 * cutoff, so every opening and period fallback still asks the server.
 */
export function setOpeningCutoffFallback(day: string | null): void {
  closedThroughFallback = day || '';
}

/** The oldest book date among the loaded entries; with none, the closed-through day ('' when neither). */
export function openingCutoff(transactions: Transaction[]): string {
  let oldest = '';
  for (const tx of transactions) {
    const d = tx && typeof tx === 'object' ? transactionDate(tx) : '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && (!oldest || d < oldest)) oldest = d;
  }
  return oldest || closedThroughFallback;
}

/** The loaded entries the server's answer does not hold: dated after its day. */
export function entriesAfter(transactions: Transaction[], asOf: string): Transaction[] {
  return transactions.filter(tx => tx && typeof tx === 'object' && transactionDate(tx) > asOf);
}

const debitNature = (a: ChartAccount) => a.type === 'asset' || a.type === 'expense' || a.type === 'cost_of_goods';

/**
 * Each account with `balanceCents` (its natural sign, as computedAccounts in useLedgerStore): the account's own
 * opening, the server's sum through `opening.asOf`, and the loaded entries after it (LedgerEngine, as today).
 */
export function withServerOpening(accounts: ChartAccount[], transactions: Transaction[], opening: ServerOpening): ChartAccount[] {
  const open = LedgerEngine.computeDimensionalBalances(accounts, entriesAfter(transactions, opening.asOf));
  return accounts.map(acc => {
    const signed = (open.get(acc.id)?.total || 0) + (opening.accounts[acc.id] || 0);
    return { ...acc, balanceCents: debitNature(acc) ? signed : -signed };
  });
}


/** The id of the one entry that stands for the server's sum (never shown, never saved: it only feeds calculations). */
export const SERVER_OPENING_ENTRY_ID = 'l123-server-opening';

/**
 * L-123 step 3b: the entries a balance calculation reads, with the server's answer folded in — one entry dated
 * `opening.asOf` holding the server's sum per account, plus the loaded entries after that day. Any balance as of a
 * date on or after `asOf` (a balance sheet, a cash total, a running chart) then equals the server's; a period that
 * starts after `asOf` sees exactly the loaded entries. A period that starts on or before `asOf` would count the
 * whole history in that one entry, so such a screen says so (`periodBeforeOpening`) and keeps the loaded entries.
 */
export function foldServerOpening(transactions: Transaction[], opening: ServerOpening | null): Transaction[] {
  if (!opening) return transactions;
  const lines = Object.entries(opening.accounts).filter(([, cents]) => cents).map(([accountId, amountCents]) => ({ accountId, amountCents }));
  const total = lines.reduce((sum, l) => sum + Math.max(0, lineAmount(l)), 0);
  const folded = {
    id: SERVER_OPENING_ENTRY_ID, workspaceId: opening.workspaceId, date: opening.asOf, description: `Balances through ${opening.asOf} (server)`,
    totalAmountCents: total, status: 'completed', type: 'journal', lines,
  } as unknown as Transaction;
  return [folded, ...entriesAfter(transactions, opening.asOf).filter(isPostable)];
}

/** True when a period starting at `startDate` reaches the day the server's sum covers (its figures would mix). */
export function periodBeforeOpening(startDate: string, opening: ServerOpening | null): boolean {
  return !!opening && !!startDate && startDate <= opening.asOf;
}

/**
 * L-123 step 3c: the entries a balance-as-of-a-date screen sums. The server's answer is folded in
 * (`foldServerOpening`) only when it is for the current cut-off (the oldest loaded day, as recomputeBalances checks)
 * and of the screen's workspace, and when the balance date is on or after that day; otherwise the loaded entries.
 * For balance math only: lists and drill-downs keep the loaded entries.
 */
export function balanceEntries(transactions: Transaction[], opening: ServerOpening | null, asOfDate?: string, workspaceId?: string): Transaction[] {
  return opensFromServer(transactions, opening, asOfDate, workspaceId) ? foldServerOpening(transactions, opening) : transactions;
}

/** Whether `balanceEntries` folds the server's answer in for these arguments. */
export function opensFromServer(transactions: Transaction[], opening: ServerOpening | null, asOfDate?: string, workspaceId?: string): opening is ServerOpening {
  if (!opening || opening.asOf !== openingCutoff(transactions || [])) return false;
  if (workspaceId && opening.workspaceId !== workspaceId) return false;
  return !(asOfDate && asOfDate < opening.asOf);
}

/**
 * L-123 step 3d: the entries a period screen sums (a P&L-type figure over `startDate`…, together with balances at its
 * end or the day before it starts, e.g. a ratio's opening receivables). The server's answer is folded in only when
 * `balanceEntries` would fold it in and the period starts after the server's day: every entry of such a period is
 * loaded, and every balance it reads (the day before the start onwards) is then the server's. A period that starts on
 * or before that day keeps the loaded entries (`periodBeforeOpening`).
 */
export function periodEntries(transactions: Transaction[], opening: ServerOpening | null, startDate: string, workspaceId?: string): Transaction[] {
  return opensForPeriod(transactions, opening, startDate, workspaceId) ? foldServerOpening(transactions, opening) : transactions;
}

/** Whether `periodEntries` folds the server's answer in for these arguments. */
export function opensForPeriod(transactions: Transaction[], opening: ServerOpening | null, startDate: string, workspaceId?: string): opening is ServerOpening {
  return !!startDate && opensFromServer(transactions, opening, startDate, workspaceId) && !periodBeforeOpening(startDate, opening);
}
