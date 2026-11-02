import { useEffect, useMemo, useState } from 'react';
import { getIdToken } from '../firebase';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { workspaceScope } from '../lib/serverAction';
import { openingCutoff } from '../lib/serverBalances';
import { computeExpenseByCategory, type CategoryExpenseBreakdown } from '../lib/reportGenerators';
import { linesNeedServer, rangeRevision } from '../lib/serverTopLines';

/**
 * L-123 step 4d: the expense breakdown by category over `from`…`to`. A category can be set on a single line, so
 * per-account sums cannot give it; when the loaded list is capped and the range reaches the oldest loaded day, the
 * whole breakdown comes from the server (GET /api/v1/balances/expense-by-category). Otherwise, and until it answers or
 * when it cannot be reached, the loaded entries' breakdown, as before. A range with no dates (all time) is not sent:
 * the server reads at most three years. `source` says which, so the screen can say so.
 */
export function useServerExpenseByCategory(from: string | undefined, to: string | undefined): { categories: CategoryExpenseBreakdown[]; source: 'loaded' | 'server' | 'loaded-incomplete' } {
  const transactions = useLedgerStore(s => s.transactions);
  const accounts = useLedgerStore(s => s.accounts);
  const capped = useLedgerStore(s => Boolean(s.truncatedCollections?.transactions));
  const workspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  const cutoff = useMemo(() => openingCutoff(transactions || []), [transactions]);
  const incomplete = linesNeedServer(capped, cutoff, from);
  const needed = incomplete && !!workspaceId && !!from && !!to && from <= to;
  // any loaded entry dated from `from` on can change the server's answer (a reversal dated after the range too)
  const revision = useMemo(() => (needed ? rangeRevision(transactions || [], from!) : ''), [needed, transactions, from]);
  // the server groups by each account's type, category and name too: a change to any of them asks again (Codex on #495)
  const accountsRevision = useMemo(() => (needed
    ? JSON.stringify((accounts || []).map(a => [a.id, a.type, a.category, a.name]).sort((x, y) => String(x[0]).localeCompare(String(y[0]))))
    : ''), [needed, accounts]);
  const key = needed ? `${workspaceId}|${from}|${to}|${(transactions || []).length}|${revision}|${accountsRevision}` : '';
  const [answer, setAnswer] = useState<{ key: string; workspaceId: string; categories: CategoryExpenseBreakdown[] | null } | null>(null);

  useEffect(() => {
    if (!key || !from || !to) return;
    const scope = workspaceScope(() => useAuthStore.getState().currentWorkspaceId);
    let live = true;
    (async () => {
      const query = new URLSearchParams({ workspaceId, from, to }).toString();
      const res = await fetch(`/api/v1/balances/expense-by-category?${query}`, { headers: { Authorization: `Bearer ${await getIdToken()}` } });
      const body = await res.json().catch(() => ({})) as { categories?: CategoryExpenseBreakdown[] };
      if (!res.ok || !Array.isArray(body.categories)) throw new Error(`expense categories ${res.status}`);
      return body.categories;
    })().then(categories => {
      if (live && scope.isCurrent()) setAnswer({ key, workspaceId, categories });
    }).catch(() => {
      // best-effort: without the server's answer the screen keeps the loaded entries' breakdown and says it may be short
      if (live && scope.isCurrent()) setAnswer({ key, workspaceId, categories: null });
    });
    return () => { live = false; };
  }, [key, workspaceId, from, to]);

  const server = key && answer?.key === key && answer.workspaceId === workspaceId ? answer.categories : null;
  return useMemo(() => {
    if (server) return { categories: server, source: 'server' as const };
    return { categories: computeExpenseByCategory(accounts, transactions, from, to), source: incomplete ? 'loaded-incomplete' as const : 'loaded' as const };
  }, [server, accounts, transactions, from, to, incomplete]);
}
