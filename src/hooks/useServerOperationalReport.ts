import { useEffect, useRef, useState } from 'react';
import { getIdToken } from '../firebase';

/**
 * Lightweight revision stamp over subscribed store collections so any local insert, payment,
 * status change, or edit invalidates and refetches the server-backed operational report.
 */
export function collectionStamp(...collections: ReadonlyArray<ReadonlyArray<unknown>>): string {
  return collections.map(list => {
    if (!Array.isArray(list) || list.length === 0) return '0';
    let hash = list.length;
    for (let i = 0; i < list.length; i += Math.max(1, Math.floor(list.length / 64))) {
      const row = list[i] as Record<string, unknown> | null;
      if (!row || typeof row !== 'object') continue;
      const sig = `${row.id ?? ''}:${row.updatedAt ?? ''}:${row.status ?? ''}:${row.amountCents ?? row.totalAmountCents ?? ''}:${row.amountPaidCents ?? ''}`;
      for (let j = 0; j < sig.length; j++) {
        hash = ((hash * 31) + sig.charCodeAt(j)) | 0;
      }
    }
    return `${list.length}:${hash >>> 0}`;
  }).join(',');
}

/**
 * Loads a server-authoritative operational report when browser collections are truncated (M-1).
 * Keyed by `requestKey` so switching workspaces, sides, date ranges, or mutating subscribed
 * records never displays stale figures.
 */
export function useServerOperationalReport<T>(
  enabled: boolean,
  url: string,
  requestKey: string,
  extract: (body: Record<string, unknown>) => T | undefined,
): T | null {
  const [state, setState] = useState<{ key: string; value: T } | null>(null);
  const extractRef = useRef(extract);

  useEffect(() => {
    extractRef.current = extract;
  }, [extract]);

  useEffect(() => {
    let cancelled = false;
    if (!enabled || !url || typeof fetch !== 'function') return;
    void (async () => {
      try {
        const token = await getIdToken();
        const res = await fetch(url, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as Record<string, unknown>;
        const next = body && typeof body === 'object' ? extractRef.current(body) : undefined;
        if (!cancelled && next !== undefined) {
          setState({ key: requestKey, value: next });
        }
      } catch {
        // best-effort: retain provisional browser rows when server report cannot be loaded
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, url, requestKey]);

  return enabled && state?.key === requestKey ? state.value : null;
}
