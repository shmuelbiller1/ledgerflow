import React from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { collectionList, type LedgerKey } from '../../lib/ledgerCollections';

/**
 * L-123 step 6: on screens that review only the entries loaded in this browser (suggestions, questions, scans), says
 * so when the loaded entries are capped, so a short list is not read as the whole ledger. Nothing when every entry
 * is loaded. `className` lets a dark panel keep the text readable.
 */
export function LoadedEntriesOnlyNote({ testId, what, className = 'text-xs text-neutral-600' }: { testId: string; what: string; className?: string }) {
  const capped = useLedgerStore(s => Boolean(s.truncatedCollections?.transactions));
  if (!capped) return null;
  return (
    <p role="note" className={className} data-testid={testId}>
      {`Not every entry is loaded in this browser: ${what} cover only the loaded entries (the most recent ones), not the whole ledger.`}
    </p>
  );
}

/**
 * R-8: the same sentence for a report that reads other lists (invoices, bills, payments, …), which are
 * capped in this browser too (src/lib/ledgerCollections.ts). A report of what is *loaded* says so,
 * because a capped list would otherwise look like a complete one — the failure mode the queue names:
 * "the figure may be incomplete".
 *
 * Nothing renders when every list it names is complete, so a screen can mount it above its content.
 */
export function CappedCollectionsNote({ testId, keys, what, className = 'text-xs text-[var(--muted)]' }: {
  testId: string;
  /** the lists the report reads that could have been capped */
  keys: readonly LedgerKey[];
  /** what those lists make, e.g. "this statement" */
  what: string;
  className?: string;
}) {
  // the whole record is selected (one stable reference), and filtered here: a selector that built a
  // new array every render would make the store read as changed forever
  const truncated = useLedgerStore(s => s.truncatedCollections);
  const capped = keys.filter(key => Boolean(truncated?.[key]));
  if (!capped.length) return null;
  return (
    <p role="note" data-testid={testId} className={className}>
      {`Not everything is loaded in this browser: only the most recent ${collectionList(capped)} are here, so ${what} may be incomplete. Narrow the period, or load the full server report where the screen offers one.`}
    </p>
  );
}
