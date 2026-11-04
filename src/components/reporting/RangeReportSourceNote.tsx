import React from 'react';
import type { RangeReportSource } from '../../hooks/useServerRangeReport';

/**
 * L-123 step 4: says where a range report's figures come from when the loaded lists are short — every entry on the
 * server, or only what is loaded because the server could not be asked. The short list may be entries or documents
 * (invoices, bills) or a list they use (accounts, customers), so the incomplete case names none in particular.
 * Nothing when the loaded lists are whole.
 */
export function RangeReportSourceNote({ source, testId, what = 'these totals' }: { source: RangeReportSource; testId: string; what?: string }) {
  if (source === 'loaded') return null;
  return (
    <p className="text-xs text-neutral-600" data-testid={testId}>
      {source === 'server'
        ? `Not every entry is loaded in this browser: ${what} are read from every entry on the server.`
        : `Some of the records behind ${what} (entries, documents or the lists they use) are not fully loaded in this browser, and the server could not be asked: ${what} cover only what is loaded, so they may be incomplete.`}
    </p>
  );
}
