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
import { BILL_ACCRUAL_TYPE } from '../lib/billStock';
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
        stockIn: [{ itemId: 'chair', quantity: 10, valueCents: 4000, actualValueCents: 5000 }],
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
      originalStandards: new Map([['l1', { standardCostCents: 400, quantity: 10 }]]),
    });
    // fx.invoice() sells 10 units: grow the line to 15 for the added-units case
    const grown = planInvoiceCogs({
      invoiceId: 'inv_1',
      invoice: { ...fx.invoice(), items: [{ ...fx.invoice().items![0], quantity: 15, amountCents: 135000 }] },
      date: '2026-11-01', uid: OWNER, workspaceId: WS, baseCurrency: 'USD',
      inventoryAccount: accounts()[5], cogsAccount: accounts()[5],
      items: fx.returnItems().map(i => ({ ...i, standardCostCents: 600 })),
      postAtStandard: true,
      originalStandards: new Map([['l1', { standardCostCents: 400, quantity: 10 }]]),
    });
    assert.equal(grown.entries[0].totalAmountCents, 7000, '10 × 400 + 5 × 600');
    assert.equal(grown.entries[0].metadata.standardCostCents, 400, 'the entry records the historical basis');
    assert.equal(grown.entries[0].metadata.standardQty, 10, 'and how many units it covers');
    // the unchanged line still posts entirely at the historical basis, with no split marker
    assert.equal(plan.entries[0].totalAmountCents, 4000, '10 × 400');
    assert.equal(plan.entries[0].metadata.standardQty, undefined);
  });
});
