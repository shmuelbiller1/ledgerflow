/**
 * Post through the real `LedgerPostService` with no server: `fetch` becomes a recorder, so a test can
 * assert what the app would have written to `/api/v1/transactions/bulk`, and can then feed that entry
 * to a read-side function to prove the two agree.
 *
 * Written once because the ledger-entry fixture and the chart it needs are the same in every case
 * that does this. Kept data-driven (the chart is a table, not five calls) so the shape of a posting
 * test is obvious at the call site.
 */
import { lineAmount } from '../../lib/txFilters';
import { makeChartAccount } from '../fixtures';
import type { ChartAccount, InventoryItem, Transaction, Workspace } from '../../types';

/** id → name, type, category. Every posting case needs these five; add rows, do not fork the helper. */
const CHART: ReadonlyArray<readonly [string, string, ChartAccount['type'], string?]> = [
  ['ar', 'Accounts Receivable', 'asset', 'Receivables'],
  ['ap', 'Accounts Payable', 'liability', 'Payables'],
  ['cash', 'Checking', 'asset', 'Cash'],
  ['rev', 'Sales', 'income', 'Revenue'],
  ['exp', 'Supplies', 'expense'],
];

export type PostedTransaction = Transaction & { metadata?: Record<string, unknown> };

/** The chart above as real `ChartAccount` objects. */
export function chartAccounts(): ChartAccount[] {
  return CHART.map(([id, name, type, category]) =>
    makeChartAccount({ id, name, type, ...(category ? { category } : {}) }));
}

/** The `context` argument `LedgerPostService` takes: one book, that chart, nothing else in it. */
export function postingContext(currency = 'USD') {
  return {
    lockDate: null,
    transactions: [] as Transaction[],
    inventory: [] as InventoryItem[],
    workspaces: [{ id: 'w1', uid: 'u1', name: 'W', currency } as Workspace],
    accounts: chartAccounts(),
  };
}

/** Line amounts by account id — the shape assertions are written against. */
export function byAccount(tx: Transaction): Record<string, number> {
  return Object.fromEntries(tx.lines.map(line => [line.accountId, lineAmount(line, tx)]));
}

export interface PostingHarness {
  /** Entries the service sent, flattened in order; cleared by `reset()`. */
  readonly sent: PostedTransaction[];
  readonly service: typeof import('../../services/LedgerPostService').LedgerPostService;
  readonly context: typeof postingContext;
  readonly byAccount: typeof byAccount;
  reset(): void;
  /** Put the real `fetch` back. Call from `after()`. */
  restore(): void;
}

export async function startPostingHarness(): Promise<PostingHarness> {
  const sent: PostedTransaction[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    const body = JSON.parse(String(init?.body || '{}')) as { transactions?: PostedTransaction[] };
    sent.push(...(body.transactions || []));
    return new Response(JSON.stringify({ status: 'ok' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  const { LedgerPostService } = await import('../../services/LedgerPostService');
  return {
    sent,
    service: LedgerPostService,
    context: postingContext,
    byAccount,
    reset: () => { sent.length = 0; },
    restore: () => { globalThis.fetch = realFetch; },
  };
}
