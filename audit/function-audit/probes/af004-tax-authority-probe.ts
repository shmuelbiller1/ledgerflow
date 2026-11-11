/**
 * AF-004 probe (AI #8, independent audit slice 4). Review-only evidence script; not a unit test.
 * Run at the pinned SHA:   npx tsx audit/function-audit/probes/af004-tax-authority-probe.ts
 * Each case prints OBSERVED vs EXPECTED. "DEFECT" = observed behaviour differs from the expected
 * contract stated in the source comments; "OK" = the control holds. Exit code is 0 on purpose: the
 * probe documents behaviour, it does not gate CI.
 *
 * UPDATED 2026-11-11 (Agent #8) at upstream main `ec3ff49336c53eeed531a79ac32cc08d1574ec96`.
 * PR #614 (merged 2026-11-10T17:37Z) closed #517, #518 and #519 by rewriting `usSalesTaxReturn`, so
 * three of these cases had become STALE and were printing "DEFECT" for behaviour that is now correct:
 *   - P3 (#518): a US sale with no state is no longer counted in a state return; it is reported in the
 *     new `unplaced` figure. The expectation was rewritten to the new contract and the case is now a
 *     regression guard, not a defect claim.
 *   - P8 (#517): the return now reads the first line's entity label via `documentEntityLabels`; the case
 *     passes and is kept as a regression guard.
 *   - P2 was partly #519's; it is kept because it still fails for a different reason (see below).
 * Still failing, and NOT covered by any open issue: P1, P2, P4, P6, P7. P1/P2/P7 share one root cause in
 * `resolveSellerProfile` (profile.ts:98-99), which #614 did not change; P4 is now reproduced precisely,
 * with a non-vacuous control, in `af004-614-residual.ts` (R1/R2/R3).
 */
import { resolveSellerProfile, type TaxProfiles } from '../../../src/lib/tax/profile';
import { usSalesTaxReturn } from '../../../src/lib/tax/usSalesTaxReturn';
import { composeFacts, type FactSources } from '../../../src/lib/rules/facts';
import { usQuarterJourney } from '../../../src/lib/usQuarterJourney';
import { israelVatReturn } from '../../../src/lib/tax/ilVatReturn';

const TX = { kind: 'sales_tax' as const, number: 'TX-1234', place: { country: 'US', state: 'TX' }, filing: 'quarterly' as const, validFrom: '2020-01-01' };
const books = { name: 'Acme Texas LLC', place: { country: 'US', state: 'TX' }, registrations: [TX] };
const report = (id: string, ok: boolean, detail: string) => console.log(`${ok ? 'OK    ' : 'DEFECT'} ${id}: ${detail}`);

// ---- P1: a label profile's place merges field-by-field with a farther level's place (profile.ts:99)
{
  const profiles: TaxProfiles = { books, labels: { 'world:il': { name: 'Acme Israel branch', place: { country: 'IL' } } } };
  const seller = resolveSellerProfile(profiles, { world: 'il' }, ['world']);
  const observed = JSON.stringify(seller.place);
  report('AF-004-P1 place merge across countries', !(seller.place?.country === 'IL' && seller.place?.state === 'TX'),
    `expected place of an Israeli entity to carry no US state; observed ${observed} (from ${JSON.stringify(seller.from)})`);
}

// ---- P2: an Israeli-labelled sale with no customer place is counted in the Texas sales-tax return (usSalesTaxReturn.ts:62)
{
  const profiles: TaxProfiles = { books, labels: { 'world:il': { name: 'Acme Israel branch', place: { country: 'IL' } } } };
  const invoice = { id: 'inv-il-1', date: '2026-07-10', status: 'paid', dimensions: { world: 'il' }, amountCents: 10000, taxAmountCents: 0, taxVersion: 2, taxTreatment: 'standard' as const };
  const r = usSalesTaxReturn({ registration: registrationKey(), profiles, order: ['world'], invoices: [invoice as never], customers: [], startDate: '2026-07-01', endDate: '2026-09-30' });
  report('AF-004-P2 Israeli sale leaks into Texas return', r.documentCount === 0,
    `expected 0 documents in the Texas permit return; observed documentCount=${r.documentCount}, grossSalesCents=${r.grossSalesCents}`);
}

// ---- P3 (#518, FIXED by PR #614 — now a regression guard, not a defect claim).
// A US place with a country but no state is passed over (usSalesTaxReturn.ts:85-91) and the sale is reported
// in the new `unplaced` figure (usSalesTaxReturn.ts:92-101) instead of being silently dropped. The old
// expectation here was `documentCount === 1`, which is WRONG under the new contract: an unplaced sale must be
// in no state's return, so `documentCount` stays 0 and `unplaced` carries it. Left unchanged, this case
// printed "DEFECT" against a closed issue.
{
  const profiles: TaxProfiles = { books };
  const customers = [{ id: 'c1', metadata: { taxPlace: { country: 'US' } } }];
  const invoice = { id: 'inv-us-1', date: '2026-07-10', status: 'paid', customerId: 'c1', amountCents: 10825, taxAmountCents: 825, taxVersion: 2, taxTreatment: 'standard' as const, taxBreakdown: [{ name: 'Texas state sales tax', rate: 0.0625, taxCents: 625 }, { name: 'Austin', rate: 0.02, taxCents: 200 }] };
  const r = usSalesTaxReturn({ registration: registrationKey(), profiles, order: ['world'], invoices: [invoice as never], customers, startDate: '2026-07-01', endDate: '2026-09-30' });
  report('AF-004-P3 #518 guard: a US sale with no state is reported in `unplaced`, in no state return',
    r.documentCount === 0 && r.unplaced.documentCount === 1 && r.unplaced.netCents === 10000 && r.unplaced.taxCents === 825,
    `expected documentCount=0 with unplaced 1 doc / 10000 net / 825 tax; observed documentCount=${r.documentCount}, unplaced=${JSON.stringify({ ...r.unplaced, documents: r.unplaced.documents.length })}`);
}

// ---- P4: the same buyer rule, two implementations: a non-US buyer place (usQuarterJourney.ts:322 vs usSalesTaxReturn.ts:62).
// Runs the REAL usQuarterJourney on the same sale and reads its certificate worklist.
{
  const profiles: TaxProfiles = { books };
  const customers = [{ id: 'c2', metadata: { taxPlace: { country: 'CA', state: 'TX' } } }];
  const invoice = { id: 'inv-ca-1', date: '2026-07-10', status: 'paid', customerId: 'c2', amountCents: 10000, taxAmountCents: 0, taxVersion: 2, taxTreatment: 'zero_rated' as const };
  const sales = usSalesTaxReturn({ registration: 'sales_tax:US-TX:TX-1234', profiles, order: ['world'], invoices: [invoice as never], customers, startDate: '2026-07-01', endDate: '2026-09-30' });
  const quarter = usQuarterJourney({ quarter: '2026-Q3', today: '2026-11-05', profiles, order: ['world'], customers, invoices: [invoice as never] });
  const zeroTaxSales = JSON.stringify(quarter).match(/"label":"Zero-tax sales","count":(\d+)/)?.[1] ?? 'not found';
  report('AF-004-P4 non-US buyer: state return vs quarter journey disagree', !(sales.documentCount === 0 && zeroTaxSales === '1'),
    `usSalesTaxReturn documentCount=${sales.documentCount} for this Canadian buyer; real usQuarterJourney certificate step counts ${zeroTaxSales} zero-tax sale(s) to a US customer (seller state fallback)`);
}

// ---- P7: a US-labelled entity with no registrations inherits the books' Israeli VAT registration (profile.ts:98 + ilVatReturn belongsTo)
{
  const il = { kind: 'vat' as const, number: '514000000', place: { country: 'IL' }, filing: 'bimonthly' as const, validFrom: '2020-01-01' };
  const profiles: TaxProfiles = { books: { name: 'Acme Ltd', place: { country: 'IL' }, registrations: [il] }, labels: { 'world:us': { name: 'Acme US branch', place: { country: 'US', state: 'CA' } } } };
  const usDoc = { id: 'inv-us-9', date: '2026-07-10', status: 'paid', dimensions: { world: 'us' }, amountCents: 10000, taxAmountCents: 0, taxVersion: 2, taxTreatment: 'standard' as const };
  const r = israelVatReturn({ registration: 'vat:IL:514000000', profiles, order: ['world'], invoices: [usDoc as never], bills: [], startDate: '2026-07-01', endDate: '2026-08-31' });
  report('AF-004-P7 US branch sale lands in the Israeli VAT return', r.documentCount === 0,
    `expected 0 documents in the IL VAT return for a US-labelled sale; observed documentCount=${r.documentCount}, taxableSalesCents=${r.taxableSalesCents}`);
}

// ---- P5 (control): fact composition conflicts are reported, not silently chosen (facts.ts:123-127)
{
  const sources: FactSources = { labels: { 'world:us': [{ attribute: 'legalForm', value: 'llc' }], 'location:austin': [{ attribute: 'legalForm', value: 'corporation' }] } };
  const c = composeFacts(sources, { world: 'us', location: 'austin' }, ['world', 'location'], '2026-07-01');
  report('AF-004-P5 control: conflicting legalForm reported as conflict', c.conflicts.length === 1 && c.facts.legalForm?.values[0] === 'llc',
    `conflicts=${c.conflicts.length}, chosen=${c.facts.legalForm?.values[0]} (first dimension in order)`);
}

// ---- P6: a set-valued fact stated verified and declared with the same value is reported unverified (facts.ts:119-120)
{
  const sources: FactSources = { books: [
    { attribute: 'productCategory', value: 'groceries' },
    { attribute: 'productCategory', value: 'groceries', evidence: { kind: 'document', ref: 'cert-9', verifiedBy: 'A. Reviewer', verifiedAt: '2026-06-01' } },
  ] };
  const c = composeFacts(sources, {}, [], '2026-07-01');
  report('AF-004-P6 duplicate verified/declared set value stays unverified', c.facts.productCategory?.verified === true,
    `verified=${c.facts.productCategory?.verified} although a verified copy of the same value exists (conservative: a false negative, not an unsafe pass)`);
}

// ---- P8 (#517, FIXED by PR #614 — now a regression guard).
// The return reads the entity label the invoice screen actually saves: the first line's, else the document's
// (`documentEntityLabels`, usSalesTaxReturn.ts:78, shared with ilVatReturn.ts:54). This case passes at
// `ec3ff49`. NOTE: the quarter journey's certificate step was NOT updated with it and still reads
// `doc.dimensions` (usQuarterJourney.ts:327) — see af004-614-residual.ts R2.
{
  const profiles: TaxProfiles = { books, labels: { 'world:il': { name: 'Acme Israel branch', place: { country: 'IL' }, registrations: [{ kind: 'vat', number: '514000000', place: { country: 'IL' }, validFrom: '2020-01-01' }] } } };
  const invoice = { id: 'inv-il-2', date: '2026-07-10', status: 'paid', items: [{ dimensions: { world: 'il' } }], amountCents: 10000, taxAmountCents: 0, taxVersion: 2, taxTreatment: 'standard' as const };
  const r = usSalesTaxReturn({ registration: 'sales_tax:US-TX:TX-1234', profiles, order: ['world'], invoices: [invoice as never], customers: [], startDate: '2026-07-01', endDate: '2026-09-30' });
  report('AF-004-P8 #517 guard: the US return honours the first line\'s entity label', r.documentCount === 0,
    `expected the Israeli-branch invoice (label on items[0]) to be outside the Texas return; observed documentCount=${r.documentCount}`);
}

function registrationKey(): string { return 'sales_tax:US-TX:TX-1234'; }
