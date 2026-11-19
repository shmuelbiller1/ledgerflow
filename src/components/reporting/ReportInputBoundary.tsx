import type { ReactNode } from 'react';
import type { LedgerKey } from '../../lib/ledgerCollections';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useScreenDataHealth } from '../../hooks/useScreenDataHealth';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { LoadingState } from '../ui/LoadingState';
import { useReportText } from './useReportText';

/** Don't mount a calculation (or its CSV) until its own workspace's subscriptions can supply it. */
export function ReportInputBoundary({ collections = ['accounts', 'transactions'], children }: {
  collections?: readonly LedgerKey[]; children: ReactNode;
}) {
  useLedgerCollections(...collections);
  const health = useScreenDataHealth(collections);
  const workspace = useAuthStore(s => s.currentWorkspaceId);
  const cacheWorkspace = useDataNeedsStore(s => s.loadedWorkspaceId);
  const reportText = useReportText();
  const current = !!workspace && workspace === cacheWorkspace;
  if (current && health.failedKeys.length) return <div role="status" className="flex flex-wrap items-center gap-3 text-sm text-[var(--text)]">
    <span>{reportText('r.report-inputs-failed', 'Report records could not be loaded.')}</span>
    <button type="button" className="min-h-11 rounded border border-[var(--line)] px-3 font-semibold" onClick={health.retry}>
      {reportText('r.try-again', 'Try again')}
    </button>
  </div>;
  if (!current || !health.ready) return <LoadingState label={reportText('r.loading-report-records', 'Loading report records…')} />;
  return children;
}
