/**
 * EG-6 (BF-04): posting landed cost, end to end against a real database. Bills and the invoice are posted by the
 * app's own posting code (commitLedgerBulk through the real routes); the landed cost through
 * POST /api/v1/inventory/landed-cost. Needs LF_TEST_DATABASE_URL.
 *
 * Worked figures (cents):
 *   Bill 1 (10-01): 10 chairs @ 5,000 = 50,000 (labelled project P-1) and 10 tables @ 15,000 = 150,000
 *   Freight bill (10-02): 20,000 to Freight in (5100)
 *   by value 50,000 : 150,000 = 1 : 3 → chairs 20,000 × 1/4 = 5,000, tables 20,000 × 3/4 = 15,000
 *   chairs (10 × 5,000 + 5,000) / 10 = 5,500; tables (10 × 15,000 + 15,000) / 10 = 16,500
 *   entry: Inventory +5,000 (P-1), Inventory +15,000, Freight in −20,000; stock moves landed-cost qty 0, +5,000 / +15,000
 *   a retry posts nothing; the generic reverse is refused (409); its own undo takes it all back (5,000 / 15,000).
 * 4 chairs sold before posting (Bill 3, same figures, invoice of 4 chairs on 10-03, 6 on hand):
 *   chairs' share 5,000: units sold 10 − 6 = 4 → COGS 4/10 × 5,000 = 2,000, Inventory 3,000
 *   chairs (6 × 5,000 + 3,000) / 6 = 5,500; tables as above 16,500 (all 10 on hand)
 *   COGS for chairs = 4 × 5,000 (the sale) + 2,000 = 22,000 = 4 × 5,500
 * Locked through 10-10: a manual 1,000 asked for 10-05 is dated today (the reversalDate rule).
 * Review fixes (Codex on #367):
 *   stock on hand before the receipt (stools): opening 100 @ 5,000, Bill 10 @ 5,000 → pool 110, 50 sold → 60 on hand;
 *     freight 1,100 on the receipt: Inventory 1,100 × 60/110 = 600, COGS 1,100 × 50/110 = 500;
 *     cost (60 × 5,000 + 600) / 60 = 5,010 (the old rule, units received − on hand = 10 − 60 < 0, put all 1,100 in Inventory)
 *   undo restores the stored cost (lamps): 2 @ 1,000 + 1 cent → round(2,001 / 2) = 1,001; the inverse round((2,002 − 1) / 2)
 *     = 1,001 would stay wrong; undo gives 1,000
 *   all sold (vases): 2 bought, 2 sold, 100 landed → COGS 100, no move; the undo is still allowed
 *   one move per item (rugs): lines of 1 and 2 units, 300 by quantity → 100 + 200, one landed-cost move of 300
 *   a backdated purchase before a landed cost (desks) is refused by the repost run, nothing posted
 */
import './helpers/dom';
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { postBillLedger } from '../services/ledgerPost/billPosting';
import { postInvoiceLedger } from '../services/ledgerPost/invoicePosting';
import type { LedgerPostContext } from '../services/ledgerPost/postingKit';
import type { ChartAccount, InventoryItem, Transaction, Workspace } from '../types';
import { formatTzDate } from '../lib/utils';
import { landedCostBaseId, remainingShare } from '../server/services/landedCostService';
import type { StockMove } from '../lib/stockMoves';
import '../services/ledgerPost/postingKit';

const url = process.env.LF_TEST_DATABASE_URL;
type Json = Record<string, unknown> & { lines?: Array<Record<string, number | string>>; entryLines?: Array<{ accountId: string; amountCents: number; dimensions?: Record<string, string> }> };

describe('EG-6: posting landed cost', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_eg6_${crypto.randomBytes(4).toString('hex')}`;
  const OWNER = 'owner-1';
  const [chair, table, chair3, table3, stool, lamp, vase, rug, desk] = ['chair', 'table', 'chair3', 'table3', 'stool', 'lamp', 'vase', 'rug', 'desk'].map(n => `${ws}_${n}`);
  const ITEMS: Array<[string, string]> = [[chair, 'Chair'], [table, 'Table'], [chair3, 'Chair B'], [table3, 'Table B'], [stool, 'Stool'], [lamp, 'Lamp'], [vase, 'Vase'], [rug, 'Rug'], [desk, 'Desk']];
  let server: Server;
  let base = '';
  let db: import('../server/db/pgFirestore').Firestore;
  const realFetch = globalThis.fetch;
  const acct: Record<string, ChartAccount> = {};
  const today = formatTzDate(new Date(), 'UTC');
  const send = async (method: string, path: string, body?: unknown, uid = OWNER) => {
    const res = await realFetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', 'x-test-uid': uid }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: res.status, body: await res.json().catch(() => ({})) as Json };
  };
  const land = (body: Record<string, unknown>, uid = OWNER) => send('POST', '/api/v1/inventory/landed-cost', { workspaceId: ws, basis: 'value', ...body }, uid);
  const all = async <T>(collection: string) => (await db.collection(collection).where('workspaceId', '==', ws).get()).docs.map(d => ({ ...d.data(), id: d.id }) as T);
  const item = async (id: string) => ({ ...(await db.collection('inventory').doc(id).get()).data(), id }) as InventoryItem;
  const context = async (): Promise<LedgerPostContext> => ({
    accounts: Object.values(acct), lockDate: null, uid: OWNER, inventory: await Promise.all(ITEMS.map(([id]) => item(id))),
    transactions: await all<Transaction>('transactions'),
    workspaces: [{ id: ws, uid: OWNER, name: 'Furniture Co', currency: 'USD' } as Workspace],
  });
  const postBill = async (id: string, date: string, splits: Array<Record<string, unknown>>) => {
    const data = {
      id, workspaceId: ws, uid: OWNER, number: id.slice(-6), vendorId: 'v', vendorName: 'Supplier', date, dueDate: date, status: 'pending' as const, currency: 'USD',
      amountCents: splits.reduce((s, x) => s + Number(x.amountCents), 0), splits,
    };
    await db.collection('bills').doc(id).set(data);
    await postBillLedger(id, data as never, ws, OWNER, { collection: 'bills', docId: id, action: 'update', data }, await context());
  };
  const goods = (c: string, t: string) => [
    { amountCents: 50_000, accountId: acct['1300'].id, description: 'Chairs', itemId: c, quantity: 10, dimensions: { project: 'P-1' } },
    { amountCents: 150_000, accountId: acct['1300'].id, description: 'Tables', itemId: t, quantity: 10 },
  ];
  const freight = (id: string) => postBill(id, '2026-10-02', [{ amountCents: 20_000, accountId: acct['5100'].id, description: 'Freight' }]);
  const sell = async (id: string, itemId: string, quantity: number, date = '2026-10-03') => {
    const data = {
      id, workspaceId: ws, uid: OWNER, number: id.slice(-4), customerId: 'acme', customerName: 'Acme', date, dueDate: date, status: 'sent' as const,
      amountCents: quantity * 30_000, amountPaidCents: 0, currency: 'USD', taxVersion: 2, taxAmountCents: 0,
      items: [{ id: 'l1', itemId, description: 'Stock', quantity, rateCents: 30_000, amountCents: quantity * 30_000, accountId: acct['4000'].id }],
    };
    await postInvoiceLedger(id, data as never, ws, OWNER, { collection: 'invoices', docId: id, action: 'create', data }, await context());
  };
  const stockLine = (itemId: string, quantity: number, unit: number) => ({ amountCents: quantity * unit, accountId: acct['1300'].id, description: 'Stock', itemId, quantity });
  const manual = (allocationId: string, amountCents: number) => ({ kind: 'manual', amountCents, accountId: acct['5100'].id, allocationId });
  const idOf = (charge: Record<string, unknown>, n: number) => `${landedCostBaseId(ws, charge as never)}-${n}`;
  const moves = async (itemId: string) => (await all<Record<string, unknown>>('stockMoves')).filter(m => m.itemId === itemId && m.kind === 'landed-cost');
  const sum = async (code: string, entryId: string) => ((await db.collection('transactions').doc(entryId).get()).data()?.lines as Array<{ accountId: string; amountCents: number }>)
    .filter(l => l.accountId === acct[code].id).reduce((s, l) => s + l.amountCents, 0);

  before(async () => {
    process.env.DATABASE_URL = url;
    const express = (await import('express')).default;
    const { workspaceRouter } = await import('../server/routes/workspaceRoutes');
    const { transactionRouter } = await import('../server/routes/transactionRoutes');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({ uid: OWNER, name: 'Furniture Co', currency: 'USD', timezone: 'UTC', members: [OWNER, 'acct', 'book', 'view'], roles: { acct: 'accountant', book: 'bookkeeper', view: 'viewer' } });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string; email: string } }).user = { uid: String(req.header('x-test-uid')), email: 'owner@furniture.test' }; next(); });
    app.use('/api/v1/workspaces', workspaceRouter);
    app.use('/api/v1/transactions', transactionRouter);
    app.use('/api/v1/documents', (await import('../server/routes/documentPostRoutes')).documentPostRouter);
    app.use('/api/v1/inventory', (await import('../server/routes/inventoryRoutes')).inventoryRouter);
    app.use('/api/v1/repost', (await import('../server/routes/repostRoutes')).repostRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const target = String(input);
      if (!target.startsWith('/')) return realFetch(input, init);
      return realFetch(`${base}${target}`, { ...init, headers: { ...(init?.headers as Record<string, string> || {}), 'x-test-uid': OWNER } });
    }) as typeof fetch;
    const accounts = await send('POST', `/api/v1/workspaces/${ws}/import-records`, { kind: 'accounts', rows: [
      { name: 'Checking', code: '1000', type: 'Bank' },
      { name: 'Accounts Receivable', code: '1100', type: 'Accounts receivable' },
      { name: 'Inventory', code: '1300', type: 'Inventory' },
      { name: 'Accounts Payable', code: '2000', type: 'Accounts payable' },
      { name: 'Sales', code: '4000', type: 'Income' },
      { name: 'Cost of goods sold', code: '5000', type: 'Cost of goods sold' },
      { name: 'Freight in', code: '5100', type: 'Expense' },
      { name: 'Opening Balance Equity', code: '3900', type: 'Equity' },
    ] });
    assert.equal(accounts.status, 200, JSON.stringify(accounts.body));
    for (const a of await all<ChartAccount>('chartAccounts')) acct[String(a.code)] = a;
    for (const [id, name] of ITEMS) {
      await db.collection('inventory').doc(id).set({ workspaceId: ws, name, sku: name.toUpperCase().replace(/ /g, ''), itemType: 'stock', quantityAtHand: 0, unitCostCents: 0, unitPriceCents: 30_000, reorderPoint: 0, uid: OWNER });
    }
    await postBill(`${ws}_bill01`, '2026-10-01', goods(chair, table));
    await freight(`${ws}_frt001`);
  });

  after(async () => {
    globalThis.fetch = realFetch;
    server?.close();
    for (const tbl of ['transactions', 'bills', 'invoices', 'inventory', 'stockMoves', 'repostQueue', 'chartAccounts', 'auditLogs', 'idempotencyKeys', 'workspaces']) {
      await db.pool.query(`delete from public."${tbl}" where workspace_id = $1 or id = $1`, [ws]).catch(() => {});
    }
    const { getSupabase } = await import('../lib/db/client');
    getSupabase().realtime.disconnect();
    await getSupabase().auth.dispose();
    await db.terminate();
  });

  const charge = { kind: 'bill', billId: `${ws}_frt001`, line: 0 };

  test('viewers and bookkeepers are refused', async () => {
    for (const uid of ['view', 'book']) assert.equal((await land({ charge, receiptBillIds: [`${ws}_bill01`] }, uid)).status, 403, uid);
  });

  test('the worked figures: a dry run shows them and writes nothing; the post gives chairs 55.00, tables 165.00, Inventory +200.00, freight −200.00', async () => {
    const before = (await all('transactions')).length;
    const dry = await land({ charge, receiptBillIds: [`${ws}_bill01`], dryRun: true }, 'acct');
    assert.equal(dry.status, 200, JSON.stringify(dry.body));
    assert.deepEqual(dry.body.lines!.map(l => [l.itemId, l.allocatedCents, l.inventoryCents, l.cogsCents, l.unitCostAfterCents]), [[chair, 5_000, 5_000, 0, 5_500], [table, 15_000, 15_000, 0, 16_500]]);
    assert.equal((await all('transactions')).length, before, 'a dry run posts nothing');
    assert.equal((await item(chair)).unitCostCents, 5_000);

    const res = await land({ charge, receiptBillIds: [`${ws}_bill01`] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const id = String(res.body.entryId);
    assert.equal(id, idOf(charge, 0));
    assert.deepEqual([res.body.posted, res.body.replayed, res.body.date], [true, false, today]);
    assert.deepEqual([(await item(chair)).unitCostCents, (await item(table)).unitCostCents], [5_500, 16_500]);
    assert.deepEqual([await sum('1300', id), await sum('5100', id), await sum('5000', id)], [20_000, -20_000, 0]);
    const entry = (await db.collection('transactions').doc(id).get()).data()!;
    const lines = entry.lines as Array<{ accountId: string; amountCents: number; dimensions?: Record<string, string> }>;
    assert.deepEqual(lines.map(l => [l.accountId, l.amountCents, l.dimensions?.project]), [[acct['1300'].id, 5_000, 'P-1'], [acct['1300'].id, 15_000, undefined], [acct['5100'].id, -20_000, undefined]], 'the received line keeps its labels');
    assert.equal(entry.metadata.billId, undefined, 'not taken for the bill\'s own posting');
    const [cm] = await moves(chair);
    assert.deepEqual([cm.quantity, cm.quantityBefore, cm.quantityAfter, cm.valueCents, cm.unitCostCents, cm.transactionId, (cm.labels as Record<string, string>)?.project], [0, 10, 10, 5_000, 5_500, id, 'P-1']);
    assert.equal((await moves(table))[0].valueCents, 15_000);
  });

  test('a retry posts nothing; the generic reverse is refused; its own undo reverses the entry and the moves', async () => {
    const count = (await all('transactions')).length;
    const again = await land({ charge, receiptBillIds: [`${ws}_bill01`] });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.deepEqual([again.body.replayed, again.body.posted, again.body.entryId], [true, false, idOf(charge, 0)]);
    assert.equal((await all('transactions')).length, count, 'nothing posted twice');
    assert.equal((await moves(chair)).length, 1);
    const id = String(again.body.entryId);
    const reversed = await send('POST', `/api/v1/transactions/${id}/reverse`, { workspaceId: ws, reversalDate: today, reason: 'undo' });
    assert.equal(reversed.status, 409, JSON.stringify(reversed.body));
    assert.match(String(reversed.body.error), /landed cost/i);
    assert.equal((await send('DELETE', `/api/v1/transactions/${id}?workspaceId=${ws}`)).status >= 400, true);
    assert.equal((await send('POST', `/api/v1/inventory/landed-cost/${id}/undo`, { workspaceId: ws }, 'view')).status, 403);
    const undo = await send('POST', `/api/v1/inventory/landed-cost/${id}/undo`, { workspaceId: ws });
    assert.equal(undo.status, 200, JSON.stringify(undo.body));
    assert.deepEqual([(await item(chair)).unitCostCents, (await item(table)).unitCostCents], [5_000, 15_000]);
    assert.deepEqual((await moves(chair)).map(m => m.valueCents).sort(), [-5_000, 5_000]);
    const undoId = String(undo.body.undoEntryId);
    assert.deepEqual([await sum('1300', undoId), await sum('5100', undoId)], [-20_000, 20_000]);
    assert.equal((await send('POST', `/api/v1/transactions/${undoId}/reverse`, { workspaceId: ws, reversalDate: today, reason: 'x' })).status, 409);
    assert.equal((await send('POST', `/api/v1/inventory/landed-cost/${id}/undo`, { workspaceId: ws })).body.replayed, true, 'an undo retried does nothing');
    // after its undo the charge may be landed again, under the next id
    const relanded = await land({ charge, receiptBillIds: [`${ws}_bill01`] });
    assert.equal(relanded.body.entryId, idOf(charge, 1));
    assert.deepEqual([(await item(chair)).unitCostCents, (await item(table)).unitCostCents], [5_500, 16_500]);
  });

  test('4 chairs sold before posting: their 4/10 × 50.00 = 20.00 goes to cost of goods sold', async () => {
    await postBill(`${ws}_bill03`, '2026-10-01', goods(chair3, table3));
    const inv = `${ws}_inv1`;
    const data = {
      id: inv, workspaceId: ws, uid: OWNER, number: 'INV1', customerId: 'acme', customerName: 'Acme', date: '2026-10-03', dueDate: '2026-10-03', status: 'sent' as const,
      amountCents: 4 * 30_000, amountPaidCents: 0, currency: 'USD', taxVersion: 2, taxAmountCents: 0,
      items: [{ id: 'l1', itemId: chair3, description: 'Chair B', quantity: 4, rateCents: 30_000, amountCents: 120_000, accountId: acct['4000'].id }],
    };
    await postInvoiceLedger(inv, data as never, ws, OWNER, { collection: 'invoices', docId: inv, action: 'create', data }, await context());
    assert.equal((await item(chair3)).quantityAtHand, 6);
    await freight(`${ws}_frt003`);
    const res = await land({ charge: { kind: 'bill', billId: `${ws}_frt003`, line: 0 }, receiptBillIds: [`${ws}_bill03`] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const id = String(res.body.entryId);
    assert.deepEqual(res.body.lines!.map(l => [l.allocatedCents, l.inventoryCents, l.cogsCents]), [[5_000, 3_000, 2_000], [15_000, 15_000, 0]]);
    assert.deepEqual([await sum('1300', id), await sum('5000', id), await sum('5100', id)], [18_000, 2_000, -20_000]);
    const cogsLine = ((await db.collection('transactions').doc(id).get()).data()!.lines as Array<{ accountId: string; dimensions?: Record<string, string> }>).find(l => l.accountId === acct['5000'].id);
    assert.equal(cogsLine?.dimensions?.project, 'P-1', 'the COGS share keeps the line\'s labels');
    assert.deepEqual([(await item(chair3)).unitCostCents, (await item(table3)).unitCostCents], [5_500, 16_500]);
    assert.equal((await moves(chair3))[0].valueCents, 3_000, 'the stock move carries only the units on hand');
    const queue = (await db.collection('repostQueue').doc(`${ws}_stock-cost_${chair3}`).get()).data();
    assert.equal(queue, undefined, 'dated after the sale: nothing is marked for repost');
  });

  test('a locked day: a manual amount asked for 10-05 is posted today; an unknown or inventory offset is refused', async () => {
    await db.collection('workspaces').doc(ws).update({ lockDate: '2026-10-10' });
    try {
      const manual = (allocationId: string, accountId = acct['5100'].id) => ({ kind: 'manual', amountCents: 1_000, accountId, allocationId });
      assert.equal((await land({ charge: manual('alloc-inv-0001', acct['1300'].id), receiptBillIds: [`${ws}_bill01`], date: '2026-10-05' })).status, 400);
      const res = await land({ charge: manual('alloc-lock-0001'), receiptBillIds: [`${ws}_bill01`], date: '2026-10-05', basis: 'quantity' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual([res.body.date, res.body.movedToOpenDay], [today, true]);
      assert.deepEqual(res.body.lines!.map(l => l.allocatedCents), [500, 500], 'by quantity 10 : 10');
      const retry = await land({ charge: manual('alloc-lock-0001'), receiptBillIds: [`${ws}_bill01`], date: '2026-10-05', basis: 'quantity' });
      assert.equal(retry.body.replayed, true);
    } finally {
      await db.collection('workspaces').doc(ws).update({ lockDate: null });
    }
  });

  test('refused: an item line as the charge, a bill with no received goods, a weight basis without weights', async () => {
    assert.equal((await land({ charge: { kind: 'bill', billId: `${ws}_bill01`, line: 0 }, receiptBillIds: [`${ws}_bill01`] })).status, 400);
    assert.equal((await land({ charge: { kind: 'manual', amountCents: 100, accountId: acct['5100'].id, allocationId: 'alloc-none-0001' }, receiptBillIds: [`${ws}_frt001`] })).status, 400);
    assert.equal((await land({ charge: { kind: 'manual', amountCents: 100, accountId: acct['5100'].id, allocationId: 'alloc-wt-00001' }, receiptBillIds: [`${ws}_bill01`], basis: 'weight' })).status, 400);
    const weighed = await land({ charge: { kind: 'manual', amountCents: 300, accountId: acct['5100'].id, allocationId: 'alloc-wt-00002' }, receiptBillIds: [`${ws}_bill01`], basis: 'weight', weights: { [`${ws}_bill01:0`]: 2, [`${ws}_bill01:1`]: 1 }, dryRun: true });
    assert.deepEqual(weighed.body.lines!.map(l => l.allocatedCents), [200, 100], 'by weight 2 : 1');
  });

  test('review: ids are a hash of the exact charge, so ids that sanitized alike no longer collide', () => {
    const a = landedCostBaseId('w', { kind: 'bill', billId: 'a/b', line: 0 });
    assert.notEqual(a, landedCostBaseId('w', { kind: 'bill', billId: 'a_b', line: 0 }));
    assert.notEqual(a, landedCostBaseId('w2', { kind: 'bill', billId: 'a/b', line: 0 }));
    assert.match(a, /^landed-cost-bill-[0-9a-f]{32}$/);
  });

  test('review: remainingShare takes each sale from the pool on hand then', () => {
    const m = (kind: string, date: string, quantity: number, before: number, extra: Record<string, unknown> = {}) => ({ kind, date, seq: `${date}#0`, quantity, quantityBefore: before, quantityAfter: before + quantity, ...extra }) as unknown as StockMove;
    const history = [m('opening', '2026-09-30', 100, 0), m('purchase', '2026-10-01', 10, 100, { documentType: 'bill', documentId: 'b', documentLine: 0 }), m('sale', '2026-10-03', -50, 110), m('transfer-out', '2026-10-04', -5, 60)];
    assert.equal(remainingShare(history, 'b', 0), 60 / 110);
    assert.equal(remainingShare(history, 'other', 0), 0);
  });

  test('review: stock on hand before the receipt shares the sales: 60/110 to Inventory, 50/110 to COGS', async () => {
    await db.collection('inventory').doc(stool).update({ unitCostCents: 5_000 });
    const opening = await send('POST', '/api/v1/inventory/adjust', { workspaceId: ws, itemId: stool, quantityChange: 100, type: 'opening', inventoryAccountId: acct['1300'].id, offsetAccountId: acct['3900'].id, date: '2026-09-30', unitCostCents: 5_000 });
    assert.equal(opening.status, 200, JSON.stringify(opening.body));
    await postBill(`${ws}_bill04`, '2026-10-01', [stockLine(stool, 10, 5_000)]);
    await sell(`${ws}_inv4`, stool, 50);
    assert.deepEqual([(await item(stool)).quantityAtHand, (await item(stool)).unitCostCents], [60, 5_000]);
    const res = await land({ charge: manual('alloc-stool-001', 1_100), receiptBillIds: [`${ws}_bill04`] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.lines!.map(l => [l.allocatedCents, l.inventoryCents, l.cogsCents, l.unitCostAfterCents]), [[1_100, 600, 500, 5_010]]);
    assert.equal((await item(stool)).unitCostCents, 5_010);
  });

  test('review: a charge bill whose posting was reversed is refused', async () => {
    const billId = `${ws}_frt004`;
    await freight(billId);
    const entry = (await all<Transaction>('transactions')).find(t => t.metadata?.billId === billId && !t.metadata?.reversesTxId)!;
    await db.collection('transactions').doc(`${entry.id}-rev`).set({ ...entry, id: `${entry.id}-rev`, lines: entry.lines.map(l => ({ ...l, amountCents: -l.amountCents })), metadata: { ...entry.metadata, reversesTxId: entry.id } });
    const res = await land({ charge: { kind: 'bill', billId, line: 0 }, receiptBillIds: [`${ws}_bill01`], dryRun: true });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.match(String(res.body.error), /not in the books/);
  });

  test('review: undo restores the stored cost, and a landed cost that went all to COGS can be undone', async () => {
    await postBill(`${ws}_bill05`, '2026-10-01', [stockLine(lamp, 2, 1_000)]);
    const lamped = await land({ charge: manual('alloc-lamp-0001', 1), receiptBillIds: [`${ws}_bill05`] });
    assert.equal((await item(lamp)).unitCostCents, 1_001, 'round(2,001 / 2)');
    assert.equal((await send('POST', `/api/v1/inventory/landed-cost/${lamped.body.entryId}/undo`, { workspaceId: ws })).status, 200);
    assert.equal((await item(lamp)).unitCostCents, 1_000, 'the stored cost, not round((2,002 − 1) / 2) = 1,001');

    await postBill(`${ws}_bill06`, '2026-10-01', [stockLine(vase, 2, 1_000)]);
    await sell(`${ws}_inv6`, vase, 2);
    const vased = await land({ charge: manual('alloc-vase-0001', 100), receiptBillIds: [`${ws}_bill06`] });
    assert.equal(vased.status, 200, JSON.stringify(vased.body));
    assert.deepEqual(vased.body.lines!.map(l => [l.inventoryCents, l.cogsCents]), [[0, 100]]);
    assert.equal((await moves(vase)).length, 0, 'nothing on hand: no move');
    const undo = await send('POST', `/api/v1/inventory/landed-cost/${vased.body.entryId}/undo`, { workspaceId: ws });
    assert.equal(undo.status, 200, JSON.stringify(undo.body));
  });

  test('review: several lines of one item write one move; Post with a stale planHash is refused with the new plan', async () => {
    await postBill(`${ws}_bill07`, '2026-10-01', [stockLine(rug, 1, 1_000), stockLine(rug, 2, 1_000)]);
    const body = { charge: manual('alloc-rug-00001', 300), receiptBillIds: [`${ws}_bill07`], basis: 'quantity' };
    const dry = await land({ ...body, dryRun: true });
    assert.match(String(dry.body.planHash), /^[0-9a-f]{32}$/);
    const stale = await land({ ...body, expectedPlanHash: 'f'.repeat(32) });
    assert.equal(stale.status, 409, JSON.stringify(stale.body));
    assert.equal((stale.body.plan as Json).planHash, dry.body.planHash, 'the new plan comes back to review');
    assert.equal((await moves(rug)).length, 0, 'nothing posted');
    const res = await land({ ...body, expectedPlanHash: dry.body.planHash });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.lines!.map(l => l.allocatedCents), [100, 200]);
    assert.deepEqual((await moves(rug)).map(m => m.valueCents), [300], 'one move for the item');
    assert.equal((await item(rug)).unitCostCents, 1_100, '(3 × 1,000 + 300) / 3');
  });

  test('review: several Inventory accounts and no mapping → choose one; the mapping is used', async () => {
    const add = await send('POST', `/api/v1/workspaces/${ws}/import-records`, { kind: 'accounts', rows: [{ name: 'Inventory 2', code: '1310', type: 'Inventory' }] });
    assert.equal(add.status, 200, JSON.stringify(add.body));
    const inv2 = (await all<ChartAccount>('chartAccounts')).find(a => a.code === '1310')!;
    const body = { charge: manual('alloc-map-00001', 100), receiptBillIds: [`${ws}_bill01`], dryRun: true };
    const refused = await land(body);
    assert.equal(refused.status, 400, JSON.stringify(refused.body));
    assert.match(String(refused.body.error), /several/);
    await db.collection('workspaces').doc(ws).update({ defaultAccountMappings: { inventory: inv2.id } });
    try {
      const mapped = await land(body);
      assert.equal(mapped.status, 200, JSON.stringify(mapped.body));
      assert.equal(mapped.body.inventoryAccountId, inv2.id);
      assert.equal((await land({ ...body, inventoryAccountId: acct['1300'].id })).body.inventoryAccountId, acct['1300'].id, 'an explicit account wins');
    } finally {
      await db.collection('workspaces').doc(ws).update({ defaultAccountMappings: null });
      await db.collection('chartAccounts').doc(inv2.id).delete();
    }
  });

  test('review: a partial update cannot strip the landed-cost type', async () => {
    const id = idOf(charge, 1);
    const res = await send('PUT', `/api/v1/transactions/${id}`, { partialUpdate: { metadata: { type: 'journal' } } });
    assert.ok(res.status >= 400, JSON.stringify(res.body));
    assert.equal((await db.collection('transactions').doc(id).get()).data()?.metadata?.type, 'landed-cost');
  });

  test('review: a backdated purchase before a landed cost is refused by the repost run', async () => {
    await postBill(`${ws}_bill08`, '2026-10-05', [stockLine(desk, 5, 1_000)]);
    assert.equal((await land({ charge: manual('alloc-desk-0001', 500), receiptBillIds: [`${ws}_bill08`] })).status, 200);
    await postBill(`${ws}_bill09`, '2026-10-01', [stockLine(desk, 5, 1_000)]);
    const before = (await all('transactions')).length;
    const run = await send('POST', '/api/v1/repost', { workspaceId: ws, runId: 'run-desk-00001', keys: [desk] });
    assert.equal(run.status, 409, JSON.stringify(run.body));
    assert.match(String(run.body.error), /landed cost was posted on .*undo it/);
    assert.equal((await all('transactions')).length, before, 'nothing posted');
  });
});
