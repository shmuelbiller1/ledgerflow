import React from 'react';
import type { RangeReportSource } from '../../hooks/useServerRangeReport';
import { useReportText, fill } from './useReportText';

/**
 * L-123 step 4: says where a range report's figures come from when the loaded lists are short — every entry on the
 * server, or only what is loaded because the server could not be asked. The short list may be entries or documents
 * (invoices, bills) or a list they use (accounts, customers), so the incomplete case names none in particular.
 * Nothing when the loaded lists are whole.
 */
export function RangeReportSourceNote({ source, testId, what = 'these totals', reads = 'every entry' }: { source: RangeReportSource; testId: string; what?: string; reads?: string }) {
  const reportText = useReportText();
  if (source === 'loaded') return null;
  return (
    <p className="text-xs text-neutral-600" data-testid={testId}>
      {source === 'server'
        ? fill(reportText('r.not-every-entry-is-loaded-in-this-browser-0-are', 'Not every entry is loaded in this browser: {0} are read from {1} on the server.'), { 0: what, 1: reads })
        : fill(reportText('r.some-of-the-records-behind-0-entries-documents-o', 'Some of the records behind {0} (entries, documents or the lists they use) are not fully loaded in this browser, and the server could not be asked: {1} cover only what is loaded, so they may be incomplete.'), { 0: what, 1: what })}
    </p>
  );
}
