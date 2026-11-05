import { useEffect, useState } from 'react';
import { getIdToken } from '../firebase';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { workspaceScope } from '../lib/serverAction';

/**
 * L-123 step 5c: every year with an entry, from the server (GET /api/v1/balances/entry-years), asked only when the
 * loaded entries are capped (the years before the oldest loaded day are then missing from the browser). Empty until it
 * answers, when not capped, or when it cannot be reached: the caller merges these with the loaded entries' years.
 */
export function useServerEntryYears(): number[] {
  const capped = useLedgerStore(s => Boolean(s.truncatedCollections?.transactions));
  const workspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  const [answer, setAnswer] = useState<{ workspaceId: string; years: number[] } | null>(null);
  useEffect(() => {
    if (!capped || !workspaceId) return;
    const scope = workspaceScope(() => useAuthStore.getState().currentWorkspaceId);
    let live = true;
    (async () => {
      const res = await fetch(`/api/v1/balances/entry-years?${new URLSearchParams({ workspaceId })}`, { headers: { Authorization: `Bearer ${await getIdToken()}` } });
      const body = await res.json().catch(() => ({})) as { years?: unknown };
      return res.ok && Array.isArray(body.years) ? body.years.filter((y): y is number => Number.isInteger(y)) : [];
    })().then(years => { if (live && scope.isCurrent()) setAnswer({ workspaceId, years }); }).catch(() => {});
    return () => { live = false; };
  }, [capped, workspaceId]);
  return capped && answer?.workspaceId === workspaceId ? answer.years : [];
}
