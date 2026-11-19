import React from 'react';
import { AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import { describeProvenance, type ReportProvenance } from '../../lib/reportProvenance';
import { useReportText } from './useReportText';

interface Props {
  provenance: ReportProvenance | null;
  /** asks the server again; offered as "Load the full server report" when the figures are not the server's */
  onRefresh?: () => void;
  busy?: boolean;
  id?: string;
}

/**
 * AUD-10: one line on every report screen saying where its figures come from (reportProvenance.ts):
 * a quiet "Complete" note, or an amber note for capped, partial or cached figures.
 */
export function ReportProvenanceNote({ provenance, onRefresh, busy = false, id }: Props) {
  const reportText = useReportText();
  if (!provenance) return null;
  const words = describeProvenance(provenance);
  const fromBrowser = provenance.source === 'browser';
  return (
    <div id={id} role="note" aria-label={reportText('r.where-these-figures-come-from', 'Where these figures come from')} data-provenance={words.complete ? 'complete' : 'incomplete'}
      className={words.complete
        ? 'px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-800 dark:text-emerald-400 rounded-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-3 text-xs font-semibold'
        : 'p-3 bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-3 text-xs sm:text-sm font-medium'}>
      <p className="flex items-center gap-2 min-w-0">
        {words.complete
          ? <CheckCircle2 aria-hidden="true" className="w-3.5 h-3.5 shrink-0" />
          : <AlertCircle aria-hidden="true" className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />}
        <span><strong>{words.headline}</strong> — {words.detail}</span>
      </p>
      {onRefresh && (
        <button type="button" onClick={onRefresh} disabled={busy}
          className="min-h-11 px-3 rounded border border-current text-xs font-semibold flex items-center gap-1.5 shrink-0 disabled:opacity-60">
          {busy ? <RefreshCw aria-hidden="true" className="w-3.5 h-3.5 animate-spin" /> : null}
          <span>{busy ? reportText('r.loading', 'Loading…') : fromBrowser ? reportText('r.load-the-full-server-report', 'Load the full server report') : reportText('r.refresh', 'Refresh')}</span>
        </button>
      )}
    </div>
  );
}
