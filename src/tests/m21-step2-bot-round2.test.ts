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
import type { LedgerPostContext } from '../services/ledgerPost/postingCore';
import type { InventoryItem, Transaction } from '../types';
import { m21BotFixtures } from './helpers/m21BotFixtures';

const fx = m21BotFixtures('ws-m21-r2');
const { WS, OWNER, accounts, billItems, returnItems, contextFor, entryTotal } = fx;

/** post a bill with the given splits under standard-cost posting and return the captured entry */
const postBill = async (splits: Array<Record<string, unknown>>, id: string, number: string, captured: NonNullable<LedgerPostContext['capture']>, stock = billItems()) => {
  await postBillLedger(id, {
    id, workspaceId: WS, uid: OWNER, number, vendorId: 'v1', vendorName: 'Supplier',
    date: '2026-11-10', dueDate: '2026-12-10', status: 'pending' as const, currency: 'USD',
    amountCents: splits.reduce((s, x) => s + Number(x.amountCents), 0), splits,
  } as never, WS, OWNER, undefined, contextFor({ enabled: true, varianceAccountId: 'acc_ppv' }, captured, stock));
  return captured[0].txs[0];
};

describe('M-21 step 2 bot round 2: Inventory splits that are not stock receipts', () => {
  test('an ordinary Inventory split beside a receipt is kept, and the entry balances', async () => {
    // 100-cent item receipt (standard 80) + a separate 50-cent ordinary Inventory split
    const splits = [
      { amountCents: 100, accountId: 'acc_inv', description: 'Chair', itemId: 'chair', quantity: 1 },
      { amountCents: 50, accountId: 'acc_inv', description: 'Assembly labour' },
    ];
    const captured: LedgerPostContext['capture'] = [];
    const entry = await postBill(splits, 'bill_r2_1', 'B-R2', captured);
    const inv = entry.lines.filter(l => l.accountId === 'acc_inv');
    const ppv = entry.lines.filter(l => l.accountId === 'acc_ppv');
    const ap = entry.lines.filter(l => l.accountId === 'acc_ap');
    // the receipt posts its standard; the ordinary split keeps its 50
    assert.equal(inv.reduce((s, l) => s + l.amountCents, 0), 130, '80 standard + 50 ordinary');
    assert.equal(ppv.length, 1);
    assert.equal(ppv[0].amountCents, 20, 'variance is actual − standard of the receipt (100 − 80)');
    assert.equal(ap[0].amountCents, -150);
    assert.equal(entryTotal(entry), 0, 'the entry balances');
  });

  test('an ordinary Inventory split under its own label keeps its own line', async () => {
    // the receipt carries project A, the ordinary split project B: the ordinary line is not merged
    // into the receipt's label group and survives with its own amount and label
    const splits = [
      { amountCents: 100, accountId: 'acc_inv', description: 'Chair for project A', itemId: 'chair', quantity: 1, dimensions: { project: 'A' } },
      { amountCents: 50, accountId: 'acc_inv', description: 'Assembly labour', dimensions: { project: 'B' } },
    ];
    const captured: LedgerPostContext['capture'] = [];
    const entry = await postBill(splits, 'bill_r2_1b', 'B-R2B', captured);
    const inv = entry.lines.filter(l => l.accountId === 'acc_inv');
    assert.equal(inv.length, 2, 'one Inventory line per label');
    const byProject = Object.fromEntries(inv.map(l => [String(l.dimensions?.project), l.amountCents]));
    assert.equal(byProject['A'], 80, 'the receipt posts its standard');
    assert.equal(byProject['B'], 50, 'the ordinary split keeps its own amount');
    assert.ok(inv.some(l => l.dimensions?.project === 'B'), 'the ordinary Inventory line is kept under its own label');
    const ppv = entry.lines.filter(l => l.accountId === 'acc_ppv');
    assert.equal(ppv[0].amountCents, 20);
    assert.equal(entryTotal(entry), 0, 'the entry balances');
  });

  test('a landed-cost-only Inventory line is still dropped (its cost is in the variance)', async () => {
    // the receipt (100, standard 80) plus a landed-cost line spread over the items (20): its Inventory
    // line is dropped and its cost rides in the receipt plan and the variance
    const splits = [
      { amountCents: 100, accountId: 'acc_inv', description: 'Chair', itemId: 'chair', quantity: 1 },
      { amountCents: 20, accountId: 'acc_inv', description: 'Freight', landedCost: true },
    ];
    const captured: LedgerPostContext['capture'] = [];
    const entry = await postBill(splits, 'bill_r2_2', 'B-R2L', captured);
    const inv = entry.lines.filter(l => l.accountId === 'acc_inv');
    const ppv = entry.lines.filter(l => l.accountId === 'acc_ppv');
    assert.equal(inv.reduce((s, l) => s + l.amountCents, 0), 80, 'only the receipt posts to Inventory, at standard');
    assert.equal(ppv[0].amountCents, 40, 'variance is the actual 120 − standard 80');
    assert.equal(entryTotal(entry), 0, 'the entry balances');
  });
});

describe('M-21 step 2 bot round 2: returns when the standard has changed', () => {
  const { saleEntry, invoice, creditNote } = fx;

  /** the posting context for a return: the sale in the ledger, the credited invoice, standard on */
  const returnContext = (txs: Transaction[], captured: NonNullable<LedgerPostContext['capture']>, stock: InventoryItem[] = returnItems()): LedgerPostContext => ({
    ...contextFor({ enabled: true, varianceAccountId: 'acc_ppv' }, captured, stock),
    transactions: txs,
    invoices: [invoice()],
  });

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
    await assert.rejects(
      postCreditNoteLedger('cn_1', creditNote('cn_1', 'CN-1') as never, WS, OWNER, undefined, returnContext([saleEntry(400, 10, true)], captured, changed)),
      (err: Error) => {
        assert.match(err.message, /standard cost of Chair changed since it was sold/);
        return true;
      }
    );
    assert.equal(captured.length, 0, 'nothing is posted');
  });

  test('a return of stock sold at a standard that has not changed still posts', async () => {
    const captured: LedgerPostContext['capture'] = [];
    await postCreditNoteLedger('cn_2', creditNote('cn_2', 'CN-2') as never, WS, OWNER, undefined, returnContext([saleEntry(400, 10, true)], captured));
    const goods = captured[0].txs.find(t => t.metadata?.type === 'credit-return-auto');
    assert.ok(goods, 'the returned-goods entry is posted');
    assert.equal(goods!.totalAmountCents, 4000, 'Inventory comes back at the sale standard');
    assert.equal(entryTotal(goods!), 0, 'the entry balances');
  });

  test('a return of stock sold at the moving average is not refused', async () => {
    const captured: LedgerPostContext['capture'] = [];
    await postCreditNoteLedger('cn_3', creditNote('cn_3', 'CN-3') as never, WS, OWNER, undefined, returnContext([saleEntry(500, 10, false)], captured));
    const goods = captured[0].txs.find(t => t.metadata?.type === 'credit-return-auto');
    assert.ok(goods, 'the returned-goods entry is posted');
    assert.equal(goods!.totalAmountCents, 5000, 'Inventory comes back at the moving average');
  });

  test('the invoice-cogs plan still relieves a standard sale at the item standard', () => {
    const plan = planInvoiceCogs({
      invoiceId: 'inv_1', invoice: invoice(), date: '2026-11-01', uid: OWNER, workspaceId: WS, baseCurrency: 'USD',
      inventoryAccount: accounts()[6], cogsAccount: accounts()[6], items: returnItems(), postAtStandard: true,
    });
    assert.equal(plan.entries[0].totalAmountCents, 4000, '10 × the 400 standard');
    assert.equal(plan.entries[0].metadata.standard, true);
  });
});
