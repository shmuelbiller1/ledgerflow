import React from 'react';
import ReportSkeleton from '../reporting/ReportSkeleton';

/** A named, non-interactive placeholder occupying the list's content area, not a bare spinner. */
export function LoadingState({ what, rows = 5 }: { what: string; rows?: number }) {
  return (
    <div className="w-full min-w-0 p-4 sm:p-6" data-loading-state>
      <ReportSkeleton rows={rows} columns={3} label={`Loading ${what}…`} />
    </div>
  );
}
