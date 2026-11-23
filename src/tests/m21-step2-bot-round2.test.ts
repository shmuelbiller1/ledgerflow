/**
 * M-21 step 2, bot round 2: two review findings on the standard-cost postings.
 *
 * 1. A bill that combines an item receipt with an ordinary (non-landed-cost) split assigned to
 *    Inventory must keep the ordinary split when the receipt is replaced by its standard value —
 *    dropping it left the entry unbalanced (Inventory 80 + variance 20 vs A/P −150 for a 100-cent
 *    receipt at an 80-cent standard plus a 50-cent ordinary Inventory split). Landed-cost-only
 *    lines, whose cost flows into the receipt and the variance, are still dropped.
 *
 * 2. A customer return of stock that was sold at a standard the item no longer has must be refused
 *    before it changes stock: returning the units at the old sale cost while the resale relieves at
 *    the new standard leaves Inventory out of step (sell 10 @ 400, change the standard to 600, take
 *    all 10 back → Inventory debited 4,000, resale credits 6,000). A return of stock sold at the
 *    average, or at a standard that has not changed, still posts.
 */
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { planInvoiceCogs } from '../services/invoiceCogs';
import { postBillLedger } from '../services/ledgerPost/billPosting';
import { postCreditNoteLedger } from '../services/ledgerPost/creditPosting';
import { returnableLines } from '../lib/salesReturns';
import { INVOICE_COGS_TYPE } from '../services/invoiceCogs';
import type { LedgerPostContext } from '../services/ledgerPost/postingCore';
import type { ChartAccount, CreditNote, InventoryItem, Invoice, Transaction, Workspace } from '../types';
import { owner } from './helpers/commandTestUtils';

const WS = 'ws-m21-r2';
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

const items = (): InventoryItem[] => ([
  { id: 'chair', uid: OWNER, workspaceId: WS, name: 'Chair', sku: 'CH-1', quantityAtHand: 0, unitCostCents: 0, unitPriceCents: 30000, reorderPoint: 0, standardCostCents: 4000, createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'table', uid: OWNER, workspaceId: WS, name: 'Table', sku: 'TB-1', quantityAtHand: 0, unitCostCents: 0, unitPriceCents: 30000, reorderPoint: 0, createdAt: '2026-01-01T00:00:00.000Z' },
]);

/** the bill tests' item: a 1-unit receipt whose standard (80) is below its actual cost (100) */
const billItems = (): InventoryItem[] => ([
  { id: 'chair', uid: OWNER, workspaceId: WS, name: 'Chair', sku: 'CH-1', quantityAtHand: 0, unitCostCents: 0, unitPriceCents: 30000, reorderPoint: 0, standardCostCents: 80, createdAt: '2026-01-01T00:00:00.000Z' },
]);

/** the return tests' item: sold at a 400 standard, the sale cost the returns are checked against */
const returnItems = (): InventoryItem[] => ([
  { id: 'chair', uid: OWNER, workspaceId: WS, name: 'Chair', sku: 'CH-1', quantityAtHand: 0, unitCostCents: 0, unitPriceCents: 30000, reorderPoint: 0, standardCostCents: 400, createdAt: '2026-01-01T00:00:00.000Z' },
]);

const contextFor = (standardCosting?: { enabled: boolean; varianceAccountId: string }, captured: LedgerPostContext['capture'] = [], stock = items()): LedgerPostContext => ({
  accounts: accounts(),
  transactions: [] as Transaction[],
  workspaces: [{ id: WS, uid: OWNER, name: 'Standard Co', currency: 'USD', ...(standardCosting ? { standardCosting } : {}) } as Workspace],
  inventory: stock,
  capture: captured,
});

describe('M-21 step 2 bot round 2: Inventory splits that are not stock receipts', () => {
  test('an ordinary Inventory split beside a receipt is kept, and the entry balances', async () => {
    // 100-cent item receipt (chair standard 80) + a separate 50-cent ordinary Inventory split
    const splits = [
      { amountCents: 100, accountId: 'acc_inv', description: 'Chair', itemId: 'chair', quantity: 1 },
      { amountCents: 50, accountId: 'acc_inv', description: 'Assembly labour', itemId: undefined, quantity: undefined },
    ];
    const captured: LedgerPostContext['capture'] = [];
    await postBillLedger('bill_r2_1', {
      id: 'bill_r2_1', workspaceId: WS, uid: OWNER, number: 'B-R2', vendorId: 'v1', vendorName: 'Supplier',
      date: '2026-11-10', dueDate: '2026-12-10', status: 'pending' as const, currency: 'USD',
      amountCents: 150, splits,
    } as never, WS, OWNER, undefined, contextFor({ enabled: true, varianceAccountId: 'acc_ppv' }, captured, billItems()));
    const [entry] = captured[0].txs;
    const inv = entry.lines.filter(l => l.accountId === 'acc_inv');
    const ppv = entry.lines.filter(l => l.accountId === 'acc_ppv');
    const ap = entry.lines.filter(l => l.accountId === 'acc_ap');
    // the receipt posts its standard; the ordinary split keeps its 50
    assert.equal(inv.reduce((s, l) => s + l.amountCents, 0), 130, '80 standard + 50 ordinary');
    assert.equal(ppv.length, 1);
    assert.equal(ppv[0].amountCents, 20, 'variance is actual − standard of the receipt (100 − 80)');
    assert.equal(ap[0].amountCents, -150);
    assert.equal(entry.lines.reduce((s, l) => s + l.amountCents, 0), 0, 'the entry balances');
  });

  test('an ordinary Inventory split under its own label keeps its own line', async () => {
    // the receipt carries project A, the ordinary split project B: the ordinary line is not merged
    // into the receipt's label group and survives with its own amount and description
    const splits = [
      { amountCents: 100, accountId: 'acc_inv', description: 'Chair for project A', itemId: 'chair', quantity: 1, dimensions: { project: 'A' } },
      { amountCents: 50, accountId: 'acc_inv', description: 'Assembly labour', itemId: undefined, quantity: undefined, dimensions: { project: 'B' } },
    ];
    const captured: LedgerPostContext['capture'] = [];
    await postBillLedger('bill_r2_1b', {
      id: 'bill_r2_1b', workspaceId: WS, uid: OWNER, number: 'B-R2B', vendorId: 'v1', vendorName: 'Supplier',
      date: '2026-11-10', dueDate: '2026-12-10', status: 'pending' as const, currency: 'USD',
      amountCents: 150, splits,
    } as never, WS, OWNER, undefined, contextFor({ enabled: true, varianceAccountId: 'acc_ppv' }, captured, billItems()));
    const [entry] = captured[0].txs;
    const inv = entry.lines.filter(l => l.accountId === 'acc_inv');
    assert.equal(inv.length, 2, 'one Inventory line per label');
    const byProject = Object.fromEntries(inv.map(l => [String(l.dimensions?.project), l.amountCents]));
    assert.equal(byProject['A'], 80, 'the receipt posts its standard');
    assert.equal(byProject['B'], 50, 'the ordinary split keeps its own amount');
    assert.ok(inv.some(l => l.dimensions?.project === 'B'), 'the ordinary Inventory line is kept under its own label');
    const ppv = entry.lines.filter(l => l.accountId === 'acc_ppv');
    assert.equal(ppv[0].amountCents, 20);
    assert.equal(entry.lines.reduce((s, l) => s + l.amountCents, 0), 0, 'the entry balances');
  });

  test('a landed-cost-only Inventory line is still dropped (its cost is in the variance)', async () => {
    // the receipt (100, standard 80) plus a landed-cost line spread over the items (20): its Inventory
    // line is dropped and its cost rides in the receipt plan and the variance
    const splits = [
      { amountCents: 100, accountId: 'acc_inv', description: 'Chair', itemId: 'chair', quantity: 1 },
      { amountCents: 20, accountId: 'acc_inv', description: 'Freight', itemId: undefined, quantity: undefined, landedCost: true },
    ];
    const captured: LedgerPostContext['capture'] = [];
    await postBillLedger('bill_r2_2', {
      id: 'bill_r2_2', workspaceId: WS, uid: OWNER, number: 'B-R2L', vendorId: 'v1', vendorName: 'Supplier',
      date: '2026-11-10', dueDate: '2026-12-10', status: 'pending' as const, currency: 'USD',
      amountCents: 120, splits,
    } as never, WS, OWNER, undefined, contextFor({ enabled: true, varianceAccountId: 'acc_ppv' }, captured, billItems()));
    const [entry] = captured[0].txs;
    const inv = entry.lines.filter(l => l.accountId === 'acc_inv');
    const ppv = entry.lines.filter(l => l.accountId === 'acc_ppv');
    assert.equal(inv.reduce((s, l) => s + l.amountCents, 0), 80, 'only the receipt posts to Inventory, at standard');
    assert.equal(ppv[0].amountCents, 40, 'variance is the actual 120 − standard 80');
    assert.equal(entry.lines.reduce((s, l) => s + l.amountCents, 0), 0, 'the entry balances');
  });
});

describe('M-21 step 2 bot round 2: returns when the standard has changed', () => {
  const saleEntry = (unitCost: number, quantity: number, standard = true): Transaction => ({
    id: 'tx_sale', uid: OWNER, workspaceId: WS, date: '2026-11-01', status: 'completed' as const,
    description: 'Cost of goods sold: Chair', currency: 'USD', type: 'actual',
    totalAmountCents: unitCost * quantity,
    lines: [],
    metadata: {
      type: INVOICE_COGS_TYPE, invoiceId: 'inv_1', cogsForLineId: 'l1', inventoryItemId: 'chair',
      quantity, standard,
    },
  } as Transaction);

  const invoice = (): Invoice => ({
    id: 'inv_1', number: 'INV-1', workspaceId: WS, uid: OWNER, status: 'approved' as const, currency: 'USD',
    date: '2026-11-01', dueDate: '2026-12-01', amountCents: 90000, customerId: 'c1',
    items: [{ id: 'l1', itemId: 'chair', description: 'Chair', quantity: 10, rateCents: 9000, amountCents: 90000, accountId: '', unitCostCents: 4000 }],
  } as Invoice);

  test('returnableLines carries the sale standard flag', () => {
    const atStandard = returnableLines(invoice(), [saleEntry(400, 10, true)]);
    assert.equal(atStandard.length, 1);
    assert.equal(atStandard[0].unitCostCents, 400);
    assert.equal(atStandard[0].saleStandard, true);
    const atAverage = returnableLines(invoice(), [saleEntry(500, 10, false)]);
    assert.equal(atAverage[0].saleStandard, undefined);
  });

  test('a return of stock sold at a standard the item no longer has is refused', async () => {
    // sold 10 @ 400 (standard), standard changed to 600, all 10 come back
    const captured: LedgerPostContext['capture'] = [];
    const changed = returnItems().map(i => (i.id === 'chair' ? { ...i, standardCostCents: 600 } : i));
    const creditNote = {
      id: 'cn_1', workspaceId: WS, uid: OWNER, number: 'CN-1', invoiceId: 'inv_1', customerId: 'c1',
      date: '2026-11-20', status: 'open' as const, currency: 'USD', amountCents: 90000,
      returnedGoods: [{ invoiceLineId: 'l1', itemId: 'chair', quantity: 10 }],
    } as Partial<CreditNote>;
    const context: LedgerPostContext = {
      ...contextFor({ enabled: true, varianceAccountId: 'acc_ppv' }, captured, changed ?? returnItems()),
      transactions: [saleEntry(400, 10, true)],
      invoices: [invoice()],
    };
    await assert.rejects(
      postCreditNoteLedger('cn_1', creditNote as never, WS, OWNER, undefined, context),
      (err: Error) => {
        assert.match(err.message, /standard cost of Chair changed since it was sold/);
        return true;
      }
    );
    assert.equal(captured.length, 0, 'nothing is posted');
  });

  test('a return of stock sold at a standard that has not changed still posts', async () => {
    const captured: LedgerPostContext['capture'] = [];
    const creditNote = {
      id: 'cn_2', workspaceId: WS, uid: OWNER, number: 'CN-2', invoiceId: 'inv_1', customerId: 'c1',
      date: '2026-11-20', status: 'open' as const, currency: 'USD', amountCents: 90000,
      returnedGoods: [{ invoiceLineId: 'l1', itemId: 'chair', quantity: 10 }],
    } as Partial<CreditNote>;
    const context: LedgerPostContext = {
      ...contextFor({ enabled: true, varianceAccountId: 'acc_ppv' }, captured, returnItems()),
      transactions: [saleEntry(400, 10, true)],
      invoices: [invoice()],
    };
    await postCreditNoteLedger('cn_2', creditNote as never, WS, OWNER, undefined, context);
    const goods = captured[0].txs.find(t => t.metadata?.type === 'credit-return-auto');
    assert.ok(goods, 'the returned-goods entry is posted');
    assert.equal(goods!.totalAmountCents, 4000, 'Inventory comes back at the sale standard');
    assert.equal(goods!.lines.reduce((s, l) => s + l.amountCents, 0), 0, 'the entry balances');
  });

  test('a return of stock sold at the moving average is not refused', async () => {
    const captured: LedgerPostContext['capture'] = [];
    const creditNote = {
      id: 'cn_3', workspaceId: WS, uid: OWNER, number: 'CN-3', invoiceId: 'inv_1', customerId: 'c1',
      date: '2026-11-20', status: 'open' as const, currency: 'USD', amountCents: 90000,
      returnedGoods: [{ invoiceLineId: 'l1', itemId: 'chair', quantity: 10 }],
    } as Partial<CreditNote>;
    const context: LedgerPostContext = {
      ...contextFor({ enabled: true, varianceAccountId: 'acc_ppv' }, captured, returnItems()),
      transactions: [saleEntry(500, 10, false)],
      invoices: [invoice()],
    };
    await postCreditNoteLedger('cn_3', creditNote as never, WS, OWNER, undefined, context);
    const goods = captured[0].txs.find(t => t.metadata?.type === 'credit-return-auto');
    assert.ok(goods, 'the returned-goods entry is posted');
    assert.equal(goods!.totalAmountCents, 5000, 'Inventory comes back at the moving average');
  });

  test('the invoice-cogs plan still relieves a standard sale at the item standard', () => {
    const plan = planInvoiceCogs({
      invoiceId: 'inv_1', invoice: invoice(), date: '2026-11-01', uid: OWNER, workspaceId: WS, baseCurrency: 'USD',
      inventoryAccount: accounts()[6], cogsAccount: accounts()[6], items: items(), postAtStandard: true,
    });
    assert.equal(plan.entries[0].totalAmountCents, 40000, '10 × the 4,000 standard');
    assert.equal(plan.entries[0].metadata.standard, true);
  });
});
