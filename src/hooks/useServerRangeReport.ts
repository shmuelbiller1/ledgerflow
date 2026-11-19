import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { identityScope } from '../lib/serverAction';
import { openingCutoff } from '../lib/serverBalances';
import { linesNeedServer, rangeRevision } from '../lib/serverTopLines';
import { runCommand, ServerCommandError } from '../lib/runCommand';

export type RangeReportSource = 'loaded' | 'server' | 'loaded-incomplete';

export interface RangeReportRead {
  source: RangeReportSource;
  /** The full report for this exact request has not settled yet. */
  pending: boolean;
  /** Only a failed GET for a requestable period can be retried. */
  retry?: () => void;
}

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
}): { report: T } & RangeReportRead {
  const { path, from, to, query, extraKey = '', alsoIncomplete = false, parse, loaded } = opts;
  const transactions = useLedgerStore(s => s.transactions);
  const capped = useLedgerStore(s => Boolean(s.truncatedCollections?.transactions));
  const workspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  const uid = useAuthStore(s => s.user?.uid);
  const cutoff = useMemo(() => openingCutoff(transactions || []), [transactions]);
  const incomplete = alsoIncomplete || linesNeedServer(capped, cutoff, from);
  const needed = incomplete && !!workspaceId && !!from && !!to && from <= to;
  // any loaded entry dated from `from` on can change the server's answer (a reversal dated after the range too)
  const revision = useMemo(() => (needed ? rangeRevision(transactions || [], from!) : ''), [needed, transactions, from]);
  const queryText = new URLSearchParams({ workspaceId, from: from || '', to: to || '', ...query }).toString();
  const key = needed ? `${path}|${queryText}|${(transactions || []).length}|${revision}|${extraKey}` : '';
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(n => n + 1), []);
  // Identity (not just URL): returning to A after B must wait for a new answer for A.
  const request = useMemo(() => key ? { key, uid, attempt } : null, [key, uid, attempt]);
  const [answer, setAnswer] = useState<{ request: NonNullable<typeof request>; report: T | null; canRetry: boolean } | null>(null);

  useEffect(() => {
    if (!request) return;
    const scope = identityScope(() => useAuthStore.getState().user?.uid, () => useAuthStore.getState().currentWorkspaceId);
    const controller = new AbortController();
    const publish = (report: T | null, canRetry = report === null) => {
      if (!controller.signal.aborted && scope.isCurrent()) setAnswer({ request, report, canRetry });
    };
    void runCommand<Record<string, unknown>>({ path: `/api/v1/balances/${path}?${queryText}`, signal: controller.signal })
      .then(body => publish(parse(body ?? {})))
      .catch((err: unknown) => publish(null, !(err instanceof ServerCommandError && err.status === 400)));
    return () => controller.abort();
  }, [request, path, queryText, parse]);

  const current = request && answer?.request === request ? answer : null;
  const server = current?.report;
  const pending = !!request && !current;
  return useMemo(() => ({
    report: server ?? loaded,
    source: server != null ? 'server' : incomplete ? 'loaded-incomplete' : 'loaded',
    pending,
    retry: current?.canRetry ? retry : undefined,
  }), [server, loaded, incomplete, pending, current, retry]);
}
