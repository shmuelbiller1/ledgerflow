import { useEffect, useMemo, useState } from 'react';
import { getIdToken } from '../firebase';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { workspaceScope } from '../lib/serverAction';
import { openingCutoff } from '../lib/serverBalances';
import { linesNeedServer, rangeRevision } from '../lib/serverTopLines';

export type RangeReportSource = 'loaded' | 'server' | 'loaded-incomplete';

/**
 * L-123 step 4: a report over `from`…`to` that cannot be made from per-account sums (single lines, line categories).
 * When the loaded entries are capped and the range reaches the oldest loaded day, or when `alsoIncomplete` says the
 * loaded lists are short in another way, the whole report comes from the server (GET `/api/v1/balances/<path>`).
 * Otherwise, and until it answers or when it cannot be reached, `loaded` (the caller's report over the loaded entries,
 * memoized), as before. `parse` reads the route's body; pass a module-level function so it keeps its identity.
 * `extraKey`: anything else the server's answer depends on (a limit, the accounts' fields), so a change asks again.
 * A range with no dates (all time) is not sent: the server reads at most three years.
 */
export function useServerRangeReport<T>(opts: {
  path: string;
  from: string | undefined;
  to: string | undefined;
  query?: Record<string, string>;
  extraKey?: string;
  alsoIncomplete?: boolean;
  parse: (body: Record<string, unknown>) => T | null;
  loaded: T;
}): { report: T; source: RangeReportSource } {
  const { path, from, to, query, extraKey = '', alsoIncomplete = false, parse, loaded } = opts;
  const transactions = useLedgerStore(s => s.transactions);
  const capped = useLedgerStore(s => Boolean(s.truncatedCollections?.transactions));
  const workspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  const cutoff = useMemo(() => openingCutoff(transactions || []), [transactions]);
  const incomplete = alsoIncomplete || linesNeedServer(capped, cutoff, from);
  const needed = incomplete && !!workspaceId && !!from && !!to && from <= to;
  // any loaded entry dated from `from` on can change the server's answer (a reversal dated after the range too)
  const revision = useMemo(() => (needed ? rangeRevision(transactions || [], from!) : ''), [needed, transactions, from]);
  const queryText = new URLSearchParams({ workspaceId, from: from || '', to: to || '', ...query }).toString();
  const key = needed ? `${path}|${queryText}|${(transactions || []).length}|${revision}|${extraKey}` : '';
  const [answer, setAnswer] = useState<{ key: string; workspaceId: string; report: T | null } | null>(null);

  useEffect(() => {
    if (!key) return;
    const scope = workspaceScope(() => useAuthStore.getState().currentWorkspaceId);
    let live = true;
    (async () => {
      const res = await fetch(`/api/v1/balances/${path}?${queryText}`, { headers: { Authorization: `Bearer ${await getIdToken()}` } });
      const body = await res.json().catch(() => ({})) as Record<string, unknown>;
      const report = res.ok ? parse(body) : null;
      if (!report) throw new Error(`${path} ${res.status}`);
      return report;
    })().then(report => {
      if (live && scope.isCurrent()) setAnswer({ key, workspaceId, report });
    }).catch(() => {
      // best-effort: without the server's answer the screen keeps the loaded entries' report and says it may be short
      if (live && scope.isCurrent()) setAnswer({ key, workspaceId, report: null });
    });
    return () => { live = false; };
  }, [key, workspaceId, path, queryText, parse]);

  const server = key && answer?.key === key && answer.workspaceId === workspaceId ? answer.report : null;
  return useMemo(() => (server
    ? { report: server, source: 'server' as const }
    : { report: loaded, source: incomplete ? 'loaded-incomplete' as const : 'loaded' as const }),
  [server, incomplete, loaded]);
}
