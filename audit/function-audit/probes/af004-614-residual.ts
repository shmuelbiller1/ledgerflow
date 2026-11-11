/**
 * AF-004 residual probe (Agent #8, 2026-11-11). Review-only evidence script; not a unit test.
 * Run at the pinned SHA:
 *   NODE_ENV=test npx tsx audit/function-audit/probes/af004-614-residual.ts
 *
 * Purpose: PR #614 (merged 2026-11-10T17:37Z) closed #517, #518 and #519 by rewriting
 * `usSalesTaxReturn`. It changed only `src/lib/tax/usSalesTaxReturn.ts` and `src/lib/usQuarterJourney.ts`'s
 * unplaced reporting. This probe re-runs the REAL libraries at this SHA and checks whether the two
 * consumers of the same quarter now agree.
 *
 * `src/lib/usQuarterJourney.ts` states its own contract twice:
 *   - file header: "Every figure is computed by the existing pure library the screen already uses, so
 *     the journey shows the same numbers that screen shows and no second rule is invented here"
 *   - lines 304-306: "The membership rule is the state return's own (counted status, the period, the
 *     seller's permit, the buyer's state with the seller's place as the over-the-counter fallback), so
 *     the two counts agree"
 *
 * Each case prints OBSERVED vs EXPECTED. "DEFECT" = observed differs from the contract the source
 * itself states. Exit code is 0 on purpose: the probe documents behaviour, it does not gate CI.
 */
import { usSalesTaxReturn } from '../../../src/lib/tax/usSalesTaxReturn';
import { usQuarterJourney } from '../../../src/lib/usQuarterJourney';
import { registrationKey, registrationsOn, resolveSellerProfile, type TaxProfiles } from '../../../src/lib/tax/profile';
import { resolveLineTax } from '../../../src/lib/tax/resolveLineTax';

const report = (id: string, ok: boolean, detail: string) =>
  console.log(`${ok ? 'OK    ' : 'DEFECT'} ${id}: ${detail}`);

const QUARTER = '2026-Q3';
const TODAY = '2026-11-11';
const START = '2026-07-01';
const END = '2026-09-30';

// A California books with its own CA sales-tax permit. Registration key per profile.ts:115.
const CA = {
  kind: 'sales_tax' as const,
  number: 'CA-5555',
  place: { country: 'US', state: 'CA' },
  filing: 'quarterly' as const,
  validFrom: '2020-01-01',
};
const CA_KEY = 'sales_tax:US-CA:CA-5555';
const books = { name: 'Acme California LLC', place: { country: 'US', state: 'CA' }, registrations: [CA] };
const profiles: TaxProfiles = { books };
const order = ['world'];

// A digital-goods item: exempt in California, taxable in Texas (verified against usProductTaxability.ts).
// A 'general' item: taxable in both, used where the product-exemption branch must not decide the outcome.
const items = [
  { id: 'item-dg', name: 'E-book licence', productTaxCategory: 'digital-goods' as const },
  { id: 'item-gen', name: 'Consulting widget', productTaxCategory: 'general' as const },
];

// The zero-tax sale as issued on 2026-07-10: destination snapshot (issue #255) says California, which is
// why charging no tax was correct there.
const issuedSnapshot = { country: 'US', state: 'CA' };
const invoice = {
  id: 'inv-dg-1',
  date: '2026-07-10',
  status: 'paid',
  customerId: 'c1',
  amountCents: 10000,
  taxAmountCents: 0,
  taxVersion: 2,
  taxTreatment: 'zero_rated' as const,
  metadata: { taxPlace: issuedSnapshot },
  items: [{ itemId: 'item-dg', description: 'E-book licence', quantity: 1, unitPriceCents: 10000, totalCents: 10000 }],
};

const certificateStep = (customers: Array<{ id: string; metadata?: unknown }>) => {
  const journey = usQuarterJourney({
    quarter: QUARTER, today: TODAY, profiles, order, customers,
    invoices: [invoice as never], items: items as never,
  });
  const step = (journey as unknown as { steps: Array<{ id: string; status: string; detail: string; figures?: Array<{ label: string; count: number }> }> })
    .steps.find(s => s.id === 'certificates');
  return { status: step?.status ?? 'missing', detail: step?.detail ?? '', figures: step?.figures ?? [] };
};

const stateReturn = (customers: Array<{ id: string; metadata?: unknown }>) =>
  usSalesTaxReturn({
    registration: CA_KEY, profiles, order, customers,
    invoices: [invoice as never], startDate: START, endDate: END,
  });

console.log('=== R1: #519 destination snapshot — state return vs the journey certificate step ===');
{
  const customerAtIssue = [{ id: 'c1', metadata: { taxPlace: { country: 'US', state: 'CA' } } }];
  const customerAfterMove = [{ id: 'c1', metadata: { taxPlace: { country: 'US', state: 'TX' } } }];

  const before = stateReturn(customerAtIssue);
  const after = stateReturn(customerAfterMove);
  report(
    'R1a #519 holds in usSalesTaxReturn',
    before.documentCount === 1 && after.documentCount === 1 && before.exemptSalesCents === after.exemptSalesCents,
    `the July California sale stays in the CA return after the customer moves: documentCount ${before.documentCount} -> ${after.documentCount}, exemptSalesCents ${before.exemptSalesCents} -> ${after.exemptSalesCents}`,
  );

  const stepBefore = certificateStep(customerAtIssue);
  const stepAfter = certificateStep(customerAfterMove);
  // The sale's destination is California both times, so the certificate step's answer must not change either.
  report(
    'R1b the journey certificate step honours the same saved destination',
    stepBefore.status === stepAfter.status && stepBefore.detail === stepAfter.detail,
    `customer in CA: status=${stepBefore.status} (${stepBefore.detail.slice(0, 120)}); ` +
      `customer moved to TX: status=${stepAfter.status} (${stepAfter.detail.slice(0, 120)}). ` +
      `The journey re-derives the buyer's state from the customer's place TODAY (usQuarterJourney.ts:330-331), ` +
      `so exemptByProduct is looked up in the wrong state's table.`,
  );

  // Product-exempt sales are counted in the return but excluded from the certificate worklist.
  report(
    'R1c product-exempt sale remains certificate-not-applicable after customer move',
    stepBefore.status === 'not-applicable' && stepAfter.status === 'not-applicable',
    `the CA return counts this sale as an exempt California sale in both cases (documentCount=${after.documentCount}); ` +
      `the certificate step says "${stepAfter.status}" once the customer moves, demanding a certificate the sale's own ` +
      `destination state never required.`,
  );
}

console.log('');
console.log('=== R2: #517 seller entity label — state return vs the journey certificate step ===');
{
  // The invoice screen saves the entity label on the FIRST LINE (usSalesTaxReturn.ts:10, #614). An Israeli
  // branch with its own VAT registration and no US permit must not be counted under the books' US permit.
  const ilVat = {
    kind: 'vat' as const,
    number: '514000000',
    place: { country: 'IL' },
    filing: 'monthly' as const,
    validFrom: '2020-01-01',
  };
  const labelledProfiles: TaxProfiles = {
    books,
    labels: { 'world:il': { name: 'Acme Israel Ltd', place: { country: 'IL' }, registrations: [ilVat] } },
  };
  // The line's item is 'general', taxable in BOTH California and Texas, so exemptByProduct cannot
  // short-circuit the loop: whether the sale is counted depends only on how the seller was resolved.
  // (Using the digital-goods item here would make this check pass for the wrong reason.)
  const labelledInvoice = {
    ...invoice,
    id: 'inv-il-line',
    metadata: { taxPlace: { country: 'US', state: 'CA' } },
    items: [{ itemId: 'item-gen', dimensions: { world: 'il' }, quantity: 1, unitPriceCents: 10000, totalCents: 10000 }],
  };
  const customers = [{ id: 'c1', metadata: { taxPlace: { country: 'US', state: 'CA' } } }];

  const ret = usSalesTaxReturn({
    registration: CA_KEY, profiles: labelledProfiles, order, customers,
    invoices: [labelledInvoice as never], startDate: START, endDate: END,
  });
  report(
    'R2a #517 holds in usSalesTaxReturn',
    ret.documentCount === 0,
    `the Israeli branch's sale is not in the California permit's return: documentCount=${ret.documentCount}`,
  );

  const journey = usQuarterJourney({
    quarter: QUARTER, today: TODAY, profiles: labelledProfiles, order, customers,
    invoices: [labelledInvoice as never], items: items as never,
  });
  const step = (journey as unknown as { steps: Array<{ id: string; status: string; detail: string; figures?: Array<{ label: string; count: number }> }> })
    .steps.find(s => s.id === 'certificates');
  const zeroTax = step?.figures?.find(f => f.label === 'Zero-tax sales')?.count ?? 0;
  // usQuarterJourney.ts:327 still reads doc.dimensions, which this invoice does not carry; it therefore falls
  // back to the books and counts the Israeli branch's sale in the US quarter's certificate worklist.
  report(
    'R2b the journey certificate step reads the same seller label',
    zeroTax === 0,
    `usSalesTaxReturn counts ${ret.documentCount} document(s) for this sale under the CA permit, but the journey's ` +
      `certificate step counts ${zeroTax} zero-tax US sale(s) — it resolves the seller from doc.dimensions ` +
      `(usQuarterJourney.ts:327) instead of documentEntityLabels (usSalesTaxReturn.ts:78, ilVatReturn.ts:54), ` +
      `so the first line's entity label is invisible to it.`,
  );

  // Control: the very same sale with no entity label anywhere belongs to the books, so it MUST be counted.
  // Without this the check above could pass vacuously (a step that counts nothing passes for any input).
  const unlabelledInvoice = {
    ...labelledInvoice,
    id: 'inv-books-line',
    items: [{ itemId: 'item-gen', quantity: 1, unitPriceCents: 10000, totalCents: 10000 }],
  };
  const control = usQuarterJourney({
    quarter: QUARTER, today: TODAY, profiles: labelledProfiles, order, customers,
    invoices: [unlabelledInvoice as never], items: items as never,
  });
  const controlStep = (control as unknown as { steps: Array<{ id: string; figures?: Array<{ label: string; count: number }> }> })
    .steps.find(s => s.id === 'certificates');
  const controlZeroTax = controlStep?.figures?.find(f => f.label === 'Zero-tax sales')?.count ?? 0;
  report(
    'R2c control: the same sale with no entity label IS counted (proves R2b is not vacuous)',
    controlZeroTax === 1,
    `unlabelled sale -> certificate step counts ${controlZeroTax} zero-tax US sale(s); ` +
      `first-line-labelled IL sale -> ${zeroTax}. Both are the same money, the same customer, the same date.`,
  );
}

console.log('');
console.log('=== R3: cross-country inheritance in resolveSellerProfile (never covered by #517/#518/#519) ===');
{
  // profile.ts:99 merges a place field-by-field across the whole chain, and profile.ts:98 lets a label with no
  // registrations inherit the books'. Neither line was touched by #614.
  const ilBranch: TaxProfiles = { books, labels: { 'world:il': { name: 'Acme Israel branch', place: { country: 'IL' } } } };
  const seller = resolveSellerProfile(ilBranch, { world: 'il' }, order);
  report(
    'R3a an Israeli entity does not inherit a US state',
    !(seller.place?.country === 'IL' && seller.place?.state === 'CA'),
    `resolveSellerProfile returned place ${JSON.stringify(seller.place)} from ${JSON.stringify(seller.from)}: ` +
      `the books' state survives into a different country (profile.ts:99).`,
  );

  const counterSale = {
    id: 'inv-il-counter', date: '2026-07-10', status: 'paid', dimensions: { world: 'il' },
    amountCents: 10000, taxAmountCents: 0, taxVersion: 2, taxTreatment: 'zero_rated' as const,
  };
  const ret = usSalesTaxReturn({
    registration: CA_KEY, profiles: ilBranch, order, customers: [],
    invoices: [counterSale as never], startDate: START, endDate: END,
  });
  report(
    'R3b an Israeli branch sale is not counted in a US state return',
    ret.documentCount === 0,
    `the IL-labelled over-the-counter sale inherits the books' CA permit (profile.ts:98) and the books' state via ` +
      `the merged place (profile.ts:99), so it lands in the California return: documentCount=${ret.documentCount}, ` +
      `grossSalesCents=${ret.grossSalesCents}. No open issue covers this: #517/#518/#519 were closed by #614, ` +
      `which did not change profile.ts.`,
  );
}

console.log('');
console.log('=== R3c: the repository\'s OWN tax-profile fixture, resolved at the level no test resolves ===');
{
  // Verbatim from src/tests/tax-profile.test.ts:9-21. That suite resolves 'world:us/texas' (a complete own
  // place) and 'location:eilat' (same country as the books), so the cross-country merge is never asserted
  // either way: it is untested, not intended.
  const fixture: TaxProfiles = {
    books: {
      name: 'Holding Ltd', place: { country: 'IL', city: 'Tel Aviv' }, basis: 'accrual',
      registrations: [{ kind: 'vat', number: '514000000', place: { country: 'IL' }, filing: 'bimonthly' }],
    },
    labels: {
      'world:us': { name: 'Acme US', place: { country: 'US' } },
      'world:us/texas': {
        name: 'Acme Texas LLC', place: { country: 'US', state: 'TX', city: 'Austin' },
        registrations: [
          { kind: 'sales_tax', number: '32000000001', place: { country: 'US', state: 'TX' }, filing: 'quarterly', validFrom: '2026-01-01' },
          { kind: 'employer', number: '12-3456789', place: { country: 'US' } },
        ],
      },
      'location:eilat': { place: { country: 'IL', city: 'Eilat', district: 'Eilat' } },
    },
  };
  const us = resolveSellerProfile(fixture, { world: 'us' }, ['world', 'location']);
  const usVat = registrationsOn(us, 'vat', '2026-07-10').map(registrationKey);
  report(
    'R3c "Acme US" is not situated in Tel Aviv and does not hold an Israeli VAT number',
    us.place?.city !== 'Tel Aviv' && usVat.length === 0,
    `resolveSellerProfile(world:us) -> place ${JSON.stringify(us.place)}, vat registrations ${JSON.stringify(usVat)} ` +
      `(from ${JSON.stringify(us.from)}). ilVatReturn.belongsTo matches on registrationKey, so an invoice labelled ` +
      `world=us is counted in the ISRAELI VAT return (see P7).`,
  );

  // The same leak one level down: a Texas LLC that records no city of its own.
  const noCity: TaxProfiles = {
    books: fixture.books,
    labels: { 'world:us/texas': { name: 'Acme Texas LLC', place: { country: 'US', state: 'TX' } } },
  };
  const tx = resolveSellerProfile(noCity, { world: 'us/texas' }, ['world']);
  report(
    'R3d a Texas entity with no own city does not inherit a foreign one',
    tx.place?.city !== 'Tel Aviv',
    `resolveSellerProfile(world:us/texas) -> place ${JSON.stringify(tx.place)}: the books' city survives into another ` +
      `country. This place is what Settings -> Tax profiles shows as the entity's inherited place, and what ` +
      `usSalesTaxReturn.ts:91 / usQuarterJourney.ts:331 use as the over-the-counter buyer-state fallback.`,
  );

  // Honest scoping: the leaked sub-country fields do NOT make the invoice suggest a wrong-country RATE,
  // because resolveLineTax branches on seller.place.country (resolveLineTax.ts:92-107) and `country` is
  // always the nearest level's own. Recorded so this finding is not over-claimed.
  const lineTax = resolveLineTax({ seller: us, date: '2026-07-10', fallback: undefined });
  report(
    'R3e scope control: the invoice rate suggestion is NOT wrong-country (resolveLineTax branches on country)',
    lineTax.reason === 'not-registered' || lineTax.reason === 'no-rate-table' || lineTax.rate === 0,
    `resolveLineTax for Acme US returned reason=${lineTax.reason} rate=${lineTax.rate}: the country is correct, so ` +
      `the harm is in the RETURNS (which match on registrationKey), not in the suggested rate.`,
  );
}
