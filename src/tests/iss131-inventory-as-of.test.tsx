/**
 * ISS-131 (GitHub #131): Inventory Valuation as of a past date takes its quantities and values from the stock history,
 * and the stock is compared with the books only when both sides are for the same date and complete.
 *
 * The issue's own example, worked by hand (cents):
 *   1 Sep: bought 10 bolts at $10.00 → 10 on hand, value 10,000; the Inventory account +10,000.
 *   5 Oct: bought 10 at $20.00 → 20 on hand, value 30,000 (moving average $15.00); the account +20,000.
 *   As of 30 Sep: 10 bolts, $100.00, unit cost $10.00 — and the books $100.00: they agree.
 *   (Before: today's 20 × $15.00 = $300.00 against $100.00, a $200 "difference" that was not there.)
 */
import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { inventoryAsOf } from '../lib/inventoryAsOf';
import { itemDetails, type StockMove } from '../lib/stockMoves';
import { makeChartAccount, makeTransaction } from './fixtures';

const TODAY = '2026-10-20';
const START = '1900-01-01';
let seq = 0;
const move = (itemId: string, date: string, quantity: number, quantityBefore: number, valueCents: number, kind: StockMove['kind'] = quantity > 0 ? 'purchase' : 'sale'): StockMove => ({
  workspaceId: 'w', uid: 'u', createdAt: date, itemId, itemName: itemId, date, kind, quantity, quantityBefore, quantityAfter: quantityBefore + quantity,
  unitCostCents: Math.round(Math.abs(valueCents / quantity)), valueCents, seq: String(++seq).padStart(6, '0'),
});
const moves: StockMove[] = [
  move('bolts', '2026-09-01', 10, 0, 10_000),
  move('bolts', '2026-10-05', 10, 10, 20_000),
  // nuts: +10 at $10, +10 at $20 (average $15), then 5 sold at $15 = −7,500 → 15 on hand, 22,500
  move('nuts', '2026-08-01', 10, 0, 10_000),
  move('nuts', '2026-08-15', 10, 10, 20_000),
  move('nuts', '2026-09-10', -5, 20, -7_500),
  // washers: stock from before the history was kept (it starts at 5)
  move('washers', '2026-09-02', -2, 5, -2_000),
  // screws: the history ends at 6 but 7 are on hand
  move('screws', '2026-09-03', 6, 0, 6_000),
  // hinges: bought after the date only: none on the date, known
  move('hinges', '2026-10-10', 4, 0, 4_000),
];
const items = [
  { id: 'bolts', name: 'Bolts', quantityAtHand: 20 },
  { id: 'nuts', name: 'Nuts', quantityAtHand: 15 },
  { id: 'washers', name: 'Washers', quantityAtHand: 3 },
  { id: 'screws', name: 'Screws', quantityAtHand: 7 },
  { id: 'hinges', name: 'Hinges', quantityAtHand: 4 },
  { id: 'pins', name: 'Pins', quantityAtHand: 12 },   // stock and no history at all
  // nothing, never moved, created after the history began (1 Aug) — so a move would exist had it held stock (#243 review)
  { id: 'clips', name: 'Clips', quantityAtHand: 0, createdAt: '2026-08-20T09:00:00Z' },
];
const asOf = (date: string, list = items) => inventoryAsOf({ asOf: date, items: list, toToday: itemDetails(moves, START, TODAY) });

test('ISS-131 worked figures: as of 30 Sep, 10 bolts at $10.00 = $100.00, never today\'s 20 × $15.00', () => {
  const result = asOf('2026-09-30');
  const bolts = result.rows.find(r => r.itemId === 'bolts')!;
  assert.deepEqual([bolts.quantity, bolts.valueCents, bolts.unitCostCents], [10, 10_000, 1_000]);
  // nuts after the sale at the average cost: 15 on hand, 30,000 − 7,500 = 22,500, $15.00 each
  assert.deepEqual(result.rows.find(r => r.itemId === 'nuts')!.valueCents, 22_500);
  assert.deepEqual(asOf('2026-08-31').rows.find(r => r.itemId === 'nuts')!.quantity, 20, 'before the sale');
});

test('ISS-131: an item the history does not explain is unknown with the reason — never 0, never today\'s figure', () => {
  const result = asOf('2026-09-30');
  const reason = (id: string) => result.rows.find(r => r.itemId === id)?.unknownReason;
  assert.match(reason('washers') || '', /starts at 5 units \(stock from before the history was kept\)/);
  assert.match(reason('screws') || '', /ends at 6, but 7 are on hand/);
  assert.match(reason('pins') || '', /12 on hand today with no stock history/);
  assert.deepEqual(result.rows.find(r => r.itemId === 'washers')!.valueCents, null);
  assert.equal(result.rows.find(r => r.itemId === 'hinges'), undefined, 'bought after the date: nothing on the date, known');
  assert.equal(result.rows.find(r => r.itemId === 'clips'), undefined);
  assert.deepEqual([result.unknownItems, result.complete, result.knownValueCents], [3, false, 10_000 + 22_500]);
});

test('ISS-131: with every item explained the total is the stock on the date', () => {
  const result = asOf('2026-09-30', items.filter(i => ['bolts', 'nuts', 'hinges', 'clips'].includes(i.id)));
  // #243 review: a deleted item whose history still holds stock is unknown (the deletion left no move saying when the
  // stock went); washers (history starts at 5) is unknown too
  assert.deepEqual([result.complete, result.knownValueCents, result.unknownItems], [false, 10_000 + 22_500, 2]);
  assert.match(result.rows.find(r => r.itemId === 'screws')!.unknownReason || '', /deleted with 6 still in its stock history/);
  const onlyBolts = inventoryAsOf({ asOf: '2026-09-30', items: [items[0]], toToday: itemDetails(moves.filter(m => m.itemId === 'bolts'), START, TODAY) });
  assert.deepEqual([onlyBolts.complete, onlyBolts.knownValueCents, onlyBolts.unknownItems], [true, 10_000, 0]);
});

describe('ISS-131 on the Inventory Valuation screen', () => {
  afterEach(() => cleanup());

  const setUp = async (historyMoves: StockMove[], stock: typeof items) => {
    const { useLedgerStore } = await import('../stores/useLedgerStore');
    const { useAuthStore } = await import('../stores/useAuthStore');
    const { useDataNeedsStore } = await import('../stores/useDataNeedsStore');
    const accounts = [makeChartAccount({ id: 'inv', name: 'Inventory', type: 'asset', category: 'Inventory' }), makeChartAccount({ id: 'bank', name: 'Bank', type: 'asset', category: 'Cash' })];
    const tx = (id: string, date: string, cents: number) => makeTransaction({ id, date, lines: [{ accountId: 'inv', amountCents: cents }, { accountId: 'bank', amountCents: -cents }] });
    useAuthStore.setState({ currentWorkspaceId: 'w' } as never);
    useLedgerStore.setState({ inventory: stock, accounts, transactions: [tx('b1', '2026-09-01', 10_000), tx('b2', '2026-10-05', 20_000)], truncatedCollections: {} } as never);
    useDataNeedsStore.setState({ loaded: { inventory: true }, loadedWorkspaceId: 'w', failed: {} } as never);
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      const end = new URL(String(input), 'http://x').searchParams.get('endDate')!;
      return new Response(JSON.stringify({ items: itemDetails(historyMoves, START, end) }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    const { InventoryValuationReportView } = await import('../components/reporting/InventoryValuationReportView');
    render(<InventoryValuationReportView asOfDate="2026-09-30" />);
    return urls;
  };

  test('the issue\'s example: $100.00 of stock beside $100.00 in the books, and they agree', async () => {
    const urls = await setUp(moves.filter(m => m.itemId === 'bolts'), [items[0]]);
    await waitFor(() => assert.match(document.body.textContent || '', /The stock list and the Inventory account agree\./));
    assert.match(document.body.textContent || '', /Stock on hand at cost on 2026-09-30, from the stock history/);
    assert.equal(urls.filter(u => /inventory-details\?workspaceId=w&startDate=1900-01-01&endDate=\d{4}-\d{2}-\d{2}$/.test(u)).length, 1, `one reading of the whole history: ${urls.join(' ')}`);
    assert.doesNotMatch(document.body.textContent || '', /\$300\.00|\$200\.00/, 'today\'s 20 × $15.00 is not shown for 30 Sep');
  });

  test('an unexplained item: listed as Unknown, total marked partial, no comparison', async () => {
    await setUp(moves, items);
    await waitFor(() => assert.match(screen.getAllByRole('status').map(s => s.textContent).join(' '), /3 item\(s\) have no stock history that explains them on 2026-09-30, so the stock value on that date is not complete and is not compared with the books\./));
    assert.match(document.body.textContent || '', /Stock value of the items known on the date/);
    assert.match(document.body.textContent || '', /Not known on 2026-09-30: 12 on hand today with no stock history/);
    assert.doesNotMatch(document.body.textContent || '', /agree|more than the Inventory account|less than the Inventory account/);
  });

  test('the history cannot be read: not available, today\'s stock is not put in its place', async () => {
    const { useAuthStore } = await import('../stores/useAuthStore');
    useAuthStore.setState({ currentWorkspaceId: 'w' } as never);
    await setUp([], [items[0]]);
    cleanup();
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'Stock history is not set up in this database yet' }), { status: 503, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
    const { InventoryValuationReportView } = await import('../components/reporting/InventoryValuationReportView');
    render(<InventoryValuationReportView asOfDate="2026-09-30" />);
    await waitFor(() => assert.match(screen.getByRole('alert').textContent || '', /The stock on 2026-09-30 is not available: Stock history is not set up in this database yet\. Today’s stock is not shown in its place, and the books are not compared\./));
    assert.match(document.body.textContent || '', /Not available/);
  });
});

// ---- review fixes (#243) ----
test('ISS-131 review: a backdated move counts on its own date, not in the order it was written', () => {
  // buys of 10 on 1 Sep and 5 Oct, then a sale of 5 written last but dated 15 Sep: on 30 Sep there were 5, not 15
  const backdated = [
    move('rods', '2026-09-01', 10, 0, 10_000),
    move('rods', '2026-10-05', 10, 10, 20_000),
    move('rods', '2026-09-15', -5, 20, -5_000),
  ];
  const result = inventoryAsOf({ asOf: '2026-09-30', items: [{ id: 'rods', name: 'Rods', quantityAtHand: 15 }], toToday: itemDetails(backdated, START, TODAY) });
  // 10 − 5 = 5 rods; 10,000 − 5,000 = 5,000 cents
  assert.deepEqual([result.rows[0].quantity, result.rows[0].valueCents, result.complete], [5, 5_000, true]);
});

test('ISS-131 review: a never-moved item at zero today is zero on the date only when that is proven', () => {
  const history = itemDetails(moves, START, TODAY); // the history begins on 1 Aug 2026
  const base = (extra: Record<string, unknown>) => inventoryAsOf({ asOf: '2026-09-30', items: [{ id: 'legacy', name: 'Legacy', quantityAtHand: 0, ...extra }], toToday: history }).rows.find(r => r.itemId === 'legacy');
  assert.match(base({ createdAt: '2025-03-01T00:00:00Z' })?.unknownReason || '', /may have held stock before the history was kept/, 'created before the history began');
  assert.match(base({})?.unknownReason || '', /may have held stock/, 'no creation date: not proven');
  assert.equal(base({ createdAt: '2026-10-10T00:00:00Z' }), undefined, 'created after the date: zero, so not listed');
  assert.equal(base({ itemType: 'service' }), undefined, 'a service holds no stock');
});

// ---- #256 review ----
test('#256 review: a move backdated before the history began does not move the start earlier', () => {
  // the history was first written on 1 Aug 2026 (nuts); a move written on 1 Oct is dated 1 Jun 2026
  const backdated = { ...move('rivets', '2026-06-01', 3, 0, 300), createdAt: '2026-10-01T10:00:00Z' };
  const history = itemDetails([...moves, backdated], START, TODAY);
  const rivets = { id: 'rivets', name: 'Rivets', quantityAtHand: 3 };
  // an item created on 15 Jul (after the backdated date, before the history really began) is not proven zero
  const legacy = inventoryAsOf({ asOf: '2026-09-30', items: [rivets, { id: 'legacy', name: 'Legacy', quantityAtHand: 0, createdAt: '2026-07-15T00:00:00Z' }], toToday: history }).rows.find(r => r.itemId === 'legacy');
  assert.match(legacy?.unknownReason || '', /may have held stock before the history was kept/);
  // one created after the first write day (20 Aug) still is
  const clips = inventoryAsOf({ asOf: '2026-09-30', items: [rivets, { id: 'clips', name: 'Clips', quantityAtHand: 0, createdAt: '2026-08-20T00:00:00Z' }], toToday: history }).rows.find(r => r.itemId === 'clips');
  assert.equal(clips, undefined, 'zero, so not listed');
});

test('#256 review: with a capped item list, an item missing from it is not called deleted', () => {
  const history = itemDetails(moves, START, TODAY);
  const rows = inventoryAsOf({ asOf: '2026-09-30', items: items.filter(i => i.id !== 'nuts'), toToday: history, itemsPartial: true }).rows;
  const nuts = rows.find(r => r.itemId === 'nuts')!;
  assert.match(nuts.unknownReason || '', /not in the loaded item list \(the list is capped\)/);
  assert.doesNotMatch(nuts.unknownReason || '', /deleted/);
});

test('#256 review: a deleted item is known to be zero before its first move', () => {
  const history = itemDetails(moves, START, TODAY);
  // nuts (first move 1 Aug, 15 still in the history) deleted: on 31 Jul the history, which starts at zero, proves 0
  const before = inventoryAsOf({ asOf: '2026-07-31', items: items.filter(i => i.id !== 'nuts'), toToday: history }).rows.find(r => r.itemId === 'nuts');
  assert.equal(before, undefined, 'zero, so not listed');
  // on 30 Sep it held stock and the deletion does not say when it went: unknown
  const after = inventoryAsOf({ asOf: '2026-09-30', items: items.filter(i => i.id !== 'nuts'), toToday: history }).rows.find(r => r.itemId === 'nuts');
  assert.match(after?.unknownReason || '', /deleted with 15 still in its stock history/);
});

describe('ISS-131 review on the screen', () => {
  afterEach(() => cleanup());
  const mount = async (asOfDate: string, truncated: Record<string, boolean>, fetchImpl?: typeof fetch) => {
    const { useLedgerStore } = await import('../stores/useLedgerStore');
    const { useAuthStore } = await import('../stores/useAuthStore');
    const accounts = [makeChartAccount({ id: 'inv', name: 'Inventory', type: 'asset', category: 'Inventory' }), makeChartAccount({ id: 'bank', name: 'Bank', type: 'asset', category: 'Cash' })];
    const tx = makeTransaction({ id: 'b1', date: '2026-09-01', lines: [{ accountId: 'inv', amountCents: 10_000 }, { accountId: 'bank', amountCents: -10_000 }] });
    useAuthStore.setState({ currentWorkspaceId: 'w' } as never);
    useLedgerStore.setState({ inventory: [{ ...items[0], quantityAtHand: 10, unitCostCents: 1_000 }], accounts, transactions: [tx], truncatedCollections: truncated } as never);
    globalThis.fetch = fetchImpl || (async () => new Response(JSON.stringify({ items: itemDetails(moves.filter(m => m.itemId === 'bolts' && m.date < '2026-10-01'), START, TODAY) }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
    const { InventoryValuationReportView } = await import('../components/reporting/InventoryValuationReportView');
    render(<InventoryValuationReportView asOfDate={asOfDate} />);
  };

  test('a capped item list: the stock may leave items out, so it is not compared with the books', async () => {
    await mount('2026-09-30', { inventory: true });
    await waitFor(() => assert.match(document.body.textContent || '', /The loaded item list is capped, so the stock value here may leave items out and is not compared with the books\./));
    assert.doesNotMatch(document.body.textContent || '', /agree\./);
  });

  test('#131: capped entries cannot pass as the whole Inventory account: not compared, for a past date and for today', async () => {
    for (const date of ['2026-09-30', '']) {
      await mount(date, { transactions: true });
      await waitFor(() => assert.match(document.body.textContent || '', /The loaded entries are capped, so the Inventory account here may be incomplete and is not compared with the stock\./));
      assert.doesNotMatch(document.body.textContent || '', /agree\.|more than the Inventory account|less than the Inventory account/);
      cleanup();
    }
  });

  test('a date after today: said plainly, not compared', async () => {
    await mount('2999-01-01', {});
    assert.match(screen.getByRole('alert').textContent || '', /2999-01-01 is after today, so there is no stock or books valuation for it yet/);
    assert.doesNotMatch(document.body.textContent || '', /agree\.|more than the Inventory account|less than the Inventory account/);
  });

  test('export waits for the history: no empty file while it is being read', async () => {
    const { toast } = await import('sonner');
    const errors: string[] = [];
    const original = toast.error;
    (toast as unknown as { error: (m: string) => void }).error = (m: string) => { errors.push(m); };
    try {
      await mount('2026-09-30', {}, (() => new Promise<Response>(() => {})) as unknown as typeof fetch); // never answers
      screen.getByRole('button', { name: /export/i }).click();
      assert.deepEqual(errors, ['The stock history for 2026-09-30 is still being read.']);
    } finally {
      (toast as unknown as { error: typeof original }).error = original;
    }
  });
});
