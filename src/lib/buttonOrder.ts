/**
 * The order a person gives to a list of buttons by dragging them (sidebar tools, calculators, …).
 *
 * Presentation only: an order never decides which buttons exist, who may open them or what they
 * do. The list a screen passes in (after its own permission and module checks) is always the list
 * that is shown; a saved order only says which of those comes first.
 *
 * Pure functions, no storage and no React: `src/hooks/useButtonOrder.ts` keeps the saved orders.
 */

/** Where a dragged button lands, relative to the button it was dropped on. */
export type DropPosition = 'before' | 'after';

/** Every saved list of one person, keyed by the list's name. */
export type SavedButtonOrders = Readonly<Record<string, readonly string[]>>;

/** One list never needs more ids than this; a longer saved list is cut, not trusted. */
export const MAX_ORDER_IDS = 1000;
/** One person never has more saved lists than this. */
export const MAX_ORDER_LISTS = 100;
const MAX_ID_LENGTH = 200;

/** Saved per person and per workspace on this device, as bookmarks are (src/lib/AGENTS.md). */
export const buttonOrderStorageKey = (uid: string, workspace: string) => `ledgerflow:button-order:v1:${JSON.stringify([uid, workspace])}`;

const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH;

/** The ids once each, in the order first seen. */
function unique(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  return ids.filter(id => (seen.has(id) ? false : (seen.add(id), true)));
}

/**
 * The buttons in the person's order.
 *
 * - Every id in `defaultIds` comes back exactly once, and nothing else does: a saved id that no
 *   longer exists (a removed tool, a module that was turned off) is ignored.
 * - A button the saved order has never seen (a tool added after the person arranged the list)
 *   goes straight after the button that precedes it in the default order, so new tools appear
 *   where the product put them instead of all piling up at the end.
 * - No saved order gives the default order back unchanged.
 */
export function applyButtonOrder(defaultIds: readonly string[], saved: readonly string[] | null | undefined): string[] {
  const defaults = unique(defaultIds);
  if (!saved || saved.length === 0) return defaults;
  const known = new Set(defaults);
  const result = unique(saved.filter(id => known.has(id)));
  if (result.length === 0) return defaults;
  const placed = new Set(result);
  defaults.forEach((id, index) => {
    if (placed.has(id)) return;
    // the nearest earlier default neighbour is always placed by now (defaults are walked in order)
    const previous = index > 0 ? defaults[index - 1] : null;
    const at = previous === null ? 0 : result.indexOf(previous) + 1;
    result.splice(at, 0, id);
    placed.add(id);
  });
  return result;
}

/**
 * `id` moved to just before or just after `targetId`. The same array comes back (so callers can
 * tell nothing happened) when either id is unknown, both are the same, or the button is already
 * in that place.
 */
export function moveButton(ids: readonly string[], id: string, targetId: string, position: DropPosition): readonly string[] {
  if (id === targetId) return ids;
  const from = ids.indexOf(id);
  if (from < 0 || !ids.includes(targetId)) return ids;
  const without = ids.filter(other => other !== id);
  const at = without.indexOf(targetId) + (position === 'after' ? 1 : 0);
  if (at === from) return ids;
  without.splice(at, 0, id);
  return without;
}

/**
 * `id` moved one place earlier (-1) or later (+1) among the buttons that are on screen now.
 * `visibleIds` is what the person sees (a search or a permission may hide some of `ids`); the
 * move is made in the full list so hidden buttons keep their place. The same array comes back at
 * either end of the list.
 */
export function stepButton(ids: readonly string[], visibleIds: readonly string[], id: string, delta: -1 | 1): readonly string[] {
  const index = visibleIds.indexOf(id);
  const neighbour = index < 0 ? undefined : visibleIds[index + delta];
  if (neighbour === undefined) return ids;
  return moveButton(ids, id, neighbour, delta === 1 ? 'after' : 'before');
}

/** Is this the order the product ships with? (Then nothing needs saving and no reset is offered.) */
export function isDefaultOrder(defaultIds: readonly string[], ids: readonly string[]): boolean {
  const defaults = unique(defaultIds);
  return defaults.length === ids.length && defaults.every((id, index) => id === ids[index]);
}

/**
 * What was saved, or nothing. Anything that is not exactly the expected shape is dropped rather
 * than repaired: a damaged or foreign value must never break a menu.
 */
export function parseButtonOrders(raw: string | null | undefined): SavedButtonOrders {
  try {
    const data: unknown = JSON.parse(raw || 'null');
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    const { version, lists } = data as { version?: unknown; lists?: unknown };
    if (version !== 1 || !lists || typeof lists !== 'object' || Array.isArray(lists)) return {};
    const result: Record<string, string[]> = {};
    for (const [listId, ids] of Object.entries(lists as Record<string, unknown>).slice(0, MAX_ORDER_LISTS)) {
      if (!isId(listId) || !Array.isArray(ids)) continue;
      const clean = unique(ids.filter(isId)).slice(0, MAX_ORDER_IDS);
      if (clean.length > 0) result[listId] = clean;
    }
    return result;
  } catch {
    return {};
  }
}

/** The text that is saved; `parseButtonOrders` reads it back. */
export function serializeButtonOrders(orders: SavedButtonOrders): string {
  return JSON.stringify({ version: 1, lists: orders });
}

/** The saved orders with one list replaced, or forgotten when `ids` is null or empty. */
export function withButtonOrder(orders: SavedButtonOrders, listId: string, ids: readonly string[] | null): SavedButtonOrders {
  const next: Record<string, readonly string[]> = { ...orders };
  if (!ids || ids.length === 0) delete next[listId];
  else next[listId] = unique(ids).slice(0, MAX_ORDER_IDS);
  return next;
}

/** A button's box on screen (viewport pixels), as `getBoundingClientRect` reports it. */
export interface ButtonBox { id: string; left: number; top: number; right: number; bottom: number }

/** A list that runs down the page, or one that runs across it (rows that wrap and grids included). */
export type ReorderAxis = 'vertical' | 'horizontal';

/** A drop further than this from every button (in pixels) is a drop on nothing: the drag is called off. */
export const DROP_REACH_PX = 96;

/**
 * Where a button dragged to (`x`, `y`) would land: the nearest other button, and whether the pointer
 * is on its leading or trailing half. Nothing comes back when the pointer is too far from the list
 * (the person dragged the button away to give up).
 */
export function nearestDropTarget(
  x: number,
  y: number,
  boxes: readonly ButtonBox[],
  axis: ReorderAxis,
  reach = DROP_REACH_PX,
): { id: string; position: DropPosition } | null {
  let best: ButtonBox | null = null;
  let bestDistance = Infinity;
  for (const box of boxes) {
    const dx = Math.max(box.left - x, 0, x - box.right);
    const dy = Math.max(box.top - y, 0, y - box.bottom);
    const distance = Math.hypot(dx, dy);
    if (distance < bestDistance) { best = box; bestDistance = distance; }
  }
  if (!best || bestDistance > reach) return null;
  const leading = axis === 'vertical' ? y < (best.top + best.bottom) / 2 : x < (best.left + best.right) / 2;
  return { id: best.id, position: leading ? 'before' : 'after' };
}
