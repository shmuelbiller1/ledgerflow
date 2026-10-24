/**
 * A-75 + A-76: dated rate tables per country with their sources, for the expense claim's mileage
 * and per-diem lines. The claim still records the rate the person types (expenseClaims.ts); these
 * tables only suggest the rate that was in force on the claim's date, so the suggestion can never
 * be a made-up number — every row names the authority's own page and the day it was read.
 *
 * Mileage (A-75): the US business standard mileage rate (A-108's IRS table, the single source of
 * truth for the US) and the UK's HMRC approved mileage allowance payments (AMAP). Rates are per
 * mile in the row's own currency; a per-mile row never fills a per-kilometre line — no conversion
 * is invented here. The UK cars-and-vans rate has a yearly 10,000-mile tier the claim line does
 * not carry, so the row's note words it and the suggestion says the claim records one rate.
 *
 * Per diem (A-76): the US GSA standard CONUS meals-and-incidental (M&IE) daily rate (lodging is
 * separate; first and last travel day are 75%) and the UK HMRC benchmark scale full-day rate (the
 * £5/£10 meal tiers are in the note). Locality tables and the GSA file import (A-107) are
 * separate later work; rows outside these countries and dates are left absent on purpose — the
 * screen then says to type the rate.
 *
 * Status is 'calculation' throughout: reference rows for a claim suggestion, not a filing, a tax
 * calculation or a decision that a trip is deductible.
 */
import { US_MILEAGE_RATES } from './usMileageRates';

export type RateCountry = 'US' | 'GB';
export type VehicleKind = 'car' | 'motorcycle' | 'bicycle';

export interface RateSource {
  authority: string;
  url: string;
  /** the day the row was read from the authority's page (YYYY-MM-DD) */
  retrieved: string;
  status?: 'calculation';
}

export interface MileageRateRow {
  country: RateCountry;
  vehicle: VehicleKind;
  /** the distance unit the rate is quoted in: a row never fills a line in the other unit */
  unit: 'mi' | 'km';
  currency: string;
  /** thousandths of the currency unit per distance unit: 450 = £0.45, 655 = $0.655 */
  rateThousandths: number;
  /** first day this rate was in force (YYYY-MM-DD) */
  validFrom: string;
  validTo?: string;
  source: RateSource;
  /** tiers or conditions the authority words them, kept beside the rate */
  note?: string;
}

export interface PerDiemRow {
  country: RateCountry;
  /** what the daily allowance covers in the authority's own words */
  area: string;
  currency: string;
  /** the daily allowance in whole cents of `currency` */
  dailyCents: number;
  validFrom: string;
  validTo?: string;
  source: RateSource;
  note?: string;
}

const HMRC_MILEAGE = 'https://www.gov.uk/government/publications/rates-and-allowances-travel-mileage-and-fuel-allowances/travel-mileage-and-fuel-rates-and-allowances';
const GSA_PER_DIEM = 'https://www.gsa.gov/travel/plan-a-trip/per-diem-rates';
const HMRC_SUBSISTENCE = 'https://www.gov.uk/hmrc-internal-manuals/employment-income-manual/eim05231';
const CHECKED = '2026-10-21';

/** A-75: the mileage rows. The US rows are A-108's IRS table wrapped per country (one source of truth). */
export const MILEAGE_RATE_ROWS: MileageRateRow[] = [
  ...US_MILEAGE_RATES.map((r): MileageRateRow => ({
    country: 'US', vehicle: 'car', unit: 'mi', currency: 'USD',
    rateThousandths: r.rateThousandths,
    validFrom: r.validFrom,
    ...(r.validTo ? { validTo: r.validTo } : {}),
    source: { authority: r.source.authority, url: r.source.url, retrieved: r.source.retrieved, status: 'calculation' },
    ...(r.note ? { note: `${r.note} (business rate; medical, moving and charitable rates differ)` } : {}),
  })),
  // HMRC approved mileage allowance payments (AMAP): cars and vans, 45p until the 2026 change.
  {
    country: 'GB', vehicle: 'car', unit: 'mi', currency: 'GBP', rateThousandths: 450,
    validFrom: '2011-04-06', validTo: '2026-04-05',
    source: { authority: 'HM Revenue & Customs', url: HMRC_MILEAGE, retrieved: CHECKED, status: 'calculation' },
    note: '45p per mile for the first 10,000 business miles in the tax year, 25p for each mile after; 5p per mile for each fellow employee carried',
  },
  {
    country: 'GB', vehicle: 'car', unit: 'mi', currency: 'GBP', rateThousandths: 550,
    validFrom: '2026-04-06',
    source: { authority: 'HM Revenue & Customs', url: HMRC_MILEAGE, retrieved: CHECKED, status: 'calculation' },
    note: '55p per mile for the first 10,000 business miles in the tax year, 25p for each mile after (the 2026/27 rate, set 21 May 2026 and backdated to 6 April 2026); 5p per mile for each fellow employee carried',
  },
  {
    country: 'GB', vehicle: 'motorcycle', unit: 'mi', currency: 'GBP', rateThousandths: 240,
    validFrom: '2011-04-06',
    source: { authority: 'HM Revenue & Customs', url: HMRC_MILEAGE, retrieved: CHECKED, status: 'calculation' },
    note: '24p per mile, unchanged from 2011/12 through 2026/27',
  },
  {
    country: 'GB', vehicle: 'bicycle', unit: 'mi', currency: 'GBP', rateThousandths: 200,
    validFrom: '2011-04-06',
    source: { authority: 'HM Revenue & Customs', url: HMRC_MILEAGE, retrieved: CHECKED, status: 'calculation' },
    note: '20p per mile, unchanged from 2011/12 through 2026/27',
  },
];

/** A-76: the per-diem rows (daily meals-and-incidental / full-day allowances only). */
export const PER_DIEM_ROWS: PerDiemRow[] = [
  {
    country: 'US', area: 'standard CONUS, meals and incidental expenses (M&IE)', currency: 'USD', dailyCents: 6_800,
    validFrom: '2024-10-01', validTo: '2025-09-30',
    source: { authority: 'U.S. General Services Administration', url: GSA_PER_DIEM, retrieved: CHECKED, status: 'calculation' },
    note: 'FY2025 standard rate. Lodging is separate; the first and last day of travel are 75% ($51.00); listed localities run $68–$92 a day',
  },
  {
    country: 'US', area: 'standard CONUS, meals and incidental expenses (M&IE)', currency: 'USD', dailyCents: 6_800,
    validFrom: '2025-10-01', validTo: '2026-09-30',
    source: { authority: 'U.S. General Services Administration', url: GSA_PER_DIEM, retrieved: CHECKED, status: 'calculation' },
    note: 'FY2026 standard rate (Bulletin FTR 26-01: the FY2025 levels were held). Lodging is separate; the first and last day of travel are 75% ($51.00); listed localities run $68–$92 a day',
  },
  {
    country: 'US', area: 'standard CONUS, meals and incidental expenses (M&IE)', currency: 'USD', dailyCents: 6_800,
    validFrom: '2026-10-01', validTo: '2027-09-30',
    source: { authority: 'U.S. General Services Administration', url: GSA_PER_DIEM, retrieved: CHECKED, status: 'calculation' },
    note: 'FY2027 standard rate (Bulletin FTR 27-01: M&IE held at $68; the standard lodging rate rose to $113 and is separate). The first and last day of travel are 75% ($51.00); listed localities run $68–$92 a day',
  },
  {
    country: 'GB', area: 'benchmark scale rate, full day', currency: 'GBP', dailyCents: 2_500,
    validFrom: '2016-04-06',
    source: { authority: 'HM Revenue & Customs', url: HMRC_SUBSISTENCE, retrieved: CHECKED, status: 'calculation' },
    note: '£25.00 for a journey of 15 hours or more that is still going at 8pm (covers the 24-hour period); £5.00 one meal (5 hours away), £10.00 two meals (10 hours); rates unchanged since 6 April 2016',
  },
];

/** The rate text a claim line takes ("0.45", "0.655"), built from the row's thousandths. */
export function rateTextFromThousandths(rateThousandths: number): string {
  const value = rateThousandths / 1000;
  return rateThousandths % 10 ? value.toFixed(3) : value.toFixed(2);
}

export interface MileageSuggestion {
  row: MileageRateRow;
  /** what to put in the claim's rate field when the row's currency is the claim's */
  rateText: string;
  /** false when the row is in another currency: shown, never prefilled (no conversion is invented) */
  matchesCurrency: boolean;
  /** false when the line's distance unit differs from the row's: shown, never prefilled */
  matchesUnit: boolean;
}

/**
 * The mileage rate in force for a country, date, vehicle and distance unit — or null when the
 * table has no row (the screen then says to type the rate). The first matching row wins; rows
 * never overlap for one country and vehicle. Pure.
 */
export function mileageRateFor(input: {
  country: string; date: string; vehicle?: VehicleKind; unit: 'mi' | 'km'; currency: string;
}): MileageSuggestion | null {
  const vehicle = input.vehicle || 'car';
  const day = String(input.date || '').slice(0, 10);
  const row = MILEAGE_RATE_ROWS.find(r =>
    r.country === input.country && r.vehicle === vehicle
    && r.validFrom <= day && (!r.validTo || r.validTo >= day));
  if (!row) return null;
  return {
    row,
    rateText: rateTextFromThousandths(row.rateThousandths),
    matchesCurrency: row.currency === input.currency,
    matchesUnit: row.unit === input.unit,
  };
}

export interface PerDiemSuggestion {
  row: PerDiemRow;
  /** what to put in the claim's daily-rate field when the row's currency is the claim's */
  dailyText: string;
  matchesCurrency: boolean;
}

/**
 * The per-diem daily allowance in force for a country and date, or null when the table has no
 * row. `extraRows` (A-107: the GSA locality rows read from the person's own GSA file) are
 * searched first, so a chosen locality's rate is suggested over the standard rate; with no
 * extra rows the answer is exactly the built-in table's.
 */
export function perDiemRateFor(input: { country: string; date: string; currency: string; extraRows?: PerDiemRow[] }): PerDiemSuggestion | null {
  const day = String(input.date || '').slice(0, 10);
  const row = [...(input.extraRows || []), ...PER_DIEM_ROWS].find(r =>
    r.country === input.country
    && r.validFrom <= day && (!r.validTo || r.validTo >= day));
  if (!row) return null;
  return {
    row,
    dailyText: (row.dailyCents / 100).toFixed(2),
    matchesCurrency: row.currency === input.currency,
  };
}

export const COUNTRY_NAMES: Record<RateCountry, string> = {
  US: 'United States',
  GB: 'United Kingdom',
};

/** The line the claim form shows under a suggested rate: what the table suggests and its source. */
export function rateSuggestionText(s: MileageSuggestion | PerDiemSuggestion, date: string): string {
  const source = `${s.row.source.authority}, ${s.row.source.url}, read ${s.row.source.retrieved}`;
  const amount = 'rateText' in s
    ? `${s.row.currency} ${s.rateText} per ${s.row.unit === 'mi' ? 'mile' : 'km'}`
    : `${s.row.currency} ${(s.row.dailyCents / 100).toFixed(2)} a day (${s.row.area})`;
  const notFilled = 'matchesUnit' in s && !s.matchesUnit
    ? ` The rate is per ${s.row.unit === 'mi' ? 'mile' : 'km'}, so it does not fill this ${s.row.unit === 'mi' ? 'kilometre' : 'mile'} line.`
    : !s.matchesCurrency
      ? ` It is in ${s.row.currency}, not this claim's currency, so it is shown only — no conversion is made.`
      : ' It fills the rate while the field is empty; what you type is what the claim records.';
  return `The table suggests ${amount} for ${date}.${notFilled} (${source})`;
}
