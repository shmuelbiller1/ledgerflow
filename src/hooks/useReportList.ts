import { useCurrentRole } from './useCurrentRole';
import { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { runCommand } from '../lib/runCommand';

/** A read-only report endpoint returning one list. Only a successful list (including []) can
 * establish an empty period. Re-entering the same book/period or changing reader starts a new read. */
export function useReportList<T>(path: string | null, field: 'items' | 'entries', isRow: (row: unknown) => row is T) {
  const uid = useAuthStore(s => s.user?.uid);
  const role = useCurrentRole();
  const guest = useAuthStore(s => s.isGuest);
  const [attempt, setAttempt] = useState(0);
  const request = useMemo(() => path ? { path, field, uid, guest, role, attempt } : null, [path, field, uid, guest, role, attempt]);
  const [answer, setAnswer] = useState<{ request: typeof request; rows?: T[]; error?: string } | null>(null);
  useEffect(() => {
    if (!request) return;
    const controller = new AbortController();
    void runCommand<Record<string, unknown>>({ path: request.path, signal: controller.signal }).then(body => {
      if (controller.signal.aborted) return;
      const rows = body?.[request.field];
      setAnswer(Array.isArray(rows) && rows.every(isRow) ? { request, rows } : { request });
    }, (err: unknown) => {
      if (!controller.signal.aborted) setAnswer({ request, error: err instanceof Error ? err.message : String(err) });
    });
    return () => controller.abort();
  }, [request, isRow]);
  const current = answer?.request === request ? answer : null;
  return { rows: current?.rows, loading: !!request && !current, failed: !!current && !current.rows,
    error: current?.error, retry: () => setAttempt(n => n + 1) };
}
