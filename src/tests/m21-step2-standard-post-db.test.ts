/**
 * M-21 standard costing, step 2, end to end against a real database. A workspace with standard-cost posting on
 * receives a bill's items at their standard and posts the difference to the purchase-price variance account; the
 * stock comes in at the standard and a sale relieves it at the standard. Needs LF_TEST_DATABASE_URL.
 *
 * Worked figures (cents):
 *   Bill B-1 (11-10): 10 chairs @ 5,000 = 50,000 (chair standard 4,000) and 5 tables @ 15,000 = 75,000 (no standard)
 *   the receipt: Inventory 115,000 (10 × 4,000 + 75,000), variance 10,000 debited to PPV (5200), A/P 125,000
 *   metadata.stockIn carries 40,000 / 75,000, so the stock comes in at the standard: chairs 10 units at 4,000
 *   (the item's average cost keeps the actual basis — 5,000 — so the variance report still compares actual
 *   against standard; only the books' carrying value is the standard)
 *   the invoice of 4 chairs: cost of goods 4 × 4,000 = 16,000 (the standard, not 4 × 5,000), stock down to 6
 *   parity: the same bill posted against a workspace row without the setting posts Inventory 125,000, no variance
 */
import './helpers/dom';
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { postBillLedger } from '../services/ledgerPost/billPosting';
import { postVendorCreditLedger } from '../services/ledgerPost/creditPosting';
import { postInvoiceLedger } from '../services/ledgerPost/invoicePosting';
import type { LedgerPostContext } from '../services/ledgerPost/postingKit';
import type { ChartAccount, InventoryItem, Transaction, Workspace } from '../types';
import '../services/ledgerPost/postingKit';

const url = process.env.LF_TEST_DATABASE_URL;
type Json = Record<string, unknown> & { lines?: Array<Record<string, number | string>> };

describe('M-21 step 2: posting at standard against the database', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_m21_${crypto.randomBytes(4).toString('hex')}`;
  const OWNER = 'owner-1';
  const [chair, table] = [`${ws}_chair`, `${ws}_table`];
  const ITEMS: Array<[string, string]> = [[chair, 'Chair'], [table, 'Table']];
  let server: Server;
  let base = '';
  let db: import('../server/db/pgFirestore').Firestore;
  const realFetch = globalThis.fetch;
  const acct: Record<string, ChartAccount> = {};
  const today = '2026-11-10';
  const send = async (method: string, path: string, body?: unknown, uid = OWNER) => {
    const res = await realFetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', 'x-test-uid': uid }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: res.status, body: await res.json().catch(() => ({})) as Json };
  };
  const all = async <T>(collection: string) => (await db.collection(collection).where('workspaceId', '==', ws).get()).docs.map(d => ({ ...d.data(), id: d.id }) as T);
  const item = async (id: string) => ({ ...(await db.collection('inventory').doc(id).get()).data(), id }) as InventoryItem;
  const standardCosting = { enabled: true, varianceAccountId: '' };
  const context = async (withStandard: boolean): Promise<LedgerPostContext> => ({
    accounts: Object.values(acct), lockDate: null, uid: OWNER, inventory: await Promise.all(ITEMS.map(([id]) => item(id))),
    transactions: await all<Transaction>('transactions'),
    workspaces: [{ id: ws, uid: OWNER, name: 'Standard Co', currency: 'USD', timezone: 'UTC', ...(withStandard ? { standardCosting } : {}) } as Workspace],
  });
  const postBill = async (id: string, splits: Array<Record<string, unknown>>, withStandard = true) => {
    const data = {
      id, workspaceId: ws, uid: OWNER, number: id.slice(-6), vendorId: 'v', vendorName: 'Supplier', date: today, dueDate: today, status: 'pending' as const, currency: 'USD',
      amountCents: splits.reduce((s, x) => s + Number(x.amountCents), 0), splits,
    };
    await db.collection('bills').doc(id).set(data);
    await postBillLedger(id, data as never, ws, OWNER, { collection: 'bills', docId: id, action: 'create', data }, await context(withStandard));
  };
  const goods = () => [
    { amountCents: 50000, accountId: acct['1300'].id, description: 'Chairs', itemId: chair, quantity: 10 },
    { amountCents: 75000, accountId: acct['1300'].id, description: 'Tables', itemId: table, quantity: 5 },
  ];

  before(async () => {
    process.env.DATABASE_URL = url;
    const express = (await import('express')).default;
    const { workspaceRouter } = await import('../server/routes/workspaceRoutes');
    const { transactionRouter } = await import('../server/routes/transactionRoutes');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({ uid: OWNER, name: 'Standard Co', currency: 'USD', timezone: 'UTC', members: [OWNER, 'acct', 'book', 'view'], roles: { acct: 'accountant', book: 'bookkeeper', view: 'viewer' } });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string; email: string } }).user = { uid: String(req.header('x-test-uid')), email: 'owner@standard.test' }; next(); });
    app.use('/api/v1/workspaces', workspaceRouter);
    app.use('/api/v1/transactions', transactionRouter);
    app.use('/api/v1/documents', (await import('../server/routes/documentPostRoutes')).documentPostRouter);
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
      { name: 'Purchase Price Variance', code: '5200', type: 'Expense' },
      { name: 'Operating Expense', code: '6000', type: 'Expense' },
      { name: 'Opening Balance Equity', code: '3900', type: 'Equity' },
    ] });
    assert.equal(accounts.status, 200, JSON.stringify(accounts.body));
    for (const a of await all<ChartAccount>('chartAccounts')) acct[String(a.code)] = a;
    standardCosting.varianceAccountId = acct['5200'].id;
    for (const [id, name] of ITEMS) {
      await db.collection('inventory').doc(id).set({
        workspaceId: ws, name, sku: name.toUpperCase(), itemType: 'stock', quantityAtHand: 0, unitCostCents: 0,
        unitPriceCents: 30000, reorderPoint: 0, uid: OWNER,
        ...(id === chair ? { standardCostCents: 4000 } : {}),
      });
    }
    // the workspace turns standard-cost posting on, with the variance account
    await db.collection('workspaces').doc(ws).update({ standardCosting });
  });

  after(async () => {
    globalThis.fetch = realFetch;
    server?.close();
    for (const tbl of ['transactions', 'bills', 'invoices', 'inventory', 'stockMoves', 'chartAccounts', 'auditLogs', 'idempotencyKeys', 'workspaces']) {
      await db.pool.query(`delete from public."${tbl}" where workspace_id = $1 or id = $1`, [ws]).catch(() => {});
    }
    const { getSupabase } = await import('../lib/db/client');
    getSupabase().realtime.disconnect();
    await getSupabase().auth.dispose();
    await db.terminate();
  });

  test('the receipt posts Inventory at the standard and the variance to the variance account', async () => {
    await postBill(`${ws}_bill01`, goods());
    const entries = await all<Transaction>('transactions');
    const accrual = entries.find(t => t.metadata?.type === 'bill-accrual');
    assert.ok(accrual, 'the bill posted its accrual entry');
    const lineOf = (code: string) => (accrual!.lines || []).filter(l => l.accountId === acct[code].id).reduce((s, l) => s + Number(l.amountCents), 0);
    assert.equal(lineOf('1300'), 115000, 'Inventory at the standard');
    assert.equal(lineOf('5200'), 10000, 'the unfavourable variance is debited');
    assert.equal(lineOf('2000'), -125000);
    assert.equal((accrual!.lines || []).reduce((s, l) => s + Number(l.amountCents), 0), 0, 'the entry balances');
    assert.deepEqual((accrual!.metadata?.stockIn as Array<{ itemId: string; quantity: number; valueCents: number }>)
      .map(l => [l.itemId, l.quantity, l.valueCents]), [[chair, 10, 40000], [table, 5, 75000]]);

    // the stock came in at the standard (the carrying value); the item's average cost keeps the actual basis
    const chairItem = await item(chair);
    assert.equal(chairItem.quantityAtHand, 10);
    assert.equal(chairItem.unitCostCents, 5000, 'the average keeps the actual cost, the books carry the standard');
  });

  test('a sale relieves the stock at the standard', async () => {
    const data = {
      id: `${ws}_inv01`, workspaceId: ws, uid: OWNER, number: 'INV-1', customerId: 'acme', customerName: 'Acme', date: today, dueDate: today, status: 'sent' as const,
      amountCents: 4 * 30000, amountPaidCents: 0, currency: 'USD', taxVersion: 2, taxAmountCents: 0,
      items: [{ id: 'l1', itemId: chair, description: 'Chair', quantity: 4, rateCents: 30000, amountCents: 4 * 30000, accountId: acct['4000'].id }],
    };
    await db.collection('invoices').doc(data.id).set(data);
    await postInvoiceLedger(data.id, data as never, ws, OWNER, { collection: 'invoices', docId: data.id, action: 'create', data }, await context(true));

    const cogs = (await all<Transaction>('transactions')).find(t => t.metadata?.type === 'invoice-cogs-auto');
    assert.ok(cogs, 'the invoice posted its cost of goods');
    assert.equal(cogs!.totalAmountCents, 16000, '4 × 4,000 at the standard, not 4 × 5,000');
    assert.equal(cogs!.metadata?.standard, true);
    const chairItem = await item(chair);
    assert.equal(chairItem.quantityAtHand, 6);
    assert.equal(chairItem.unitCostCents, 5000, 'a sale does not move the average-cost basis');
  });

  test('goods returned to the vendor come off Inventory at the standard, reversing the variance', async () => {
    // Codex review: the receipt debited Inventory at the standard (4,000) and debited PPV for the
    // difference; a return must credit Inventory at the standard and reverse that variance, not take the
    // full actual value (5,000) off Inventory again.
    await postBill(`${ws}_bill03`, goods());
    const onHandBefore = (await item(chair)).quantityAtHand;
    const vcId = `${ws}_vc01`;
    const vcData = {
      id: vcId, workspaceId: ws, uid: OWNER, vendorId: 'v', vendorName: 'Supplier', number: 'VC-1',
      billId: `${ws}_bill03`, amountCents: 25000, remainingCents: 25000, date: today, status: 'open' as const,
      currency: 'USD', returnedGoods: [{ billLine: 0, itemId: chair, quantity: 5, valueCents: 25000 }],
    };
    await db.collection('vendorCredits').doc(vcId).set(vcData);
    await postVendorCreditLedger(vcId, vcData as never, ws, OWNER, { collection: 'vendorCredits', docId: vcId, action: 'create', data: vcData }, await context(true));

    const vc = (await all<Transaction>('transactions')).find(t => t.metadata?.vendorCreditId === vcId);
    assert.ok(vc, 'the credit posted its entry');
    const lineOf = (code: string) => (vc!.lines || []).filter(l => l.accountId === acct[code].id).reduce((s, l) => s + Number(l.amountCents), 0);
    assert.equal(lineOf('1300'), -20000, 'Inventory comes off at the standard carrying value (5 × 4,000)');
    assert.equal(lineOf('5200'), -5000, 'the receipt variance for the returned units is reversed');
    assert.equal(lineOf('2000'), 25000);
    assert.equal((vc!.lines || []).reduce((s, l) => s + Number(l.amountCents), 0), 0, 'the entry balances');
    // the units leave stock at the standard value
    assert.deepEqual((vc!.metadata?.stockOut as Array<{ itemId: string; quantity: number; valueCents: number }>)
      .map(l => [l.itemId, l.quantity, l.valueCents]), [[chair, 5, 20000]]);
    // Codex review (F4): the stock move also carries the actual receipt basis (5 × 5,000), beside the
    // standard value it relieves Inventory at, so the average-cost basis is unaffected by the return
    const vcMove = (await all<import('../lib/stockMoves').StockMove & { id: string }>('stockMoves'))
      .find(m => m.kind === 'purchase-return' && m.itemId === chair);
    assert.ok(vcMove, 'the return moved stock');
    assert.equal(vcMove!.valueCents, -20000, 'the stock move relieves at the standard carrying value');
    assert.equal(vcMove!.actualValueCents, -25000, 'the stock move carries the actual receipt basis');
    const chairItem = await item(chair);
    assert.equal(chairItem.quantityAtHand, onHandBefore - 5);
  });

  test('parity: without the setting the same bill posts as before', async () => {
    // the server re-posts the bill with a context read from the database, so the setting itself is turned
    // off on the workspace row for this post (and put back after)
    await db.collection('workspaces').doc(ws).update({ standardCosting: { enabled: false, varianceAccountId: '' } });
    try {
      await postBill(`${ws}_bill02`, goods(), false);
    } finally {
      await db.collection('workspaces').doc(ws).update({ standardCosting });
    }
    const entries = await all<Transaction>('transactions');
    const accrual = entries.find(t => t.metadata?.billId === `${ws}_bill02` && t.metadata?.type === 'bill-accrual');
    assert.ok(accrual);
    const lineOf = (code: string) => (accrual!.lines || []).filter(l => l.accountId === acct[code].id).reduce((s, l) => s + Number(l.amountCents), 0);
    assert.equal(lineOf('1300'), 125000, 'Inventory at the actual');
    assert.equal(lineOf('5200'), 0, 'no variance line');
    assert.deepEqual((accrual!.metadata?.stockIn as Array<{ itemId: string; valueCents: number }>)
      .map(l => [l.itemId, l.valueCents]), [[chair, 50000], [table, 75000]]);
  });
});
