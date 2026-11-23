/**
 * M-21 step 2, bot round 3: four more review findings on the standard-cost postings and the
 * drop-ship command, found after the round-2 fixes.
 *
 * 1. The standard-cost return guard must not treat an item the context did not load (the
 *    sample-workspace path, where credit notes get no inventory) as a changed standard —
 *    otherwise every standard return is refused in production.
 * 2. An ordinary Inventory split's kept value must be its allocated share (books' minor units,
 *    net of tax), not its raw document amount: on a foreign-currency bill the two differ and the
 *    rebuilt entry would not balance.
 * 3. planReturnEntries must propagate the sale's standard marker to the return's metadata, so the
 *    cost replay's standard-return guard can protect standard-valued returns.
 * 4. estimate.dropship must refuse a declined order even though it keeps its acceptance date.
 */
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { planReturnEntries } from '../lib/salesReturns';
import { planInvoiceCogs } from '../services/invoiceCogs';
import { postBillLedger } from '../services/ledgerPost/billPosting';
import { postCreditNoteLedger } from '../services/ledgerPost/creditPosting';
import { estimateDropshipCommand, estimateStatusCommand } from '../server/commands/estimates';
import { workspaceStandardCostingCommand } from '../server/commands/workspaceSettings';
import { inventoryCogsCommand } from '../server/commands/inventoryStock';
import { INVOICE_COGS_TYPE } from '../services/invoiceCogs';
import type { LedgerPostContext } from '../services/ledgerPost/postingCore';
import type { ChartAccount, CreditNote, InventoryItem, Invoice, Transaction, Workspace } from '../types';
import { commandHarness, owner } from './helpers/commandTestUtils';

const WS = 'ws-m21-r3';
const OWNER = owner.uid;

const accounts = (): ChartAccount[] => ([
  { id: 'acc_inv', uid: OWNER, workspaceId: WS, name: 'Inventory', code: '1300', type: 'asset', category: 'Inventory', balanceCents: 0 },
  { id: 'acc_exp', uid: OWNER, workspaceId: WS, name: 'Operating Expense', code: '6000', type: 'expense', category: 'Expense', balanceCents: 0 },
  { id: 'acc_ap', uid: OWNER, workspaceId: WS, name: 'Accounts Payable', code: '2000', type: 'liability', category: 'Payables', balanceCents: 0 },
  { id: 'acc_cash', uid: OWNER, workspaceId: WS, name: 'Cash', code: '1000', type: 'asset', category: 'Cash', balanceCents: 0 },
  { id: 'acc_ppv', uid: OWNER, workspaceId: WS, name: 'Purchase Price Variance', code: '5200', type: 'expense', category: 'Expense', balanceCents: 0 },
  { id: 'acc_ar', uid: OWNER, workspaceId: WS, name: 'Accounts Receivable', code: '1100', type: 'asset', category: 'Receivables', balanceCents: 0 },
  { id: 'acc_cogs', uid: OWNER, workspaceId: WS, name: 'Cost of Goods Sold', code: '5000', type: 'expense', category: 'Expense', balanceCents: 0 },
  { id: 'acc_sr', uid: OWNER, workspaceId: WS, name: 'Sales Returns', code: '4000', type: 'income', category: 'Revenue', balanceCents: 0 },
]);

const returnItems = (): InventoryItem[] => ([
  { id: 'chair', uid: OWNER, workspaceId: WS, name: 'Chair', sku: 'CH-1', quantityAtHand: 0, unitCostCents: 0, unitPriceCents: 30000, reorderPoint: 0, standardCostCents: 400, createdAt: '2026-01-01T00:00:00.000Z' },
]);

const contextFor = (standardCosting?: { enabled: boolean; varianceAccountId: string }, captured: LedgerPostContext['capture'] = [], stock: InventoryItem[] = returnItems()): LedgerPostContext => ({
  accounts: accounts(),
  transactions: [] as Transaction[],
  workspaces: [{ id: WS, uid: OWNER, name: 'Standard Co', currency: 'USD', ...(standardCosting ? { standardCosting } : {}) } as Workspace],
  inventory: stock,
  capture: captured,
});

const saleEntry = (unitCost: number, quantity: number, standard = true): Transaction => ({
  id: 'tx_sale', uid: OWNER, workspaceId: WS, date: '2026-11-01', status: 'completed' as const,
  description: 'Cost of goods sold: Chair', currency: 'USD', type: 'actual',
  totalAmountCents: unitCost * quantity,
  lines: [],
  metadata: { type: INVOICE_COGS_TYPE, invoiceId: 'inv_1', cogsForLineId: 'l1', inventoryItemId: 'chair', quantity, standard },
} as Transaction);

const invoice = (): Invoice => ({
  id: 'inv_1', number: 'INV-1', workspaceId: WS, uid: OWNER, status: 'approved' as const, currency: 'USD',
  date: '2026-11-01', dueDate: '2026-12-01', amountCents: 90000, customerId: 'c1',
  items: [{ id: 'l1', itemId: 'chair', description: 'Chair', quantity: 10, rateCents: 9000, amountCents: 90000, accountId: '', unitCostCents: 4000 }],
} as Invoice);

const creditNote = (id: string, number: string): Partial<CreditNote> => ({
  id, workspaceId: WS, uid: OWNER, number, invoiceId: 'inv_1', customerId: 'c1',
  date: '2026-11-20', status: 'open' as const, currency: 'USD', amountCents: 90000,
  returnedGoods: [{ invoiceLineId: 'l1', itemId: 'chair', quantity: 10 }],
});

const entryTotal = (entry: { lines: Array<{ amountCents: number }> }) => entry.lines.reduce((s, l) => s + l.amountCents, 0);

describe('M-21 step 2 bot round 3: the return guard with an unloaded item', () => {
  test('a return of a standard sale is not refused when the context carries no inventory', async () => {
    // the sample-workspace path: the context loader did not load the item, so there is no current
    // standard to compare against — a missing item is not a changed standard
    const captured: LedgerPostContext['capture'] = [];
    const context: LedgerPostContext = {
      ...contextFor({ enabled: true, varianceAccountId: 'acc_ppv' }, captured, []),
      transactions: [saleEntry(400, 10, true)],
      invoices: [invoice()],
    };
    await postCreditNoteLedger('cn_r3_1', creditNote('cn_r3_1', 'CN-R3-1') as never, WS, OWNER, undefined, context);
    const goods = captured[0].txs.find(t => t.metadata?.type === 'credit-return-auto');
    assert.ok(goods, 'the returned-goods entry is posted');
    assert.equal(goods!.totalAmountCents, 4000, 'Inventory comes back at the sale cost');
  });

  test('the guard still refuses when the item is loaded and its standard has changed', async () => {
    const captured: LedgerPostContext['capture'] = [];
    const changed = returnItems().map(i => ({ ...i, standardCostCents: 600 }));
    const context: LedgerPostContext = {
      ...contextFor({ enabled: true, varianceAccountId: 'acc_ppv' }, captured, changed),
      transactions: [saleEntry(400, 10, true)],
      invoices: [invoice()],
    };
    await assert.rejects(
      postCreditNoteLedger('cn_r3_2', creditNote('cn_r3_2', 'CN-R3-2') as never, WS, OWNER, undefined, context),
      (err: Error) => /standard cost of Chair changed since it was sold/.test(err.message)
    );
    assert.equal(captured.length, 0, 'nothing is posted');
  });
});

describe('M-21 step 2 bot round 3: ordinary Inventory splits at their allocated share', () => {
  test('a foreign-currency bill keeps the ordinary split at its posted share, and balances', async () => {
    // EUR bill at rate 2 (books in USD): the 100-EUR receipt and the 50-EUR ordinary split post at
    // their allocated shares of the 300-cent net (200 and 100), not at their raw document amounts
    const splits = [
      { amountCents: 100, accountId: 'acc_inv', description: 'Chair', itemId: 'chair', quantity: 1 },
      { amountCents: 50, accountId: 'acc_inv', description: 'Assembly labour' },
    ];
    const billItems: InventoryItem[] = [{ id: 'chair', uid: OWNER, workspaceId: WS, name: 'Chair', sku: 'CH-1', quantityAtHand: 0, unitCostCents: 0, unitPriceCents: 30000, reorderPoint: 0, standardCostCents: 80, createdAt: '2026-01-01T00:00:00.000Z' }];
    const captured: LedgerPostContext['capture'] = [];
    await postBillLedger('bill_r3_1', {
      id: 'bill_r3_1', workspaceId: WS, uid: OWNER, number: 'B-R3', vendorId: 'v1', vendorName: 'Supplier',
      date: '2026-11-10', dueDate: '2026-12-10', status: 'pending' as const, currency: 'EUR', exchangeRate: 2,
      amountCents: 150, splits,
    } as never, WS, OWNER, undefined, contextFor({ enabled: true, varianceAccountId: 'acc_ppv' }, captured, billItems));
    const [entry] = captured[0].txs;
    const inv = entry.lines.filter(l => l.accountId === 'acc_inv');
    const ppv = entry.lines.filter(l => l.accountId === 'acc_ppv');
    // the receipt posts its standard (80); the ordinary split keeps its allocated share (100), not 50
    assert.equal(inv.reduce((s, l) => s + l.amountCents, 0), 180, '80 standard + 100 allocated ordinary');
    assert.equal(ppv[0].amountCents, 120, 'variance is the actual 200 − standard 80');
    assert.equal(entry.lines.find(l => l.accountId === 'acc_ap')!.amountCents, -300);
    assert.equal(entryTotal(entry), 0, 'the entry balances');
  });

  test('an ordinary split sharing a landed-only label is kept at its allocated share', async () => {
    // a landed-cost line and an ordinary split under the same label, with the receipt under another:
    // the landed cost rides in the variance, the ordinary split keeps its own share
    const splits = [
      { amountCents: 100, accountId: 'acc_inv', description: 'Chair', itemId: 'chair', quantity: 1, dimensions: { project: 'A' } },
      { amountCents: 20, accountId: 'acc_inv', description: 'Freight', dimensions: { project: 'B' }, landedCost: true },
      { amountCents: 50, accountId: 'acc_inv', description: 'Assembly labour', dimensions: { project: 'B' } },
    ];
    const billItems: InventoryItem[] = [{ id: 'chair', uid: OWNER, workspaceId: WS, name: 'Chair', sku: 'CH-1', quantityAtHand: 0, unitCostCents: 0, unitPriceCents: 30000, reorderPoint: 0, standardCostCents: 80, createdAt: '2026-01-01T00:00:00.000Z' }];
    const captured: LedgerPostContext['capture'] = [];
    await postBillLedger('bill_r3_2', {
      id: 'bill_r3_2', workspaceId: WS, uid: OWNER, number: 'B-R3B', vendorId: 'v1', vendorName: 'Supplier',
      date: '2026-11-10', dueDate: '2026-12-10', status: 'pending' as const, currency: 'USD',
      amountCents: 170, splits,
    } as never, WS, OWNER, undefined, contextFor({ enabled: true, varianceAccountId: 'acc_ppv' }, captured, billItems));
    const [entry] = captured[0].txs;
    const inv = entry.lines.filter(l => l.accountId === 'acc_inv');
    const byProject = Object.fromEntries(inv.map(l => [String(l.dimensions?.project), l.amountCents]));
    assert.equal(byProject['A'], 80, 'the receipt posts its standard');
    assert.equal(byProject['B'], 50, 'the ordinary split keeps its share; the landed line is dropped');
    assert.equal(entryTotal(entry), 0, 'the entry balances');
  });
});

describe('M-21 step 2 bot round 3: the return carries the sale standard marker', () => {
  test('planReturnEntries marks a return of a standard sale as standard', () => {
    const entries = planReturnEntries({
      creditNote: { id: 'cn_1', number: 'CN-1', invoiceId: 'inv_1', date: '2026-11-20', returnedGoods: [{ invoiceLineId: 'l1', itemId: 'chair', quantity: 10 }] },
      lines: [{ invoiceLineId: 'l1', itemId: 'chair', description: 'Chair', sold: 10, returned: 0, returnable: 10, unitCostCents: 400, unitPriceCents: 9000, saleStandard: true }],
      uid: OWNER, workspaceId: WS, baseCurrency: 'USD',
      inventoryAccount: accounts()[0], cogsAccount: accounts()[5],
    });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].metadata?.standard, true, 'the replay guard can see the return is standard');
    assert.equal(entries[0].totalAmountCents, 4000);
  });

  test('a return of a sale at the average carries no standard marker', () => {
    const entries = planReturnEntries({
      creditNote: { id: 'cn_2', number: 'CN-2', invoiceId: 'inv_1', date: '2026-11-20', returnedGoods: [{ invoiceLineId: 'l1', itemId: 'chair', quantity: 10 }] },
      lines: [{ invoiceLineId: 'l1', itemId: 'chair', description: 'Chair', sold: 10, returned: 0, returnable: 10, unitCostCents: 500, unitPriceCents: 9000 }],
      uid: OWNER, workspaceId: WS, baseCurrency: 'USD',
      inventoryAccount: accounts()[0], cogsAccount: accounts()[5],
    });
    assert.equal(entries[0].metadata?.standard, undefined);
  });
});

describe('M-21 step 2 bot round 3: drop-ship refuses a declined order', () => {
  test('a declined order that keeps its acceptance date is refused', async () => {
    const harness = await commandHarness({
      commands: [estimateDropshipCommand, estimateStatusCommand],
      workspaceId: WS,
      seed(db) {
        db.seed(`workspaces/${WS}`, { uid: OWNER, members: [OWNER], currency: 'USD' });
        db.seed(`vendors/vendor_r3`, { uid: OWNER, workspaceId: WS, name: 'Drop Shipper' });
        // accepted once (orderedAt is set), then declined: the order is closed, fulfilment is suppressed
        db.seed(`estimates/est_r3_declined`, {
          uid: OWNER, workspaceId: WS, number: 'EST-R3', customerId: 'cust_1', customerName: 'Acme',
          amountCents: 50000, date: '2026-11-01', expiryDate: '2026-12-01', status: 'declined', currency: 'USD',
          orderedAt: '2026-11-02T09:00:00.000Z', orderedBy: OWNER,
          lines: [{ id: 'l1', itemId: 'chair', dropShip: true, description: 'Chair', quantity: 10, unitPriceCents: 5000, amountCents: 50000 }],
          createdAt: '2026-11-01T00:00:00.000Z',
        });
      },
    });
    try {
      const response = await harness.run(OWNER, 'estimate.dropship', { id: 'est_r3_declined', vendorId: 'vendor_r3' });
      assert.equal(response.status, 409, 'a declined order does not drop-ship');
      const body = await response.json() as { status: string; message?: string };
      assert.match(String(body.message || ''), /Only accepted orders drop-ship/);
    } finally {
      await harness.close();
    }
  });
});

describe('M-21 step 2 bot round 3: the carrying-basis transition and manual COGS', () => {
  test('enabling standard costing is refused with negative stock on hand', async () => {
    // selling below zero leaves quantity -10 at cost 500 with a 400 standard: the drift check must
    // include negative stock, or the transition leaves Inventory out of step
    const harness = await commandHarness({
      commands: [workspaceStandardCostingCommand],
      workspaceId: WS,
      seed(db) {
        db.seed(`workspaces/${WS}`, { uid: OWNER, members: [OWNER], currency: 'USD' });
        db.seed(`chartAccounts/acc_ppv`, { uid: OWNER, workspaceId: WS, name: 'Purchase Price Variance', code: '5200', type: 'expense', category: 'Expense' });
        db.seed(`inventory/neg`, { uid: OWNER, workspaceId: WS, name: 'Neg', sku: 'NG', itemType: 'stock', quantityAtHand: -10, unitCostCents: 500, standardCostCents: 400 });
      },
    });
    try {
      const response = await harness.run(OWNER, 'workspace.standardcosting', { enabled: true, varianceAccountId: 'acc_ppv' });
      assert.equal(response.status, 409, 'negative stock is not reconciled');
      const body = await response.json() as { message?: string };
      assert.match(String(body.message || ''), /standard/i);
    } finally { await harness.close(); }
  });

  test('inventory.cogs is refused for a standard item while standard costing is on', async () => {
    const harness = await commandHarness({
      commands: [inventoryCogsCommand],
      workspaceId: WS,
      seed(db) {
        db.seed(`workspaces/${WS}`, { uid: OWNER, members: [OWNER], currency: 'USD', standardCosting: { enabled: true, varianceAccountId: 'acc_ppv' } });
        db.seed(`chartAccounts/acc_inv`, { uid: OWNER, workspaceId: WS, name: 'Inventory', code: '1300', type: 'asset', category: 'Inventory' });
        db.seed(`chartAccounts/acc_cogs`, { uid: OWNER, workspaceId: WS, name: 'Cost of Goods Sold', code: '5000', type: 'expense', category: 'Expense' });
        db.seed(`inventory/std`, { uid: OWNER, workspaceId: WS, name: 'Std', sku: 'ST', itemType: 'stock', quantityAtHand: 10, unitCostCents: 500, standardCostCents: 400 });
      },
    });
    try {
      const response = await harness.run(OWNER, 'inventory.cogs', { itemId: 'std', quantitySold: 2, inventoryAccountId: 'acc_inv', cogsAccountId: 'acc_cogs' });
      assert.equal(response.status, 409, 'the manual COGS path does not post at the standard');
      const body = await response.json() as { message?: string };
      assert.match(String(body.message || ''), /standard cost/i);
    } finally { await harness.close(); }
  });
});

describe('M-21 step 2 bot round 3: rounding-safe return guard and repost basis', () => {
  test('a fractional-quantity standard return is not refused for rounding alone', async () => {
    // 0.3 units at a 335 standard post 101 cents, which rounds to 337 per unit — the per-unit figure
    // differs from the standard, but the sale total matches the current standard, so the return posts
    const sale = {
      id: 'tx_frac', uid: OWNER, workspaceId: WS, date: '2026-11-01', status: 'completed' as const,
      description: 'Cost of goods sold: Chair', currency: 'USD', type: 'actual', totalAmountCents: 101,
      lines: [],
      metadata: { type: INVOICE_COGS_TYPE, invoiceId: 'inv_frac', cogsForLineId: 'l1', inventoryItemId: 'chair', quantity: 0.3, standard: true },
    } as Transaction;
    const invoice = {
      id: 'inv_frac', number: 'INV-FRAC', workspaceId: WS, uid: OWNER, status: 'approved' as const, currency: 'USD',
      date: '2026-11-01', dueDate: '2026-12-01', amountCents: 101, customerId: 'c1',
      items: [{ id: 'l1', itemId: 'chair', description: 'Chair', quantity: 0.3, rateCents: 9000, amountCents: 101, accountId: '', unitCostCents: 337 }],
    } as Invoice;
    const fracItems = returnItems().map(i => ({ ...i, standardCostCents: 335 }));
    const captured: LedgerPostContext['capture'] = [];
    const context: LedgerPostContext = {
      ...contextFor({ enabled: true, varianceAccountId: 'acc_ppv' }, captured, fracItems),
      transactions: [sale],
      invoices: [invoice],
    };
    const fracNote = { ...creditNote('cn_frac', 'CN-FRAC'), invoiceId: 'inv_frac', returnedGoods: [{ invoiceLineId: 'l1', itemId: 'chair', quantity: 0.3 }] };
    await postCreditNoteLedger('cn_frac', fracNote as never, WS, OWNER, undefined, context);
    const goods = captured[0].txs.find(t => t.metadata?.type === 'credit-return-auto');
    assert.ok(goods, 'the fractional-quantity return is not refused for rounding alone');
  });

  test('planInvoiceCogs keeps the original standard when reposting an existing sale', () => {
    // the item's standard changed to 600, but the sale line was already posted at 400: the repost
    // must keep 400, not reprice at 600
    const inv = invoice();
    const atOldStandard = planInvoiceCogs({
      invoiceId: 'inv_1', invoice: inv, date: '2026-11-01', uid: OWNER, workspaceId: WS, baseCurrency: 'USD',
      inventoryAccount: accounts()[5], cogsAccount: accounts()[5], items: returnItems(),
      postAtStandard: true, originalStandards: new Map([['l1', 400]]),
    });
    assert.equal(atOldStandard.entries[0].totalAmountCents, 4000, 'the repost keeps the 400 basis');
    assert.equal(atOldStandard.entries[0].metadata.standardCostCents, 400);
    // without the recorded original, the current standard is used (the item's 400 here)
    const atCurrent = planInvoiceCogs({
      invoiceId: 'inv_1', invoice: inv, date: '2026-11-01', uid: OWNER, workspaceId: WS, baseCurrency: 'USD',
      inventoryAccount: accounts()[5], cogsAccount: accounts()[5], items: returnItems(),
      postAtStandard: true,
    });
    assert.equal(atCurrent.entries[0].metadata.standardCostCents, 400, 'the sale records the standard it posted at');
  });
});
