import { useCallback, useMemo } from 'react';
import { useLedgerStore } from '../stores/useLedgerStore';
import type { ChartAccount, Transaction } from '../types';
import { useServerRangeReport, type RangeReportSource } from './useServerRangeReport';

/**
 * L-123 step 4: a report over `from`…`to` that groups lines by their accounts' type, category or name in a way
 * per-account sums cannot give (useServerRangeReport, GET `/api/v1/balances/<path>`). A capped chart of accounts also
 * asks the server: lines whose account is not loaded are left out of the browser's sums, whatever the range. Each
 * account's type, category and name are in the request key, so a change to any of them asks again. `compute` must keep
 * its identity (a module function or a useCallback); `parse` reads the route's body (module function).
 */
export function useServerAccountReport<T>(
  path: string, from: string | undefined, to: string | undefined,
  compute: (accounts: ChartAccount[], transactions: Transaction[]) => T,
  parse: (body: Record<string, unknown>) => T | null,
): { report: T; source: RangeReportSource } {
  const transactions = useLedgerStore(s => s.transactions);
  const accounts = useLedgerStore(s => s.accounts);
  const accountsCapped = useLedgerStore(s => Boolean(s.truncatedCollections?.chartAccounts));
  const loaded = useMemo(() => compute(accounts, transactions), [compute, accounts, transactions]);
  const accountsKey = useMemo(() => JSON.stringify((accounts || []).map(a => [a.id, a.type, a.category, a.name])
    .sort((x, y) => String(x[0]).localeCompare(String(y[0])))), [accounts]);
  return useServerRangeReport({ path, from, to, extraKey: accountsKey, alsoIncomplete: accountsCapped, parse, loaded });
}

/**
 * L-123 step 4d/4e: a breakdown grouped by something set on an entry or a line (an expense category, an income source),
 * through useServerAccountReport. `field` is the array in the route's body.
 */
export function useServerBreakdown<Row>(
  path: string, field: string, from: string | undefined, to: string | undefined,
  compute: (accounts: ChartAccount[], transactions: Transaction[], from?: string, to?: string) => Row[],
): { rows: Row[]; source: RangeReportSource } {
  const computeRange = useCallback((accounts: ChartAccount[], transactions: Transaction[]) => compute(accounts, transactions, from, to), [compute, from, to]);
  const parse = useMemo(() => (body: Record<string, unknown>) => (Array.isArray(body[field]) ? body[field] as Row[] : null), [field]);
  const { report, source } = useServerAccountReport(path, from, to, computeRange, parse);
  return { rows: report, source };
}
