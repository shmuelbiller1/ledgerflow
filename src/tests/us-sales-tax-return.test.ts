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

test('#517: the seller is the first line\'s entity label, as the invoice screen saves it', () => {
  // the books hold Texas permit 3200; the Israeli entity has its own VAT number and no US permit
  const books: TaxProfiles = {
    books: { place: { country: 'US', state: 'TX' }, registrations: [{ kind: 'sales_tax', number: '3200', place: { country: 'US', state: 'TX' } }] },
    labels: { 'world:il': { place: { country: 'IL' }, registrations: [{ kind: 'vat', number: '514000000', place: { country: 'IL' } }] } },
  };
  const run = (invoices: UsSalesDocument[]) => usSalesTaxReturn({ registration: 'sales_tax:US-TX:3200', profiles: books, order: ['world'], customers, startDate: '2026-07-01', endDate: '2026-09-30', invoices });
  // Q3 sale: 100.00 + 8.25 tax to the Austin customer
  const sale = (id: string, extra: Partial<UsSalesDocument>) => doc(id, 'austin', 10825, 825, [['Texas state sales tax', 825]], { dimensions: undefined, ...extra });
  assert.equal(run([sale('line-il', { items: [{ dimensions: { world: 'il' } }] })]).documentCount, 0, 'the Israeli entity\'s sale (label on the line) is not on the Texas books\' return');
  assert.equal(run([sale('doc-il', { dimensions: { world: 'il' } })]).documentCount, 0, 'an older document-level label still counts');
  const own = run([sale('unlabelled', { items: [{ dimensions: {} }] })]);
  assert.equal(own.documentCount, 1, 'an unlabelled sale is the books\' own');
  assert.equal(own.taxableSalesCents, 10000);
  assert.equal(own.taxCollectedCents, 825);
});

test('#518: a sale to a US customer with no state is named, not dropped or guessed', () => {
  const nostate = [...customers, { id: 'us-nostate', metadata: { taxPlace: { country: 'US' } } }];
  // Q3 sale of 100.00 + 8.25 tax by the Texas entity to a US customer whose state is unknown
  const sale = doc('ns1', 'us-nostate', 10825, 825, [['Texas state sales tax', 825]]);
  const r = usSalesTaxReturn({ registration: 'sales_tax:US-TX:3200', profiles, order: ['world'], customers: nostate, startDate: '2026-07-01', endDate: '2026-09-30', invoices: [sale] });
  assert.equal(r.documentCount, 0, 'not put in Texas by guess');
  assert.equal(r.taxCollectedCents, 0);
  assert.deepEqual(r.unknownStateDocumentIds, ['ns1']);
  const q = usQuarterJourney({ quarter: '2026-Q3', today: '2026-10-05', profiles, order: ['world'], customers: nostate, invoices: [sale], creditNotes: [] });
  assert.ok(q.problems.includes("1 sale to a US customer with no state is in no state's return; add the customer's state."), q.problems.join(' | '));
  assert.equal(q.readyToClose, false);
  // a foreign customer is not a missing state
  const foreign = [...customers, { id: 'uk', metadata: { taxPlace: { country: 'GB' } } }];
  assert.deepEqual(usSalesTaxReturn({ registration: 'sales_tax:US-TX:3200', profiles, order: ['world'], customers: foreign, startDate: '2026-07-01', endDate: '2026-09-30', invoices: [doc('uk1', 'uk', 10000, 0, [])] }).unknownStateDocumentIds, []);
});
