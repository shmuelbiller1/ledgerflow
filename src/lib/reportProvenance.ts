/**
 * AUD-10: where a report's figures come from, in one shape for every report path.
 *
 * - The server reads every entry (no cap), so its answer is `complete`; a P&L or balance sheet it
 *   answered from its 60-second cache carries `cachedAt`, the moment the answer was worked out.
 * - A screen that works the figures out in this browser (the server answer failed, or a filter the
 *   server does not take) reads only the loaded collections: when a collection reached its cap
 *   (src/lib/ledgerCollections.ts; newest first) the answer is `{ cappedAt }`, when one failed to
 *   load it is `partial`.
 *
 * `describeProvenance` is the one wording every report screen shows (ReportProvenanceNote).
 * Nothing here changes a figure.
 */
import { LEDGER_COLLECTIONS, type LedgerKey } from './ledgerCollections';
import { byCodeUnit } from './codeUnitOrder';

export type ReportCompleteness = 'complete' | 'partial' | { cappedAt: number; collection: LedgerKey };

export interface ReportProvenance {
  source: 'server' | 'browser';
  completeness: ReportCompleteness;
  /** ISO time the server worked out a cached answer; absent on a fresh answer */
  cachedAt?: string;
  /** browser only: the server report was asked for and could not be loaded */
  serverError?: boolean;
}

/** The server's provenance: every entry read; `cachedAt` when the answer came from its cache. */
export function serverProvenance(cachedAt?: number): ReportProvenance {
  return { source: 'server', completeness: 'complete', ...(cachedAt !== undefined ? { cachedAt: new Date(cachedAt).toISOString() } : {}) };
}

/** A provenance the server sent, or a plain server answer (older responses carry none). */
export function provenanceFromResponse(body: unknown): ReportProvenance {
  const p = body && typeof body === 'object' ? (body as { provenance?: ReportProvenance }).provenance : undefined;
  if (p && p.source === 'server') return { source: 'server', completeness: p.completeness ?? 'complete', ...(p.cachedAt ? { cachedAt: p.cachedAt } : {}) };
  return serverProvenance();
}

export interface LoadedState {
  /** per database collection (useLedgerStore.truncatedCollections) */
  truncatedCollections: Record<string, boolean>;
  /** some collection reached its cap (useLedgerStore.isDataTruncated) */
  isDataTruncated: boolean;
  /** per ledger key (useDataNeedsStore.failed) */
  failed: Partial<Record<LedgerKey, string>>;
}

/**
 * A figure worked out in this browser from the collections `keys`: partial when one failed to load
 * or truncation is known without saying which collection; capped when one reached its cap.
 */
export function browserProvenance(keys: readonly LedgerKey[], state: LoadedState, serverError = false): ReportProvenance {
  const base = { source: 'browser' as const, ...(serverError ? { serverError: true } : {}) };
  if (keys.some(key => state.failed[key])) return { ...base, completeness: 'partial' };
  const capped = keys.find(key => state.truncatedCollections[LEDGER_COLLECTIONS[key].collection]);
  if (capped) return { ...base, completeness: { cappedAt: LEDGER_COLLECTIONS[capped].cap, collection: capped } };
  const knownWhich = Object.values(state.truncatedCollections).some(Boolean);
  if (state.isDataTruncated && !knownWhich) return { ...base, completeness: 'partial' };
  return { ...base, completeness: 'complete' };
}

const NOUN: Partial<Record<LedgerKey, string>> = { transactions: 'entries', accounts: 'accounts', journalEntries: 'journal entries', invoices: 'invoices', bills: 'bills', payments: 'payments' };

/** HH:MM in the viewer's clock */
export function clockTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export interface ProvenanceWords {
  /** true when nothing is missing and the answer is not a cached one */
  complete: boolean;
  /** first words: Complete · Capped at 20,000 entries · Cached at 14:02 · Partial */
  headline: string;
  detail: string;
}

/** The words a report screen shows for a provenance. */
export function describeProvenance(p: ReportProvenance): ProvenanceWords {
  if (p.source === 'server') {
    if (p.cachedAt) {
      const at = clockTime(p.cachedAt);
      return { complete: false, headline: `Cached at ${at}`, detail: `Worked out by the server from every entry at ${at}; changes made since then show after a refresh.` };
    }
    return { complete: true, headline: 'Complete', detail: 'Worked out by the server from every entry.' };
  }
  const why = p.serverError ? ' The server report could not be loaded.' : '';
  if (p.completeness === 'complete') {
    return { complete: true, headline: 'Complete', detail: `Worked out in this browser from every loaded entry.${why}` };
  }
  if (p.completeness === 'partial') {
    return { complete: false, headline: 'Partial', detail: `Worked out in this browser, but not everything could be loaded, so the figures may be incomplete.${why}` };
  }
  const n = p.completeness.cappedAt.toLocaleString('en-US');
  const noun = NOUN[p.completeness.collection] || 'records';
  return { complete: false, headline: `Capped at ${n} ${noun}`, detail: `Worked out in this browser from the newest ${n} ${noun} only; older ones are not loaded, so the figures may be incomplete.${why}` };
}

/** One provenance for several answers (period columns): the least complete wins, the oldest cache. */
export function combineProvenance(all: readonly ReportProvenance[]): ReportProvenance | null {
  if (all.length === 0) return null;
  const browser = all.find(p => p.source === 'browser' && p.completeness !== 'complete') || all.find(p => p.source === 'browser');
  if (browser) return browser;
  const cached = all.map(p => p.cachedAt).filter((x): x is string => Boolean(x)).sort(byCodeUnit);
  return serverProvenance(cached.length ? Date.parse(cached[0]) : undefined);
}
