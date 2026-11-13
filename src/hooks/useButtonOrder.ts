import { useCallback, useMemo, useSyncExternalStore } from 'react';
import {
  applyButtonOrder,
  buttonOrderStorageKey,
  isDefaultOrder,
  moveButton,
  parseButtonOrders,
  serializeButtonOrders,
  stepButton,
  withButtonOrder,
  type DropPosition,
  type SavedButtonOrders,
} from '../lib/buttonOrder';
import { useAuthStore } from '../stores/useAuthStore';

/**
 * Each person's own button order, kept on this device.
 *
 * One small shared store outside React, so every list on the page reads the same saved value in
 * its first render (no flash of the default order) and a change in another browser tab arrives
 * through the `storage` event. The order belongs to the signed-in person, not to a workspace:
 * someone who puts Bank first wants Bank first in every company they open.
 *
 * Nothing here is sent to the server and nothing here is financial: it is the same kind of
 * device-local preference as bookmarks and pinned pages.
 */

interface Snapshot { orders: SavedButtonOrders; storageError: boolean }

const cache = new Map<string, Snapshot>();
const listeners = new Set<() => void>();
const EMPTY: Snapshot = { orders: {}, storageError: false };

function read(uid: string): Snapshot {
  const cached = cache.get(uid);
  if (cached) return cached;
  let snapshot: Snapshot;
  try {
    snapshot = { orders: parseButtonOrders(localStorage.getItem(buttonOrderStorageKey(uid))), storageError: false };
  } catch {
    // storage blocked (private mode, a locked-down browser): the default order, and changes last for this visit
    snapshot = EMPTY;
  }
  cache.set(uid, snapshot);
  return snapshot;
}

function write(uid: string, orders: SavedButtonOrders): void {
  let storageError = false;
  try {
    const key = buttonOrderStorageKey(uid);
    if (Object.keys(orders).length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, serializeButtonOrders(orders));
  } catch {
    storageError = true;
  }
  cache.set(uid, { orders, storageError });
  listeners.forEach(listener => listener());
}

function onStorage(event: StorageEvent): void {
  // another tab saved an order (or storage was cleared): read it again the next time it is asked for
  if (event.key !== null && !event.key.startsWith('ledgerflow:button-order:v1:')) return;
  cache.clear();
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}

/** Tests only: forget what was read, so each test starts from what is in storage. */
export function resetButtonOrderCacheForTests(): void {
  cache.clear();
  listeners.forEach(listener => listener());
}

export interface ButtonOrder {
  /** The ids to show, in the person's order (every id of `defaultIds`, once). */
  orderedIds: string[];
  /** Has the person changed this list? (Offer "Reset order" only then.) */
  isCustom: boolean;
  /** The last change could not be saved in this browser; it lasts until the page reloads. */
  storageError: boolean;
  /** Put `id` just before/after `targetId`. Returns whether anything moved. */
  move: (id: string, targetId: string, position: DropPosition) => boolean;
  /** Move `id` one place earlier (-1) or later (+1) among `visibleIds`. Returns whether it moved. */
  step: (id: string, delta: -1 | 1, visibleIds?: readonly string[]) => boolean;
  /** Back to the order the product ships with. */
  reset: () => void;
}

/**
 * The saved order of one list of buttons for the signed-in person.
 *
 * `listId` names the list (for example `sidebar.daily`); `defaultIds` is the product's own order
 * of every button the list can hold. Pass the full list, not the filtered one a search leaves:
 * hidden buttons keep their place.
 */
export function useButtonOrder(listId: string, defaultIds: readonly string[]): ButtonOrder {
  const uid = useAuthStore(s => s.user?.uid || 'guest');
  const snapshot = useSyncExternalStore(subscribe, () => read(uid), () => EMPTY);
  const saved = snapshot.orders[listId];
  // the caller may build `defaultIds` on every render: keep one array per content, not per identity
  const defaultsKey = JSON.stringify(defaultIds);
  const defaults = useMemo(() => JSON.parse(defaultsKey) as string[], [defaultsKey]);
  const orderedIds = useMemo(() => applyButtonOrder(defaults, saved), [defaults, saved]);
  const isCustom = useMemo(() => !isDefaultOrder(defaults, orderedIds), [defaults, orderedIds]);

  const commit = useCallback((next: readonly string[], current: readonly string[]): boolean => {
    if (next === current) return false;
    // the person may have signed out or switched account while a drag was in flight
    const liveUid = useAuthStore.getState().user?.uid || 'guest';
    if (liveUid !== uid) return false;
    const latest = read(uid).orders;
    write(uid, withButtonOrder(latest, listId, isDefaultOrder(defaults, next) ? null : next));
    return true;
  }, [uid, listId, defaults]);

  const move = useCallback((id: string, targetId: string, position: DropPosition) =>
    commit(moveButton(orderedIds, id, targetId, position), orderedIds), [commit, orderedIds]);
  const step = useCallback((id: string, delta: -1 | 1, visibleIds: readonly string[] = orderedIds) =>
    commit(stepButton(orderedIds, visibleIds, id, delta), orderedIds), [commit, orderedIds]);
  const reset = useCallback(() => {
    if ((useAuthStore.getState().user?.uid || 'guest') !== uid) return;
    const latest = read(uid).orders;
    if (latest[listId]) write(uid, withButtonOrder(latest, listId, null));
  }, [uid, listId]);

  return { orderedIds, isCustom, storageError: snapshot.storageError, move, step, reset };
}
