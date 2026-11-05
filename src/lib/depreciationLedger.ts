/**
 * Asset depreciation ledger (CB-27): for a period, each fixed asset's cost, the depreciation it had
 * before the period, the depreciation posted in it (month by month runs, read from the run entries
 * in force, each naming its assets and amounts), what it has at the end, and its book value. What an
 * asset had before its first run here (brought in with it) counts as before. Assets sold or scrapped
 * by the end are marked.
 */
import type { FixedAsset, Transaction } from '../types';
import { isPostable } from './txFilters';
import { reversedTransactionIds } from './postingCheck';

export interface DepreciationLedgerRow {
  assetId: string;
  name: string;
  costCents: number;
  openingCents: number;
  periodCents: number;
  closingCents: number;
  bookValueCents: number;
  /** months of the period with a run for it (YYYY-MM) */
  months: string[];
  disposedOn?: string;
  /** part of it was sold or scrapped: its cost is what is left, and the runs before that were on the whole */
  partlyDisposed?: boolean;
}

const RUN = 'depreciation-run';

const day = (t: Transaction) => String(t.date || '').slice(0, 10);

/**
 * The runs reversed by `to`: a reversal dated after `to` had not happened yet, so the run still counts in a ledger
 * or register through that day (CodeRabbit on #449). Covers both links, the reversal's own and the run's
 * reversalEventId.
 */
function reversedAsOf(transactions: Transaction[], to: string): Set<string> {
  const byId = new Map(transactions.map(t => [t.id, t]));
  const isReversalEntry = (t: Transaction) => !!(t.metadata?.isReversal || t.metadata?.reversesTxId);
  const reversed = reversedTransactionIds(transactions.filter(t => !isReversalEntry(t) || day(t) <= to)
    .map(t => (t.reversalEventId && byId.has(t.reversalEventId) ? { ...t, reversalEventId: undefined } : t)));
  for (const t of transactions) {
    const reversal = t.reversalEventId ? byId.get(t.reversalEventId) : undefined;
    if (reversal && day(reversal) <= to) reversed.add(t.id);
  }
  return reversed;
}

export function depreciationLedger(assets: FixedAsset[], transactions: Transaction[], from: string, to: string): DepreciationLedgerRow[] {
  const reversed = reversedAsOf(transactions, to);
  const runs = transactions.filter(t => t.metadata?.type === RUN && isPostable(t) && !reversed.has(t.id) && !t.metadata?.isReversal);
  const byAsset = new Map<string, Array<{ date: string; month: string; cents: number }>>();
  for (const run of runs) {
    const date = String(run.date || '').slice(0, 10);
    const month = String(run.metadata?.month || date.slice(0, 7));
    for (const a of (run.metadata?.assets as Array<{ assetId: string; amountCents: number }> | undefined) || []) {
      byAsset.set(a.assetId, [...(byAsset.get(a.assetId) || []), { date, month, cents: Math.round(Number(a.amountCents) || 0) }]);
    }
  }
  return assets
    .filter(a => String(a.purchaseDate || '').slice(0, 10) <= to && !(a.disposedOn && a.disposedOn < from))
    .map(asset => {
      const list = byAsset.get(asset.id) || [];
      const posted = list.reduce((s, r) => s + r.cents, 0);
      // depreciation it came with (before any run here), from what it carries now
      const broughtIn = Math.max(0, (asset.accumulatedDepreciationCents || 0) - posted);
      const before = list.filter(r => r.date < from).reduce((s, r) => s + r.cents, 0);
      const within = list.filter(r => r.date >= from && r.date <= to);
      const periodCents = within.reduce((s, r) => s + r.cents, 0);
      const openingCents = broughtIn + before;
      const closingCents = openingCents + periodCents;
      const costCents = asset.purchasePriceCents || 0;
      return {
        assetId: asset.id, name: asset.name, costCents, openingCents, periodCents, closingCents, bookValueCents: costCents - closingCents,
        months: [...new Set(within.map(r => r.month))].sort(),
        ...(asset.disposedOn && asset.disposedOn <= to ? { disposedOn: asset.disposedOn } : {}),
        ...(asset.partialDisposals?.length ? { partlyDisposed: true } : {}),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
