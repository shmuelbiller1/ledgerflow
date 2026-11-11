/**
 * A-24 (PLAN §3 step 4): Canada's GST / HST / PST / RST / QST as dated rows with a source per row.
 *
 * The federal GST is 5%. Five provinces charge a single HST (the federal part plus a provincial
 * part); Quebec charges the QST on top of the GST; British Columbia, Manitoba and Saskatchewan
 * charge their own PST/RST on top of the GST. Alberta and the three territories charge GST only.
 *
 * `validFrom` is the effective date of the row; where a province's history is not fully reviewed the
 * row starts at the documented date and `note` says what is not covered. `checked` is the day a
 * person compared the row with the source. Rates are fractions (13% = 0.13); a return is built from
 * the components (`canadaSalesTaxRateTable`), never by adding two "combined" rows.
 */
import type { RateTable, TaxComponent } from './resolveLineTax';
import { placeState, type TaxPlace } from './profile';

export type CaTaxKind = 'GST' | 'HST' | 'PST' | 'RST' | 'QST';

export interface CaSalesTaxRow {
  /** two-letter province or territory code (ON, QC, BC …) */
  province: string;
  provinceName: string;
  kind: CaTaxKind;
  rate: number;
  validFrom: string;
  validTo?: string;
  source: string;
  checked: string;
  note?: string;
}

const CHECKED = '2026-10-11';
const CRA = 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses.html';
const CA = 'https://www.canada.ca/en/revenue-agency.html';

const GST_5 = (province: string, provinceName: string, note?: string): CaSalesTaxRow =>
  ({ province, provinceName, kind: 'GST', rate: 0.05, validFrom: '2008-01-01', source: CRA, checked: CHECKED, note });

/** 5% federal GST in every province and territory (folded into HST where one applies), then the provincial taxes. */
export const CA_SALES_TAX: CaSalesTaxRow[] = [
  GST_5('AB', 'Alberta'),
  GST_5('BC', 'British Columbia'),
  GST_5('MB', 'Manitoba'),
  GST_5('NB', 'New Brunswick'),
  GST_5('NL', 'Newfoundland and Labrador'),
  GST_5('NS', 'Nova Scotia'),
  GST_5('NT', 'Northwest Territories'),
  GST_5('NU', 'Nunavut'),
  GST_5('ON', 'Ontario'),
  GST_5('PE', 'Prince Edward Island'),
  GST_5('QC', 'Quebec'),
  GST_5('SK', 'Saskatchewan'),
  GST_5('YT', 'Yukon'),

  // HST provinces: one combined tax, the federal part included
  { province: 'ON', provinceName: 'Ontario', kind: 'HST', rate: 0.13, validFrom: '2010-07-01', source: CRA, checked: CHECKED, note: '8% provincial part on top of the 5% federal part' },
  { province: 'NB', provinceName: 'New Brunswick', kind: 'HST', rate: 0.15, validFrom: '2016-07-01', source: CRA, checked: CHECKED, note: '15% from 1 Jul 2016 (13% from 2010 to 2016-06-30)' },
  { province: 'NL', provinceName: 'Newfoundland and Labrador', kind: 'HST', rate: 0.15, validFrom: '2016-07-01', source: CRA, checked: CHECKED, note: '15% from 1 Jul 2016 (13% before)' },
  { province: 'PE', provinceName: 'Prince Edward Island', kind: 'HST', rate: 0.14, validFrom: '2013-04-01', validTo: '2016-09-30', source: CRA, checked: CHECKED, note: '14% from 1 Apr 2013' },
  { province: 'PE', provinceName: 'Prince Edward Island', kind: 'HST', rate: 0.15, validFrom: '2016-10-01', source: CRA, checked: CHECKED, note: '15% from 1 Oct 2016' },
  { province: 'NS', provinceName: 'Nova Scotia', kind: 'HST', rate: 0.15, validFrom: '2010-07-01', validTo: '2025-03-31', source: CRA, checked: CHECKED },
  { province: 'NS', provinceName: 'Nova Scotia', kind: 'HST', rate: 0.14, validFrom: '2025-04-01', source: 'https://novascotia.ca/finance/en/home/taxation/tax101/hst.html', checked: CHECKED, note: 'provincial part cut from 10% to 9% on 1 Apr 2025' },

  // provinces with a separate provincial tax on top of the GST
  { province: 'BC', provinceName: 'British Columbia', kind: 'PST', rate: 0.07, validFrom: '2013-04-01', source: 'https://www2.gov.bc.ca/gov/content/taxes/sales-taxes/pst', checked: CHECKED, note: 'PST returned 1 Apr 2013 after the HST years' },
  { province: 'MB', provinceName: 'Manitoba', kind: 'RST', rate: 0.07, validFrom: '2022-01-01', source: 'https://www.gov.mb.ca/finance/taxation/taxes/retail.html', checked: CHECKED, note: '7% from 1 Jan 2022 (8% from Jul 2019); earlier history not fully reviewed' },
  { province: 'SK', provinceName: 'Saskatchewan', kind: 'PST', rate: 0.06, validFrom: '2017-04-01', source: 'https://www.saskatchewan.ca/business/taxes-licensing-and-reporting/provincial-taxes-policies-and-programs/provincial-sales-tax', checked: CHECKED, note: '6% from 1 Apr 2017 (5% before)' },
  { province: 'QC', provinceName: 'Quebec', kind: 'QST', rate: 0.09975, validFrom: '2013-01-01', source: 'https://www.revenuquebec.ca/en/businesses/consumption-taxes/gsthst-and-qst/', checked: CHECKED, note: '9.975% from 1 Jan 2013; Quebec also collects the federal GST for the CRA' },
];

export const CA_PROVINCES: string[] = [...new Set(CA_SALES_TAX.map(r => r.province))];

/** HST provinces: a single combined rate, so GST must not be added as a second component there. */
export const CA_HST_PROVINCES = ['ON', 'NB', 'NL', 'NS', 'PE'];

const inForce = (r: CaSalesTaxRow, date: string) => r.validFrom <= date && (!r.validTo || date <= r.validTo);

/** The rows for a province/territory in force on a date. */
export function caSalesTaxRows(province: string, date: string): CaSalesTaxRow[] {
  const code = province.toUpperCase();
  return CA_SALES_TAX.filter(r => r.province === code && inForce(r, date));
}

/** Every component of the tax a sale in a province carries on a date (QST/BST provinces keep the GST separate). */
export function canadaVatComponents(province: string, date: string): TaxComponent[] {
  const code = province.toUpperCase();
  const rows = caSalesTaxRows(code, date);
  const hst = rows.find(r => r.kind === 'HST');
  if (hst) return [{ level: 'country', name: `HST ${hst.provinceName}`, rate: hst.rate }];
  const components: TaxComponent[] = [];
  const gst = rows.find(r => r.kind === 'GST');
  if (gst) components.push({ level: 'country', name: 'GST', rate: gst.rate });
  for (const r of rows.filter(r => r.kind === 'PST' || r.kind === 'RST' || r.kind === 'QST')) {
    components.push({ level: 'state', name: `${r.kind} ${r.provinceName}`, rate: r.rate });
  }
  return components;
}

/** The combined rate a province charges on a date (a display convenience; components stay the source). */
export function canadaCombinedRate(province: string, date: string): number | undefined {
  const components = canadaVatComponents(province, date);
  if (!components.length) return undefined;
  return Math.round(components.reduce((s, c) => s + c.rate, 0) * 1e6) / 1e6;
}

/** `RateTables['CA']`: the components for a Canadian buyer's province on the date. */
export function canadaSalesTaxRateTable(rows: CaSalesTaxRow[] = CA_SALES_TAX): RateTable {
  return (place: TaxPlace, date: string): TaxComponent[] | undefined => {
    if (place.country !== 'CA') return undefined;
    const province = placeState(place);
    if (!province) return undefined;
    const inForceRows = rows.filter(r => r.province === province && r.validFrom <= date && (!r.validTo || date <= r.validTo));
    if (!inForceRows.length) return undefined;
    const hst = inForceRows.find(r => r.kind === 'HST');
    if (hst) return [{ level: 'country', name: `HST ${hst.provinceName}`, rate: hst.rate }];
    const components: TaxComponent[] = [];
    const gst = inForceRows.find(r => r.kind === 'GST');
    if (gst) components.push({ level: 'country', name: 'GST', rate: gst.rate });
    for (const r of inForceRows.filter(r => r.kind === 'PST' || r.kind === 'RST' || r.kind === 'QST')) {
      components.push({ level: 'state', name: `${r.kind} ${r.provinceName}`, rate: r.rate });
    }
    return components;
  };
}

/** The source page a row came from (for screens that must show where a rate was read). */
export const CA_TAX_INDEX = CA;
