/**
 * #844: yen (0 digits) and dinars (3 digits) at a major-unit rate, worked by hand.
 *  ¥5,000,000 at 0.025 ILS/JPY = ₪125,000.00 = 12,500,000 agorot (over the allocation threshold)
 *  KWD 300.000 (300,000 fils) at 12 ILS/KWD = ₪3,600.00 = 360,000 agorot (under the ₪5,000 of June 2026; the old maths said ₪36,000)
 *  ¥100,000 at 0.0067 USD/JPY = $670.00 = 67,000 cents
 *  ¥10,000 bill line at 0.0067 = $67.00 = 6,700 cents; KWD 1.000 at 3.25 USD = $3.25 = 325 cents
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { needsAllocationNumber } from '../lib/tax/ilAllocation';
import { usSalesTaxReturn, type UsSalesDocument } from '../lib/tax/usSalesTaxReturn';
import { documentLine } from '../lib/prepaidSchedule';
import { lineAmount, baseAbsoluteTotal } from '../lib/txFilters';
import type { ChartAccount, Transaction, TransactionLine } from '../types';

test('the Israeli allocation number: a yen invoice over the threshold needs one, a dinar invoice under it does not', () => {
  const base = { date: '2026-08-10', buyerVatNumber: '514000000', taxCents: 1 };
  assert.equal(needsAllocationNumber({ ...base, netCents: 5_000_000, currency: 'JPY', exchangeRate: 0.025 }), true);
  assert.equal(needsAllocationNumber({ ...base, netCents: 300_000, currency: 'KWD', exchangeRate: 12 }), false);
});

test('a yen sale is reported in dollars on the US state return', () => {
  const r = usSalesTaxReturn({
    registration: 'sales_tax:US-TX:3200', order: ['world'], startDate: '2026-07-01', endDate: '2026-09-30',
    profiles: { books: { place: { country: 'US', state: 'TX' }, registrations: [{ kind: 'sales_tax', number: '3200', place: { country: 'US', state: 'TX' } }] } },
    customers: [{ id: 'b', metadata: { taxPlace: { country: 'US', state: 'TX' } } }],
    invoices: [{ id: 'j1', date: '2026-08-10', status: 'sent', taxVersion: 2, amountCents: 100_000, taxAmountCents: 0, customerId: 'b',
      taxTreatment: 'out_of_scope', currency: 'JPY', exchangeRate: 0.0067 } as UsSalesDocument],
  });
  assert.equal(r.grossSalesCents, 67_000);
});

test('a prepaid spread of a yen bill is in home cents', () => {
  const accounts = [{ id: 'ins', type: 'expense', name: 'Insurance' }] as unknown as ChartAccount[];
  const bill = { amountCents: 10_000, currency: 'JPY', exchangeRate: 0.0067, items: [{ accountId: 'ins', amountCents: 10_000 }] };
  assert.deepEqual(documentLine(bill, accounts, 'expense', undefined, 'USD'), { accountId: 'ins', baseCents: 6_700 });
});

test('entries without stored home amounts convert by their own minor units', () => {
  const kwd = { currency: 'KWD', exchangeRate: 3.25, totalAmountCents: 1_000, lines: [] } as unknown as Transaction;
  assert.equal(lineAmount({ amountCents: 1_000 } as TransactionLine, kwd), 325);
  assert.equal(baseAbsoluteTotal(kwd), 325);
  // rate 1 is already the home currency, whatever the entry says
  assert.equal(lineAmount({ amountCents: 1_234 } as TransactionLine, { exchangeRate: 1, currency: 'JPY' } as unknown as Transaction), 1_234);
});
