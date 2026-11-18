import { useCallback, useEffect, useState } from 'react';
import { db } from '../firebase';
import { collection, getDocs, limit, onSnapshot, query, where } from '../lib/db/firestore';
import { maskCardNumbers } from '../lib/cardNumberMask';
import { sortQueries, type ClientQuery } from '../lib/clientQueries';
import { runCommand } from '../lib/runCommand';

/** Questions about entries (BD-07): written through the server, which checks who may ask, answer or close. */
async function call<T>(workspaceId: string, path: string, body: unknown): Promise<T> {
  const data = await runCommand<{ data?: T }>({
    path: `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/queries${path}`,
    method: 'POST',
    body,
  }) ?? {};
  return data.data as T;
}

export async function askAboutEntry(workspaceId: string, transactionId: string, question: string): Promise<ClientQuery> {
  return (await call<{ query: ClientQuery }>(workspaceId, '', { transactionId, question: maskCardNumbers(question) })).query;
}

export async function replyToQuery(workspaceId: string, queryId: string, text: string): Promise<ClientQuery> {
  return (await call<{ query: ClientQuery }>(workspaceId, `/${encodeURIComponent(queryId)}/reply`, { text: maskCardNumbers(text) })).query;
}

export async function closeQuery(workspaceId: string, queryId: string): Promise<void> {
  await call(workspaceId, `/${encodeURIComponent(queryId)}/close`, {});
}

/**
 * The workspace's questions, live (the Questions screen), or one entry's, read once with `reload`
 * after each change (the entry's window: no live connection held open for every entry opened).
 * Waiting ones first.
 */
export function useClientQueries(workspaceId: string | null | undefined, transactionId?: string) {
  const [round, setRound] = useState(0);
  const reload = useCallback(() => setRound(r => r + 1), []);
  // the answer for the request it belongs to: a newer request shows as loading until it is answered
  const list = `${workspaceId}|${transactionId || ''}|`;
  const key = workspaceId ? `${list}${round}` : '';
  const [result, setResult] = useState<{ key: string; queries: ClientQuery[]; failed: boolean } | null>(null);

  useEffect(() => {
    if (!workspaceId) return undefined;
    const filters = [where('workspaceId', '==', workspaceId), ...(transactionId ? [where('transactionId', '==', transactionId)] : [])];
    const q = query(collection(db, 'clientQueries'), ...filters, limit(500));
    const show = (docs: Array<{ id: string; data: () => unknown }>) =>
      setResult({ key, failed: false, queries: sortQueries(docs.map(d => ({ ...(d.data() as Omit<ClientQuery, 'id'>), id: d.id }))) });
    const fail = () => setResult(r => ({ key, failed: true, queries: r?.queries || [] }));
    if (transactionId) {
      let live = true;
      getDocs(q).then(snap => { if (live) show(snap.docs); }).catch(() => { if (live) fail(); });
      return () => { live = false; };
    }
    return onSnapshot(q, snap => show(snap.docs), fail);
  }, [workspaceId, transactionId, key]);

  if (!workspaceId) return { queries: [] as ClientQuery[], loading: false, failed: false, reload };
  const current = result?.key === key ? result : null;
  // while the same list is read again, its last answer stays on screen (never another workspace's)
  const shown = result && result.key.startsWith(list) ? result.queries : [];
  return { queries: shown, loading: !current, failed: current?.failed || false, reload };
}
