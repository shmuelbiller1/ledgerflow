import React from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import type { LedgerKey } from '../../lib/ledgerCollections';
import { LoadingState } from './LoadingState';

/** Do not present a failed or unfinished collection read as an empty list. */
export function CollectionEmptyState({ keys, loading, what, children }: {
  keys: readonly LedgerKey[];
  loading: boolean;
  what: string;
  children: React.ReactNode;
}) {
  const failed = useDataNeedsStore(s => s.failed);
  const retry = useDataNeedsStore(s => s.retry);
  const guest = useAuthStore(s => s.isGuest && !s.user);
  const failures = guest ? [] : keys.filter(key => failed[key]);
  if (failures.length) return (
    <div role="alert" className="p-4 text-center text-sm text-[var(--neg)] space-y-2">
      <p>Couldn’t load all data for {what}. This list may be incomplete.</p>
      <button type="button" className="min-h-11 px-4 underline font-semibold" onClick={() => failures.forEach(retry)}>
        Try again
      </button>
    </div>
  );
  return loading ? <LoadingState what={what} /> : <>{children}</>;
}
