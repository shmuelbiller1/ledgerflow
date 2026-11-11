/**
 * A Texas sales tax return (PLAN US-3), checked by hand. The Texas entity holds permit 3200; Q3 2026.
 *  i1 Austin customer: 1,000.00 + 82.50 tax (state 62.50, Austin 20.00)
 *  i2 Houston customer with a good resale certificate: 500.00, no tax → exempt
 *  i3 a California customer → not this return; i4 the Israeli books → not this return
 *  c1 credit to the Austin customer: 100.00 + 8.25 (state 6.25, Austin 2.00)
 *  → gross 1,400.00 · exempt 500.00 · taxable 900.00 · tax 74.25 · state 56.25, Austin 18.00
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { usSalesTaxReturn, type UsSalesDocument } from '../lib/tax/usSalesTaxReturn';
import { usQuarterJourney } from '../lib/usQuarterJourney';
import type { TaxProfiles } from '../lib/tax/profile';

const profiles: TaxProfiles = {
  books: { place: { country: 'IL' }, registrations: [{ kind: 'vat', number: '514000000', place: { country: 'IL' } }] },
  labels: { 'world:tx': { place: { country: 'US', state: 'TX' }, registrations: [{ kind: 'sales_tax', number: '3200', place: { country: 'US', state: 'TX' } }] } },
};
const tx = { world: 'tx' };
const doc = (id: string, customerId: string, amount: number, tax: number, parts: Array<[string, number]>, extra: Partial<UsSalesDocument> = {}): UsSalesDocument =>
  ({ id, date: '2026-08-10', status: 'sent', taxVersion: 2, amountCents: amount, taxAmountCents: tax, customerId, dimensions: tx, taxTreatment: tax ? 'standard' : 'out_of_scope',
     taxBreakdown: parts.map(([name, taxCents]) => ({ name, rate: 0, taxCents })), ...extra }) as UsSalesDocument;
const customers = [
  { id: 'austin', metadata: { taxPlace: { country: 'US', state: 'TX', city: 'Austin' } } },
  { id: 'houston', metadata: { taxPlace: { country: 'US', state: 'TX' }, taxExemption: { number: 'RESALE-1', expires: '2027-12-31' } } },
  { id: 'la', metadata: { taxPlace: { country: 'US', state: 'CA' } } },
];

test('the Texas permit\'s return for the quarter', () => {
  const r = usSalesTaxReturn({
    registration: 'sales_tax:US-TX:3200', profiles, order: ['world'], customers, startDate: '2026-07-01', endDate: '2026-09-30',
    invoices: [
      doc('i1', 'austin', 108250, 8250, [['Texas state sales tax', 6250], ['Austin', 2000]]),
      doc('i2', 'houston', 50000, 0, []),
      doc('i3', 'la', 100000, 0, []),
      doc('i4', 'austin', 118000, 18000, [], { dimensions: {} }),
      doc('i5', 'austin', 108250, 8250, [], { date: '2026-10-01' }),
    ],
    creditNotes: [doc('c1', 'austin', 10825, 825, [['Texas state sales tax', 625], ['Austin', 200]], { status: 'applied' })],
  });
  assert.equal(r.state, 'TX');
  assert.deepEqual([r.grossSalesCents, r.exemptSalesCents, r.taxableSalesCents, r.taxCollectedCents, r.documentCount], [140000, 50000, 90000, 7425, 3]);
  assert.deepEqual(r.byJurisdiction, [{ name: 'Austin', taxCents: 1800 }, { name: 'Texas state sales tax', taxCents: 5625 }]);
});

/**
 * AF-004 (issues #517, #518, #519), each with the issue's own figures: one Q3 sale of 100.00 net + 8.25 tax.
 * Texas books hold permit 3200; the Israeli entity (world:il) has its own VAT registration and no US permit.
 */
const txBooks: TaxProfiles = {
  books: { place: { country: 'US', state: 'TX' }, registrations: [{ kind: 'sales_tax', number: '3200', place: { country: 'US', state: 'TX' } }] },
  labels: { 'world:il': { place: { country: 'IL' }, registrations: [{ kind: 'vat', number: '514000000', place: { country: 'IL' } }] } },
};
const sale = (id: string, extra: Partial<UsSalesDocument> = {}): UsSalesDocument =>
  ({ id, date: '2026-08-10', status: 'sent', taxVersion: 2, amountCents: 10825, taxAmountCents: 825, customerId: 'buyer', taxTreatment: 'standard',
     taxBreakdown: [{ name: 'Texas state sales tax', rate: 0, taxCents: 825 }], ...extra }) as UsSalesDocument;
const txReturn = (invoices: UsSalesDocument[], buyerPlace: unknown, creditNotes: UsSalesDocument[] = []) => usSalesTaxReturn({
  registration: 'sales_tax:US-TX:3200', profiles: txBooks, order: ['world'], startDate: '2026-07-01', endDate: '2026-09-30',
  customers: [{ id: 'buyer', metadata: buyerPlace === undefined ? {} : { taxPlace: buyerPlace } }], invoices, creditNotes,
});
const figures = (r: ReturnType<typeof txReturn>) => [r.documentCount, r.grossSalesCents, r.taxCollectedCents];
const TX = { country: 'US', state: 'TX' };
const OK = { country: 'US', state: 'OK' };

test('#519: a sale keeps the destination saved on it when the customer later moves (TX → OK)', () => {
  assert.deepEqual(figures(txReturn([sale('s1', { metadata: { taxPlace: TX } })], TX)), [1, 10000, 825]);
  // the customer now lives in Oklahoma; the issued invoice still records Texas
  assert.deepEqual(figures(txReturn([sale('s1', { metadata: { taxPlace: TX } })], OK)), [1, 10000, 825]);
  // and the other way round: a sale issued to Oklahoma does not enter Texas because the customer moved to Texas
  assert.deepEqual(figures(txReturn([sale('s2', { metadata: { taxPlace: OK } })], TX)), [0, 0, 0]);
});

test('#519: an older sale with no saved destination still follows the customer (the legacy fallback); ship-to comes before the customer', () => {
  assert.deepEqual(figures(txReturn([sale('s1')], TX)), [1, 10000, 825]);
  assert.deepEqual(figures(txReturn([sale('s1')], OK)), [0, 0, 0]);
  assert.deepEqual(figures(txReturn([sale('s1', { shippingAddress: { country: 'US', state: 'TX' } })], OK)), [1, 10000, 825]);
});

test('#519: a credit note follows its invoice\'s destination, so it reduces the same state after the customer moves', () => {
  const invoice = sale('s1', { metadata: { taxPlace: TX } });
  const credit = sale('c1', { status: 'applied', invoiceId: 's1', amountCents: 2165, taxAmountCents: 165, taxBreakdown: [{ name: 'Texas state sales tax', rate: 0, taxCents: 165 }] });
  const r = txReturn([invoice], OK, [credit]);
  assert.deepEqual(figures(r), [2, 8000, 660]);
  assert.deepEqual(r.byJurisdiction, [{ name: 'Texas state sales tax', taxCents: 660 }]);
});

test('#517: the entity label on the first line decides the seller — the Israeli entity\'s sale is not in the Texas books\' return', () => {
  // exactly as the invoice screen saves it: the label is on items[0], not on the document
  assert.deepEqual(figures(txReturn([sale('s1', { items: [{ dimensions: { world: 'il' } }] })], TX)), [0, 0, 0]);
  // the same label on the document itself (older documents) is excluded too, and an unlabelled sale is the books'
  assert.deepEqual(figures(txReturn([sale('s1', { dimensions: { world: 'il' } })], TX)), [0, 0, 0]);
  assert.deepEqual(figures(txReturn([sale('s1', { items: [{}] })], TX)), [1, 10000, 825]);
  // the first line wins over a different document-level label
  assert.deepEqual(figures(txReturn([sale('s1', { items: [{ dimensions: { world: 'il' } }], dimensions: {} })], TX)), [0, 0, 0]);
});

test('#518: a US sale with no state is in no return and is counted as unplaced, never guessed into Texas', () => {
  const US = { country: 'US' };
  const r = txReturn([sale('s1', { metadata: { taxPlace: US } })], US);
  assert.deepEqual(figures(r), [0, 0, 0]);
  assert.deepEqual(r.unplaced, { documentCount: 1, netCents: 10000, taxCents: 825, documents: [{ id: 'invoice:s1', netCents: 10000, taxCents: 825 }] });
  // state missing on the customer only (no snapshot on the sale): the same
  assert.deepEqual([txReturn([sale('s1')], US).unplaced.documentCount, txReturn([sale('s1')], US).unplaced.taxCents], [1, 825]);
});

test('#518: an incomplete saved place does not trap the sale — adding the state to the customer or the ship-to places it', () => {
  const US = { country: 'US' };
  const stuck = sale('s1', { metadata: { taxPlace: US } });
  // the customer's state was added afterwards: the sale is now in Texas, and no longer unplaced
  const fixedOnCustomer = txReturn([stuck], TX);
  assert.deepEqual([...figures(fixedOnCustomer), fixedOnCustomer.unplaced.documentCount], [1, 10000, 825, 0]);
  // or the ship-to state on the invoice
  const fixedOnInvoice = txReturn([sale('s1', { metadata: { taxPlace: US }, shippingAddress: { country: 'US', state: 'TX' } })], US);
  assert.deepEqual([...figures(fixedOnInvoice), fixedOnInvoice.unplaced.documentCount], [1, 10000, 825, 0]);
  // a complete saved place still wins over the customer's place today (#519 is unchanged)
  assert.deepEqual(figures(txReturn([sale('s1', { metadata: { taxPlace: TX } })], OK)), [1, 10000, 825]);
});

test('#518: what is not unplaced — a sale abroad, a counter sale with no place anywhere, and a complete one', () => {
  // a foreign customer: in no state and not a missing state
  const abroad = txReturn([sale('s1')], { country: 'IL' });
  assert.deepEqual([...figures(abroad), abroad.unplaced.documentCount], [0, 0, 0, 0]);
  // nothing recorded on the sale or the customer: an over-the-counter sale at the seller's own place (Texas)
  const counter = txReturn([sale('s1')], undefined);
  assert.deepEqual([...figures(counter), counter.unplaced.documentCount], [1, 10000, 825, 0]);
  // no customer at all: the same
  const walkIn = txReturn([sale('s1', { customerId: undefined })], undefined);
  assert.deepEqual([...figures(walkIn), walkIn.unplaced.documentCount], [1, 10000, 825, 0]);
  const complete = txReturn([sale('s1', { metadata: { taxPlace: TX } })], TX);
  assert.equal(complete.unplaced.documentCount, 0);
});

test('#613 review: the certificate check finds the seller the same way the return does (first-line label)', () => {
  // the books hold only an Israeli VAT number; the Texas entity holds permit 3200. One Q3 exempt sale of 400.00,
  // no tax, to a Texas customer with no certificate, labelled Texas on its first line only (as the invoice screen saves it)
  const dallas = [...customers, { id: 'dallas', metadata: { taxPlace: { country: 'US', state: 'TX' } } }];
  const sale = doc('ex1', 'dallas', 40000, 0, [], { dimensions: undefined, taxTreatment: 'exempt', items: [{ dimensions: tx }] });
  const q = usQuarterJourney({ quarter: '2026-Q3', today: '2026-10-05', profiles, order: ['world'], customers: dallas, invoices: [sale], creditNotes: [] });
  const step = q.steps.find(s => s.id === 'certificates')!;
  assert.equal(step.status, 'attention');
  assert.deepEqual(step.figures, [
    { label: 'Zero-tax sales', count: 1 },
    { label: 'Certificate missing', count: 1 },
    { label: 'Certificate expired', count: 0 },
  ]);
});
