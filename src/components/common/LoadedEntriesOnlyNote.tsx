import React from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';

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
