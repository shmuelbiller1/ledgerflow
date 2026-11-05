/**
 * EG-7: the stock closing snapshot and the stock invariants. Pure: the server builds and checks with it
 * (src/server/services/stockClosingService.ts), the nightly Data Health run reads `STOCK_INVARIANT_CHECKS`
 * (src/lib/dataChecks.ts), and the Inventory Valuation panel shows what the server returns.
 *
 * Stock value at a date = the sum of the moves' values dated on or before it (the moving-average value the
 * stock-moves ledger keeps, as Inventory details and Stock aging read it). The books' value = the Inventory
 * accounts' balance at the same date. The three checks:
 *   (a) the stock value equals the Inventory balance; a difference is put on the item whose entry posted a
 *       different value than its stock moves (or that moved with no entry), and what no move explains (a manual
 *       journal to Inventory, an opening balance) is listed by entry;
 *   (b) no item ends any day below zero, by the moves' dates (a move dated back can take a day below zero even
 *       when each move, in the order written, stayed above it);
 *   (c) a snapshot's checksum still matches the moves it covers; otherwise it is stale.
 */
import type { ChartAccount, Transaction } from '../types';
import { resolveAccountRole } from './accountUtils';
import { isPostable, lineAmount, transactionDate } from './txFilters';
import { datedMoves, NO_LOCATION, orderedMoves, type StockMove } from './stockMoves';
import type { CheckFinding, DataCheck } from './dataChecks';
import { formatCurrency } from './moneyFormat';

export interface StockClosingRow {
  itemId: string;
  itemName: string;
  /** a Location label value; '' = no location */
  locationId: string;
  quantity: number;
  valueCents: number;
  /** the moves with units at this location (a revaluation without a location is spread, and counted on the item) */
  moveCount: number;
  checksum: string;
}

export interface StockClosing {
  workspaceId: string;
  /** the period end (YYYY-MM-DD) */
  asOf: string;
  rows: StockClosingRow[];
  moveCount: number;
  /** over the moves dated through `asOf` and each item's history start */
  checksum: string;
  /** over the entries through `asOf` that touch an Inventory account (absent on closings taken before it was kept) */
  booksChecksum?: string;
  stockValueCents: number;
  /** the Inventory accounts' balance at `asOf` (balancesAsOf, plus the accounts' opening balances) */
  inventoryBalanceCents: number;
  /** stock less books */
  differenceCents: number;
  /** false when an item's history starts with units it has no value for (stock from before the history) */
  complete: boolean;
  incompleteItems: Array<{ itemId: string; itemName: string; quantity: number; reason?: string }>;
  builtAt: string;
  builtBy: string;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const day = (d: unknown) => String(d || '').slice(0, 10);
/** money in the workspace currency's own minor units (JPY 0, KWD 3), with the shared formatter */
const money = (cents: number, currency?: string) => formatCurrency(cents, currency || 'USD');

/** FNV-1a, 64 bits, as hex: the same in the browser and on the server, over a list kept in order. */
export function fnv64(text: string): string {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i++) {
    h ^= BigInt(text.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0');
}

/** What a move contributes to a checksum: everything that changes a quantity or a value, and its place in the order. */
const moveKey = (m: StockMove) => [m.id || '', m.itemId, m.locationId || NO_LOCATION, day(m.date), m.seq, round6(Number(m.quantity) || 0), Number(m.valueCents) || 0].join('|');

export const movesChecksum = (moves: StockMove[]) => fnv64(moves.map(moveKey).sort().join('\n'));

/** The moves a closing at `asOf` covers. */
export const movesUpTo = (moves: StockMove[], asOf: string) => moves.filter(m => day(m.date) !== '' && day(m.date) <= asOf);

/** Each item's history start: the quantity before its first move in the order written (over ALL its moves, any date). */
export function historyStarts(moves: StockMove[]): Map<string, number> {
  const byItem = new Map<string, StockMove[]>();
  for (const m of moves) byItem.set(m.itemId, [...(byItem.get(m.itemId) || []), m]);
  return new Map([...byItem].map(([itemId, list]) => [itemId, round6(Number(orderedMoves(list)[0].quantityBefore) || 0)]));
}

/** The entries through `asOf` that touch an Inventory account, as a checksum of their Inventory lines. */
export function inventoryEntriesChecksum(entries: Transaction[], accounts: ChartAccount[], asOf: string): string {
  const inventory = new Set(accounts.filter(a => resolveAccountRole(a) === 'inventory').map(a => a.id));
  const keys: string[] = [];
  for (const tx of entries) {
    const d = transactionDate(tx);
    if (!isPostable(tx) || d === '' || d > asOf) continue;
    const lines = (tx.lines || []).filter(l => l && inventory.has(l.accountId)).map(l => `${l.accountId}:${lineAmount(l, tx)}`);
    if (lines.length) keys.push(`${tx.id}|${d}|${lines.sort().join(',')}`);
  }
  const opening = accounts.filter(a => inventory.has(a.id)).map(a => `${a.id}:${Number(a.openingBalanceCents) || 0}`).sort();
  return fnv64([...keys.sort(), `opening|${opening.join(',')}`].join('\n'));
}

/** Shares `cents` over `weights` (all positive) by the largest remainder, so the parts add back to it exactly. */
function spread(cents: number, weights: number[]): number[] {
  const total = weights.reduce((s, w) => s + w, 0);
  const raw = weights.map(w => (cents * w) / total);
  const parts = raw.map(r => Math.trunc(r));
  let left = cents - parts.reduce((s, p) => s + p, 0);
  const order = raw.map((r, i) => [Math.abs(r - parts[i]), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left !== 0 && k < order.length; k++, left -= Math.sign(left)) parts[order[k][1]] += Math.sign(left);
  return parts;
}

/**
 * The closing snapshot at `asOf`, per item and location. The history is read whole (any date) for each item's start,
 * then the moves dated through `asOf` are summed: a move written first but dated later does not leak into it.
 * Units the history starts with have no value basis: they are kept at no location and the closing says it is
 * incomplete. A change of value with no units and no location (a revaluation) is spread, at its own place in the
 * dated history (before the moves after it), over the locations holding units then, by their quantity (largest
 * remainder); it stays at no location only when no location holds units. `items` (the item list), when given, adds
 * the items with stock on hand and no stock history at all: their stock on the date is not known (incomplete).
 */
export function buildStockClosing(input: { workspaceId: string; asOf: string; moves: StockMove[]; inventoryBalanceCents: number; booksChecksum?: string; builtBy: string; at: string; items?: Array<{ id: string; name?: string; quantityAtHand?: number; itemType?: string }> }): StockClosing {
  const starts = historyStarts(input.moves);
  const covered = movesUpTo(input.moves, input.asOf);
  const byItem = new Map<string, StockMove[]>();
  for (const m of covered) byItem.set(m.itemId, [...(byItem.get(m.itemId) || []), m]);
  const rows: StockClosingRow[] = [];
  const incompleteItems: StockClosing['incompleteItems'] = [];
  for (const [itemId, list] of byItem) {
    const itemName = String(list.find(m => m.itemName)?.itemName || itemId);
    const at = new Map<string, { quantity: number; valueCents: number; moves: StockMove[] }>();
    const slot = (where: string) => at.get(where) || at.set(where, { quantity: 0, valueCents: 0, moves: [] }).get(where)!;
    const start = starts.get(itemId) || 0;
    if (start) { slot(NO_LOCATION).quantity = start; incompleteItems.push({ itemId, itemName, quantity: start }); }
    for (const m of datedMoves(list)) {
      if (!m.locationId && !Number(m.quantity)) {
        // a revaluation with no location: over the locations holding units at this point of the dated history
        const cents = Number(m.valueCents) || 0;
        const holding = [...at].filter(([, s]) => s.quantity > 0);
        if (holding.length) spread(cents, holding.map(([, s]) => s.quantity)).forEach((c, i) => { holding[i][1].valueCents += c; });
        else slot(NO_LOCATION).valueCents += cents;
        continue;
      }
      const s = slot(m.locationId || NO_LOCATION);
      s.quantity = round6(s.quantity + (Number(m.quantity) || 0));
      s.valueCents += Number(m.valueCents) || 0;
      s.moves.push(m);
    }
    for (const [locationId, s] of at) {
      if (s.quantity === 0 && s.valueCents === 0 && s.moves.length === 0) continue;
      rows.push({ itemId, itemName, locationId, quantity: s.quantity, valueCents: s.valueCents, moveCount: s.moves.length, checksum: fnv64(`${locationId === NO_LOCATION ? start : 0}|${movesChecksum(s.moves)}`) });
    }
  }
  // stock on hand today and no stock history at all: its stock on the date is not known (as inventoryAsOf says)
  for (const item of input.items || []) {
    const onHand = round6(Number(item.quantityAtHand) || 0);
    if (onHand === 0 || item.itemType === 'service' || starts.has(item.id)) continue;
    incompleteItems.push({ itemId: item.id, itemName: String(item.name || item.id), quantity: onHand, reason: `${onHand} on hand today with no stock history, so its stock on ${input.asOf} is not known` });
  }
  rows.sort((a, b) => a.itemName.localeCompare(b.itemName) || a.locationId.localeCompare(b.locationId));
  const stockValueCents = rows.reduce((s, r) => s + r.valueCents, 0);
  const startKey = [...byItem.keys()].sort().map(id => `${id}:${starts.get(id) || 0}`).join(',');
  return {
    workspaceId: input.workspaceId, asOf: input.asOf, rows, moveCount: covered.length, checksum: fnv64(`${movesChecksum(covered)}|${startKey}`),
    ...(input.booksChecksum ? { booksChecksum: input.booksChecksum } : {}),
    stockValueCents, inventoryBalanceCents: input.inventoryBalanceCents, differenceCents: stockValueCents - input.inventoryBalanceCents,
    complete: incompleteItems.length === 0, incompleteItems: incompleteItems.sort((x, y) => x.itemName.localeCompare(y.itemName)),
    builtAt: input.at, builtBy: input.builtBy,
  };
}

export interface BooksCheck {
  ok: boolean;
  asOf: string;
  stockValueCents: number;
  inventoryBalanceCents: number;
  /** stock less books */
  differenceCents: number;
  byItem: Array<{ itemId: string; itemName: string; differenceCents: number }>;
  /** Inventory amounts no stock move explains (stock less books, so a journal of +10.00 to Inventory is −1,000) */
  unattributed: Array<{ transactionId: string; date: string; description: string; differenceCents: number }>;
  message: string;
}

/**
 * Check (a). `inventoryBalanceCents` is the Inventory balance from balancesAsOf when the caller has it; without it the
 * balance is summed from `entries` (and the accounts' opening balances). The split by item reads `entries`.
 */
export function checkStockAgainstBooks(input: { asOf: string; moves: StockMove[]; entries: Transaction[]; accounts: ChartAccount[]; inventoryBalanceCents?: number; currency?: string }): BooksCheck {
  const fmt = (cents: number) => money(cents, input.currency);
  const inventory = new Set(input.accounts.filter(a => resolveAccountRole(a) === 'inventory').map(a => a.id));
  const covered = movesUpTo(input.moves, input.asOf);
  const names = new Map(covered.map(m => [m.itemId, String(m.itemName || m.itemId)]));
  const byItem = new Map<string, number>();
  const toItem = (itemId: string, cents: number) => { if (cents) byItem.set(itemId, (byItem.get(itemId) || 0) + cents); };
  const movesByEntry = new Map<string, StockMove[]>();
  for (const m of covered) {
    if (m.transactionId) movesByEntry.set(m.transactionId, [...(movesByEntry.get(m.transactionId) || []), m]);
  }
  const unattributed: BooksCheck['unattributed'] = [];
  let booksFromEntries = 0;
  const seen = new Set<string>();
  for (const tx of input.entries) {
    const d = transactionDate(tx);
    if (!isPostable(tx) || d === '' || d > input.asOf) continue;
    const posted = (tx.lines || []).filter(l => l && inventory.has(l.accountId)).reduce((s, l) => s + lineAmount(l, tx), 0);
    booksFromEntries += posted;
    const moves = movesByEntry.get(tx.id) || [];
    seen.add(tx.id);
    const moved = moves.reduce((s, m) => s + (Number(m.valueCents) || 0), 0);
    if (moved === posted) continue;
    const items = [...new Set(moves.map(m => m.itemId))];
    if (items.length === 1) toItem(items[0], moved - posted);
    else unattributed.push({ transactionId: tx.id, date: d, description: String(tx.description || ''), differenceCents: moved - posted });
  }
  // moves whose entry is not in the books on the date (none, voided, deleted): stock with no value in the books
  for (const m of covered) if (!m.transactionId || !seen.has(m.transactionId)) toItem(m.itemId, Number(m.valueCents) || 0);
  const opening = input.accounts.filter(a => inventory.has(a.id)).reduce((s, a) => s + (Number(a.openingBalanceCents) || 0), 0);
  if (opening) unattributed.push({ transactionId: '', date: '', description: 'Opening balance of the Inventory account', differenceCents: -opening });
  const stockValueCents = covered.reduce((s, m) => s + (Number(m.valueCents) || 0), 0);
  const inventoryBalanceCents = input.inventoryBalanceCents ?? booksFromEntries + opening;
  const residual = inventoryBalanceCents - (booksFromEntries + opening);
  if (residual) unattributed.push({ transactionId: '', date: '', description: 'Inventory balance not found in the entries read', differenceCents: -residual });
  const differenceCents = stockValueCents - inventoryBalanceCents;
  const items = [...byItem].map(([itemId, c]) => ({ itemId, itemName: names.get(itemId) || itemId, differenceCents: c })).sort((a, b) => a.itemName.localeCompare(b.itemName));
  const parts = [
    ...items.map(i => `${i.itemName} ${fmt(i.differenceCents)}`),
    ...unattributed.map(u => `${u.description || u.transactionId}${u.date ? ` (${u.date})` : ''} ${fmt(u.differenceCents)}`),
  ];
  const message = differenceCents === 0
    ? `On ${input.asOf} the stock is worth ${fmt(stockValueCents)}, the same as the Inventory account.`
    : `On ${input.asOf} the stock is worth ${fmt(stockValueCents)} but the Inventory account shows ${fmt(inventoryBalanceCents)}: the books have ${fmt(Math.abs(differenceCents))} ${differenceCents < 0 ? 'more' : 'less'} than the stock.${parts.length ? ` From: ${parts.slice(0, 5).join('; ')}${parts.length > 5 ? `; and ${parts.length - 5} more` : ''}.` : ''}`;
  return { ok: differenceCents === 0, asOf: input.asOf, stockValueCents, inventoryBalanceCents, differenceCents, byItem: items, unattributed, message };
}

export interface NegativeDay { itemId: string; itemName: string; date: string; quantity: number }

/**
 * Each item's quantity at the end of each day it moved, by the moves' dates: the history's start (the first move's
 * quantity before, in the order written) plus every move dated on or before that day.
 */
export function datedQuantities(moves: StockMove[]): Map<string, Array<{ date: string; quantity: number }>> {
  const byItem = new Map<string, StockMove[]>();
  for (const m of moves) if (day(m.date)) byItem.set(m.itemId, [...(byItem.get(m.itemId) || []), m]);
  const out = new Map<string, Array<{ date: string; quantity: number }>>();
  for (const [itemId, list] of byItem) {
    // EG-1's datedMoves: in date order, the quantities derived from the quantities moved; the last move of a day ends it
    const endOfDay = new Map<string, number>();
    for (const m of datedMoves(list)) endOfDay.set(day(m.date), m.quantityAfter);
    out.set(itemId, [...endOfDay].map(([date, quantity]) => ({ date, quantity })));
  }
  return out;
}

/**
 * Check (b): the first day, through `asOf` when given, each item ended below zero. The dated quantities are
 * reconstructed from all the moves (any date), then read up to `asOf`.
 */
export function negativeStockDays(moves: StockMove[], asOf?: string): { ok: boolean; items: NegativeDay[]; message: string } {
  const names = new Map(moves.map(m => [m.itemId, String(m.itemName || m.itemId)]));
  const items: NegativeDay[] = [];
  for (const [itemId, days] of datedQuantities(moves)) {
    const first = days.find(d => d.quantity < 0 && (!asOf || d.date <= asOf));
    if (first) items.push({ itemId, itemName: names.get(itemId) || itemId, date: first.date, quantity: first.quantity });
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || a.itemName.localeCompare(b.itemName));
  const message = items.length === 0
    ? `No item is below zero on any day${asOf ? ` through ${asOf}` : ''}.`
    : items.slice(0, 5).map(i => `${i.itemName} is at ${i.quantity} at the end of ${i.date}`).join('; ') + (items.length > 5 ? `; and ${items.length - 5} more items` : '') + '.';
  return { ok: items.length === 0, items, message };
}

/**
 * Check (c): whether a snapshot still matches what it was built from: its stock moves (and each item's history start)
 * and, when it kept one and `booksChecksum` is given, the entries through its date that touch Inventory (a journal
 * posted during a partial unlock).
 */
export function closingFreshness(closing: Pick<StockClosing, 'asOf' | 'checksum' | 'moveCount' | 'rows'> & { booksChecksum?: string }, moves: StockMove[], booksChecksum?: string): { fresh: boolean; changedItems: string[]; booksChanged: boolean; message: string } {
  const now = buildStockClosing({ workspaceId: '', asOf: closing.asOf, moves, inventoryBalanceCents: 0, builtBy: '', at: '' });
  const booksChanged = Boolean(closing.booksChecksum && booksChecksum && closing.booksChecksum !== booksChecksum);
  const movesChanged = now.checksum !== closing.checksum;
  if (!movesChanged && !booksChanged) return { fresh: true, changedItems: [], booksChanged: false, message: `The stock closing of ${closing.asOf} still matches its ${closing.moveCount} stock moves${closing.booksChecksum && booksChecksum ? ' and the Inventory entries' : ''}.` };
  const key = (r: StockClosingRow) => `${r.itemId}\u0000${r.locationId}`;
  const then = new Map(closing.rows.map(r => [key(r), r]));
  const nowRows = new Map(now.rows.map(r => [key(r), r]));
  const changed = new Set<string>();
  for (const r of now.rows) { const t = then.get(key(r)); if (!t || t.checksum !== r.checksum || t.valueCents !== r.valueCents || t.quantity !== r.quantity) changed.add(r.itemName); }
  for (const r of closing.rows) if (!nowRows.has(key(r))) changed.add(r.itemName);
  const changedItems = movesChanged ? [...changed].sort() : [];
  const why = [
    movesChanged ? `its stock moves were changed since it was taken (${now.moveCount} now, ${closing.moveCount} then${changedItems.length ? `; ${changedItems.slice(0, 5).join(', ')}` : ''})` : '',
    booksChanged ? `an entry to Inventory dated on or before ${closing.asOf} was posted, changed or removed since it was taken` : '',
  ].filter(Boolean).join('; and ');
  return { fresh: false, changedItems, booksChanged, message: `The stock closing of ${closing.asOf} is stale: ${why}.` };
}

/** The nightly Data Health checks (the context carries the stock moves, the stock closings and which sources were capped). */
export const STOCK_INVARIANT_CHECKS: DataCheck[] = [
  {
    id: 'stock-vs-books',
    label: 'Stock value differs from the Inventory account (EG-7)',
    remedy: 'Open Inventory Valuation and the entries named: post the stock change with its entry, or correct the journal to Inventory.',
    run: ({ stockMoves, transactions, accounts, today, truncated, baseCurrency }) => {
      // the browser does not load the stock moves: nothing to compare (an empty list is compared: stock is then 0)
      if (!stockMoves) return [];
      const capped = (truncated || []).filter(t => t === 'stockMoves' || t === 'transactions');
      if (capped.length) {
        return [{ id: `stock-vs-books-not-compared-${capped.join('-')}`, checkId: 'stock-vs-books', severity: 'low', title: 'Stock and the Inventory account were not compared',
          description: `Only part of the ${capped.map(c => (c === 'stockMoves' ? 'stock history' : 'entries')).join(' and the ')} could be read, so a comparison would be wrong. Open Inventory Valuation to compare them for a date.` }];
      }
      const check = checkStockAgainstBooks({ asOf: today, moves: stockMoves, entries: transactions, accounts, currency: baseCurrency });
      return check.ok ? [] : [{ id: `stock-vs-books-${check.differenceCents}`, checkId: 'stock-vs-books', severity: 'high', title: `Stock and the Inventory account differ by ${money(Math.abs(check.differenceCents), baseCurrency)}`, description: check.message }];
    },
  },
  {
    id: 'stock-negative-on-date',
    label: 'Items below zero on a day, by the moves\' dates (EG-7)',
    remedy: 'Date the stock that came in on or before the day it went out, or correct the move dated too early.',
    run: ({ stockMoves, truncated }) => (truncated || []).includes('stockMoves') ? [] : negativeStockDays(stockMoves || []).items.map((i): CheckFinding => ({
      id: `stock-negative-on-date-${i.itemId}-${i.date}`, checkId: 'stock-negative-on-date', severity: 'medium',
      title: `${i.itemName} is below zero on ${i.date}`, description: `${i.itemName} ends ${i.date} at ${i.quantity}, by the dates of its stock moves.`,
      record: { type: 'item', id: i.itemId },
    })),
  },
  {
    id: 'stock-closing-stale',
    label: 'Stock closings whose stock moves or Inventory entries changed (EG-7)',
    remedy: 'An owner takes the stock closing again (Inventory Valuation), after checking why a closed period\'s stock changed.',
    run: ({ stockMoves, stockClosings, transactions, accounts, truncated }) => (truncated || []).some(t => t === 'stockMoves' || t === 'transactions') ? [] : (stockClosings || []).flatMap(c => {
      const f = closingFreshness(c, stockMoves || [], inventoryEntriesChecksum(transactions, accounts, c.asOf));
      return f.fresh ? [] : [{ id: `stock-closing-stale-${c.asOf}-${c.checksum}`, checkId: 'stock-closing-stale', severity: 'high' as const, title: `The stock closing of ${c.asOf} is stale`, description: f.message }];
    }),
  },
];
