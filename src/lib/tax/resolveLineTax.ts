/**
 * The tax on one sale line (PLAN §6): who sells (the seller's resolved profile, from the line's
 * entity label or the books), where the buyer is, the date, the item's tax category and any
 * exemption certificate decide it. The answer names the registration the line belongs to, so each
 * return is built from its own lines.
 *
 * Rates come from tables with dated rows (`RateTables`); Israel's is built in, the US state and
 * local tables plug in as AI #3 and AI #5 deliver them. A place without a table answers
 * `no-rate-table`: nothing is guessed. Pure.
 */
import { ilVatAreaKeyFor, ilVatRateTable, isIlZeroArea } from './ilVat';
import { IL_VAT_STANDARD, rateOn } from './ilVatRates';
import { registrationKey, registrationsOn, type ResolvedProfile, type TaxPlace } from './profile';

export interface TaxComponent {
  /** country, state, county, city or district */
  level: 'country' | 'state' | 'county' | 'city' | 'district';
  name: string;
  rate: number;
}

export type LineTaxReason =
  | 'taxed'
  | 'exempt-certificate'   // the buyer has a good certificate (T-05)
  | 'export'               // sold to another country: zero-rated
  | 'zero-area'            // a zero-rated area (a sale into Eilat, the export areas, duty-free)
  | 'exempt-area'          // CON-3: made and used in Eilat by an Eilat dealer — exempt, not zero-rated
  | 'not-registered'       // no registration for the buyer's place on the date (no nexus in that state)
  | 'no-rate-table';       // the place has no table yet: nothing is guessed

export interface LineTax {
  reason: LineTaxReason;
  components: TaxComponent[];
  /** the sum of the components */
  rate: number;
  /** the registration (registrationKey) whose return the line belongs to, when there is one */
  registration?: string;
  /**
   * CON-3: how a 0% special-area line is reported. Zero-rated is a taxable sale at 0% (input VAT stays
   * reclaimable); exempt is not a taxable sale at all (no VAT and no input credit). Set only where the
   * law decides it here; otherwise the document's tax code says.
   */
  treatment?: 'zero_rated' | 'exempt';
  /**
   * CON-3 review: the special-area relief applies only when these conditions hold, and the books do not record them
   * (goods or services, who the buyer is, where the goods are used, the law's excluded goods). A screen offers the
   * relief as the user's choice, never as the expected tax; `ordinaryRate` is the rate when it does not apply.
   */
  conditions?: string;
  ordinaryRate?: number;
}

/** A US state's (or other) rates for a buyer's place, a date and an item category; none = no table. */
export type RateTable = (place: TaxPlace, date: string, category?: string) => TaxComponent[] | undefined;
export type RateTables = Partial<Record<string, RateTable>>;

// CON-3: Israel's table reads the special areas however the place is written (אילת, Eilat, EILAT, city or district)
export const builtInRateTables: RateTables = {
  IL: ilVatRateTable(),
};

// CON-3 review: when each relief applies (Eilat Free Trade Zone Law, 1985, s.5; the export areas as exports)
const IL_AREA_CONDITIONS: Record<string, string> = {
  eilat: 'goods sold to a dealer resident in Eilat for its business there (s.5(a)); services, sales to private buyers and goods on the law\'s excluded list are taxed at the ordinary rate',
  'eilat-local': 'the seller is a dealer resident in Eilat and the goods or services are supplied and used in Eilat (s.5(b), 5(e)); goods on the law\'s excluded list are taxed at the ordinary rate',
  'duty-free': 'a sale to a traveller leaving the country, with the travel document kept',
  export: 'the buyer is in the area and the documents the Tax Authority asks for are kept (treated as an export)',
};

/** CON-3: the Israeli special area (its table key) a place names, when it is one zero-rated on the date. */
const ilZeroAreaOf = (place: TaxPlace | null | undefined, date: string): string | undefined => {
  if (!place || (place.country || '').toUpperCase() !== 'IL') return undefined;
  const key = ilVatAreaKeyFor(place.district) ?? ilVatAreaKeyFor(place.city);
  return key && isIlZeroArea(key, date) ? key : undefined;
};

const total = (components: TaxComponent[]) => Math.round(components.reduce((s, c) => s + c.rate, 0) * 1e6) / 1e6;

export function resolveLineTax(input: {
  seller: ResolvedProfile;
  buyer?: TaxPlace | null;
  date: string;
  category?: string;
  exempt?: boolean;
  tables?: RateTables;
  /** for a place without its own table: usually the rule packs (`ruleRateTable`, PLAN §10) */
  fallback?: RateTable;
}): LineTax {
  const tables = { ...builtInRateTables, ...input.tables };
  const table = (key: string): RateTable | undefined => tables[key] || input.fallback;
  const sellerCountry = input.seller.place?.country;
  const buyer = input.buyer?.country ? input.buyer : input.seller.place;
  const none = (reason: LineTaxReason, registration?: string): LineTax => ({ reason, components: [], rate: 0, ...(registration ? { registration } : {}) });
  if (!sellerCountry || !buyer) return none('no-rate-table');

  if (sellerCountry === 'US') {
    // sales tax: only where the seller holds a permit for the buyer's state on the date (nexus)
    if (buyer.country !== 'US') return none('export');
    const permit = registrationsOn(input.seller, 'sales_tax', input.date).find(r => r.place.state === buyer.state);
    if (!permit) return none('not-registered');
    const key = registrationKey(permit);
    if (input.exempt) return none('exempt-certificate', key);
    const components = table(`US-${buyer.state}`)?.(buyer, input.date, input.category);
    if (!components) return none('no-rate-table', key);
    return { reason: 'taxed', components, rate: total(components), registration: key };
  }

  // VAT countries: the seller's VAT registration in its own country
  const vat = registrationsOn(input.seller, 'vat', input.date).find(r => r.place.country === sellerCountry);
  if (!vat) return none('not-registered');
  const key = registrationKey(vat);
  // an Israeli export is zero-rated (VAT Law s.30): a taxable sale at 0%, so it takes the zero-rated code, never the exempt one
  if (buyer.country !== sellerCountry) return sellerCountry === 'IL' ? { ...none('export', key), treatment: 'zero_rated' } : none('export', key);
  if (input.exempt) return none('exempt-certificate', key);
  const components = table(sellerCountry)?.(buyer, input.date, input.category);
  if (!components) return none('no-rate-table', key);
  const rate = total(components);
  const ilArea = sellerCountry === 'IL' && rate === 0 ? ilZeroAreaOf(buyer, input.date) : undefined;
  if (ilArea) {
    // Eilat Free Trade Zone Law s.5: a dealer resident in Eilat selling for use there is exempt (5(b), 5(e));
    // a sale into the area by a dealer from outside it is at the zero rate (5(a)). The other areas are exports.
    const exempt = ilArea === 'eilat' && ilZeroAreaOf(input.seller.place, input.date) === 'eilat';
    const relief = { registration: key, conditions: IL_AREA_CONDITIONS[exempt ? 'eilat-local' : ilArea] || IL_AREA_CONDITIONS.export, ordinaryRate: rateOn(IL_VAT_STANDARD, input.date)?.rate };
    return exempt
      ? { reason: 'exempt-area', components, rate, treatment: 'exempt', ...relief }
      : { reason: 'zero-area', components, rate, treatment: 'zero_rated', ...relief };
  }
  return { reason: rate === 0 && buyer.district ? 'zero-area' : 'taxed', components, rate, registration: key };
}

/**
 * The invoice's tax choice for a rate: the sales code with that rate (an exempt one for 0), else a custom rate in percent.
 * CON-3: with a `treatment` (a special-area line), 0% takes the code of exactly that treatment, so the VAT report
 * counts the sale as zero-rated or exempt as the law says; without such a code `missing` names the treatment
 * and no other 0% code is substituted (an exempt code would drop a zero-rated sale's input credit).
 */
export function taxChoiceFor<C>(rate: number, codes: Array<{ id: string; treatment?: string; components: C }>, effective: (components: C) => number, treatment?: 'zero_rated' | 'exempt'): { taxCodeId?: string; taxRate: number; missing?: 'zero_rated' | 'exempt' } {
  if (rate === 0 && treatment) {
    const exact = codes.find(c => c.treatment === treatment);
    return exact ? { taxCodeId: exact.id, taxRate: 0 } : { taxCodeId: undefined, taxRate: 0, missing: treatment };
  }
  const match = rate === 0 ? codes.find(c => c.treatment === 'exempt') || codes.find(c => effective(c.components) === 0) : codes.find(c => Math.abs(effective(c.components) - rate) < 1e-6);
  return match ? { taxCodeId: match.id, taxRate: 0 } : { taxCodeId: undefined, taxRate: Math.round(rate * 100000) / 1000 };
}
