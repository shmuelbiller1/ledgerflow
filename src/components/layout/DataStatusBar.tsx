import React from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { COLLECTION_LABELS, collectionList, CORE_KEYS, LEDGER_COLLECTIONS } from '../../lib/ledgerCollections';
import type { LedgerKey } from '../../lib/ledgerCollections';

/**
 * One line above every screen about the workspace's data (I-01, I-02, AA-02): what is still
 * loading, what failed to load (with "Try again"), and which lists are cut at their limit, so a
 * screen's totals or "nothing here" are never taken at face value by mistake.
 */
export default function DataStatusBar() {
  const asked = useDataNeedsStore(s => s.asked);
  const loaded = useDataNeedsStore(s => s.loaded);
  const failed = useDataNeedsStore(s => s.failed);
  const retry = useDataNeedsStore(s => s.retry);
  const truncated = useLedgerStore(s => s.truncatedCollections);
  const signedIn = useAuthStore(s => Boolean(s.user && s.currentWorkspaceId));
  if (!signedIn) return null;

  const wanted = [...new Set<LedgerKey>([...CORE_KEYS, ...asked])];
  const failedKeys = wanted.filter(k => failed[k]);
  const loadingKeys = wanted.filter(k => !loaded[k] && !failed[k]);
  const cut = (Object.keys(LEDGER_COLLECTIONS) as LedgerKey[])
    .filter(k => truncated?.[LEDGER_COLLECTIONS[k].collection]);

  // loading floats over the page and takes no space: a bar appearing and going as each kind of data
  // arrives made the whole page jump up and down
  const loadingNote = loadingKeys.length > 0 && (
    <div role="status" className="pointer-events-none fixed bottom-4 left-1/2 -translate-x-1/2 z-[150] flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--muted)] shadow-md">
      <Loader2 size={14} className="animate-spin" aria-hidden="true" />
      <span>Loading {collectionList(loadingKeys)}…</span>
    </div>
  );
  if (!failedKeys.length && !cut.length) return loadingNote || null;
  return (
    <div className="border-b border-[var(--line)] text-xs px-4 py-1.5 space-y-1">
      {loadingNote}
      {failedKeys.length > 0 && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-[var(--neg)]">
          <AlertTriangle size={14} aria-hidden="true" />
          <span>Couldn't load {collectionList(failedKeys)}. Screens that use them may look empty. Check your connection, then</span>
          {failedKeys.map(k => (
            <button key={k} type="button" onClick={() => retry(k)} className="underline font-semibold">
              try again{failedKeys.length > 1 ? ` (${COLLECTION_LABELS[k]})` : ''}
            </button>
          ))}
        </div>
      )}
      {cut.length > 0 && (
        <div role="status" className="text-[var(--brass)]">
          Only the most recent {cut.map(k => `${LEDGER_COLLECTIONS[k].cap.toLocaleString()} ${COLLECTION_LABELS[k]}`).join(' and ')} are loaded: totals on screen may be incomplete.
        </div>
      )}
    </div>
  );
}
