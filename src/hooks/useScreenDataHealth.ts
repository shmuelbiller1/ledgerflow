import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { useAuthStore } from '../stores/useAuthStore';
import type { LedgerKey } from '../lib/ledgerCollections';

/**
 * The three data states of one screen (A-235), for the collections that screen needs:
 *
 * - `loading`: still arriving. A screen shows its loading state, never "nothing here yet".
 * - `failed`: could not be loaded (the store keeps the reason, src/stores/useDataNeedsStore.ts).
 *   The screen says so in plain words and offers "Try again", which asks for them again.
 * - neither: the screen shows its own empty state when the lists are empty.
 *
 * Demo mode has no database (the same rule as useLedgerCollections), so nothing there fails.
 */
export interface ScreenDataHealth {
  /** the collections this screen needs that could not be loaded */
  failedKeys: LedgerKey[];
  /** the first reason the load failed, when the store has one */
  message?: string;
  /** the collections still on their way */
  loadingKeys: LedgerKey[];
  /** everything the screen needs has arrived */
  ready: boolean;
  /** ask again for every failed collection ("Try again") */
  retry: () => void;
}

export function useScreenDataHealth(keys: readonly LedgerKey[]): ScreenDataHealth {
  const failed = useDataNeedsStore(s => s.failed);
  const loaded = useDataNeedsStore(s => s.loaded);
  const retryCollection = useDataNeedsStore(s => s.retry);
  const isGuest = useAuthStore(s => s.isGuest && !s.user);

  const failedKeys = isGuest ? [] : keys.filter(k => Boolean(failed[k]));
  const loadingKeys = isGuest ? [] : keys.filter(k => !loaded[k] && !failed[k]);
  return {
    failedKeys,
    message: failedKeys.length ? failed[failedKeys[0]] : undefined,
    loadingKeys,
    ready: keys.length === 0 || (failedKeys.length === 0 && loadingKeys.length === 0),
    retry: () => {
      for (const key of failedKeys) retryCollection(key);
    },
  };
}
