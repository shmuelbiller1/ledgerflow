/**
 * Codex on PR #1013:
 *  - aging from dated settlement events must not report documents settled before the payment ledger
 *    existed as owed again (no `paymentAllocations` rows, but paid counters and payment records);
 *  - a return restores exactly the cost its sale took (fractional micro-cent lots), and a zero-cost
 *    return still brings its units back to stock.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { outstandingAsOfCents } from '../lib/aging';
import { agingSettlementEvents } from '../server/reports/agingSettlements';
import { planReturnEntries, type ReturnableLine } from '../lib/salesReturns';
import type { Invoice } from '../types';

const invoice = (extra: Partial<Invoice> = {}): Invoice => ({
  id: 'inv1', customerId: 'c1', customerName: 'C', number: 'I-1', date: '2026-01-05', dueDate: '2026-02-05',
  status: 'paid', currency: 'USD', amountCents: 10000, amountPaidCents: 10000, settledByRecordsCents: 10000, items: [],
  ...extra,
} as unknown as Invoice);

describe('aging with history from before the payment ledger', () => {
  test('a paid invoice with no ledger rows and no payment record is not owed again', () => {
    assert.equal(outstandingAsOfCents(invoice({ updatedAt: '2026-01-20T10:00:00Z' } as Partial<Invoice>), [], '2026-11-22', 'USD'), 0);
  });

  test('a payment recorded before the ledger settles from its own date, and a later void unwinds it', () => {
    const payment = { id: 'pay1', paymentDate: '2026-02-10', currency: 'USD', exchangeRate: 1, allocations: [{ documentId: 'inv1', documentType: 'invoice', amountCents: 10000 }] };
    const events = agingSettlementEvents([], [payment], 'invoice', 'USD');
    assert.equal(outstandingAsOfCents(invoice(), events, '2026-01-31', 'USD'), 10000, 'owed before the payment');
    assert.equal(outstandingAsOfCents(invoice(), events, '2026-02-10', 'USD'), 0, 'settled from the payment date');
    const voided = agingSettlementEvents([], [{ ...payment, status: 'void', voidDate: '2026-03-10' }], 'invoice', 'USD');
    const reopened = invoice({ status: 'sent', amountPaidCents: 0, settledByRecordsCents: 0 });
    assert.equal(outstandingAsOfCents(reopened, voided, '2026-02-28', 'USD'), 0, 'February still shows it settled');
    assert.equal(outstandingAsOfCents(reopened, voided, '2026-03-10', 'USD'), 10000, 'owed again from the void');
  });

  test('a payment that has ledger rows is not counted twice', () => {
    const rows = [{ documentId: 'inv1', documentType: 'invoice', date: '2026-02-10', amountCents: 10000, baseClearedCents: 10000, kind: 'payment', sourceType: 'payment', sourceId: 'pay1' }];
    const payment = { id: 'pay1', paymentDate: '2026-02-10', allocations: [{ documentId: 'inv1', documentType: 'invoice', amountCents: 10000 }] };
    const events = agingSettlementEvents(rows, [payment], 'invoice', 'USD');
    assert.equal(events.length, 1);
    const partly = invoice({ status: 'partially_paid', amountCents: 20000, amountPaidCents: 10000, settledByRecordsCents: 10000 });
    assert.equal(outstandingAsOfCents(partly, events, '2026-03-01', 'USD'), 10000);
  });

  test('a ledger row for one allocation does not suppress other legacy allocations', () => {
    const rows = [{ documentId: 'inv1', documentType: 'invoice', date: '2026-02-10', amountCents: 10000, baseClearedCents: 10000, kind: 'payment', sourceType: 'payment', sourceId: 'pay1' }];
    const payment = {
      id: 'pay1', paymentDate: '2026-02-10', allocations: [
        { documentId: 'inv1', documentType: 'invoice', amountCents: 10000 },
        { documentId: 'inv2', documentType: 'invoice', amountCents: 5000 },
      ],
    };
    const events = agingSettlementEvents(rows, [payment], 'invoice', 'USD');
    assert.deepEqual(events.map(({ documentId, amountCents }) => ({ documentId, amountCents })), [
      { documentId: 'inv1', amountCents: 10000 },
      { documentId: 'inv2', amountCents: 5000 },
    ]);
  });
});

describe('a pre-ledger payment later applied through the ledger (Gitar on #1013)', () => {
  // paid invoice A ($100) before the ledger existed; its $50 leftover was later applied to invoice B
  // through the ledger, which wrote one row with this payment as its source
  const payment = {
    id: 'pay1', paymentDate: '2026-02-10', currency: 'USD', exchangeRate: 1,
    allocations: [{ documentId: 'invA', documentType: 'invoice', amountCents: 10000 }, { documentId: 'invB', documentType: 'invoice', amountCents: 5000 }],
  };
  const rows = [{ documentId: 'invB', documentType: 'invoice', date: '2026-04-01', amountCents: 5000, baseClearedCents: 5000, kind: 'application', sourceType: 'payment', sourceId: 'pay1' }];
  const invA = invoice({ id: 'invA', updatedAt: '2026-06-30T00:00:00Z' } as Partial<Invoice>);

  test('the pre-ledger allocation keeps its payment date', () => {
    const events = agingSettlementEvents(rows, [payment], 'invoice', 'USD');
    assert.deepEqual(events.filter(e => e.documentId === 'invA').map(e => [e.date, e.amountCents]), [['2026-02-10', 10000]]);
    assert.deepEqual(events.filter(e => e.documentId === 'invB').map(e => [e.date, e.amountCents]), [['2026-04-01', 5000]], 'invoice B only from its ledger row');
    assert.equal(outstandingAsOfCents(invA, events, '2026-03-31', 'USD'), 0, 'A was paid in February, not when it was last edited');
  });

  test('a void reverses the pre-ledger part on the void date', () => {
    const events = agingSettlementEvents(rows, [{ ...payment, status: 'void', voidDate: '2026-05-15' }], 'invoice', 'USD');
    assert.deepEqual(events.filter(e => e.documentId === 'invA').map(e => [e.date, e.amountCents]), [['2026-02-10', 10000], ['2026-05-15', -10000]]);
  });

  test('a later ledger application to the same document leaves the earlier part dated', () => {
    const same = { ...payment, allocations: [{ documentId: 'invA', documentType: 'invoice', amountCents: 6000 }, { documentId: 'invA', documentType: 'invoice', amountCents: 4000 }] };
    const sameRows = [{ ...rows[0], documentId: 'invA', amountCents: 4000, baseClearedCents: 4000 }];
    const events = agingSettlementEvents(sameRows, [same], 'invoice', 'USD');
    assert.deepEqual(events.map(e => [e.date, e.amountCents]).sort(), [['2026-02-10', 6000], ['2026-04-01', 4000]]);
  });
});

describe('returns restore the exact sale cost', () => {
  const accounts = { inventoryAccount: { id: 'inv', name: 'Inventory' }, cogsAccount: { id: 'cogs', name: 'COGS' } };
  // three units at 33,333,333 micro-cents: the sale posted 100 cents
  const line: ReturnableLine = { invoiceLineId: 'l1', itemId: 'item', description: 'Widget', sold: 3, returned: 0, returnable: 3, unitCostCents: 33, saleTotalCents: 100, returnedCents: 0, unitPriceCents: 5000 };
  const plan = (quantity: number, l: ReturnableLine = line) => planReturnEntries({
    creditNote: { id: 'cn1', number: 'CN-1', invoiceId: 'inv1', date: '2026-03-01', returnedGoods: [{ invoiceLineId: 'l1', itemId: 'item', quantity }] },
    lines: [l], uid: 'u', workspaceId: 'ws', baseCurrency: 'USD', ...accounts,
  });

  test('a full return restores all 100 cents, not 3 × 33', () => {
    assert.equal(plan(3)[0].totalAmountCents, 100);
  });

  test('partial returns add up to the sale cost exactly', () => {
    const first = plan(1)[0].totalAmountCents;
    const second = plan(2, { ...line, returned: 1, returnable: 2, returnedCents: first })[0].totalAmountCents;
    assert.equal(first + second, 100);
  });

  test('a zero-cost return still brings its units back', () => {
    const [entry] = plan(3, { ...line, unitCostCents: 0, saleTotalCents: 0 });
    assert.ok(entry, 'an entry is posted');
    assert.equal(entry.totalAmountCents, 0);
    assert.equal(entry.metadata?.quantity, 3);
  });
});
