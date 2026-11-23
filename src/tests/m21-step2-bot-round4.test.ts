/**
 * M-21 step 2, bot round 4: four more review findings on the standard-cost carrying basis, found after
 * the round-3 fixes.
 *
 * 1. Reposting an unchanged bill must keep the carrying basis its original receipt posted at: an item's
 *    standard can legally change once its stock sold down to zero, and repricing the replacement receipt
 *    at the new standard leaves Inventory out of step with no stock movement.
 * 2. A delivery return must be checked against the item's current standard, the same way credit-note
 *    returns are: restoring the units at the delivery's booked cost while a resale relieves them at the
 *    new standard leaves Inventory out of step.
 * 3. planInvoiceCogs must preserve the historical standard only for the units the sale was originally
 *    posted for: units a later edit added are valued at the item's current standard.
 * 4. The credit-note return guard must compare the sale's carrying value against the current standard even
 *    when the sale predates standard costing (its regression tests live in the round-2 suite).
 */
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { planInvoiceCogs } from '../services/invoiceCogs';
import { postBillLedger } from '../services/ledgerPost/billPosting';
import { BILL_ACCRUAL_TYPE, planStandardReceipt } from '../lib/billStock';
import { deliveryReturnStandardProblem } from '../server/services/deliveryService';
import type { LedgerPostContext } from '../services/ledgerPost/postingCore';
import type { InventoryItem, Transaction } from '../types';
import { m21BotFixtures } from './helpers/m21BotFixtures';

const fx = m21BotFixtures('ws-m21-r4');
const { WS, OWNER, accounts, billItems, contextFor, entryTotal } = fx;

describe('M-21 step 2 bot round 4: a reposted bill keeps its original receipt basis', () => {
  test('the replacement receipt posts at the basis the original receipt used, not the new standard', async () => {
    // the bill was received at a 400 standard (10 units, 5,000 actual); the stock sold down to zero and
    // the standard changed to 600. Reposting the unchanged bill must not reprice the receipt to 6,000.
    const priorAccrual = {
      id: 'tx_prior_accrual', uid: OWNER, workspaceId: WS, date: '2026-11-01', status: 'completed' as const,
      description: 'Bill B-R4 - Supplier', currency: 'USD', type: 'actual', totalAmountCents: 5000,
      lines: [],
      metadata: {
        billId: 'bill_r4_1', type: BILL_ACCRUAL_TYPE,
        stockIn: [{ itemId: 'chair', quantity: 10, valueCents: 4000, actualValueCents: 5000, line: 0 }],
      },
    } as Transaction;
    const stock: InventoryItem[] = billItems().map(i => ({ ...i, standardCostCents: 600 }));
    const captured: LedgerPostContext['capture'] = [];
    const context: LedgerPostContext = {
      ...contextFor({ enabled: true, varianceAccountId: 'acc_ppv' }, captured, stock),
      transactions: [priorAccrual],
    };
    await postBillLedger('bill_r4_1', {
      id: 'bill_r4_1', workspaceId: WS, uid: OWNER, number: 'B-R4', vendorId: 'v1', vendorName: 'Supplier',
      date: '2026-11-10', dueDate: '2026-12-10', status: 'pending' as const, currency: 'USD',
      amountCents: 5000, splits: [{ amountCents: 5000, accountId: 'acc_inv', description: 'Chair', itemId: 'chair', quantity: 10 }],
    } as never, WS, OWNER, undefined, context);

    const accrual = captured[0].txs.find(t => t.metadata?.type === BILL_ACCRUAL_TYPE);
    assert.ok(accrual, 'the bill posted its accrual entry');
    const lineOf = (id: string) => (accrual!.lines || []).filter(l => l.accountId === id).reduce((s, l) => s + l.amountCents, 0);
    assert.equal(lineOf('acc_inv'), 4000, 'the receipt posts the original 400 carrying basis, not the new 600 standard');
    assert.equal(lineOf('acc_ppv'), 1000, 'the variance is the actual 5,000 − the original 4,000 basis');
    assert.equal(entryTotal(accrual!), 0, 'the entry balances');
  });

  test('units added by a later edit take the current standard, the original units keep the old basis', async () => {
    // the bill was received at a 400 standard (10 units); the standard changed to 600 and the line grew
    // to 11 units: the replacement posts the original 10 at 400 and the added unit at 600
    const priorAccrual = {
      id: 'tx_prior_accrual_grown', uid: OWNER, workspaceId: WS, date: '2026-11-01', status: 'completed' as const,
      description: 'Bill B-R4G - Supplier', currency: 'USD', type: 'actual', totalAmountCents: 5000,
      lines: [],
      metadata: {
        billId: 'bill_r4_grown', type: BILL_ACCRUAL_TYPE,
        stockIn: [{ itemId: 'chair', quantity: 10, valueCents: 4000, actualValueCents: 5000, line: 0 }],
      },
    } as Transaction;
    const stock: InventoryItem[] = billItems().map(i => ({ ...i, standardCostCents: 600 }));
    const captured: LedgerPostContext['capture'] = [];
    const context: LedgerPostContext = {
      ...contextFor({ enabled: true, varianceAccountId: 'acc_ppv' }, captured, stock),
      transactions: [priorAccrual],
    };
    await postBillLedger('bill_r4_grown', {
      id: 'bill_r4_grown', workspaceId: WS, uid: OWNER, number: 'B-R4G', vendorId: 'v1', vendorName: 'Supplier',
      date: '2026-11-10', dueDate: '2026-12-10', status: 'pending' as const, currency: 'USD',
      amountCents: 5500, splits: [{ amountCents: 5500, accountId: 'acc_inv', description: 'Chair', itemId: 'chair', quantity: 11 }],
    } as never, WS, OWNER, undefined, context);

    const accrual = captured[0].txs.find(t => t.metadata?.type === BILL_ACCRUAL_TYPE);
    assert.ok(accrual, 'the bill posted its accrual entry');
    const lineOf = (id: string) => (accrual!.lines || []).filter(l => l.accountId === id).reduce((s, l) => s + l.amountCents, 0);
    assert.equal(lineOf('acc_inv'), 4600, 'the original 10 keep 400, the added unit takes the 600 standard');
    assert.equal(lineOf('acc_ppv'), 900, 'variance is the actual 5,500 − the 4,600 carrying value');
    assert.equal(entryTotal(accrual!), 0, 'the entry balances');
  });

  test('a line re-pointed at a different item does not reuse the previous item basis', async () => {
    // the bill line's index matches an original receipt row, but the item changed: the old basis must
    // not carry over — the replacement posts at the new item's standard
    const plan = planStandardReceipt(
      [{ itemId: 'table', quantity: 10, valueCents: 5000, line: 0 }],
      [{ id: 'table', standardCostCents: 600 }],
      true,
      new Map([[0, { itemId: 'chair', quantity: 10, valueCents: 4000 }]]),
    );
    assert.ok(plan);
    assert.equal(plan.entries[0].valueCents, 6000, "10 × the table's 600 standard, not the chair's 400");
  });

  test('repeated item lines keep their own receipt basis', async () => {
    // two lines of the same item, received at different actual values before the item had a standard:
    // each line's replacement must keep its own carrying value, not the last row's
    const priorAccrual = {
      id: 'tx_prior_accrual_two', uid: OWNER, workspaceId: WS, date: '2026-11-01', status: 'completed' as const,
      description: 'Bill B-R4T - Supplier', currency: 'USD', type: 'actual', totalAmountCents: 11000,
      lines: [],
      metadata: {
        billId: 'bill_r4_two', type: BILL_ACCRUAL_TYPE,
        stockIn: [
          { itemId: 'chair', quantity: 10, valueCents: 5000, actualValueCents: 5000, line: 0 },
          { itemId: 'chair', quantity: 10, valueCents: 6000, actualValueCents: 6000, line: 1 },
        ],
      },
    } as Transaction;
    const stock: InventoryItem[] = billItems().map(i => ({ ...i, standardCostCents: 400 }));
    const captured: LedgerPostContext['capture'] = [];
    const context: LedgerPostContext = {
      ...contextFor({ enabled: true, varianceAccountId: 'acc_ppv' }, captured, stock),
      transactions: [priorAccrual],
    };
    await postBillLedger('bill_r4_two', {
      id: 'bill_r4_two', workspaceId: WS, uid: OWNER, number: 'B-R4T', vendorId: 'v1', vendorName: 'Supplier',
      date: '2026-11-10', dueDate: '2026-12-10', status: 'pending' as const, currency: 'USD',
      amountCents: 11000,
      splits: [
        { amountCents: 5000, accountId: 'acc_inv', description: 'Chair (first lot)', itemId: 'chair', quantity: 10 },
        { amountCents: 6000, accountId: 'acc_inv', description: 'Chair (second lot)', itemId: 'chair', quantity: 10 },
      ],
    } as never, WS, OWNER, undefined, context);

    const accrual = captured[0].txs.find(t => t.metadata?.type === BILL_ACCRUAL_TYPE);
    assert.ok(accrual, 'the bill posted its accrual entry');
    const inv = (accrual!.lines || []).filter(l => l.accountId === 'acc_inv');
    // the two lines share a label, so they post as one Inventory line — but its value is the sum of the
    // two lines' own bases (5,000 + 6,000), not two repriced lots at the current 400 standard (8,000)
    assert.equal(inv.length, 1, 'the lines share a label group');
    assert.equal(inv.reduce((s, l) => s + l.amountCents, 0), 11000, 'each line keeps its own 5,000 / 6,000 basis');
  });
});

describe('M-21 step 2 bot round 4: delivery returns check the current standard', () => {
  test('a return whose restoring value differs from the current standard is refused', () => {
    const problem = deliveryReturnStandardProblem({ enabled: true }, 600, 10, 4000, 'Chair');
    assert.match(problem || '', /standard cost of Chair changed since it was delivered/);
  });

  test('a return whose restoring value matches the current standard is allowed', () => {
    assert.equal(deliveryReturnStandardProblem({ enabled: true }, 400, 10, 4000, 'Chair'), null);
  });

  test('the check does not fire without the setting, without a standard, or within rounding', () => {
    assert.equal(deliveryReturnStandardProblem(undefined, 600, 10, 4000, 'Chair'), null, 'standard costing off');
    assert.equal(deliveryReturnStandardProblem({ enabled: true }, null, 10, 4000, 'Chair'), null, 'no standard');
    assert.equal(deliveryReturnStandardProblem({ enabled: true }, 335, 0.3, 101, 'Chair'), null, 'fractional rounding');
  });
});

describe('M-21 step 2 bot round 4: historical standards cover only the original sale quantity', () => {
  test('units added after a standard change take the current standard', () => {
    // 10 units were sold at a 400 standard; the standard changed to 600 and the invoice's line grows to
    // 15 units: the original 10 keep 400, the 5 added units take 600
    const plan = planInvoiceCogs({
      invoiceId: 'inv_1', invoice: fx.invoice(), date: '2026-11-01', uid: OWNER, workspaceId: WS, baseCurrency: 'USD',
      inventoryAccount: accounts()[5], cogsAccount: accounts()[5],
      items: fx.returnItems().map(i => ({ ...i, standardCostCents: 600 })),
      postAtStandard: true,
      originalStandards: new Map([['l1', [{ standardCostCents: 400, quantity: 10 }]]]),
    });
    // fx.invoice() sells 10 units: grow the line to 15 for the added-units case
    const grown = planInvoiceCogs({
      invoiceId: 'inv_1',
      invoice: { ...fx.invoice(), items: [{ ...fx.invoice().items![0], quantity: 15, amountCents: 135000 }] },
      date: '2026-11-01', uid: OWNER, workspaceId: WS, baseCurrency: 'USD',
      inventoryAccount: accounts()[5], cogsAccount: accounts()[5],
      items: fx.returnItems().map(i => ({ ...i, standardCostCents: 600 })),
      postAtStandard: true,
      originalStandards: new Map([['l1', [{ standardCostCents: 400, quantity: 10 }]]]),
    });
    assert.equal(grown.entries[0].totalAmountCents, 7000, '10 × 400 + 5 × 600');
    assert.equal(grown.entries[0].metadata.standardCostCents, 400, 'the entry records the historical basis');
    assert.equal(grown.entries[0].metadata.standardQty, 10, 'and how many units it covers');
    // the unchanged line still posts entirely at the historical basis, with no split marker
    assert.equal(plan.entries[0].totalAmountCents, 4000, '10 × 400');
    assert.equal(plan.entries[0].metadata.standardQty, undefined);
  });

  test('a fresh sale records no standardQty, so a repost still uses the recorded standard', () => {
    // a sale posted with no prior cost-of-goods entry has no historical basis: the whole quantity is at
    // the current standard and the entry must not carry a zero standardQty (which would make a repost
    // reprice every unit at the item's then-current standard)
    const fresh = planInvoiceCogs({
      invoiceId: 'inv_fresh', invoice: fx.invoice(), date: '2026-11-01', uid: OWNER, workspaceId: WS, baseCurrency: 'USD',
      inventoryAccount: accounts()[5], cogsAccount: accounts()[5],
      items: fx.returnItems().map(i => ({ ...i, standardCostCents: 400 })),
      postAtStandard: true,
    });
    assert.equal(fresh.entries[0].totalAmountCents, 4000);
    assert.equal(fresh.entries[0].metadata.standardCostCents, 400);
    assert.equal(fresh.entries[0].metadata.standardQty, undefined, 'a fresh sale carries no historical split');
  });

  test('a sale amended twice keeps every cohort it was already posted at', () => {
    // 10 units sold at a 400 standard, the standard changed to 600 and 5 units were added, then the
    // standard changed to 800 and the sale is reposted: the original 10 stay at 400, the 5 added units
    // stay at 600 — only genuinely new units would take the 800 standard
    const plan = planInvoiceCogs({
      invoiceId: 'inv_amended', invoice: { ...fx.invoice(), items: [{ ...fx.invoice().items![0], quantity: 15 }] },
      date: '2026-11-01', uid: OWNER, workspaceId: WS, baseCurrency: 'USD',
      inventoryAccount: accounts()[5], cogsAccount: accounts()[5],
      items: fx.returnItems().map(i => ({ ...i, standardCostCents: 800 })),
      postAtStandard: true,
      originalStandards: new Map([['l1', [
        { standardCostCents: 400, quantity: 10 },
        { standardCostCents: 600, quantity: 5 },
      ]]]),
    });
    assert.equal(plan.entries[0].totalAmountCents, 7000, '10 × 400 + 5 × 600, nothing repriced at 800');
    assert.deepEqual(plan.entries[0].metadata.standards, [
      { standardCostCents: 400, quantity: 10 },
      { standardCostCents: 600, quantity: 5 },
    ], 'the entry records every cohort for the next repost');
  });

  test('a sale keeps its recorded standard basis after standard costing is disabled', () => {
    // the workspace turns standard costing off after the stock sold down; saving the unchanged sale
    // must not reprice it at the moving average — the recorded basis stays until the stock is revalued
    const plan = planInvoiceCogs({
      invoiceId: 'inv_disabled', invoice: fx.invoice(), date: '2026-11-01', uid: OWNER, workspaceId: WS,
      baseCurrency: 'USD',
      inventoryAccount: accounts()[5], cogsAccount: accounts()[5],
      items: fx.returnItems().map(i => ({ ...i, unitCostCents: 500 })),
      postAtStandard: false,
      originalStandards: new Map([['l1', [{ standardCostCents: 400, quantity: 10 }]]]),
    });
    assert.equal(plan.entries[0].totalAmountCents, 4000, 'the recorded 400 basis, not the 500 moving average');
    assert.equal(plan.entries[0].metadata.standardCostCents, 400);
  });
});
