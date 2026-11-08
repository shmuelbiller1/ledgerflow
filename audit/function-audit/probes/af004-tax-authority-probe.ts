/**
 * AF-004 probe (AI #8, independent audit slice 4). Review-only evidence script; not a unit test.
 * Run at the pinned SHA:   npx tsx audit/function-audit/probes/af004-tax-authority-probe.ts
 * Each case prints OBSERVED vs EXPECTED. "DEFECT" = observed behaviour differs from the expected
 * contract stated in the source comments; "OK" = the control holds. Exit code is 0 on purpose: the
 * probe documents behaviour, it does not gate CI.
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

// ---- P3: a customer whose tax place has a country but no state is dropped without any trace (usSalesTaxReturn.ts:62-63)
{
  const profiles: TaxProfiles = { books };
  const customers = [{ id: 'c1', metadata: { taxPlace: { country: 'US' } } }];
  const invoice = { id: 'inv-us-1', date: '2026-07-10', status: 'paid', customerId: 'c1', amountCents: 10825, taxAmountCents: 825, taxVersion: 2, taxTreatment: 'standard' as const, taxBreakdown: [{ name: 'Texas state sales tax', rate: 0.0625, taxCents: 625 }, { name: 'Austin', rate: 0.02, taxCents: 200 }] };
  const r = usSalesTaxReturn({ registration: registrationKey(), profiles, order: ['world'], invoices: [invoice as never], customers, startDate: '2026-07-01', endDate: '2026-09-30' });
  report('AF-004-P3 TX sale with US place but no state is silently omitted', r.documentCount === 1,
    `expected the sale to be reported or flagged; observed documentCount=${r.documentCount}, taxCollectedCents=${r.taxCollectedCents}`);
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

// ---- P8: the US return reads doc.dimensions, but the screens keep entity labels on the first line
// (ilVatReturn.ts documentEntityLabels, CON-4b). The Texas permit return therefore ignores the entity label.
{
  const profiles: TaxProfiles = { books, labels: { 'world:il': { name: 'Acme Israel branch', place: { country: 'IL' }, registrations: [{ kind: 'vat', number: '514000000', place: { country: 'IL' }, validFrom: '2020-01-01' }] } } };
  const invoice = { id: 'inv-il-2', date: '2026-07-10', status: 'paid', items: [{ dimensions: { world: 'il' } }], amountCents: 10000, taxAmountCents: 0, taxVersion: 2, taxTreatment: 'standard' as const };
  const r = usSalesTaxReturn({ registration: 'sales_tax:US-TX:TX-1234', profiles, order: ['world'], invoices: [invoice as never], customers: [], startDate: '2026-07-01', endDate: '2026-09-30' });
  report('AF-004-P8 US return ignores first-line entity label', r.documentCount === 0,
    `Israeli-branch invoice (label on items[0]) counted in the Texas return: documentCount=${r.documentCount}`);
}

function registrationKey(): string { return 'sales_tax:US-TX:TX-1234'; }
