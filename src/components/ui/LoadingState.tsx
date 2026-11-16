import React from 'react';
import ReportSkeleton from '../reporting/ReportSkeleton';

/** A named, non-interactive placeholder occupying the list's content area, not a bare spinner. */
/** `label` replaces the whole sentence (a translated screen passes its own words). */
export function LoadingState({ what, label, rows = 5 }: { rows?: number } & ({ what: string; label?: string } | { what?: undefined; label: string })) {
  return (
    <div className="w-full min-w-0 p-4 sm:p-6" data-loading-state>
      <ReportSkeleton rows={rows} columns={3} label={label ?? `Loading ${what}…`} />
    </div>
  );
}
