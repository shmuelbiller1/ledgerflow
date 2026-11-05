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
  // whole cents for the server and the loaded matches alike: a part cent never widens the range, so a minimum rounds
  // up and a maximum down (19.994 → at least 2000 cents). QueryView converts the typed text exactly
  // (typedAmountCents), so no float noise reaches here; a caller passing a float product still gets an integer
  // (Codex and CodeRabbit on #516)
  const cents = (v: number | undefined, toward: (n: number) => number) =>
    (v === undefined || !Number.isFinite(v) ? undefined : Number.isInteger(v) ? v : toward(v));
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
