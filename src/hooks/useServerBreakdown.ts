import { useMemo } from 'react';
import { useLedgerStore } from '../stores/useLedgerStore';
import type { ChartAccount, Transaction } from '../types';
import { useServerRangeReport, type RangeReportSource } from './useServerRangeReport';

/**
 * L-123 step 4d/4e: a breakdown report over `from`…`to` grouped by something set on an entry or a line (an expense
 * category, an income source), so per-account sums cannot give it (useServerRangeReport, GET
 * `/api/v1/balances/<path>`). A capped chart of accounts also asks the server: lines whose account is not loaded are
 * left out of the browser's sums, whatever the range. Each account's type, category and name are in the request key,
 * so a change to any of them asks again. `field` is the array in the route's body.
 */
export function useServerBreakdown<Row>(
  path: string, field: string, from: string | undefined, to: string | undefined,
  compute: (accounts: ChartAccount[], transactions: Transaction[], from?: string, to?: string) => Row[],
): { rows: Row[]; source: RangeReportSource } {
  const transactions = useLedgerStore(s => s.transactions);
  const accounts = useLedgerStore(s => s.accounts);
  const accountsCapped = useLedgerStore(s => Boolean(s.truncatedCollections?.chartAccounts));
  const loaded = useMemo(() => compute(accounts, transactions, from, to), [compute, accounts, transactions, from, to]);
  const accountsKey = useMemo(() => JSON.stringify((accounts || []).map(a => [a.id, a.type, a.category, a.name])
    .sort((x, y) => String(x[0]).localeCompare(String(y[0])))), [accounts]);
  const parse = useMemo(() => (body: Record<string, unknown>) => (Array.isArray(body[field]) ? body[field] as Row[] : null), [field]);
  const { report, source } = useServerRangeReport({ path, from, to, extraKey: accountsKey, alsoIncomplete: accountsCapped, parse, loaded });
  return { rows: report, source };
}
