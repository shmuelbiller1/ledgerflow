import { useMemo } from 'react';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useLedgerCollections } from './useLedgerCollections';
import { entryMatches, type EntryQuery } from '../lib/entryQuery';
import { useServerRangeReport, type RangeReportSource } from './useServerRangeReport';
import type { Transaction } from '../types';

type Matches = { entries: Transaction[]; total: number };
const parseMatches = (body: Record<string, unknown>): Matches | null =>
  (Array.isArray(body.entries) && typeof body.total === 'number' ? { entries: body.entries as Transaction[], total: body.total } : null);

/**
 * L-123 step 5c: the Query screen's matches (entryMatches). When the loaded entries are capped and the dates reach the
 * oldest loaded day, they come from the server (GET /api/v1/balances/entry-query, newest first, at most 1,000 with the
 * full count). Without dates the server is not asked (it reads at most three years): the loaded matches, marked
 * incomplete when capped.
 */
export function useServerEntryQuery(input: EntryQuery): { results: Transaction[]; total: number; source: RangeReportSource } {
  useLedgerCollections('transactions');
  // amounts typed as 19.99 arrive as 1998.9999…: whole cents, for the server and the loaded matches alike (Codex on
  // #516). The float noise goes first, then a part cent never widens the range: a minimum rounds up, a maximum down
  // (19.994 → at least 2000 cents), CodeRabbit on #516
  const cents = (v: number | undefined, toward: (n: number) => number) =>
    (v === undefined || !Number.isFinite(v) ? undefined : toward(Math.round(v * 1e6) / 1e6));
  const filter = useMemo<EntryQuery>(() => ({ ...input, minAmountCents: cents(input.minAmountCents, Math.ceil), maxAmountCents: cents(input.maxAmountCents, Math.floor) }),
    [input]);
  const transactions = useLedgerStore(s => s.transactions);
  const loaded = useMemo(() => {
    const entries = (transactions || []).filter(tx => entryMatches(tx, filter));
    return { entries, total: entries.length };
  }, [transactions, filter]);
  const query = useMemo(() => {
    const q: Record<string, string> = {};
    if (filter.searchTerm) q.q = filter.searchTerm;
    if (filter.minAmountCents !== undefined) q.min = String(filter.minAmountCents);
    if (filter.maxAmountCents !== undefined) q.max = String(filter.maxAmountCents);
    if (filter.accountIds?.length) q.accounts = filter.accountIds.join(',');
    return q;
  }, [filter.searchTerm, filter.minAmountCents, filter.maxAmountCents, filter.accountIds]);
  const { report, source } = useServerRangeReport({
    path: 'entry-query', from: filter.startDate || undefined, to: filter.endDate || undefined, query, parse: parseMatches, loaded,
  });
  return { results: report.entries, total: report.total, source };
}
