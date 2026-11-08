/**
 * Agent #8 — targeted, synthetic AF-004 acceptance reproductions at upstream 7896cbd.
 *
 * This is intentionally outside the normal npm test glob. Some assertions are expected to
 * FAIL on the audited revision; their names and expected figures describe the desired contract,
 * not a passing product state. Run explicitly and retain its nonzero exit until the owner fixes
 * the relevant behavior. No DB, browser, production tax advice, or provider is involved.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { documentEntityLabels } from '../../src/lib/tax/ilVatReturn';
import { resolveSellerProfile, taxProfilesProblem, type TaxProfiles } from '../../src/lib/tax/profile';
import { saleDestinationSnapshot } from '../../src/lib/tax/usInvoiceTax';
import { usSalesTaxReturn, type UsSalesDocument } from '../../src/lib/tax/usSalesTaxReturn';
import { usQuarterJourney } from '../../src/lib/usQuarterJourney';

const texas = { country: 'US', state: 'TX', city: 'Austin' };
const oklahoma = { country: 'US', state: 'OK', city: 'Tulsa' };
const registration = 'sales_tax:US-TX:3200';
const profiles: TaxProfiles = {
  books: {
    place: texas,
    registrations: [{ kind: 'sales_tax', number: '3200', place: { country: 'US', state: 'TX' } }],
  },
  labels: {
    'world:il': {
      place: { country: 'IL' },
      registrations: [{ kind: 'vat', number: '514000000', place: { country: 'IL' } }],
    },
  },
};

type SavedInvoice = UsSalesDocument & {
  metadata: { taxPlace: typeof texas };
  items?: Array<{ dimensions: Record<string, string> }>;
};

// Hand figures: $100.00 net + $8.25 tax = $108.25 gross. Tax splits $6.25 + $2.00.
const invoice: SavedInvoice = {
  id: 'sale-1', customerId: 'customer-1', date: '2026-08-10', status: 'sent',
  amountCents: 10825, taxAmountCents: 825, taxVersion: 2, taxTreatment: 'standard',
  taxBreakdown: [
    { name: 'Texas state sales tax', rate: 6.25, taxCents: 625 },
    { name: 'Austin', rate: 2, taxCents: 200 },
  ],
  metadata: { taxPlace: texas },
};
const at = (place: { country: string; state?: string; city?: string }) =>
  [{ id: 'customer-1', metadata: { taxPlace: place } }];
const returnFor = (sale: SavedInvoice, customers: ReturnType<typeof at>) => usSalesTaxReturn({
  registration, profiles, order: ['world'], invoices: [sale], customers,
  startDate: '2026-07-01', endDate: '2026-09-30',
});

test('control: invoice save keeps its original Texas snapshot after the customer moves', () => {
  assert.deepEqual(saleDestinationSnapshot({
    status: 'sent', customerId: 'customer-1', initial: invoice, customers: at(oklahoma),
  }), { taxPlace: texas });
});

test('control: Texas sale is counted before customer details change', () => {
  const result = returnFor(invoice, at(texas));
  assert.deepEqual(
    [result.documentCount, result.grossSalesCents, result.taxableSalesCents, result.taxCollectedCents],
    [1, 10000, 10000, 825],
  );
  assert.deepEqual(result.byJurisdiction, [
    { name: 'Austin', taxCents: 200 }, { name: 'Texas state sales tax', taxCents: 625 },
  ]);
});

test('contract: a saved Texas sale stays on the Texas return after the customer moves', () => {
  const result = returnFor(invoice, at(oklahoma));
  assert.deepEqual(
    [result.documentCount, result.grossSalesCents, result.taxableSalesCents, result.taxCollectedCents],
    [1, 10000, 10000, 825],
  );
});

test('contract: the quarter journey also retains the saved Texas sale after the customer moves', () => {
  const journey = usQuarterJourney({
    quarter: '2026-Q3', today: '2026-11-05', profiles, order: ['world'],
    invoices: [invoice], customers: at(oklahoma),
  });
  const row = journey.steps.find(step => step.id === 'state-returns')?.returns.find(r => r.registration === registration);
  assert.ok(row, 'the Texas permit must have a return row');
  assert.deepEqual([row.documentCount, row.grossSalesCents, row.taxCollectedCents], [1, 10000, 825]);
});

test('contract: an incomplete US buyer state is flagged instead of silently dropping a taxed sale', () => {
  const journey = usQuarterJourney({
    quarter: '2026-Q3', today: '2026-11-05', profiles, order: ['world'],
    invoices: [{ ...invoice, metadata: { taxPlace: { country: 'US' } } }],
    customers: at({ country: 'US' }),
  });
  const row = journey.steps.find(step => step.id === 'state-returns')?.returns.find(r => r.registration === registration);
  assert.ok(row);
  assert.ok(
    journey.problems.some(problem => /state|destination|unassigned/i.test(problem)),
    `unresolved destination was not flagged (documents=${row.documentCount}, tax=${row.taxCollectedCents}); guessing Texas is not required`,
  );
});

test('control: first-line labels identify the Israeli entity and its separate VAT registration', () => {
  const labelled = { ...invoice, items: [{ dimensions: { world: 'il' } }] };
  const labels = documentEntityLabels(labelled);
  assert.deepEqual(labels, { world: 'il' });
  assert.deepEqual(resolveSellerProfile(profiles, labels, ['world']).registrations, [
    { kind: 'vat', number: '514000000', place: { country: 'IL' } },
  ]);
});

test('control: a document-level Israeli label excludes the sale from the Texas permit', () => {
  const labelled = { ...invoice, dimensions: { world: 'il' } };
  assert.equal(returnFor(labelled, at(texas)).documentCount, 0);
});

test('contract: a first-line Israeli entity label also excludes it from the Texas permit', () => {
  const labelled = { ...invoice, items: [{ dimensions: { world: 'il' } }] };
  assert.equal(returnFor(labelled, at(texas)).documentCount, 0);
});

test('observation: valid cross-country profiles inherit a US state and registration', () => {
  // This characterizes current behavior only; whether the child is a different legal entity
  // or a location of the same entity is an owner/tax-design question, not decided by this test.
  const crossCountry: TaxProfiles = {
    books: profiles.books,
    labels: { 'world:il': { place: { country: 'IL' } } },
  };
  assert.equal(taxProfilesProblem(crossCountry), null);
  const seller = resolveSellerProfile(crossCountry, { world: 'il' }, ['world']);
  assert.deepEqual(seller.place, { country: 'IL', state: 'TX', city: 'Austin' });
  assert.equal(seller.registrations?.[0].number, '3200');
});
