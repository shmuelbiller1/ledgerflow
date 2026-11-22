/**
 * W-08 drop-ship: a sales order line marked drop-ship is bought from a vendor and shipped straight to the
 * customer. The command places one vendor purchase order from the order's drop-ship lines; the PO's items carry
 * no stock item, so the bill made from the order brings no units in and posting moves no stock, and the invoice
 * made from the order posts the sale as today with no cost of goods.
 *
 * Worked figures (cents):
 *   Order EST-1001, two lines: Chair (10 × 5,000 = 50,000, drop-ship) and Table (2 × 15,000 = 30,000, in stock)
 *   the drop-ship PO buys the Chair line only: 10 × 5,000 = 50,000, numbered PO-<year>-001, status draft
 *   the PO item carries no itemId, so billLinesFromOrder emits no itemId/quantity on its bill splits, and
 *   posting that bill moves no stock (no stockIn on the entry); the invoice of the order keeps the Table's item
 *   and drops the Chair's, so the Chair sale books no cost of goods.
 */
import assert from 'node:assert/strict';
import test, { after, before, describe } from 'node:test';
import { billLinesFromOrder, nextPoNumber } from '../lib/purchaseOrders';
import { convertEstimateToInvoice } from '../lib/estimateConverter';
import { orderPartInvoice, orderProgress } from '../lib/salesOrders';
import { estimateDropshipCommand, estimateSaveCommand, estimateStatusCommand } from '../server/commands/estimates';
import type { Estimate, PurchaseOrder } from '../types';
import { commandHarness, owner, type CommandHarness } from './helpers/commandTestUtils';

const WS = 'ws-w08';
const EST_ID = 'est_w08_1';
const VENDOR_ID = 'vendor_w08';

const lines = (dropShip: boolean[]) => [
  { id: 'l1', itemId: 'chair', dropShip: dropShip[0], description: 'Chair', quantity: 10, unitPriceCents: 5000, amountCents: 50000 },
  { id: 'l2', itemId: 'table', dropShip: dropShip[1], description: 'Table', quantity: 2, unitPriceCents: 15000, amountCents: 30000 },
];

const estimateRow = (dropShip: boolean[], ordered = true): Record<string, unknown> => ({
  id: EST_ID, uid: owner.uid, workspaceId: WS, number: 'EST-1001', customerId: 'cust_1', customerName: 'Acme',
  amountCents: 80000, date: '2026-11-01', expiryDate: '2026-12-01', status: ordered ? 'accepted' : 'draft',
  ...(ordered ? { orderedAt: '2026-11-02T09:00:00.000Z', orderedBy: owner.uid } : {}),
  lines: lines(dropShip), createdAt: '2026-11-01T00:00:00.000Z',
});

describe('W-08: the drop-ship purchase order', () => {
  let harness: CommandHarness;

  before(async () => {
    harness = await commandHarness({
      commands: [estimateDropshipCommand, estimateSaveCommand, estimateStatusCommand],
      workspaceId: WS,
      seed(db) {
        db.seed(`workspaces/${WS}`, { uid: owner.uid, members: [owner.uid], currency: 'USD' });
        db.seed(`vendors/${VENDOR_ID}`, { uid: owner.uid, workspaceId: WS, name: 'Drop Shipper' });
        db.seed(`estimates/${EST_ID}`, estimateRow([true, false]));
      },
    });
  });

  after(async () => { await harness.close(); });

  test('places one PO from the drop-ship lines, numbered, with no item on its lines', async () => {
    const response = await harness.run(owner.uid, 'estimate.dropship', { id: EST_ID, vendorId: VENDOR_ID });
    assert.equal(response.status, 200);
    const body = await response.json() as { status: string; data?: { id: string; poNumber: string; totalAmountCents: number; lines: number } };
    assert.equal(body.status, 'success');
    const result = body.data!;
    assert.match(result.poNumber, /^PO-\d{4}-001$/);
    assert.equal(result.totalAmountCents, 50000);
    assert.equal(result.lines, 1);

    const po = harness.db.read(`purchaseOrders/${result.id}`) as Record<string, unknown>;
    assert.equal(po.workspaceId, WS);
    assert.equal(po.vendorId, VENDOR_ID);
    assert.equal(po.vendorName, 'Drop Shipper');
    assert.equal(po.status, 'draft');
    assert.equal(po.totalAmountCents, 50000);
    assert.deepEqual(po.metadata, { estimateId: EST_ID, estimateNumber: 'EST-1001', dropShip: true });
    const items = po.items as Array<Record<string, unknown>>;
    assert.equal(items.length, 1);
    assert.equal(items[0].description, 'Chair');
    assert.equal(items[0].quantity, 10);
    assert.equal(items[0].unitPriceCents, 5000);
    assert.equal(items[0].totalCents, 50000);
    assert.equal(items[0].itemId, undefined, 'the units never come into stock');
    // the order remembers the PO it was placed on
    const est = harness.db.read(`estimates/${EST_ID}`) as Record<string, unknown>;
    assert.equal((est.metadata as Record<string, unknown>).dropShipPoId, result.id);
  });

  test('a second drop-ship order for the same order is refused', async () => {
    const response = await harness.run(owner.uid, 'estimate.dropship', { id: EST_ID, vendorId: VENDOR_ID });
    assert.equal(response.status, 409);
  });

  test('a quote that is not an order is refused', async () => {
    const quoteId = 'est_w08_quote';
    harness.db.seed(`estimates/${quoteId}`, estimateRow([true, false], false));
    const response = await harness.run(owner.uid, 'estimate.dropship', { id: quoteId, vendorId: VENDOR_ID });
    assert.equal(response.status, 409);
  });

  test('an order with no drop-ship lines is refused', async () => {
    const plainId = 'est_w08_plain';
    harness.db.seed(`estimates/${plainId}`, estimateRow([false, false]));
    const response = await harness.run(owner.uid, 'estimate.dropship', { id: plainId, vendorId: VENDOR_ID });
    assert.equal(response.status, 400);
  });

  test('a vendor outside the workspace is refused', async () => {
    const response = await harness.run(owner.uid, 'estimate.dropship', { id: 'est_w08_none', vendorId: VENDOR_ID });
    assert.equal(response.status, 404);
  });
});

describe('W-08: the bill and the invoice move no stock', () => {
  const po = (items: PurchaseOrder['items']): PurchaseOrder => ({
    id: 'po_w08', uid: 'u', workspaceId: 'w', poNumber: 'PO-2026-001', vendorId: 'v', vendorName: 'Drop Shipper',
    issueDate: '2026-11-03', status: 'draft', items, totalAmountCents: items.reduce((s, i) => s + i.totalCents, 0),
    createdAt: '2026-11-03T00:00:00.000Z',
  });

  test('the bill made from the drop-ship PO carries no item, so nothing comes into stock', () => {
    const billLines = billLinesFromOrder(po([
      { id: 'a', description: 'Chair', quantity: 10, unitPriceCents: 5000, totalCents: 50000 },
    ]));
    assert.equal(billLines.length, 1);
    assert.equal(billLines[0].amountCents, 50000);
    assert.equal(billLines[0].itemId, undefined);
    assert.equal(billLines[0].quantity, undefined);
  });

  test('a stock item ordered the usual way still brings its units in (J-08, unchanged)', () => {
    const billLines = billLinesFromOrder(po([
      { id: 'a', description: 'Chair', quantity: 10, unitPriceCents: 5000, totalCents: 50000, itemId: 'chair' },
    ]));
    assert.deepEqual([billLines[0].itemId, billLines[0].quantity], ['chair', 10]);
  });

  test('the quantities invoice of the order drops the drop-ship line item, keeps the stock line item', () => {
    const est = { id: EST_ID, uid: 'u', workspaceId: WS, number: 'EST-1001', customerId: 'c', customerName: 'Acme',
      amountCents: 80000, date: '2026-11-01', status: 'accepted' as const, lines: lines([true, false]), createdAt: '2026-11-01T00:00:00.000Z' } as Estimate;
    const progress = orderProgress(est, []);
    const invoice = orderPartInvoice(est, progress, 80000, 'part 1', { mode: 'quantities', quantities: [10, 2] });
    const [chairLine, tableLine] = invoice.items || [];
    assert.equal(chairLine.itemId, undefined, 'the drop-ship line books no cost');
    assert.equal(tableLine.itemId, 'table', 'the stock line keeps its item');
    assert.equal(invoice.amountCents, 80000);
  });

  test('a whole-order invoice built from the estimate drops the drop-ship line item too', () => {
    const est = { id: EST_ID, uid: 'u', workspaceId: WS, number: 'EST-1001', customerId: 'c', customerName: 'Acme',
      amountCents: 80000, date: '2026-11-01', status: 'accepted' as const, lines: lines([true, false]), createdAt: '2026-11-01T00:00:00.000Z' } as Estimate;
    const invoice = convertEstimateToInvoice(est);
    const items = invoice.items || [];
    assert.equal(items[0].itemId, undefined);
    assert.equal(items[1].itemId, 'table');
  });

  test('the PO numbering continues from the highest this year', () => {
    assert.equal(nextPoNumber([{ poNumber: 'PO-2026-007' }, { poNumber: 'PO-2025-040' }], '2026'), 'PO-2026-008');
  });
});
