import { useEffect, useMemo, useState } from 'react';
import { getIdToken } from '../firebase';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { workspaceScope } from '../lib/serverAction';
import { openingCutoff } from '../lib/serverBalances';
import { mergedActivity, overlapRevision, withoutReplacedPostings, type ActivityByMonth, type ServerActivity } from '../lib/periodActivity';

/**
 * L-123 step 3e: the activity per account per month over `from`…`to` that a period screen sums
 * (src/lib/periodActivity.ts). Only when the loaded entries are capped (truncatedCollections.transactions) and the
 * range reaches the oldest loaded day's month is the server asked (GET /api/v1/balances/activity); otherwise, and
 * until it answers or when it cannot be reached, the loaded entries' fold, so the figures are as before.
 * `serverMonths` says whether any month came from the server. `excludeDocumentId`: the document being edited; its
 * postings its save would replace are left out on both sides, the server's months and the loaded ones.
 */
export function useServerActivity(from: string, to: string, excludeDocumentId?: string): { activity: ActivityByMonth; serverMonths: boolean } {
  const allTransactions = useLedgerStore(s => s.transactions);
  const transactions = useMemo(() => (excludeDocumentId ? withoutReplacedPostings(allTransactions || [], excludeDocumentId) : allTransactions),
    [allTransactions, excludeDocumentId]);
  const capped = useLedgerStore(s => Boolean(s.truncatedCollections?.transactions));
  const workspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  const cutoff = useMemo(() => openingCutoff(transactions || []), [transactions]);
  const needed = capped && !!workspaceId && !!cutoff && !!from && !!to && from <= to && from.slice(0, 7) <= cutoff.slice(0, 7);
  // the loaded entries the server's months overlap (through the cut-off month): an edit or a void there, even with the
  // same date and the same number of entries, changes the revision and asks the server again
  const revision = useMemo(() => (needed ? overlapRevision(transactions || [], cutoff.slice(0, 7)) : ''), [needed, transactions, cutoff]);
  const key = needed ? `${workspaceId}|${from}|${to}|${excludeDocumentId || ''}|${cutoff}|${(transactions || []).length}|${revision}` : '';
  const [answer, setAnswer] = useState<{ key: string; server: ServerActivity | null } | null>(null);

  useEffect(() => {
    if (!key) return;
    const scope = workspaceScope(() => useAuthStore.getState().currentWorkspaceId);
    let live = true;
    (async () => {
      const query = new URLSearchParams({ workspaceId, from, to, ...(excludeDocumentId ? { excludeDocumentId } : {}) }).toString();
      const res = await fetch(`/api/v1/balances/activity?${query}`, { headers: { Authorization: `Bearer ${await getIdToken()}` } });
      const body = await res.json().catch(() => ({})) as { months?: ActivityByMonth };
      if (!res.ok || !body.months || typeof body.months !== 'object') throw new Error(`activity ${res.status}`);
      return { workspaceId, from, to, months: body.months };
    })().then(server => {
      if (live && scope.isCurrent()) setAnswer({ key, server });
    }).catch(() => {
      // best-effort: without the server's answer the screen keeps the loaded entries' sums
      if (live && scope.isCurrent()) setAnswer({ key, server: null });
    });
    return () => { live = false; };
  }, [key, workspaceId, from, to, excludeDocumentId]);

  const server = key && answer?.key === key ? answer.server : null;
  return useMemo(() => ({
    activity: mergedActivity(transactions || [], server, from, to, cutoff, workspaceId),
    serverMonths: !!server,
  }), [transactions, server, from, to, cutoff, workspaceId]);
}
