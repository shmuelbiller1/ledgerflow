import { useEffect, useMemo, useRef, useState } from 'react';
import { runCommand } from '../lib/runCommand';

/**
 * Lightweight revision stamp over subscribed store collections so any local insert, payment,
 * status change, or edit invalidates and refetches the server-backed operational report.
 */
export function collectionStamp(...collections: ReadonlyArray<ReadonlyArray<unknown>>): string {
  return collections.map(list => {
    if (!Array.isArray(list) || list.length === 0) return '0';
    let hash = list.length;
    for (let i = 0; i < list.length; i++) {
      const row = list[i] as Record<string, unknown> | null;
      if (!row || typeof row !== 'object') continue;
      const sig = `${row.id ?? ''}:${row.updatedAt ?? ''}:${row.status ?? ''}:${row.amountCents ?? ''}:${row.totalAmountCents ?? ''}:${row.amountPaidCents ?? ''}`;
      for (let j = 0; j < sig.length; j++) {
        hash = (Math.imul(hash, 31) + sig.charCodeAt(j)) | 0; // NOSONAR: S7767 — intentional 32-bit wrap for rolling collection stamp hash
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
  // Returning to the same dates, or hitting the cap again, starts a new read. A success
  // from its previous activation must not authorize an export while this read is pending or refused.
  const request = useMemo(() => enabled && url ? { url, requestKey } : null, [enabled, url, requestKey]);
  const [state, setState] = useState<{ request: NonNullable<typeof request>; value: T } | null>(null);
  const extractRef = useRef(extract);

  useEffect(() => {
    extractRef.current = extract;
  }, [extract]);

  useEffect(() => {
    let cancelled = false;
    if (!request || typeof fetch !== 'function') return;
    void (async () => {
      try {
        // the token is `runCommand`'s business; a refusal or a cut connection both mean "keep the provisional rows"
        const body = await runCommand<Record<string, unknown>>({ path: request.url });
        if (cancelled) return;
        const next = body && typeof body === 'object' ? extractRef.current(body) : undefined;
        if (!cancelled && next !== undefined) {
          setState({ request, value: next });
        }
      } catch {
        // best-effort: retain provisional browser rows when server report cannot be loaded
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [request]);

  return state?.request === request ? state.value : null;
}
