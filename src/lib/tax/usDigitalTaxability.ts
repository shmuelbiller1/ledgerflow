/**
 * A-42 (PLAN US-1/US-3): the digital-product side of A-31 — for every state and DC, whether
 * **SaaS**, a **digital download** and **streaming** are reached by the state's tax, each dated with
 * a source and the day it was checked.
 *
 * Why a separate table: A-30's item categories carry one value per item, and a customer's movie
 * stream and a software subscription can sit in the same shop. A-31 answers the coarse question
 * ("digital goods"); several states answer a download and a stream differently, so the answer is
 * kept here per form, and `digitalFormMismatches()` lists the states where a rule keyed only on the
 * item's category would be wrong. The state's published answer is what a row records; where sources
 * of the state's own guidance do not agree, the row is `unclear` and the tool asks a person
 * (PLAN §5), never guesses.
 *
 * What this is: a calculation-stage table. What it is not: a rate, a rule, or a filing position. The
 * download rows are the same answers A-31's `digital-goods` rows hold (one list, so the two cannot
 * drift); the SaaS and streaming rows are new. A-31's SaaS rows read this table, so the state's
 * answer reaches the rule graph once, here. A rate a state charges on a reduced base or through a
 * different tax (Texas' data-processing base, Florida's communications services tax) is stated in
 * `note` and the row is `unclear`: a percentage of the wrong base is worse than a question.
 */
import { US_STATE_SALES_TAX } from './usStateSalesTax';
// type-only: A-31 imports this module's answers, so this file must not read it at run time
import type { TaxTreatment } from './usProductTaxability';

/**
 * The states whose tax reaches a downloaded copy. This is the same list A-31's `digital-goods` rows
 * are built from — it lives here so both tables read one list and cannot drift.
 */
export const DIGITAL_GOODS_TAXABLE_STATES = ['AZ', 'CO', 'CT', 'DC', 'GA', 'HI', 'IA', 'ID', 'IL', 'IN', 'KY', 'LA', 'MA', 'MD', 'ME', 'MI', 'MN', 'MS', 'NE', 'NJ', 'NM', 'NY', 'OH', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'WA', 'WI'];

export type DigitalSubtype = 'saas' | 'digital-downloads' | 'streaming';

export const DIGITAL_SUBTYPES: DigitalSubtype[] = ['saas', 'digital-downloads', 'streaming'];

export const DIGITAL_SUBTYPE_LABELS: Record<DigitalSubtype, string> = {
  saas: 'Software as a service (SaaS)',
  'digital-downloads': 'Digital downloads',
  streaming: 'Streaming',
};

export interface UsDigitalTaxabilityRow {
  state: string;
  subtype: DigitalSubtype;
  treatment: TaxTreatment;
  /** for a reduced rate: the state part, as a fraction (no such row is written today) */
  rate?: number;
  source: string;
  validFrom: string;
  checked: string;
  note?: string;
}

const CHECKED = '2026-10-12';
/** The date the answers below are asserted from — not each law's own effective date, which the note names. */
const VALID_FROM = '2026-01-01';
const NO_STATE_TAX_NOTE = 'no state sales tax; a local jurisdiction may still tax this — confirm locally';

/** SaaS is reached by the state's tax (several of these tax a business subscription differently — see the note). */
/** Texas reached it through a data-processing service, not a sale of the subscription: it is left unclear (see its note). */
const SAAS_TAXABLE = ['AL', 'AZ', 'CT', 'DC', 'HI', 'KY', 'LA', 'MA', 'MD', 'NM', 'NY', 'OH', 'PA', 'RI', 'SC', 'SD', 'TN', 'UT', 'VT', 'WA', 'WV'];
/** The state's own guidance keeps a hosted subscription out of its tax. */
const SAAS_EXEMPT = ['AR', 'CA', 'CO', 'FL', 'GA', 'ID', 'IL', 'IN', 'KS', 'ME', 'MI', 'MN', 'MO', 'NE', 'NJ', 'NC', 'NV', 'OK', 'VA', 'WI', 'WY'];

const SAAS_NOTES: Partial<Record<string, string>> = {
  CT: 'a business subscription is taxed at 1%, personal use at the general rate (Special Notice 2019(8)); confirm which applies',
  HI: 'reached through the general excise tax, which applies to the seller’s gross income, not a sales tax added to the invoice',
  IA: 'the published answers differ on whether a subscription used for business is exempt; confirm the use before deciding',
  IL: 'the state does not tax it; Chicago adds its own tax on some cloud services — confirm the place of use',
  MD: 'commercial use is taxed at 3% from 1 Jul 2025 (with data processing and hosting); consumer use at the general rate — confirm the buyer',
  ME: 'exempt while the subscriber only reaches the application online without downloading it; a download is a different answer',
  MI: 'a subscription used online is not taxed; a downloaded copy is a different answer',
  MS: 'the published answers disagree; confirm with the state before deciding',
  ND: 'no statute names it; the administrative position is that it is not taxed — confirm',
  OH: 'taxed for business use, not for personal use (Ohio Rev. Code §5739.01(Y)(1)(c)); confirm the use',
  SC: 'reached as a communications service rather than as software; confirm the classification',
  TX: 'reached as a data processing service with an 80% taxable base (34 Tex. Admin. Code §3.330); the base is not the invoice amount',
  VT: 'the exemption for it was repealed from 1 Jul 2024',
  WA: 'reached as a digital automated service (RCW 82.04.192)',
  CO: 'the state does not tax it; home-rule cities may tax it — confirm the place of use',
  CA: 'not tangible personal property and not an enumerated service; confirm the product rather than the label',
  FL: 'not reached by the state sales tax; the communications services tax applies to some providers instead',
  GA: 'the state does not tax a hosted subscription; a permanent right of use is a different answer',
};

/** Streaming is reached by the state's tax (a different tax on the provider is named in the note). */
const STREAMING_TAXABLE = ['AL', 'CO', 'CT', 'DC', 'IA', 'LA', 'MD', 'ME', 'MN', 'MS', 'NC', 'NE', 'OH', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'WA', 'WI', 'WV', 'WY'];
/** The state's own guidance keeps a stream (a temporary right of use) out of its sales tax. */
const STREAMING_EXEMPT = ['CA', 'FL', 'GA', 'ID', 'IL', 'IN', 'MI', 'MO', 'NJ', 'NY', 'VA'];
/** The state taxes streaming from this date (the row is not asserted for periods before it). */
const STREAMING_FROM: Partial<Record<string, string>> = { ME: '2026-01-01', UT: '2026-07-01' };

const STREAMING_NOTES: Partial<Record<string, string>> = {
  FL: 'the state sales tax does not reach it; the communications services tax applies to providers — a different tax, reported by the provider',
  GA: 'taxed only with a permanent right of use, which a subscription does not give',
  ID: 'taxed only with a permanent right of use, which a subscription does not give',
  IL: 'the state does not tax it; Chicago adds its own amusement tax on streamed entertainment — confirm the place of use',
  IN: 'taxed only with a permanent right of use, which a subscription does not give',
  KY: 'a separate telecommunications tax applies to the provider rather than sales tax on the subscription; confirm before charging it here',
  ME: 'taxed from 1 Jan 2026 (digital audio-visual and audio works)',
  MD: 'the 2025 expansion of digital products reaches it; confirm the product with the state',
  UT: 'taxed from 1 Jul 2026 (Senate Bill 162): access to streamed audio-visual and audio works, even without a download',
  LA: 'the state confirmed streaming services as taxable in August 2025; earlier periods need their own answer',
  NY: 'streamed audio-visual works are not in the state’s taxable digital products; prewritten software and information services are taxed — confirm the product',
  HI: 'the general excise tax reaches most business income, but the streaming answer is not established here — confirm',
  NM: 'the gross receipts tax reaches most services; the streaming answer is not established here — confirm',
  AR: 'some published answers tax digital products here and others do not; confirm with the state',
  AZ: 'a download is taxed; whether a stream is has been answered differently — confirm',
  MA: 'most electronically delivered products are not taxed, but the streaming answer is not established here — confirm',
  NV: 'published answers disagree on a temporary right of use; confirm with the state',
  OK: 'electronically delivered software is exempt; whether a stream is reached is not established here — confirm',
  ND: 'no specified digital product is taxed, but the streaming answer is not established here — confirm',
};

const sourceFor = (state: string) => US_STATE_SALES_TAX.find(r => r.state === state)?.source || '';

const treatmentOf = (state: string, taxable: string[], exempt: string[]): TaxTreatment =>
  taxable.includes(state) ? 'taxable' : exempt.includes(state) ? 'exempt' : 'unclear';

function build(): UsDigitalTaxabilityRow[] {
  const rows: UsDigitalTaxabilityRow[] = [];
  for (const state of US_STATE_SALES_TAX) {
    const code = state.state;
    const source = sourceFor(code);
    const noStateTax = state.rate === 0;
    // downloads: A-31's own list, so the two tables can never disagree about a downloaded copy
    const downloads: TaxTreatment = noStateTax ? 'unclear' : DIGITAL_GOODS_TAXABLE_STATES.includes(code) ? 'taxable' : 'exempt';
    const saas: TaxTreatment = noStateTax ? 'unclear' : treatmentOf(code, SAAS_TAXABLE, SAAS_EXEMPT);
    const streaming: TaxTreatment = noStateTax ? 'unclear' : treatmentOf(code, STREAMING_TAXABLE, STREAMING_EXEMPT);
    const answers: Array<[DigitalSubtype, TaxTreatment]> = [['saas', saas], ['digital-downloads', downloads], ['streaming', streaming]];
    for (const [subtype, treatment] of answers) {
      const note = [
        subtype === 'saas' ? SAAS_NOTES[code] : undefined,
        subtype === 'streaming' ? STREAMING_NOTES[code] : undefined,
        treatment === 'unclear' && noStateTax ? NO_STATE_TAX_NOTE : undefined,
        treatment === 'unclear' && !noStateTax && !(subtype === 'saas' ? SAAS_NOTES[code] : STREAMING_NOTES[code])
          ? 'the published answers do not agree; confirm with the state before relying on it' : undefined,
        treatment === 'exempt' && subtype === 'digital-downloads' ? 'the state’s tax does not reach a downloaded copy' : undefined,
      ].filter(Boolean).join('; ');
      rows.push({
        state: code, subtype, treatment,
        source, validFrom: subtype === 'streaming' ? STREAMING_FROM[code] || VALID_FROM : VALID_FROM,
        checked: CHECKED,
        ...(note ? { note } : {}),
      });
    }
  }
  return rows;
}

/** 51 jurisdictions (50 states + DC) × 3 forms, one dated row each. */
export const US_DIGITAL_TAXABILITY: UsDigitalTaxabilityRow[] = build();

/** The rows for one state (and one form, when asked). */
export function digitalTaxabilityRows(state: string, subtype?: DigitalSubtype): UsDigitalTaxabilityRow[] {
  const code = state.toUpperCase();
  return US_DIGITAL_TAXABILITY.filter(r => r.state === code && (!subtype || r.subtype === subtype));
}

/** The row for one form in one state; undefined when the state is not in the table at all. */
export function digitalTreatment(state: string, subtype: DigitalSubtype): UsDigitalTaxabilityRow | undefined {
  return digitalTaxabilityRows(state, subtype)[0];
}

/** True only when the state's published answer is that this form is not reached by its tax. */
export function digitalIsExempt(state: string, subtype: DigitalSubtype): boolean {
  return digitalTreatment(state, subtype)?.treatment === 'exempt';
}

/** True only when the state's published answer is that this form is taxed. */
export function digitalIsTaxed(state: string, subtype: DigitalSubtype): boolean {
  return digitalTreatment(state, subtype)?.treatment === 'taxable';
}

/**
 * The states where a download and a stream are answered differently — the places where an item that
 * carries only A-30's `digital-goods` category would be decided wrongly for one of the two forms.
 * Exported so a screen or a review can list them instead of the difference staying invisible.
 */
export function digitalFormMismatches(): Array<{ state: string; downloads: TaxTreatment; streaming: TaxTreatment; note?: string }> {
  return US_STATE_SALES_TAX.flatMap(({ state }) => {
    const downloads = digitalTreatment(state, 'digital-downloads')?.treatment;
    const streaming = digitalTreatment(state, 'streaming')?.treatment;
    if (!downloads || !streaming || downloads === streaming) return [];
    return [{ state, downloads, streaming, ...(digitalTreatment(state, 'streaming')?.note ? { note: digitalTreatment(state, 'streaming')!.note } : {}) }];
  });
}
