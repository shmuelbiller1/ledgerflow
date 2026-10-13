/**
 * A-45 (PLAN W-04/W-05): inventory cycle counts — a count sheet for one place, what the ledger says
 * is there, what a person counted, and the variance in units and at the item's own cost.
 *
 * The loop: `openCountSheet` lists the items the stock-moves history puts at that place (W-01's
 * `stockByLocation`), a person enters counted quantities with `enterCount`, `countSheetVariance`
 * shows the differences and their value, and `markReady` only **marks the sheet ready** — it does not
 * post anything. Posting the adjustment is AI #1's lane: the server's stock-count path
 * (`/api/v1/inventory/count`) is what actually changes the quantity and writes the entry, and this
 * library deliberately calls nothing.
 *
 * Honesty rules kept from the rest of the stock screens:
 *  - a count of a place where the history does not explain the quantity is marked `unexplained`, so
 *    the variance report can say the *expected* figure may be wrong instead of blaming the count;
 *  - an item with no history at all is listed from its own quantity on hand (a named place then says
 *    the places of its units are unknown);
 *  - a row the person did not count is never treated as zero: it is listed under `notCounted`.
 * Pure.
 */
import type { InventoryItem } from '../types';
import { NO_LOCATION, stockByLocation, stockHistoryProblem, type StockMove } from './stockMoves';

export type CountSheetStatus = 'open' | 'ready';

export interface CountSheetRow {
  itemId: string;
  itemName: string;
  sku?: string;
  /** units the ledger says are at this place */
  expected: number;
  /** the item's own cost basis — the average cost the value of the difference is taken at */
  unitCostCents: number;
  /** what the person counted; undefined = not counted yet (never treated as zero) */
  counted?: number;
  /** the history does not explain this item's quantity, so `expected` may be wrong */
  unexplained?: boolean;
  /** why the expected figure may be wrong, for the screen */
  unexplainedReason?: string;
}

export interface CountSheet {
  id: string;
  /** a Location label value; '' is the stock with no location (NO_LOCATION) */
  locationId: string;
  date: string;
  status: CountSheetStatus;
  rows: CountSheetRow[];
  note?: string;
  /** who marked it ready and when — a person, shown on the sheet */
  markedReadyBy?: string;
  markedReadyAt?: string;
}

/** The sheet's id: one sheet per place and day. */
export function countSheetId(locationId: string, date: string): string {
  return `count-${locationId || 'no-location'}-${date}`;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export interface OpenCountSheetInput {
  locationId: string;
  /** YYYY-MM-DD the count is made */
  date: string;
  items: Array<Pick<InventoryItem, 'id' | 'name' | 'sku' | 'quantityAtHand' | 'unitCostCents'>>;
  /** the workspace's stock-moves ledger (any items; each row reads its own) */
  moves?: StockMove[];
  /** list every item, including the ones the ledger does not put at this place (a full count) */
  includeZero?: boolean;
  note?: string;
}

/**
 * Open a sheet for a place. By default only the items the ledger puts there are listed (a cycle
 * count is a subset); `includeZero` lists every item for a full count. The expected quantity of an
 * item with no history is its own quantity on hand, and the row says the history does not explain it.
 */
export function openCountSheet(input: OpenCountSheetInput): CountSheet {
  const moves = input.moves || [];
  const rows: CountSheetRow[] = [];
  for (const item of input.items) {
    const itemMoves = moves.filter(m => m.itemId === item.id);
    const problem = itemMoves.length ? stockHistoryProblem(item, itemMoves) : null;
    const at = stockByLocation(itemMoves);
    const inLedger = at.has(input.locationId);
    const expected = itemMoves.length
      ? round6(at.get(input.locationId) || 0)
      : input.locationId === NO_LOCATION ? round6(Number(item.quantityAtHand) || 0) : 0;
    if (!input.includeZero && expected === 0 && !problem) continue;
    const unexplainedReason = problem
      ? problem
      : !itemMoves.length
        ? (input.locationId === NO_LOCATION
          ? 'no stock history: the quantity on hand is used as expected'
          : 'no stock history: nothing says these units are at this place')
        : !inLedger ? 'the stock-moves ledger has no units of this item at this place' : undefined;
    rows.push({
      itemId: item.id, itemName: item.name, ...(item.sku ? { sku: item.sku } : {}),
      expected, unitCostCents: Number(item.unitCostCents) || 0,
      ...(unexplainedReason ? { unexplained: true, unexplainedReason } : {}),
    });
  }
  return {
    id: countSheetId(input.locationId, input.date), locationId: input.locationId, date: input.date,
    status: 'open', rows, ...(input.note ? { note: input.note } : {}),
  };
}

/** Why a typed count cannot be read, or null. Blank means "not counted", which is allowed. */
export function countInputProblem(raw: string): string | null {
  if (raw.trim() === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return 'Enter a number, or leave the row blank to skip it';
  if (value < 0) return 'A counted quantity cannot be negative';
  if (round6(value) !== value) return 'Enter at most six decimal places';
  return null;
}

/** Enter what was counted for one item; blank clears the row back to "not counted". */
export function enterCount(sheet: CountSheet, itemId: string, raw: string): CountSheet {
  const problem = countInputProblem(raw);
  if (problem) return sheet;
  const counted = raw.trim() === '' ? undefined : Number(raw);
  return {
    ...sheet,
    status: sheet.status === 'ready' ? 'ready' : 'open',
    rows: sheet.rows.map(row => {
      if (row.itemId !== itemId) return row;
      const { counted: _drop, ...rest } = row;
      return counted === undefined ? rest : { ...row, counted };
    }),
  };
}

export interface CountVarianceRow {
  itemId: string;
  itemName: string;
  expected: number;
  counted: number;
  /** counted − expected */
  difference: number;
  /** the difference valued at the item's own cost (positive = found stock, negative = short) */
  valueCents: number;
  unexplained: boolean;
}

export interface CountVariance {
  /** every counted row, in the sheet's order */
  countedRows: CountVarianceRow[];
  /** only the counted rows that differ from the ledger */
  differences: CountVarianceRow[];
  /** rows the person did not count — never read as zero */
  notCounted: CountSheetRow[];
  /** units short (a negative difference) and units found, as positive numbers */
  unitsShort: number;
  unitsFound: number;
  /** the value of the differences at the items' own cost, signed: negative = a shortage */
  valueCents: number;
  /** counted rows whose expected figure the history does not explain */
  unexplained: CountVarianceRow[];
}

/** The variance of a sheet: quantity and value at the item's own (average) cost. */
export function countSheetVariance(sheet: CountSheet): CountVariance {
  const countedRows: CountVarianceRow[] = [];
  const notCounted: CountSheetRow[] = [];
  for (const row of sheet.rows) {
    if (row.counted === undefined) { notCounted.push(row); continue; }
    const difference = round6(row.counted - row.expected);
    countedRows.push({
      itemId: row.itemId, itemName: row.itemName, expected: row.expected, counted: row.counted,
      difference, valueCents: Math.round(difference * row.unitCostCents), unexplained: Boolean(row.unexplained),
    });
  }
  const differences = countedRows.filter(r => r.difference !== 0);
  const sumOf = (of: (row: CountVarianceRow) => number) => round6(countedRows.reduce((s, row) => s + of(row), 0));
  return {
    countedRows, differences, notCounted,
    unitsShort: Math.abs(sumOf(row => (row.difference < 0 ? row.difference : 0))),
    unitsFound: sumOf(row => (row.difference > 0 ? row.difference : 0)),
    valueCents: countedRows.reduce((s, r) => s + r.valueCents, 0),
    unexplained: countedRows.filter(r => r.unexplained),
  };
}

/** Why the sheet cannot be marked ready, or null. */
export function readyProblem(sheet: CountSheet): string | null {
  if (sheet.status === 'ready') return 'This sheet is already marked ready';
  if (!sheet.rows.length) return 'There is nothing on this sheet to count';
  const variance = countSheetVariance(sheet);
  if (!variance.countedRows.length) return 'Nothing is counted yet — enter the counted quantities first';
  if (variance.unexplained.length) {
    return `The stock history does not explain ${variance.unexplained.length} counted row${variance.unexplained.length === 1 ? '' : 's'} (${variance.unexplained.map(r => r.itemName).join(', ')}); check the history or record the missing movement before marking the sheet ready`;
  }
  return null;
}

/**
 * Mark the sheet ready for the adjustment to be posted. **This posts nothing**: it records who
 * checked the count and when. The server's stock-count path (AI #1's `/api/v1/inventory/count`,
 * reached from the Inventory screen) is what changes quantities and writes the entry.
 */
export function markReady(sheet: CountSheet, by: string, at: string): { sheet: CountSheet; problem?: string } {
  const problem = readyProblem(sheet);
  if (problem) return { sheet, problem };
  return { sheet: { ...sheet, status: 'ready', markedReadyBy: by, markedReadyAt: at } };
}

/** What the screen says when the differences are posted elsewhere — kept next to the rule, not in a screen. */
export const COUNT_POSTING_NOTE = 'Marking a sheet ready does not post it: the stock-count adjustment is posted by the inventory count on the Inventory screen (the server writes the entry and the stock-moves history).';
