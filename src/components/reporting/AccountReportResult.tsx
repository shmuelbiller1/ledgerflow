import type { ReactNode } from 'react';
import type { RangeReportRead } from '../../hooks/useServerRangeReport';
import { LoadingState } from '../ui/LoadingState';
import { useReportText } from './useReportText';

/** A pending full read isn't a refusal, and an empty partial list isn't a no-activity result. */
export function AccountReportResult({ read, testId, hasRows, children }: {
  read: RangeReportRead; testId: string; hasRows: boolean; children: ReactNode;
}) {
  const reportText = useReportText();
  if (read.pending) return <LoadingState label={reportText('r.loading-report-records', 'Loading report records…')} />;
  if (read.source === 'loaded') return children;
  const partial = read.source === 'loaded-incomplete';
  return <>
    <div role="status" data-testid={testId} className="flex flex-wrap items-center gap-3 text-sm text-[var(--muted)]">
      <span>{partial ? (read.retry
        ? reportText('r.full-range-failed', 'The full report could not be loaded. The preview uses loaded entries only and may be incomplete. CSV export is unavailable.')
        : reportText('r.full-range-unavailable', 'Only part of the history is loaded. Open the report for a specific period to read the full history for that period. CSV export is unavailable.'))
        : reportText('r.full-range-source', 'These figures are read from every entry on the server for this period.')}</span>
      {read.retry && <button type="button" className="min-h-11 rounded border border-[var(--line)] px-3 font-semibold text-[var(--text)]" onClick={read.retry}>
        {reportText('r.load-full-range', 'Load the full report')}
      </button>}
    </div>
    {(!partial || hasRows) && children}
  </>;
}
