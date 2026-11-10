/**
 * Agent #6 probe (2026-11-10) — AF-004 family: `TaxPlace.state` vs `TaxPlace.region`.
 *
 * Hypothesis: parts of the product write a customer's/seller's US state into `TaxPlace.region`
 * (the seeded 12-month sample book, and the conformance journey that reads it), while the
 * sales-tax return resolves the buyer with `place.state`. A place carrying only `region` is
 * therefore treated as "a place we know, in a country that is not US" and the sale is dropped
 * from the state return (issue #518's silent-omission branch).
 *
 * Run:  NODE_ENV=test SYSTEM_SALT=... npx tsx --test audit/.../af004-taxplace-key-mismatch.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usSalesTaxReturn } from '../../../src/lib/tax/usSalesTaxReturn.ts';
import { usQuarterJourney } from '../../../src/lib/usQuarterJourney.ts';
import type { TaxProfiles } from '../../../src/lib/tax/profile.ts';

const REG = 'sales_tax:US-TX:32099887766';

// A seller holding a Texas permit (what the sample book's taxProfiles say).
const profiles: TaxProfiles = {
  books: {
    name: 'Harbor & Olive Supply Co.',
    place: { country: 'US', state: 'TX' },
    registrations: [{ kind: 'sales_tax', number: '32099887766', place: { country: 'US', state: 'TX' }, filing: 'quarterly' }],
  },
};

const invoice = (over: Record<string, unknown> = {}) => ({
  id: 'inv-1', number: 'INV-1', customerId: 'c1', customerName: 'Beacon Market 1',
  date: '2026-08-05', dueDate: '2026-09-05', status: 'sent', currency: 'USD', taxVersion: 2,
  taxTreatment: 'standard', subtotalCents: 10000, taxAmountCents: 625, amountCents: 10625,
  items: [{ id: 'l1', accountId: 'acc-sales-goods', description: 'Goods', quantity: 1, rateCents: 10000, amountCents: 10000 }],
  ...over,
});

test('control: a customer place written with state=TX is counted', () => {
  const r = usSalesTaxReturn({
    registration: REG, profiles, order: ['world'],
    customers: [{ id: 'c1', metadata: { taxPlace: { country: 'US', state: 'TX' } } }],
    invoices: [invoice()] as never, startDate: '2026-07-01', endDate: '2026-09-30',
  });
  assert.equal(r.documentCount, 1);
  assert.equal(r.taxableSalesCents, 10000);
  assert.equal(r.taxCollectedCents, 625);
});

test('DEFECT: the same Texas sale written as region=TX (the sample book\'s and journey\'s shape) is dropped', () => {
  const r = usSalesTaxReturn({
    registration: REG, profiles, order: ['world'],
    customers: [{ id: 'c1', metadata: { taxPlace: { country: 'US', region: 'TX' } } }],
    invoices: [invoice()] as never, startDate: '2026-07-01', endDate: '2026-09-30',
  });
  // observed: nothing counted, nothing surfaced — a Texas taxable sale vanishes from the TX return
  assert.equal(r.documentCount, 0);
  assert.equal(r.taxableSalesCents, 0);
  assert.equal(r.taxCollectedCents, 0);
});

test('DEFECT: the US quarter journey reports 0.00 due for the same Texas sale', () => {
  const q = usQuarterJourney({
    quarter: '2026-Q3', today: '2026-11-10', currency: 'USD', profiles, order: ['world'],
    customers: [{ id: 'c1', metadata: { taxPlace: { country: 'US', region: 'TX' } } }],
    invoices: [invoice()] as never,
  });
  const returns = q.steps.find(s => s.id === 'state-returns')!.returns;
  const tx = returns.find(r => r.state === 'TX');
  assert.ok(tx, 'a Texas return row exists (the permit is in force)');
  assert.equal(tx!.documentCount, 0);
  assert.equal(tx!.taxCollectedCents, 0);
});

test('control: the sample book\'s own workspace taxProfiles use region and are therefore unusable by the return', () => {
  // the seeded workspace writes `place: { country: 'US', region: 'TX' }` (src/lib/sampleBusinessYear.ts:142)
  const seeded: TaxProfiles = {
    books: {
      name: 'Harbor & Olive Supply Co.',
      place: { country: 'US', region: 'TX' },
      registrations: [{ kind: 'sales_tax', number: '32099887766', place: { country: 'US', region: 'TX' }, filing: 'quarterly' }],
    },
  } as unknown as TaxProfiles;
  const q = usQuarterJourney({
    quarter: '2026-Q3', today: '2026-11-10', currency: 'USD', profiles: seeded, order: ['world'],
    customers: [{ id: 'c1', metadata: { taxPlace: { country: 'US', state: 'TX' } } }],
    invoices: [invoice()] as never,
  });
  // the permit row still exists, but its registration key carries no state
  const returns = q.steps.find(s => s.id === 'state-returns')!.returns;
  assert.equal(returns.length, 1);
  assert.equal(returns[0].state, '');
});
