import { create } from 'zustand';
import type { LedgerKey } from '../lib/ledgerCollections';
import { canRetryNow, planRetry, type RetryTrouble } from '../lib/collectionRetry';

/**
 * Which on-demand collections screens have asked for (src/lib/ledgerCollections.ts), which have
 * arrived for the open workspace, and which failed to load. useLedgerData subscribes to every key
 * asked for and keeps it live; the list only grows during a session. The data status bar shows
 * what is loading or failed, with "Try again".
 *
 * A failed collection is also retried on its own: `trouble` holds the attempts and the next due
 * time (src/lib/collectionRetry.ts, issue #96), and useLedgerData schedules those attempts and
 * runs them early when the browser is online again or the tab becomes visible. A permission
 * refusal is never retried automatically; it keeps its "Try again".
 */
interface DataNeedsState {
  asked: LedgerKey[];
  loaded: Partial<Record<LedgerKey, boolean>>;
  /** Workspace whose subscriptions produced these loaded flags. */
  loadedWorkspaceId: string | null;
  /** why a collection couldn't be loaded */
  failed: Partial<Record<LedgerKey, string>>;
  /** automatic retry state for failed collections */
  trouble: Partial<Record<LedgerKey, RetryTrouble>>;
  ask: (keys: readonly LedgerKey[]) => void;
  markLoaded: (key: LedgerKey) => void;
  markFailed: (key: LedgerKey, message: string, error?: unknown) => void;
  /** clear a failure and its attempts; useLedgerData subscribes again ("Try again") */
  retry: (key: LedgerKey) => void;
  /**
   * Clear the failures that may be tried automatically (`immediate` = the tab came back). The
   * attempt records stay, so a flapping connection still runs out of attempts.
   */
  retryTransientFailures: (now?: number, immediate?: boolean) => void;
  /**
   * The browser reports it is online again (or the tab comes back to the screen): connection
   * failures start a fresh bounded cycle of attempts. A refusal is still left alone.
   */
  retryAfterReconnect: () => void;
  /** a new workspace: everything loads again */
  resetLoaded: (workspaceId?: string) => void;
}

export const useDataNeedsStore = create<DataNeedsState>((set) => ({
  asked: [],
  loaded: {},
  loadedWorkspaceId: null,
  failed: {},
  trouble: {},
  ask: (keys) => set((state) => {
    const missing = keys.filter(k => !state.asked.includes(k));
    return missing.length ? { asked: [...state.asked, ...missing].sort() } : state;
  }),
  markLoaded: (key) => set((state) => {
    // loaded, with nothing failed or half-retried for this key: nothing to change
    if (state.loaded[key] && !state.failed[key] && !state.trouble[key]) return state;
    const { [key]: _gone, ...failed } = state.failed;
    const { [key]: _goneTrouble, ...trouble } = state.trouble;
    return { loaded: { ...state.loaded, [key]: true }, failed, trouble };
  }),
  markFailed: (key, message, error) => set((state) => ({
    failed: { ...state.failed, [key]: message },
    trouble: { ...state.trouble, [key]: planRetry(error ?? message, state.trouble[key]?.attempts ?? 0, Date.now()) },
  })),
  retry: (key) => set((state) => {
    const { [key]: _gone, ...failed } = state.failed;
    const { [key]: _goneTrouble, ...trouble } = state.trouble;
    return { failed, trouble };
  }),
  retryTransientFailures: (now = Date.now(), immediate = false) => set((state) => {
    const cleared = Object.keys(state.failed).filter(key => {
      const k = key as LedgerKey;
      return Boolean(state.failed[k]) && canRetryNow(state.trouble[k], now, immediate);
    });
    if (!cleared.length) return state;
    const failed = { ...state.failed };
    for (const key of cleared) delete failed[key as LedgerKey];
    return { failed };
  }),
  retryAfterReconnect: () => set((state) => {
    // every failure but a refusal: connection trouble and any failure with no plan recorded
    const cleared = Object.keys(state.failed).filter(key => state.trouble[key as LedgerKey]?.kind !== 'auth');
    if (!cleared.length) return state;
    const failed = { ...state.failed };
    const trouble = { ...state.trouble };
    for (const key of cleared) {
      delete failed[key as LedgerKey];
      delete trouble[key as LedgerKey];
    }
    return { failed, trouble };
  }),
  resetLoaded: (workspaceId) => set({ loaded: {}, loadedWorkspaceId: workspaceId ?? null, failed: {}, trouble: {} }),
}));
