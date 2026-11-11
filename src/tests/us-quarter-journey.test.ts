/**
 * A-153: the US quarter journey, checked by hand. The Texas entity holds permit 3200 and the
 * quarter is Q3 2026 (1 Jul – 30 Sep 2026). Every expected number below is worked out on paper
 * first and asserted literally, so a change to a return, a calendar or a threshold that alters a
 * figure fails here instead of passing silently.
 *
 * The Texas return for the quarter, by hand (a document's `amountCents` is its tax-inclusive
 * total, so the net is the amount less its tax):
 *   i1 10 Aug Austin customer   1,000.00 + 82.50 (state 62.50, Austin 20.00)   taxable, net 1,000.00
 *   i4  5 Jul Austin customer     200.00 + 16.50 (state 12.50, Austin  4.00)   taxable, net   200.00
 *   i2 15 Aug Houston resale      500.00 + 0      (certificate to 31 Dec 2027) exempt,  net   500.00
 *   i6  1 Sep Dallas              300.00 + 0      (certificate ran out 31 Dec 2025) exempt, expired
 *   i7 10 Sep Dallas              250.00 + 0      (no certificate recorded)    exempt, missing
 *   c1 25 Aug credit to Austin    100.00 + 8.25   (state 6.25, Austin 2.00)   reduces the quarter
 *   i3 20 Aug California customer 1,000.00 + 0     → another state, not this return
 *   i5  1 Oct Austin customer     100.00 + 8.25   → next quarter
 *   i8 30 Jun Austin customer      50.00 + 4.13   → previous quarter
 *   → gross 2,150.00 · exempt 1,050.00 · taxable 1,100.00 · tax 90.75 · 6 documents
 *   → Austin 22.00 · Texas state 68.75
 * Planning due date: Texas files by the 20th of the following month → 20 Oct 2026.
 * Texas economic nexus is revenue only at 500,000.00, so 2,240.75 does not reach it.
 * Use tax: one bill with no item category (30,000, never estimated) and one general-goods bill
 *   (100,000 at the Texas 6.25% state rate = 6,250.00).
 * 1099 for 2026: the NEC/MISC threshold is 2,000.00; Ava's Design was paid 2,500.00 (over),
 *   Blue Ridge LLC 1,500.00 (below).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  US_QUARTER_JOURNEY_CSV_HEADERS, usQuarterJourney, usQuarterJourneyCsvRows, usQuarterOf, usQuarterPermits, usQuarterProblem,
} from '../lib/usQuarterJourney';
import type { UsSalesDocument } from '../lib/tax/usSalesTaxReturn';
import type { TaxProfiles } from '../lib/tax/profile';
import { filingDueDate } from '../lib/tax/usFilingCalendar';
import { nexusThreshold } from '../lib/tax/usNexus';
import { stateSalesTaxRate } from '../lib/tax/usStateSalesTax';
import { threshold1099Cents } from '../lib/tax/us1099Preview';

const QUARTER = '2026-Q3';
const TODAY = '2026-10-18';

const profiles: TaxProfiles = {
  books: { place: { country: 'IL' }, registrations: [{ kind: 'vat', number: '514000000', place: { country: 'IL' } }] },
  labels: { 'world:tx': { place: { country: 'US', state: 'TX' }, registrations: [{ kind: 'sales_tax', number: '3200', place: { country: 'US', state: 'TX' } }] } },
};
const tx = { world: 'tx' };
const doc = (id: string, customerId: string, amount: number, tax: number, parts: Array<[string, number]>, extra: Partial<UsSalesDocument> = {}): UsSalesDocument =>
  ({
    id, date: '2026-08-10', status: 'sent', taxVersion: 2, amountCents: amount, taxAmountCents: tax, customerId, dimensions: tx,
    taxTreatment: tax ? 'standard' : 'exempt',
    taxBreakdown: parts.map(([name, taxCents]) => ({ name, rate: 0, taxCents })), ...extra,
  }) as unknown as UsSalesDocument;

const customers = [
  { id: 'austin', metadata: { taxPlace: { country: 'US', state: 'TX', city: 'Austin' } } },
  { id: 'houston', metadata: { taxPlace: { country: 'US', state: 'TX' }, taxExemption: { number: 'RESALE-1', expires: '2027-12-31' } } },
  { id: 'dallas-expired', metadata: { taxPlace: { country: 'US', state: 'TX', city: 'Dallas' }, taxExemption: { number: 'GOV-9', expires: '2025-12-31' } } },
  { id: 'dallas-none', metadata: { taxPlace: { country: 'US', state: 'TX', city: 'Dallas' } } },
  { id: 'la', metadata: { taxPlace: { country: 'US', state: 'CA' } } },
];

const invoices = [
  doc('i1', 'austin', 108250, 8250, [['Texas state sales tax', 6250], ['Austin', 2000]]),
  doc('i4', 'austin', 21650, 1650, [['Texas state sales tax', 1250], ['Austin', 400]], { date: '2026-07-05' }),
  doc('i2', 'houston', 50000, 0, [], { date: '2026-08-15' }),
  doc('i6', 'dallas-expired', 30000, 0, [], { date: '2026-09-01' }),
  doc('i7', 'dallas-none', 25000, 0, [], { date: '2026-09-10' }),
  doc('i3', 'la', 100000, 0, [], { date: '2026-08-20', taxTreatment: 'out_of_scope' }),
  doc('i5', 'austin', 10825, 825, [['Texas state sales tax', 625]], { date: '2026-10-01' }),
  doc('i8', 'austin', 5413, 413, [['Texas state sales tax', 313]], { date: '2026-06-30' }),
];
const creditNotes = [
  doc('c1', 'austin', 10825, 825, [['Texas state sales tax', 625], ['Austin', 200]], { date: '2026-08-25', status: 'applied' }),
];

const bills = [
  { id: 'b1', vendorName: 'Office Depot', date: '2026-08-02', amountCents: 30000, currency: 'USD', status: 'approved' },
  { id: 'b2', vendorName: 'Widgets Inc', date: '2026-08-03', amountCents: 100000, currency: 'USD', status: 'approved', splits: [{ itemId: 'itm-1', amountCents: 100000 }] },
  { id: 'b3', vendorName: 'Taxed Vendor', date: '2026-08-04', amountCents: 50000, currency: 'USD', status: 'approved', taxAmountCents: 3125 },
];
const items = [{ id: 'itm-1', productTaxCategory: 'general' }];

const vendors = [
  { id: 'v-ava', name: "Ava's Design", is1099: true, address: '1 Main St', metadata: { taxId: '123456789', taxPlace: { country: 'US' } } },
  { id: 'v-blue', name: 'Blue Ridge LLC', is1099: true, metadata: { taxPlace: { country: 'US' } } },
];
const payments = [
  { contactId: 'v-ava', contactName: "Ava's Design", date: '2026-08-11', amountCents: 250000, currency: 'USD', direction: 'made', status: 'posted' },
  { contactId: 'v-blue', contactName: 'Blue Ridge LLC', date: '2026-09-11', amountCents: 150000, currency: 'USD', direction: 'made', status: 'posted' },
];

const journey = () => usQuarterJourney({
  quarter: QUARTER, today: TODAY, currency: 'USD', profiles, order: ['world'], customers,
  invoices, creditNotes, bills, items, vendors, payments,
  periods: [{ month: '2026-07', state: 'soft' }, { month: '2026-08', state: 'soft' }],
});

test('the quarter reads its own dates and months', () => {
  const q = usQuarterOf(QUARTER)!;
  assert.equal(q.startDate, '2026-07-01');
  assert.equal(q.endDate, '2026-09-30');
  assert.deepEqual(q.months, ['2026-07', '2026-08', '2026-09']);
  assert.equal(q.taxYear, 2026);
  assert.equal(usQuarterOf('2026-Q4')!.endDate, '2026-12-31');
  assert.equal(usQuarterOf('2028-Q1')!.endDate, '2028-03-31'); // a leap February
  assert.equal(usQuarterOf('2026-Q2')!.startDate, '2026-04-01');
  assert.equal(usQuarterOf('2026-q3'), undefined);
  assert.equal(usQuarterOf('2026-13'), undefined);
  assert.equal(usQuarterOf('third quarter'), undefined);
  assert.equal(usQuarterOf('1899-Q1'), undefined);
  assert.equal(usQuarterProblem('2026-Q3'), null);
  assert.equal(usQuarterProblem('Q3 2026'), 'A quarter is written as 2026-Q3.');
  assert.equal(usQuarterProblem('2026-Q3', '18/10/2026'), 'Today is a YYYY-MM-DD date.');
});

test('the permit in force on the last day of the quarter', () => {
  const permits = usQuarterPermits(profiles, '2026-09-30');
  assert.equal(permits.length, 1);
  assert.equal(permits[0].state, 'TX');
  assert.equal(permits[0].stateName, 'Texas');
  assert.equal(permits[0].permitNumber, '3200');
  assert.equal(permits[0].registration, 'sales_tax:US-TX:3200');
  assert.equal(permits[0].from, 'world:tx');
  // a permit that ran out before the quarter is not one of them
  assert.equal(usQuarterPermits({
    labels: { 'world:tx': { registrations: [{ kind: 'sales_tax', number: '3200', place: { country: 'US', state: 'TX' }, validTo: '2026-06-30' }] } },
  }, '2026-09-30').length, 0);
  // an Israeli VAT registration is not a US sales-tax permit
  assert.equal(usQuarterPermits({ books: { registrations: [{ kind: 'vat', number: '514000000', place: { country: 'IL' } }] } }, '2026-09-30').length, 0);
});

test('the Texas return for the quarter, box by box', () => {
  const state = journey().steps.find(s => s.id === 'state-returns')!;
  assert.equal(state.status, 'attention');
  const r = state.returns[0];
  assert.equal(r.state, 'TX');
  assert.equal(r.startDate, '2026-07-01');
  assert.equal(r.endDate, '2026-09-30');
  assert.deepEqual(
    [r.grossSalesCents, r.exemptSalesCents, r.taxableSalesCents, r.taxCollectedCents, r.documentCount],
    [215000, 105000, 110000, 9075, 6],
  );
  assert.deepEqual(r.byJurisdiction, [{ name: 'Austin', taxCents: 2200 }, { name: 'Texas state sales tax', taxCents: 6875 }]);
  assert.equal(r.filed, false);
  // the planning calendar: the 20th of the following month, and Texas nexus is revenue only at 500,000
  assert.equal(r.dueDate, filingDueDate('TX', '2026-09-30'));
  assert.equal(r.dueDate, '2026-10-20');
  assert.equal(r.nexusThresholdCents, nexusThreshold('TX', '2026-09-30')!.salesThresholdCents);
  assert.equal(r.nexusThresholdCents, 50000000);
  assert.equal(r.nexusSalesReached, false);
  assert.match(r.dueNote || '', /quarterly is common/);
});

test('the same quarter with nothing in it owes nothing and files nothing', () => {
  const state = usQuarterJourney({ quarter: QUARTER, today: TODAY, profiles, order: ['world'], customers, invoices: [], creditNotes: [] })
    .steps.find(s => s.id === 'state-returns')!;
  const r = state.returns[0];
  assert.deepEqual([r.grossSalesCents, r.taxableSalesCents, r.taxCollectedCents, r.documentCount], [0, 0, 0, 0]);
  assert.equal(r.filed, false);
  // no tax and no documents: nothing is waiting, so the step is not flagged
  assert.equal(usQuarterJourney({ quarter: QUARTER, today: TODAY, profiles, order: ['world'], customers, invoices: [], creditNotes: [] })
    .steps.find(s => s.id === 'close')!.status, 'attention');
});

test('a return the server recorded for the quarter counts as filed', () => {
  const open = usQuarterJourney({
    quarter: QUARTER, today: TODAY, profiles, order: ['world'], customers, invoices, creditNotes,
  }).steps.find(s => s.id === 'state-returns')!;
  assert.equal(open.returns[0].filed, false);
  const recorded = usQuarterJourney({
    quarter: QUARTER, today: TODAY, profiles, order: ['world'], customers, invoices, creditNotes,
    filedPeriods: [{ startDate: '2026-07-01', endDate: '2026-09-30' }],
  });
  assert.equal(recorded.steps.find(s => s.id === 'state-returns')!.returns[0].filed, true);
  assert.equal(recorded.steps.find(s => s.id === 'state-returns')!.status, 'done');
  assert.match(recorded.steps.find(s => s.id === 'state-returns')!.detail, /recorded as filed/);
  // a filed record for another period does not count for this one
  const other = usQuarterJourney({
    quarter: QUARTER, today: TODAY, profiles, order: ['world'], customers, invoices, creditNotes,
    filedPeriods: [{ startDate: '2026-04-01', endDate: '2026-06-30' }],
  });
  assert.equal(other.steps.find(s => s.id === 'state-returns')!.returns[0].filed, false);
});

test('the certificate check behind the quarter’s zero-tax sales', () => {
  const step = journey().steps.find(s => s.id === 'certificates')!;
  assert.equal(step.status, 'attention');
  assert.equal(step.figures.find(f => f.label === 'Zero-tax sales')!.count, 3);
  assert.equal(step.figures.find(f => f.label === 'Certificate missing')!.count, 1);
  assert.equal(step.figures.find(f => f.label === 'Certificate expired')!.count, 1);
  // the Houston resale certificate is good for the whole quarter, so it is counted but not flagged
  assert.match(step.detail, /3 zero-tax sale\(s\) to a US customer: 1 without a recorded certificate, 1 after the certificate’s last day/);
  // with a good certificate on every zero-tax sale the step is done
  const all = usQuarterJourney({
    quarter: QUARTER, today: TODAY, profiles, order: ['world'], customers,
    invoices: [doc('i2', 'houston', 50000, 0, [], { date: '2026-08-15' })],
  }).steps.find(s => s.id === 'certificates')!;
  assert.equal(all.status, 'done');
  // no zero-tax sale at all: the step does not apply
  const none = usQuarterJourney({ quarter: QUARTER, today: TODAY, profiles, order: ['world'], customers, invoices: [doc('i1', 'austin', 108250, 8250, [])] })
    .steps.find(s => s.id === 'certificates')!;
  assert.equal(none.status, 'not-applicable');
});

test('W8-GOLD: a zero-tax sale exempt by its product (Texas groceries) needs no certificate; a free-text or unloaded line still does', () => {
  const grocery = [{ id: 'itm-food', productTaxCategory: 'groceries' }, ...items];
  const step = (lines: Array<{ itemId?: string }>, list = grocery) => usQuarterJourney({
    quarter: QUARTER, today: TODAY, profiles, order: ['world'], customers, items: list,
    invoices: [doc('i7', 'dallas-none', 25000, 0, [], { date: '2026-09-10', items: lines } as Partial<UsSalesDocument>)],
  }).steps.find(s => s.id === 'certificates')!;
  assert.equal(step([{ itemId: 'itm-food' }]).status, 'not-applicable');
  assert.equal(step([{ itemId: 'itm-food' }, { itemId: 'itm-1' }]).figures.find(f => f.label === 'Certificate missing')!.count, 1, 'a general-goods line needs one');
  assert.equal(step([{ itemId: 'itm-food' }, {}]).figures.find(f => f.label === 'Certificate missing')!.count, 1, 'a free-text line needs one');
  assert.equal(step([{ itemId: 'itm-food' }], items).figures.find(f => f.label === 'Certificate missing')!.count, 1, 'an item not loaded needs one');
});

test('use tax on the quarter’s untaxed purchases', () => {
  const step = journey().steps.find(s => s.id === 'use-tax')!;
  assert.equal(step.status, 'attention');
  const rate = stateSalesTaxRate('TX', '2026-08-03')!;
  assert.equal(rate, 0.0625);
  // 100,000 general-goods base at the Texas state rate = 6,250.00; the 30,000 with no item category
  // is never estimated, and the bill with tax charged is not a use-tax candidate
  assert.equal(step.figures.find(f => f.label === 'Estimated use tax')!.cents, 6250);
  assert.equal(step.figures.find(f => f.label === 'Base to review')!.cents, 30000);
  // a state with no state sales tax has no state use tax here
  const none = usQuarterJourney({ quarter: QUARTER, today: TODAY, profiles, order: ['world'], customers, useTaxState: 'OR', bills, items })
    .steps.find(s => s.id === 'use-tax')!;
  assert.equal(none.status, 'not-applicable');
  assert.match(none.detail, /no state sales tax/);
  // with nothing untaxed left to review the step is done
  const done = usQuarterJourney({ quarter: QUARTER, today: TODAY, profiles, order: ['world'], customers, bills: [], items })
    .steps.find(s => s.id === 'use-tax')!;
  assert.equal(done.status, 'done');
});

test('the 1099 preview for the quarter’s tax year', () => {
  const step = journey().steps.find(s => s.id === 'form-1099')!;
  assert.equal(step.status, 'attention');
  assert.equal(threshold1099Cents(2026, '1099-NEC', '1a'), 200000);
  assert.equal(step.figures.find(f => f.label === 'Threshold')!.cents, 200000);
  assert.equal(step.figures.find(f => f.label === 'Vendors over threshold')!.count, 1);
  assert.match(step.detail, /1 vendor\(s\) are at or over the 2026 threshold/);
  // a year where nobody reached the threshold is done
  const below = usQuarterJourney({
    quarter: QUARTER, today: TODAY, profiles, order: ['world'], customers, vendors, payments: [payments[1]],
  }).steps.find(s => s.id === 'form-1099')!;
  assert.equal(below.status, 'done');
});

test('closing the quarter’s months', () => {
  const step = journey().steps.find(s => s.id === 'close')!;
  assert.equal(step.status, 'attention');
  assert.equal(step.figures.find(f => f.label === 'Months still open')!.count, 1);
  assert.match(step.detail, /Still open: 2026-09/);
  // every month closed and the return recorded as filed: the close step is done, but the quarter is
  // not ready while use tax, certificates or the 1099 preview still need a person
  const closed = usQuarterJourney({
    quarter: QUARTER, today: TODAY, profiles, order: ['world'], customers, invoices, creditNotes, bills, items, vendors, payments,
    periods: [{ month: '2026-07', state: 'soft' }, { month: '2026-08', state: 'hard' }, { month: '2026-09', state: 'hard' }],
    filedReturns: ['sales_tax:US-TX:3200'],
  });
  assert.equal(closed.steps.find(s => s.id === 'close')!.status, 'done');
  assert.equal(closed.readyToClose, false);
  assert.equal(closed.nextStep, 'use-tax');
  // a quarter with nothing waiting anywhere: every step is done or does not apply
  const clean = usQuarterJourney({
    quarter: QUARTER, today: TODAY, profiles, order: ['world'], customers,
    periods: [{ month: '2026-07', state: 'soft' }, { month: '2026-08', state: 'hard' }, { month: '2026-09', state: 'hard' }],
    filedReturns: ['sales_tax:US-TX:3200'],
  });
  assert.equal(clean.attention, 0);
  assert.equal(clean.done, 4);
  assert.equal(clean.readyToClose, true);
  assert.equal(clean.nextStep, undefined);
  // the month-end close screen is where the work happens
  assert.equal(clean.steps.find(s => s.id === 'close')!.screen, 'month-end-close');
});

test('the whole journey in order, with the screen that does each step', () => {
  const j = journey();
  assert.deepEqual(j.steps.map(s => s.id), ['permits', 'state-returns', 'use-tax', 'certificates', 'form-1099', 'close']);
  assert.deepEqual(j.steps.map(s => s.tab), ['settings', 'reports', 'reports', 'reports', 'reports', 'month-end-close']);
  assert.deepEqual(j.steps.map(s => s.screen), ['tax-profiles', 'tax-liability', 'use-tax-review', 'customer-tax-certificates', 'vendor-1099-readiness', 'month-end-close']);
  assert.equal(j.steps[0].status, 'done');
  assert.equal(j.attention, 5);
  assert.equal(j.readyToClose, false);
  assert.equal(j.nextStep, 'state-returns');
  assert.deepEqual(j.problems, []);
  // every screen the journey names is a real registry screen
  for (const step of j.steps) assert.ok(step.screenLabel.length > 0, step.id);
});

test('without a permit the journey says so instead of inventing a return', () => {
  const j = usQuarterJourney({ quarter: QUARTER, today: TODAY, profiles: { books: profiles.books }, order: ['world'], customers, invoices, creditNotes });
  assert.equal(j.steps.find(s => s.id === 'permits')!.status, 'attention');
  assert.equal(j.steps.find(s => s.id === 'state-returns')!.status, 'not-applicable');
  assert.equal(j.steps.find(s => s.id === 'state-returns')!.returns.length, 0);
  assert.match(j.steps.find(s => s.id === 'state-returns')!.detail, /No permit is recorded/);
  assert.equal(j.readyToClose, false);
});

test('a quarter that is not written as one is reported, not guessed', () => {
  const j = usQuarterJourney({ quarter: 'Q3', today: TODAY });
  assert.deepEqual(j.problems, ['A quarter is written as 2026-Q3.']);
  assert.equal(j.readyToClose, false);
  assert.equal(j.steps.find(s => s.id === 'state-returns')!.status, 'not-applicable');
  const bad = usQuarterJourney({ quarter: QUARTER, today: 'yesterday' });
  assert.deepEqual(bad.problems, ['Today is a YYYY-MM-DD date.']);
});

test('a quarter before the 1099 table says so instead of asking a table with no row', () => {
  const j = usQuarterJourney({ quarter: '2019-Q2', today: '2019-07-05', profiles, order: ['world'], customers, vendors, payments });
  assert.equal(j.taxYear, 2019);
  const step = j.steps.find(s => s.id === 'form-1099')!;
  assert.equal(step.status, 'not-applicable');
  assert.match(step.detail, /threshold table covers 2020 and later/);
  // the rest of the journey still reads the quarter's own data
  assert.equal(j.steps.find(s => s.id === 'state-returns')!.returns[0].endDate, '2019-06-30');
});

test('the export carries the same figures as the screen', () => {
  const rows = usQuarterJourneyCsvRows(journey());
  assert.equal(rows[0][0], QUARTER);
  // six steps, and the state-returns step adds one row per permit
  assert.equal(rows.length, 7);
  const texas = rows.find(row => row[5] === 'TX 3200')!;
  assert.deepEqual([texas[6], texas[7], texas[8], texas[9]], ['2150.00', '1050.00', '1100.00', '90.75']);
  assert.equal(texas[10], '2026-10-20');
  assert.equal(texas[11], 'no');
  assert.ok(US_QUARTER_JOURNEY_CSV_HEADERS.includes('Tax collected'));
});

test('the journey’s document count is the return’s own count', () => {
  // an independent count of the quarter's counted Texas sales documents, worked by hand here:
  // i1, i4, i2, i6, i7 and the credit note c1 — six
  const counted = [...invoices, ...creditNotes].filter(d => {
    const date = String(d.date || '');
    return ['sent', 'applied'].includes(String(d.status)) && date >= '2026-07-01' && date <= '2026-09-30' && d.customerId !== 'la';
  });
  assert.equal(counted.length, 6);
  assert.equal(journey().steps.find(s => s.id === 'state-returns')!.returns[0].documentCount, counted.length);
});

test('AF-004 (#518): a US sale with no state is reported as a problem and the quarter is not ready to close', () => {
  const clean = journey();
  assert.equal(clean.problems.some(p => /no state/.test(p)), false);
  const withUnplaced = usQuarterJourney({
    quarter: QUARTER, today: TODAY, currency: 'USD', profiles, order: ['world'],
    customers: [...customers, { id: 'nowhere', metadata: { taxPlace: { country: 'US' } } }],
    invoices: [...invoices, doc('i-unplaced', 'nowhere', 10825, 825, [['Texas state sales tax', 825]])],
    creditNotes, bills, items, vendors, payments,
    periods: [{ month: '2026-07', state: 'soft' }, { month: '2026-08', state: 'soft' }],
  });
  const problem = withUnplaced.problems.find(p => /no state/.test(p));
  assert.equal(problem, "1 US sale has no state on the invoice or the customer, with 8.25 of tax: it is in no state's return. Add the state to the customer or the invoice.");
  assert.equal(withUnplaced.readyToClose, false);
  // the Texas figures are the same as without it: the sale was not guessed into Texas
  const stateFigures = (q: ReturnType<typeof journey>) => q.steps.flatMap(step => step.returns || []).map(r => [r.state, r.taxCollectedCents, r.documentCount]);
  assert.ok(stateFigures(clean).length > 0);
  assert.deepEqual(stateFigures(withUnplaced), stateFigures(clean));
});

test('AF-004 (#518): unplaced sales of two selling entities with their own permits are both counted, each once', () => {
  const two: TaxProfiles = {
    books: { place: { country: 'IL' }, registrations: [] },
    labels: {
      'world:tx': { place: { country: 'US', state: 'TX' }, registrations: [{ kind: 'sales_tax', number: '3200', place: { country: 'US', state: 'TX' } }] },
      'world:tx2': { place: { country: 'US', state: 'TX' }, registrations: [{ kind: 'sales_tax', number: '4400', place: { country: 'US', state: 'TX' } }] },
    },
  };
  const q = usQuarterJourney({
    quarter: QUARTER, today: TODAY, currency: 'USD', profiles: two, order: ['world'],
    customers: [{ id: 'nowhere', metadata: { taxPlace: { country: 'US' } } }],
    invoices: [
      doc('u1', 'nowhere', 10825, 825, [['Texas state sales tax', 825]]),
      doc('u2', 'nowhere', 10625, 625, [['Texas state sales tax', 625]], { dimensions: { world: 'tx2' } }),
    ],
    creditNotes: [], bills: [], items: [], vendors: [], payments: [], periods: [],
  });
  assert.equal(q.problems.find(p => /no state/.test(p)), "2 US sales have no state on the invoice or the customer, with 14.50 of tax: they are in no state's return. Add the state to the customer or the invoice.");
});

// #627: the certificate step reads the seller and the destination exactly as the state return does
const certStep = (invoice: UsSalesDocument, people = customers, taxProfiles = profiles) => usQuarterJourney({
  quarter: QUARTER, today: TODAY, profiles: taxProfiles, order: ['world'], customers: people,
  items: [{ id: 'digital', productTaxCategory: 'digital-goods' }, { id: 'plain', productTaxCategory: 'general' }],
  invoices: [invoice],
}).steps.find(s => s.id === 'certificates')!;
const caProfiles: TaxProfiles = {
  books: { place: { country: 'US', state: 'CA' }, registrations: [{ kind: 'sales_tax', number: 'CA-5555', place: { country: 'US', state: 'CA' } }] },
  labels: { 'world:il': { name: 'Israel branch', place: { country: 'IL' }, registrations: [{ kind: 'vat', number: '514000001', place: { country: 'IL' } }] } },
};

test('#627: moving the customer does not change a past sale’s certificate check (the saved destination decides)', () => {
  // digital goods are exempt in California and taxable in Texas; the sale was delivered in California
  const sale = (extra: Partial<UsSalesDocument>) => doc('z1', 'c1', 10000, 0, [], { date: '2026-07-10', dimensions: undefined, items: [{ itemId: 'digital' }], ...extra } as Partial<UsSalesDocument>);
  const saved = sale({ metadata: { taxPlace: { country: 'US', state: 'CA' } } });
  const inCa = [{ id: 'c1', metadata: { taxPlace: { country: 'US', state: 'CA' } } }];
  const movedToTx = [{ id: 'c1', metadata: { taxPlace: { country: 'US', state: 'TX' } } }];
  assert.equal(certStep(saved, inCa, caProfiles).status, 'not-applicable');
  assert.equal(certStep(saved, movedToTx, caProfiles).status, 'not-applicable', 'the customer moved; the sale did not');
  // the ship-to state decides when no place was saved
  assert.equal(certStep(sale({ shippingAddress: { state: 'CA' } } as Partial<UsSalesDocument>), movedToTx, caProfiles).status, 'not-applicable');
  // with nothing saved on the sale, the customer's place today is the only record: Texas. The books hold a
  // California permit only, so no state return counts this Texas sale and no certificate is asked for here (#644)
  assert.equal(certStep(sale({}), movedToTx, caProfiles).status, 'not-applicable');
  // with a Texas permit too, the Texas return counts it, and Texas taxes digital goods: the certificate is missing
  const caTx: TaxProfiles = { ...caProfiles, books: { ...caProfiles.books!, registrations: [...caProfiles.books!.registrations!, { kind: 'sales_tax', number: 'TX-1', place: { country: 'US', state: 'TX' } }] } };
  assert.equal(certStep(sale({}), movedToTx, caTx).figures.find(f => f.label === 'Certificate missing')!.count, 1);
  // no place anywhere: over the counter at the seller's own state (California: exempt by product)
  assert.equal(certStep(sale({}), [], caProfiles).status, 'not-applicable');
});

test('#627: a sale labelled on its first line for a branch with no US permit is not in the US certificate list', () => {
  const line = { itemId: 'plain', dimensions: { world: 'il' } };
  const branchSale = doc('z2', 'c1', 10000, 0, [], { date: '2026-07-10', dimensions: undefined, items: [line] } as Partial<UsSalesDocument>);
  assert.equal(certStep(branchSale, [], caProfiles).status, 'not-applicable');
  // the same sale with no label anywhere is the books' own sale and is counted
  const plain = doc('z3', 'c1', 10000, 0, [], { date: '2026-07-10', dimensions: undefined, items: [{ itemId: 'plain' }] } as Partial<UsSalesDocument>);
  assert.equal(certStep(plain, [], caProfiles).figures.find(f => f.label === 'Zero-tax sales')!.count, 1);
});

test('#627: a zero-tax sale delivered abroad is in no state, so it asks for no US certificate', () => {
  const exported = doc('z4', 'c1', 10000, 0, [], { date: '2026-07-10', dimensions: undefined, items: [{ itemId: 'plain' }], metadata: { taxPlace: { country: 'CA' } } } as Partial<UsSalesDocument>);
  assert.equal(certStep(exported, [], caProfiles).status, 'not-applicable');
});

