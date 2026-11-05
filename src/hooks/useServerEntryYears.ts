import { useEffect, useState } from 'react';
import { getIdToken } from '../firebase';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { workspaceScope } from '../lib/serverAction';

/**
 * L-123 step 5c: every year with an entry, from the server (GET /api/v1/balances/entry-years), asked only when the
 * loaded entries are capped (the years before the oldest loaded day are then missing from the browser). Empty until it
 * answers, when not capped, or when it cannot be reached (`failed`, asked again when the loaded entries change): the
 * caller merges these with the loaded entries' years and says when older years may be missing.
 */
export function useServerEntryYears(): { years: number[]; failed: boolean } {
  const capped = useLedgerStore(s => Boolean(s.truncatedCollections?.transactions));
  // a failed answer is asked again when the loaded entries change: a capped list keeps its length, so the list
  // itself, which every snapshot replaces, is the signal (CodeRabbit and Codex on #516)
  const transactions = useLedgerStore(s => s.transactions);
  const workspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  const [answer, setAnswer] = useState<{ workspaceId: string; years: number[]; failed: boolean } | null>(null);
  const retryOn = answer?.failed ? transactions : null;
  useEffect(() => {
    if (!capped || !workspaceId) return;
    const scope = workspaceScope(() => useAuthStore.getState().currentWorkspaceId);
    let live = true;
    (async () => {
      const res = await fetch(`/api/v1/balances/entry-years?${new URLSearchParams({ workspaceId })}`, { headers: { Authorization: `Bearer ${await getIdToken()}` } });
      const body = await res.json().catch(() => ({})) as { years?: unknown };
      if (!res.ok || !Array.isArray(body.years)) throw new Error(`entry-years ${res.status}`);
      return body.years.filter((y): y is number => Number.isInteger(y));
    })().then(years => { if (live && scope.isCurrent()) setAnswer({ workspaceId, years, failed: false }); })
      .catch(() => { if (live && scope.isCurrent()) setAnswer(a => ({ workspaceId, years: a?.workspaceId === workspaceId ? a.years : [], failed: true })); });
    return () => { live = false; };
  }, [capped, workspaceId, retryOn]);
  if (!capped || answer?.workspaceId !== workspaceId) return { years: [], failed: false };
  return { years: answer.years, failed: answer.failed };
}
