/**
 * BM-04 (#651): two report figures that converted a payment with the exchange rate alone, so a document
 * whose currency has a different number of minor units than the books (¥ has none, KWD three) was 100x
 * or 10x out:
 *
 *  - sales-rep commission (`src/lib/salesReps.ts`) — a 10 % commission on a ¥100,000 sale at 0.0067 in
 *    USD books is $67.00 = 6,700 cents, not 67 cents;
 *  - cash-basis revenue recognition (`src/server/reports/cashBasis.ts`) — the paid share of an accrual
 *    divided an un-adjusted document conversion by the accrual's base cents, so a fully paid ¥100,000
 *    invoice recognised 670 of 67,000 (1 %) instead of all of it.
 *
 * Every expected figure below is worked by hand from ISO minor units and the rate, not taken from either library.
 * The foreign-currency controls use the same economic amount in USD. When a legacy payment has no saved currency,
 * its allocation is in the books' currency and must keep that currency's minor-unit scale, including JPY and KWD.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { commissionLines, type SalesRep } from '../lib/salesReps';
import { cashBasisEntries, type CashBasisPayment } from '../server/reports/cashBasis';
import { computeProfitAndLoss } from '../server/reports/computeReports';
import { makeChartAccount } from './fixtures';
import type { ChartAccount, Invoice, Transaction } from '../types';

const WS = 'ws_minor';

const rep: SalesRep = { id: 'sr_abcdef', name: 'Dana', commissionPercent: 10, customerIds: ['c1'] };

/** One invoice of a rep's customer, in the document's own minor units. */
function invoice(id: string, currency: string, exchangeRate: number, amountCents: number, taxAmountCents = 0): Invoice {
  return {
    id, workspaceId: WS, number: id.toUpperCase(), customerId: 'c1', customerName: 'Customer',
    date: '2026-10-02', dueDate: '2026-11-01', status: 'paid', currency, exchangeRate,
    amountCents, taxAmountCents,
    items: [{ id: 'li1', description: 'Licence', quantity: 1, rateCents: amountCents, amountCents }],
  } as unknown as Invoice;
}

const account = (id: string, code: string, name: string, type: string, category = '') =>
  makeChartAccount({ id, code, name, type, category, workspaceId: WS } as never);
const accounts: ChartAccount[] = [
  account('bank', '1010', 'Checking', 'asset', 'Bank'),
  account('ar', '1200', 'Accounts Receivable', 'asset', 'Receivables'),
  account('sales', '4000', 'Sales', 'income'),
];

function accrual(id: string, invoiceId: string, arCents: number): Transaction {
  return {
    id, workspaceId: WS, date: '2026-10-02', description: `Invoice ${invoiceId}`, exchangeRate: 1,
    status: 'completed', type: 'actual',
    // the posting the server writes: base cents on both sides, the receivable debited
    lines: [
      { accountId: 'ar', amountCents: arCents, baseAmountCents: arCents },
      { accountId: 'sales', amountCents: -arCents, baseAmountCents: -arCents },
    ],
    metadata: { type: 'invoice-accrual', invoiceId },
  } as unknown as Transaction;
}

test('commission: a foreign payment is converted with its minor units, not the rate alone', () => {
  // ¥100,000 at 0.0067 = $670.00 = 67,000 USD cents. 10 % of it is 6,700 cents.
  const jpy = invoice('inv-jpy', 'JPY', 0.0067, 100_000);
  const jpyPayment = {
    id: 'pay-jpy', status: 'posted', date: '2026-10-05', currency: 'JPY', exchangeRate: 0.0067,
    allocations: [{ documentId: 'inv-jpy', documentType: 'invoice', amountCents: 100_000 }],
  };
  const [line] = commissionLines([rep], [jpy], [jpyPayment], '2026-10-01', '2026-10-31', [], 'USD');
  assert.equal(line.paidCents, 67_000, 'the sale is $670.00 in the books');
  assert.equal(line.netCents, 67_000, 'no tax on this invoice');
  assert.equal(line.commissionCents, 6_700, '10 % of $670.00 is $67.00');

  // Control: the same $670.00 as a USD payment earns the same commission.
  const usd = invoice('inv-usd', 'USD', 1, 67_000);
  const usdPayment = {
    id: 'pay-usd', status: 'posted', date: '2026-10-05', currency: 'USD', exchangeRate: 1,
    allocations: [{ documentId: 'inv-usd', documentType: 'invoice', amountCents: 67_000 }],
  };
  assert.equal(commissionLines([rep], [usd], [usdPayment], '2026-10-01', '2026-10-31', [], 'USD')[0].commissionCents, 6_700);

  // KWD 100.000 at 3.25 = $325.00 = 32,500 cents; 10 % is 3,250 cents. Three decimals are not cents either.
  const kwd = invoice('inv-kwd', 'KWD', 3.25, 100_000);
  const kwdPayment = {
    id: 'pay-kwd', status: 'posted', date: '2026-10-05', currency: 'KWD', exchangeRate: 3.25,
    allocations: [{ documentId: 'inv-kwd', documentType: 'invoice', amountCents: 100_000 }],
  };
  assert.equal(commissionLines([rep], [kwd], [kwdPayment], '2026-10-01', '2026-10-31', [], 'USD')[0].commissionCents, 3_250);
});

test('commission: a row with no saved currency keeps the two-decimal USD reading', () => {
  // Legacy data: EUR 100.00 (10,000 cents) at 1.1 = 11,000 cents in USD books; no minor-unit shift.
  const eur = invoice('inv-eur', 'EUR', 1.1, 10_000);
  const payment = {
    id: 'pay-eur', status: 'posted', date: '2026-10-05', exchangeRate: 1.1,
    allocations: [{ documentId: 'inv-eur', documentType: 'invoice', amountCents: 10_000 }],
  };
  const [line] = commissionLines([rep], [eur], [payment], '2026-10-01', '2026-10-31', [], 'USD');
  assert.equal(line.paidCents, 11_000);
  assert.equal(line.commissionCents, 1_100);
});

test('commission: a missing payment currency uses the books minor units for JPY and KWD', () => {
  for (const currency of ['JPY', 'KWD'] as const) {
    const amount = 100_000;
    const id = currency.toLowerCase();
    const inv = invoice(`inv-${id}`, currency, 1, amount);
    const payment = {
      id: `pay-${id}`, status: 'posted', date: '2026-10-05', exchangeRate: 1,
      allocations: [{ documentId: `inv-${id}`, documentType: 'invoice', amountCents: amount }],
    };
    const [line] = commissionLines([rep], [inv], [payment], '2026-10-01', '2026-10-31', [], currency);
    assert.equal(line.paidCents, amount, `the allocation remains ${amount} ${currency} minor units`);
    assert.equal(line.commissionCents, 10_000, '10 % commission is 10,000 book minor units');
  }
});

test('cash basis: a fully paid foreign invoice recognises all of its revenue', () => {
  const tx = accrual('tx-jpy', 'inv-jpy', 67_000);
  const payments: CashBasisPayment[] = [{
    id: 'pay-jpy', status: 'posted', date: '2026-10-05', currency: 'JPY', exchangeRate: 0.0067,
    allocations: [{ documentId: 'inv-jpy', documentType: 'invoice', amountCents: 100_000 }],
  }];
  const { entries } = cashBasisEntries(accounts, [tx], payments, 'USD');
  const pl = computeProfitAndLoss(accounts, entries, '2026-10-01', '2026-10-31');
  assert.equal(pl.income.total, 67_000, 'the paid share is 100 %, so all $670.00 of revenue');

  // Control: the same $670.00 as USD recognises the same 67,000 cents.
  const usdTx = accrual('tx-usd', 'inv-usd', 67_000);
  const usdPayments: CashBasisPayment[] = [{
    id: 'pay-usd', status: 'posted', date: '2026-10-05', currency: 'USD', exchangeRate: 1,
    allocations: [{ documentId: 'inv-usd', documentType: 'invoice', amountCents: 67_000 }],
  }];
  assert.equal(computeProfitAndLoss(accounts, cashBasisEntries(accounts, [usdTx], usdPayments, 'USD').entries, '2026-10-01', '2026-10-31').income.total, 67_000);
});

test('cash basis: a part payment recognises its share, in the books cents on both sides of the share', () => {
  const tx = accrual('tx-jpy', 'inv-jpy', 67_000);
  // Half of ¥100,000 = ¥50,000 at 0.0067 = $335.00 = 33,500 cents: half the accrual.
  const payments: CashBasisPayment[] = [{
    id: 'pay-jpy', status: 'posted', date: '2026-10-05', currency: 'JPY', exchangeRate: 0.0067,
    allocations: [{ documentId: 'inv-jpy', documentType: 'invoice', amountCents: 50_000 }],
  }];
  const { entries } = cashBasisEntries(accounts, [tx], payments, 'USD');
  assert.equal(computeProfitAndLoss(accounts, entries, '2026-10-01', '2026-10-31').income.total, 33_500);

  // KWD 100.000 at 3.25 = $325.00 = 32,500 cents; paying KWD 40.000 = $130.00 = 13,000 cents is 40 %.
  const kwdTx = accrual('tx-kwd', 'inv-kwd', 32_500);
  const kwdPayments: CashBasisPayment[] = [{
    id: 'pay-kwd', status: 'posted', date: '2026-10-05', currency: 'KWD', exchangeRate: 3.25,
    allocations: [{ documentId: 'inv-kwd', documentType: 'invoice', amountCents: 40_000 }],
  }];
  assert.equal(computeProfitAndLoss(accounts, cashBasisEntries(accounts, [kwdTx], kwdPayments, 'USD').entries, '2026-10-01', '2026-10-31').income.total, 13_000);
});

test('cash basis: a payment with no saved currency keeps the two-decimal USD reading', () => {
  // Legacy row: EUR 100.00 (10,000 cents) at 1.1 against an 11,000-cent accrual is the whole document.
  const tx = accrual('tx-eur', 'inv-eur', 11_000);
  const payments: CashBasisPayment[] = [{
    id: 'pay-eur', status: 'posted', date: '2026-10-05', exchangeRate: 1.1,
    allocations: [{ documentId: 'inv-eur', documentType: 'invoice', amountCents: 10_000 }],
  }];
  assert.equal(computeProfitAndLoss(accounts, cashBasisEntries(accounts, [tx], payments, 'USD').entries, '2026-10-01', '2026-10-31').income.total, 11_000);
});

test('cash basis: a missing payment currency uses the books minor units for JPY and KWD', () => {
  const cases = [
    { currency: 'JPY', allocation: 50_000, expectedIncome: 50_000 },
    { currency: 'KWD', allocation: 40_000, expectedIncome: 40_000 },
  ] as const;
  for (const { currency, allocation, expectedIncome } of cases) {
    const id = currency.toLowerCase();
    const tx = accrual(`tx-${id}`, `inv-${id}`, 100_000);
    const payments: CashBasisPayment[] = [{
      id: `pay-${id}`, status: 'posted', date: '2026-10-05', exchangeRate: 1,
      allocations: [{ documentId: `inv-${id}`, documentType: 'invoice', amountCents: allocation }],
    }];
    const { entries } = cashBasisEntries(accounts, [tx], payments, currency);
    const pl = computeProfitAndLoss(accounts, entries, '2026-10-01', '2026-10-31');
    assert.equal(pl.income.total, expectedIncome, `${currency} payment recognizes its exact book-unit share`);
  }
});
