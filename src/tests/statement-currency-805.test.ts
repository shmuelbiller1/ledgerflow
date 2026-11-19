/**
 * #805: a USD book, a USD statement. Sep 30 invoice ¥100,000 at $0.0067 = $670.00 open; Oct 1 invoice $100.00.
 * October: opening 67,000 cents, closing 77,000. A KWD 1.000 credit at $3.25 is 325 cents.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStatement } from '../server/reports/computeReports';
import type { Customer, Invoice, Payment, CreditNote } from '../types';

const contact = { id: 'c1', name: 'Acme' } as Customer;
const inv = (id: string, date: string, amountCents: number, currency: string, exchangeRate: number) =>
  ({ id, number: id, customerId: 'c1', date, status: 'sent', amountCents, currency, exchangeRate }) as unknown as Invoice;

test('yen and dollars in one statement are both in dollars', () => {
  const r = computeStatement(contact, [inv('J1', '2026-09-30', 100_000, 'JPY', 0.0067), inv('U1', '2026-10-01', 10_000, 'USD', 1)], [], [], '2026-10-01', '2026-10-31', 'customer', [], 'USD');
  assert.deepEqual([r.openingBalanceCents, r.endingBalanceCents, r.currency], [67_000, 77_000, 'USD']);
});

test('payments and credits in another currency convert by their own digits', () => {
  const pay = { id: 'p1', contactId: 'c1', date: '2026-10-02', direction: 'received', status: 'posted', amountCents: 50_000, currency: 'JPY', exchangeRate: 0.0067 } as unknown as Payment;
  const credit = { id: 'k1', number: 'K1', customerId: 'c1', date: '2026-10-03', status: 'open', amountCents: 1_000, currency: 'KWD', exchangeRate: 3.25 } as unknown as CreditNote;
  const r = computeStatement(contact, [inv('U1', '2026-10-01', 10_000, 'USD', 1)], [], [pay], '2026-10-01', '2026-10-31', 'customer', [credit], 'USD');
  assert.equal(r.endingBalanceCents, 10_000 - 33_500 - 325);
});

test('a book in one currency is unchanged', () => {
  const r = computeStatement(contact, [inv('U1', '2026-10-01', 10_000, 'USD', 1)], [], [], '2026-10-01', '2026-10-31', 'customer', [], 'USD');
  assert.equal(r.endingBalanceCents, 10_000);
});
