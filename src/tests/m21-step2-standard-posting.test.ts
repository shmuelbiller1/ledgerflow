/**
 * M-21 standard costing, step 2: a workspace that turns standard-cost posting on receives stock at the
 * item's standard and relieves it at the standard, with the difference (actual − standard) to a purchase-price
 * variance account; the inventory report values the stock at the standard. Parity first: with the setting off,
 * every figure is exactly what the books did before step 2.
 *
 * Worked figures (cents):
 *   Bill B-1 buys 10 chairs @ 5,000 (50,000; chair standard 4,000) and 5 tables @ 15,000 (75,000; no standard)
 *   standard off: Inventory 125,000 (50,000 + 75,000), no variance line, stock-in values 50,000 / 75,000
 *   standard on:  chairs 10 × 4,000 = 40,000, tables keep their 75,000 → Inventory 115,000;
 *                variance 125,000 − 115,000 = 10,000 (unfavourable) debited to the variance account;
 *                the entry balances: Dr Inventory 115,000 + Dr PPV 10,000 = Cr A/P 125,000
 *                metadata.stockIn carries the standard values (40,000 / 75,000), so the stock comes in at them
 *   a standard above the actual (chair 6,000): Inventory 60,000, variance −10,000 credited to PPV
 *   the sale of 4 chairs relieves 4 × 4,000 = 16,000 at standard (20,000 at the moving average without it)
 *   the inventory report: 10 chairs at 4,000 + 5 tables at 15,000 = 115,000, which the Inventory account agrees with
 */
import assert from 'node:assert/strict';
import test, { after, before, describe } from 'node:test';
import { planStandardReceipt } from '../lib/billStock';
import { planInvoiceCogs } from '../services/invoiceCogs';
import { computeInventoryValuation } from '../server/reports/itemReports';
import { postBillLedger } from '../services/ledgerPost/billPosting';
import type { LedgerPostContext } from '../services/ledgerPost/postingCore';
import { workspaceStandardCostingCommand } from '../server/commands/workspaceSettings';
import type { ChartAccount, InventoryItem, Transaction, Workspace } from '../types';
import { commandHarness, owner, type CommandHarness } from './helpers/commandTestUtils';

const WS = 'ws-m21';
const OWNER = owner.uid;

const accounts = (): ChartAccount[] => ([
  { id: 'acc_inv', uid: OWNER, workspaceId: WS, name: 'Inventory', code: '1300', type: 'asset', category: 'Inventory', balanceCents: 0 },
  { id: 'acc_exp', uid: OWNER, workspaceId: WS, name: 'Operating Expense', code: '6000', type: 'expense', category: 'Expense', balanceCents: 0 },
  { id: 'acc_ap', uid: OWNER, workspaceId: WS, name: 'Accounts Payable', code: '2000', type: 'liability', category: 'Payables', balanceCents: 0 },
  { id: 'acc_cash', uid: OWNER, workspaceId: WS, name: 'Cash', code: '1000', type: 'asset', category: 'Cash', balanceCents: 0 },
  { id: 'acc_ppv', uid: OWNER, workspaceId: WS, name: 'Purchase Price Variance', code: '5200', type: 'expense', category: 'Expense', balanceCents: 0 },
]);

const items = (): InventoryItem[] => ([
  { id: 'chair', uid: OWNER, workspaceId: WS, name: 'Chair', sku: 'CH-1', quantityAtHand: 0, unitCostCents: 0, unitPriceCents: 30000, reorderPoint: 0, standardCostCents: 4000, createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'table', uid: OWNER, workspaceId: WS, name: 'Table', sku: 'TB-1', quantityAtHand: 0, unitCostCents: 0, unitPriceCents: 30000, reorderPoint: 0, createdAt: '2026-01-01T00:00:00.000Z' },
]);

/** the same items with the stock on hand (what the valuation report reads) */
const stockedItems = (): InventoryItem[] => items().map(i => ({ ...i, quantityAtHand: i.id === 'chair' ? 10 : 5, unitCostCents: i.id === 'chair' ? 5000 : 15000 }));

const billSplits = () => ([
  { amountCents: 50000, accountId: 'acc_inv', description: 'Chairs', itemId: 'chair', quantity: 10 },
  { amountCents: 75000, accountId: 'acc_inv', description: 'Tables', itemId: 'table', quantity: 5 },
]);

const billData = (splits = billSplits()) => ({
  id: 'bill_m21_1', workspaceId: WS, uid: OWNER, number: 'B-1', vendorId: 'v1', vendorName: 'Supplier',
  date: '2026-11-10', dueDate: '2026-12-10', status: 'pending' as const, currency: 'USD',
  amountCents: splits.reduce((s, x) => s + Number(x.amountCents), 0), splits,
});

const contextFor = (standardCosting?: { enabled: boolean; varianceAccountId: string }, captured: LedgerPostContext['capture'] = [], stock = items()): LedgerPostContext => ({
  accounts: accounts(),
  transactions: [] as Transaction[],
  workspaces: [{ id: WS, uid: OWNER, name: 'Standard Co', currency: 'USD', ...(standardCosting ? { standardCosting } : {}) } as Workspace],
  inventory: stock,
  capture: captured,
});

describe('M-21 step 2: receiving at standard', () => {
  test('the plan values each item at its standard and totals the variance', () => {
    const plan = planStandardReceipt([
      { itemId: 'chair', quantity: 10, valueCents: 50000, line: 0 },
      { itemId: 'table', quantity: 5, valueCents: 75000, line: 1 },
    ], items(), true);
    assert.deepEqual(plan!.entries.map(l => [l.itemId, l.valueCents]), [['chair', 40000], ['table', 75000]]);
    assert.equal(plan!.actualTotalCents, 125000);
    assert.equal(plan!.standardTotalCents, 115000);
    assert.equal(plan!.varianceCents, 10000);
    // off: the same lines, unchanged
    assert.equal(planStandardReceipt([{ itemId: 'chair', quantity: 10, valueCents: 50000, line: 0 }], items(), false), null);
  });

  test('a bill posts Inventory at the standard and the difference to the variance account', async () => {
    const captured: LedgerPostContext['capture'] = [];
    await postBillLedger('bill_m21_1', billData() as never, WS, OWNER, undefined, contextFor({ enabled: true, varianceAccountId: 'acc_ppv' }, captured));
    const [entry] = captured[0].txs;
    const lines = entry.lines;
    const inv = lines.filter(l => l.accountId === 'acc_inv');
    const ppv = lines.filter(l => l.accountId === 'acc_ppv');
    const ap = lines.filter(l => l.accountId === 'acc_ap');
    assert.equal(inv.reduce((s, l) => s + l.amountCents, 0), 115000);
    assert.equal(ppv.length, 1);
    assert.equal(ppv[0].amountCents, 10000, 'the stock cost more than planned: the variance is debited');
    assert.match(ppv[0].description || '', /Purchase price variance on Bill B-1/);
    assert.equal(ap[0].amountCents, -125000);
    assert.equal(lines.reduce((s, l) => s + l.amountCents, 0), 0, 'the entry balances');
    // the stock comes in at the standard values
    assert.deepEqual((entry.metadata?.stockIn as Array<{ itemId: string; quantity: number; valueCents: number }>)
      .map(l => [l.itemId, l.quantity, l.valueCents]), [['chair', 10, 40000], ['table', 5, 75000]]);
  });

  test('a standard above the actual credits the variance account', async () => {
    const captured: LedgerPostContext['capture'] = [];
    const splits = [{ amountCents: 50000, accountId: 'acc_inv', description: 'Chairs', itemId: 'chair', quantity: 10 }];
    const highStandard = items().map(i => (i.id === 'chair' ? { ...i, standardCostCents: 6000 } : i));
    await postBillLedger('bill_m21_2', { ...billData(splits), id: 'bill_m21_2', number: 'B-2' } as never, WS, OWNER, undefined, contextFor({ enabled: true, varianceAccountId: 'acc_ppv' }, captured, highStandard));
    const [entry] = captured[0].txs;
    const ppv = entry.lines.filter(l => l.accountId === 'acc_ppv');
    const inv = entry.lines.filter(l => l.accountId === 'acc_inv');
    assert.equal(ppv[0].amountCents, -10000, 'the stock cost less than planned: the variance is credited');
    assert.equal(inv[0].amountCents, 60000);
    assert.equal(entry.lines.reduce((s, l) => s + l.amountCents, 0), 0);
  });

  test('parity: with the setting off the bill posts exactly as before', async () => {
    const captured: LedgerPostContext['capture'] = [];
    await postBillLedger('bill_m21_3', billData() as never, WS, OWNER, undefined, contextFor(undefined, captured));
    const [entry] = captured[0].txs;
    const inv = entry.lines.filter(l => l.accountId === 'acc_inv');
    assert.equal(inv.reduce((s, l) => s + l.amountCents, 0), 125000);
    assert.equal(entry.lines.filter(l => l.accountId === 'acc_ppv').length, 0, 'no variance line');
    assert.deepEqual((entry.metadata?.stockIn as Array<{ itemId: string; valueCents: number }>)
      .map(l => [l.itemId, l.valueCents]), [['chair', 50000], ['table', 75000]]);
  });

  test('the sale relieves the stock at the standard when the workspace posts at standard', () => {
    const invoice = { id: 'inv_1', number: 'INV-1', items: [{ id: 'l1', itemId: 'chair', description: 'Chair', quantity: 4, rateCents: 9000, amountCents: 36000, accountId: '', unitCostCents: 5000 }] };
    const atStandard = planInvoiceCogs({
      invoiceId: 'inv_1', invoice, date: '2026-11-11', uid: OWNER, workspaceId: WS, baseCurrency: 'USD',
      inventoryAccount: accounts()[0], cogsAccount: accounts()[1], items: items(), postAtStandard: true,
    });
    assert.equal(atStandard.entries[0].totalAmountCents, 16000, '4 × 4,000, not 4 × 5,000');
    assert.equal(atStandard.entries[0].metadata.standard, true);
    const atAverage = planInvoiceCogs({
      invoiceId: 'inv_1', invoice, date: '2026-11-11', uid: OWNER, workspaceId: WS, baseCurrency: 'USD',
      inventoryAccount: accounts()[0], cogsAccount: accounts()[1], items: items(),
    });
    assert.equal(atAverage.entries[0].totalAmountCents, 20000, 'the moving average, as before');
  });

  test('the inventory report values the stock at the standard and agrees with the books', () => {
    const asPosted = [{ id: 'tx_1', workspaceId: WS, date: '2026-11-10', status: 'completed' as const, totalAmountCents: 125000, lines: [
      { accountId: 'acc_inv', amountCents: 115000 },
      { accountId: 'acc_ppv', amountCents: 10000 },
      { accountId: 'acc_ap', amountCents: -125000 },
    ] } as Transaction];
    const atStandard = computeInventoryValuation(stockedItems(), accounts(), asPosted, undefined, true);
    assert.equal(atStandard.totalValueCents, 115000);
    assert.equal(atStandard.ledgerValueCents, 115000);
    assert.equal(atStandard.differenceCents, 0);
    const atAverage = computeInventoryValuation(stockedItems(), accounts(), asPosted, undefined, false);
    assert.equal(atAverage.totalValueCents, 125000);
    assert.equal(atAverage.differenceCents, 10000, 'the stock list and the books disagree by the variance');
  });
});

describe('M-21 step 2: the workspace setting', () => {
  let harness: CommandHarness;

  before(async () => {
    harness = await commandHarness({
      commands: [workspaceStandardCostingCommand],
      workspaceId: WS,
      seed(db) {
        db.seed(`workspaces/${WS}`, { uid: OWNER, members: [OWNER, 'viewer-1'], currency: 'USD', roles: { 'viewer-1': 'viewer' } });
        for (const a of accounts()) db.seed(`chartAccounts/${a.id}`, a as unknown as Record<string, unknown>);
      },
    });
  });

  after(async () => { await harness.close(); });

  test('turning it on stores the setting, and needs the variance account in the chart', async () => {
    const ok = await harness.run(OWNER, 'workspace.standardcosting', { enabled: true, varianceAccountId: 'acc_ppv' });
    assert.equal(ok.status, 200);
    const ws = harness.db.read(`workspaces/${WS}`) as Record<string, unknown>;
    assert.deepEqual(ws.standardCosting, { enabled: true, varianceAccountId: 'acc_ppv' });

    const missing = await harness.run(OWNER, 'workspace.standardcosting', { enabled: true });
    assert.equal(missing.status, 400);
    const notInChart = await harness.run(OWNER, 'workspace.standardcosting', { enabled: true, varianceAccountId: 'acc_nope' });
    assert.equal(notInChart.status, 400);
  });

  test('a viewer cannot change it', async () => {
    const denied = await harness.run('viewer-1', 'workspace.standardcosting', { enabled: false });
    assert.equal(denied.status, 403);
  });
});
