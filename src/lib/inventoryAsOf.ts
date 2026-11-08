/**
 * ISS-131: the stock on hand and its value as of a past date, from the stock-moves ledger (W-02) — never today's
 * quantities and costs relabelled with an old date.
 *
 * The figures come from one reading of the whole history (`itemDetails` from its start to today, the server's
 * `/reports/inventory-details`). An item's quantity on the date is the sum of its moves dated on or before it, and
 * its value the sum of those moves' own values (the cost each move was booked at, moving weighted average), so a
 * later purchase, a later cost edit or a move written later but dated earlier (backdated) is placed by its date.
 *
 * An item's past figure is given only when the history explains it:
 *  - the history starts from zero (what came in less what went out equals where it ends), and
 *  - it ends at the item's quantity on hand today; a deleted item whose history still holds stock is unknown, since
 *    the deletion left no move saying when the stock went;
 *  - an item that never moved and has nothing on hand is zero on the date only when that is proven: it is a service,
 *    it was created after the date, or it was created after the stock history began (so a move would exist).
 * Otherwise the item is "unknown" with the reason, and is never shown as an exact zero. Pure.
 */
import type { ItemDetails } from './stockMoves';
import { byCodeUnit } from './codeUnitOrder';

export interface InventoryAsOfRow {
  itemId: string;
  name: string;
  /** null when the history does not explain the item */
  quantity: number | null;
  valueCents: number | null;
  unitCostCents: number | null;
  /** why the past figure is not known */
  unknownReason?: string;
}

export interface InventoryAsOf {
  asOf: string;
  rows: InventoryAsOfRow[];
  /** the value of the items whose past figure is known */
  knownValueCents: number;
  unknownItems: number;
  /** every item is known: the total is the stock's value on the date */
  complete: boolean;
  negativeStockItems: number;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function inventoryAsOf(input: {
  asOf: string;
  items: Array<{ id: string; name?: string; quantityAtHand?: number; itemType?: string; createdAt?: string }>;
  /** `itemDetails` from the start of the history to today */
  toToday: ItemDetails[];
  /** #256 review: the item list is capped, so an item missing from it may exist: it is not called deleted */
  itemsPartial?: boolean;
}): InventoryAsOf {
  const now = new Map(input.toToday.map(d => [d.itemId, d]));
  const items = new Map(input.items.map(i => [i.id, i]));
  const ids = [...new Set([...input.items.map(i => i.id), ...input.toToday.map(d => d.itemId)])];
  // the first day any move was written: an item created after it would have a move for any stock it ever had.
  // #256 review: the day written, not the move's own date — a backdated move does not move the start earlier; with
  // no write day kept, nothing is proven by it
  const historyStart = input.toToday.flatMap(d => d.moves.map(m => m.writtenOn || '')).filter(Boolean).sort(byCodeUnit)[0];

  const rows = ids.map((itemId): InventoryAsOfRow => {
    const item = items.get(itemId);
    const today = now.get(itemId);
    const name = item?.name || today?.itemName || itemId;
    const onHand = round6(Number(item?.quantityAtHand) || 0);
    const unknown = (unknownReason: string): InventoryAsOfRow => ({ itemId, name, quantity: null, valueCents: null, unitCostCents: null, unknownReason });
    if (!today) {
      if (onHand !== 0) return unknown(`${onHand} on hand today with no stock history, so its stock on ${input.asOf} is not known`);
      const created = String(item?.createdAt || '').slice(0, 10);
      const provenZero = item?.itemType === 'service' || (created && created > input.asOf) || (created && historyStart && created >= historyStart);
      if (!provenZero) return unknown(`no stock history, and it may have held stock before the history was kept`);
      return { itemId, name, quantity: 0, valueCents: 0, unitCostCents: 0 };
    }
    const startsAt = round6(today.closing.quantity - (today.received - today.issued));
    if (startsAt !== 0) return unknown(`its stock history starts at ${startsAt} units (stock from before the history was kept)`);
    // placed by date, not by the order the moves were written (a backdated move counts on its own date)
    const dated = today.moves.filter(m => m.date <= input.asOf);
    if (!item && round6(today.closing.quantity) !== 0) {
      // #256 review: with a capped item list, an item not in it may simply not be loaded
      if (input.itemsPartial) return unknown(`it is not in the loaded item list (the list is capped), so its stock on ${input.asOf} is not checked`);
      // #256 review: before its first move the history (which starts at zero) proves it had none
      if (dated.length > 0) return unknown(`it was deleted with ${today.closing.quantity} still in its stock history, which does not say when that stock went`);
      return { itemId, name, quantity: 0, valueCents: 0, unitCostCents: 0 };
    }
    if (item && round6(today.closing.quantity) !== onHand) return unknown(`its stock history ends at ${today.closing.quantity}, but ${onHand} are on hand`);
    const quantity = round6(dated.reduce((sum, m) => sum + (Number(m.quantity) || 0), 0));
    const valueCents = Math.round(dated.reduce((sum, m) => sum + (Number(m.valueCents) || 0), 0));
    return {
      itemId, name, quantity,
      // negative stock is valued at 0, as the current valuation does
      valueCents: quantity > 0 ? valueCents : 0,
      unitCostCents: quantity > 0 ? Math.round(valueCents / quantity) : 0,
    };
  }).filter(r => r.quantity !== 0 || r.unknownReason || (r.valueCents ?? 0) !== 0);

  const known = rows.filter(r => r.quantity !== null);
  return {
    asOf: input.asOf,
    rows: rows.sort((a, b) => (b.valueCents ?? -1) - (a.valueCents ?? -1) || a.name.localeCompare(b.name)),
    knownValueCents: known.reduce((s, r) => s + (r.valueCents || 0), 0),
    unknownItems: rows.length - known.length,
    complete: known.length === rows.length,
    negativeStockItems: known.filter(r => (r.quantity || 0) < 0).length,
  };
}
