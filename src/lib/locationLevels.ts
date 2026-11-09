/**
 * A-115: minimum/maximum stock per location. Each stock item may carry a minimum and a maximum for
 * any Location label value (InventoryItem.locationLevels, whole units). When a location's stock
 * falls below its minimum, the reorder suggestions' by-location mode suggests topping it back up
 * to the maximum (rounded up to whole packages, like the global suggestions).
 *
 * A location's stock comes from the item's stock-moves ledger and is used only when the history
 * proves it: the history must explain the item (stockHistoryProblem) and start from zero, so the
 * moves are the whole story and the location split is exact. Otherwise the item is listed as
 * unplaced with the reason, and no location suggestion is made for it. The global reorder point
 * and its suggestions are unchanged. Pure.
 */
import type { InventoryItem, Vendor } from '../types';
import { orderedMoves, stockByLocation, stockHistoryProblem, type StockMove } from './stockMoves';
import {
  groupReorderLines, reorderLineFor, roundUpToPack, vendorPriceMaps, type ReorderGroup, type ReorderLine,
} from './reorderSuggestions';
import { byCodeUnit } from './codeUnitOrder';

export interface LocationLevel {
  min: number;
  max: number;
}

/**
 * Why these typed levels cannot be saved, in plain words, or null: whole units, nothing below
 * zero, and the maximum at least the minimum. Both blank means no levels for the location.
 */
export function levelProblem(minRaw: string, maxRaw: string): string | null {
  const minText = String(minRaw ?? '').trim();
  const maxText = String(maxRaw ?? '').trim();
  if (!minText && !maxText) return null;
  if (!/^\d+$/.test(minText)) return 'The minimum is whole units, 0 or more.';
  if (!/^\d+$/.test(maxText)) return 'The maximum is whole units, 0 or more.';
  if (Number(maxText) < Number(minText)) return 'The maximum cannot be below the minimum.';
  return null;
}

/** The saved shape back from the form's hidden JSON; rows that are not valid levels are dropped. */
export function parseLocationLevelsJson(raw: unknown): Record<string, LocationLevel> {
  if (typeof raw !== 'string' || !raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, LocationLevel> = {};
    for (const [locationId, level] of Object.entries(parsed as Record<string, unknown>)) {
      if (!locationId || typeof level !== 'object' || level === null) continue;
      const { min, max } = level as { min?: unknown; max?: unknown };
      if (!Number.isInteger(min) || !Number.isInteger(max)) continue;
      if ((min as number) < 0 || (max as number) < (min as number)) continue;
      out[locationId] = { min: min as number, max: max as number };
    }
    return out;
  } catch { return {}; }
}

export interface LocatedStock {
  locationId: string;
  onHand: number;
}

export interface LocationStockReading {
  at: LocatedStock[];
  /** the history proves the split: it explains the item and starts from zero */
  provable: boolean;
  /** why the split cannot be used, when it cannot */
  reason?: string;
}

/**
 * Where an item's stock sits, from its stock-moves ledger. Provable only when the history
 * explains the item and starts from zero (a first move that starts above zero, or stock with no
 * history at all, sits at an unknown location). Locations that net to zero are left out.
 */
export function locationOnHand(
  item: { name?: string; quantityAtHand?: number },
  moves: StockMove[],
): LocationStockReading {
  const list = moves || [];
  const problem = stockHistoryProblem(item, list);
  if (problem) return { at: [], provable: false, reason: problem };
  const ordered = orderedMoves(list);
  if (ordered.length === 0) {
    if (Number(item.quantityAtHand) || 0) {
      return { at: [], provable: false, reason: 'Its stock came from before the stock history, so where it sits is not known.' };
    }
    return { at: [], provable: true };
  }
  if (Number(ordered[0].quantityBefore) || 0) {
    return { at: [], provable: false, reason: 'Its stock history starts before the ledger, so where its stock sits is not known.' };
  }
  return {
    at: [...stockByLocation(list)].map(([locationId, onHand]) => ({ locationId, onHand })),
    provable: true,
  };
}

export interface LocationReorderInput {
  items: InventoryItem[];
  movesByItem: Map<string, StockMove[]>;
  bills: Array<{ vendorId: string; date?: string; splits?: Array<{ itemId?: string; quantity?: number; amountCents: number }> }>;
  orders: Array<{ vendorId: string; issueDate: string; items?: Array<{ itemId?: string; unitPriceCents: number }> }>;
  vendors: Array<Pick<Vendor, 'id' | 'name'>>;
  locationName: (id: string) => string;
}

export interface UnplacedItem {
  itemId: string;
  name: string;
  reason: string;
}

/**
 * The by-location reorder suggestions, grouped by vendor like the global ones: one row per item
 * and location whose stock is below its minimum, suggesting the top-up to the maximum in whole
 * packages. Items with levels whose history does not prove the split are listed as unplaced with
 * the reason — never suggested. Items with no levels are left out (their global suggestion stands).
 */
export function locationReorderSuggestions(input: LocationReorderInput): { groups: ReorderGroup[]; unplaced: UnplacedItem[] } {
  const vendorName = new Map(input.vendors.map(v => [v.id, v.name] as const));
  const maps = vendorPriceMaps(input.bills, input.orders);
  const lines: Array<{ line: ReorderLine; vendorId?: string }> = [];
  const unplaced: UnplacedItem[] = [];
  for (const item of input.items || []) {
    if (item.itemType === 'service' || item.consignment) continue;
    const levels = item.locationLevels || {};
    const locationIds = Object.keys(levels);
    if (locationIds.length === 0) continue;
    const reading = locationOnHand(item, input.movesByItem.get(item.id) || []);
    if (!reading.provable) {
      unplaced.push({ itemId: item.id, name: item.name || item.sku || item.id, reason: reading.reason || 'Where its stock sits is not known.' });
      continue;
    }
    const at = new Map(reading.at.map(r => [r.locationId, r.onHand] as const));
    for (const locationId of locationIds.sort(byCodeUnit)) {
      const level = levels[locationId];
      const onHand = at.get(locationId) || 0;
      if (!(onHand < level.min)) continue;
      const packSize = Number(item.unitsPerPackage) || 1;
      const suggested = roundUpToPack(level.max - onHand, packSize);
      const { line, vendorId } = reorderLineFor(item, onHand, level.min, suggested, maps);
      lines.push({
        line: { ...line, locationId, locationName: input.locationName(locationId), maxLevel: level.max },
        vendorId,
      });
    }
  }
  return { groups: groupReorderLines(lines, vendorName), unplaced: unplaced.sort((a, b) => a.name.localeCompare(b.name)) };
}
