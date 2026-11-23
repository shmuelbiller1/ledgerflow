/**
 * Cost of goods sold on invoices: the entries (src/services/invoiceCogs.ts) and, against a real
 * database, the posting endpoint that records them and moves stock
 * (POST /api/v1/transactions/bulk + src/server/services/cogsStockService.ts).
 * The database part runs when LF_TEST_DATABASE_URL is set.
 */
import test, { after, before, describe } from 'node:test';
import { commitAsServer } from './helpers/serverCommit';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { COGS_ACCOUNTS_MISSING, COGS_COST_UNKNOWN, planInvoiceCogs } from '../services/invoiceCogs';
import type { InvoiceCogsInput } from '../services/invoiceCogs';
import { makeInvoice } from './fixtures';
import type { Invoice } from '../types';

type Line = NonNullable<Invoice['items']>[number];
const line = (over: Partial<Line> & Pick<Line, 'id'>): Line => ({
  description: 'x', quantity: 1, rateCents: 0, amountCents: 0, accountId: 'sales', ...over,
});
const baseInput = (invoice: Invoice, over: Partial<InvoiceCogsInput> = {}): InvoiceCogsInput => ({
  invoiceId: invoice.id, invoice, date: '2026-04-05', uid: 'u1', workspaceId: 'ws1', baseCurrency: 'USD',
  inventoryAccount: { id: 'inv', name: 'Inventory' }, cogsAccount: { id: 'cogs', name: 'Cost of Goods Sold' },
  items: [{ id: 'item-w', name: 'Widget', unitCostCents: 400 }], ...over,
});

describe('Invoice cost of goods sold entries', () => {
  test('selling 3 at cost 400: DR cost of goods sold 1200, CR inventory 1200, linked to the line', () => {
    const invoice = makeInvoice({ id: 'INV1', items: [line({ id: 'l1', itemId: 'item-w', quantity: 3, unitCostCents: 400 })] });
    const { entries, pendingReason } = planInvoiceCogs(baseInput(invoice));
    assert.equal(pendingReason, undefined);
    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0].lines.map(l => [l.accountId, l.amountCents]), [['cogs', 1200], ['inv', -1200]]);
    assert.deepEqual(entries[0].metadata, {
      invoiceId: 'INV1', type: 'invoice-cogs-auto', cogsForInvoiceId: 'INV1', cogsForLineId: 'l1', inventoryItemId: 'item-w', quantity: 3,
      // DIM-2 phase 3: the customer the units went to
      customerId: 'cust-1',
    });
  });

  test('a foreign-currency invoice still costs the items in the base currency', () => {
    const invoice = makeInvoice({ id: 'INV2', currency: 'EUR', exchangeRate: 1.1, items: [line({ id: 'l1', itemId: 'item-w', quantity: 2, unitCostCents: 400 })] });
    const [entry] = planInvoiceCogs(baseInput(invoice, { baseCurrency: 'USD' })).entries;
    assert.equal(entry.totalAmountCents, 800);
    assert.equal(entry.currency, 'USD');
    assert.equal(entry.exchangeRate, 1);
  });

  test('free-text lines, zero quantities and unknown costs post nothing', () => {
    const invoice = makeInvoice({ id: 'INV3', items: [
      line({ id: 'a', quantity: 5, unitCostCents: 400 }),                 // no item
      line({ id: 'b', itemId: 'item-w', quantity: 0 }),                   // nothing sold
      line({ id: 'c', itemId: 'item-unknown', quantity: 2 }),             // no cost known
    ] });
    // INV-01: the unknown cost still posts nothing, but the invoice is flagged for review
    assert.deepEqual(planInvoiceCogs(baseInput(invoice)), { entries: [], pendingReason: COGS_COST_UNKNOWN });
  });

  test('a known zero cost ships the units with a zero-value entry', () => {
    const invoice = makeInvoice({ id: 'INV3b', items: [line({ id: 'c', itemId: 'item-free', quantity: 2 })] });
    const plan = planInvoiceCogs(baseInput(invoice, { items: [{ id: 'item-free', name: 'Freebie', unitCostCents: 0 }] }));
    assert.equal(plan.entries.length, 1);
    assert.equal(plan.entries[0].totalAmountCents, 0);
    assert.equal(plan.pendingReason, undefined);
  });

  test("the item's cost is used when the line has none", () => {
    const invoice = makeInvoice({ id: 'INV4', items: [line({ id: 'l1', itemId: 'item-w', quantity: 1.5 })] });
    assert.equal(planInvoiceCogs(baseInput(invoice)).entries[0].totalAmountCents, 600);
  });

  test('missing accounts never block the invoice: nothing posted, reason given', () => {
    const invoice = makeInvoice({ id: 'INV5', items: [line({ id: 'l1', itemId: 'item-w', quantity: 1 })] });
    assert.deepEqual(planInvoiceCogs(baseInput(invoice, { cogsAccount: undefined })), { entries: [], pendingReason: COGS_ACCOUNTS_MISSING });
    // No item lines: no reason to flag the invoice.
    const services = makeInvoice({ id: 'INV6', items: [line({ id: 'l1', quantity: 1 })] });
    assert.deepEqual(planInvoiceCogs(baseInput(services, { cogsAccount: undefined })), { entries: [] });
  });
});

const url = process.env.LF_TEST_DATABASE_URL;

describe('Posting endpoint: cost of goods sold moves stock', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const suffix = crypto.randomBytes(4).toString('hex');
  const ws = `ws_cogs_${suffix}`;
  const other = `ws_cogs_other_${suffix}`;
  const item = `${ws}_widget`;
  const otherItem = `${other}_widget`;
  let server: Server;
  let base = '';
  let db: import('../server/db/pgFirestore').Firestore;

  // L94-STEP2B: entries that name a document are the server's own (its posting builds them); sent to the shared commit as the server does
  const post = (uid: string, body: unknown, key?: string) => commitAsServer(db, uid, body as never, key);
  const stock = async (id = item) => (await db.collection('inventory').doc(id).get()).data()?.quantityAtHand;
  const cogsEntry = (id: string, quantity: number, itemId = item) => {
    const invoice = makeInvoice({ id: `${ws}_inv`, items: [line({ id: 'l1', itemId, quantity, unitCostCents: 400 })] });
    const [entry] = planInvoiceCogs(baseInput(invoice, { workspaceId: ws, inventoryAccount: { id: `${ws}_inv`, name: 'Inventory' }, cogsAccount: { id: `${ws}_cogs`, name: 'COGS' } })).entries;
    return { ...entry, id };
  };
  const reversalOf = (id: string, target: ReturnType<typeof cogsEntry>) => ({
    ...target, id, description: 'Reversal', metadata: { invoiceId: `${ws}_inv`, isReversal: true, reversesTxId: target.id },
    lines: target.lines.map(l => ({ ...l, amountCents: -l.amountCents, debitCents: l.creditCents, creditCents: l.debitCents })),
  });

  before(async () => {
    process.env.DATABASE_URL = url;
    const express = (await import('express')).default;
    const { transactionRouter } = await import('../server/routes/transactionRoutes');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({ uid: 'owner-1', name: 'Shop', members: ['owner-1', 'book-1', 'view-1'], roles: { 'book-1': 'bookkeeper', 'view-1': 'viewer' } });
    await db.collection('workspaces').doc(other).set({ uid: 'owner-2', name: 'Other', members: ['owner-2'] });
    await db.collection('chartAccounts').doc(`${ws}_inv`).set({ workspaceId: ws, name: 'Inventory', type: 'asset', category: 'Inventory', code: '1200' });
    await db.collection('chartAccounts').doc(`${ws}_cogs`).set({ workspaceId: ws, name: 'COGS', type: 'expense', category: 'COGS', code: '5000' });
    await db.collection('inventory').doc(item).set({ workspaceId: ws, name: 'Widget', sku: 'W-1', unitCostCents: 400, unitPriceCents: 1250, quantityAtHand: 10 });
    await db.collection('inventory').doc(otherItem).set({ workspaceId: other, name: 'Theirs', sku: 'T-1', unitCostCents: 400, unitPriceCents: 1, quantityAtHand: 5 });

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string } }).user = { uid: String(req.header('x-test-uid')) }; next(); });
    app.use('/api/v1/transactions', transactionRouter);
    app.use('/api/v1/documents', (await import('../server/routes/documentPostRoutes')).documentPostRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    for (const table of ['transactions', 'inventory', 'chartAccounts', 'invoices', 'creditNotes', 'idempotencyKeys', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id in ($1, $2) or id in ($1, $2)`, [ws, other]);
    }
    await db.terminate();
  });

  const sale = cogsEntry(`${ws}_c1`, 3);

  test('a viewer cannot post', async () => {
    const res = await post('view-1', { workspaceId: ws, transactions: [sale] });
    assert.equal(res.status, 403);
    assert.equal(await stock(), 10);
  });

  test('posting the cost lowers stock; the same request again changes nothing', async () => {
    const first = await post('book-1', { workspaceId: ws, transactions: [sale] }, `k-${suffix}`);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(await stock(), 7);
    const again = await post('book-1', { workspaceId: ws, transactions: [sale] }, `k-${suffix}`);
    assert.equal(again.status, 200);
    assert.equal(await stock(), 7);
  });

  test('AUD-07: the same key from another user, or for a different request, is refused and changes nothing', async () => {
    const other = await post('owner-1', { workspaceId: ws, transactions: [sale] }, `k-${suffix}`);
    assert.equal(other.status, 409, JSON.stringify(other.body));
    const changed = await post('book-1', { workspaceId: ws, transactions: [{ ...sale, description: 'something else' }] }, `k-${suffix}`);
    assert.equal(changed.status, 409, JSON.stringify(changed.body));
    assert.equal(await stock(), 7);
  });

  test('reversing it puts the stock back, and it cannot be reversed twice', async () => {
    const rev = await post('book-1', { workspaceId: ws, transactions: [reversalOf(`${ws}_r1`, sale)] });
    assert.equal(rev.status, 200, JSON.stringify(rev.body));
    assert.equal(await stock(), 10);
    const twice = await post('book-1', { workspaceId: ws, transactions: [reversalOf(`${ws}_r2`, sale)] });
    assert.equal(twice.status, 409);
    assert.equal(await stock(), 10);
  });

  test('selling more than is on hand is recorded with a warning', async () => {
    const res = await post('owner-1', { workspaceId: ws, transactions: [cogsEntry(`${ws}_c2`, 12)] });
    assert.equal(res.status, 200);
    assert.match(String((res.body.warnings as string[])[0]), /Widget is now -2/);
    assert.equal(await stock(), -2);
  });

  test("another workspace's item is refused and nothing is written", async () => {
    const res = await post('owner-1', { workspaceId: ws, transactions: [cogsEntry(`${ws}_c3`, 1, otherItem)] });
    assert.equal(res.status, 403);
    assert.equal((await db.collection('transactions').doc(`${ws}_c3`).get()).exists, false);
    assert.equal(await stock(otherItem), 5);
  });

  test('the manual Reverse action also puts the stock back', async () => {
    const entry = cogsEntry(`${ws}_c5`, 1);
    assert.equal((await post('owner-1', { workspaceId: ws, transactions: [entry] })).status, 200);
    assert.equal(await stock(), -3);
    const res = await fetch(`${base}/api/v1/transactions/${entry.id}/reverse`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-test-uid': 'owner-1' },
      body: JSON.stringify({ workspaceId: ws, reason: 'test', reversalDate: '2026-04-06' }),
    });
    assert.equal(res.status, 200, await res.text());
    assert.equal(await stock(), -2);
    assert.equal((await post('owner-1', { workspaceId: ws, transactions: [reversalOf(`${ws}_r5`, entry)] })).status, 409);
  });

  test('an update changes only the fields it sends (Retry), and credit notes can be saved', async () => {
    await db.collection('invoices').doc(`${ws}_inv7`).set({ workspaceId: ws, customerId: 'c', amountCents: 500, dueDate: '2026-05-01', status: 'sent', metadata: { cogsPending: true } });
    const upd = await post('owner-1', { workspaceId: ws, transactions: [], entityMutation: { collection: 'invoices', docId: `${ws}_inv7`, action: 'update', data: { metadata: { cogsPending: false } } } });
    assert.equal(upd.status, 200, JSON.stringify(upd.body));
    const inv = (await db.collection('invoices').doc(`${ws}_inv7`).get()).data();
    assert.equal(inv?.status, 'sent');
    assert.equal(inv?.metadata?.cogsPending, false);
    const cn = await post('owner-1', { workspaceId: ws, transactions: [], entityMutation: { collection: 'creditNotes', docId: `${ws}_cn1`, action: 'create', data: { customerId: 'c', amountCents: 300, remainingCents: 300, date: '2026-05-01', status: 'open' } } });
    assert.equal(cn.status, 200, JSON.stringify(cn.body));
    assert.equal((await db.collection('creditNotes').doc(`${ws}_cn1`).get()).data()?.amountCents, 300);
  });

  test('all or nothing: a failing entry also undoes the invoice change', async () => {
    const res = await post('owner-1', {
      workspaceId: ws,
      transactions: [cogsEntry(`${ws}_c4`, 1), { ...sale }], // sale's id already exists
      entityMutation: { collection: 'invoices', docId: `${ws}_inv9`, action: 'create', data: { customerId: 'c', amountCents: 100, dueDate: '2026-05-01', status: 'sent' } },
    });
    assert.equal(res.status, 409);
    assert.equal((await db.collection('invoices').doc(`${ws}_inv9`).get()).exists, false);
    assert.equal((await db.collection('transactions').doc(`${ws}_c4`).get()).exists, false);
    assert.equal(await stock(), -2);
  });
});
