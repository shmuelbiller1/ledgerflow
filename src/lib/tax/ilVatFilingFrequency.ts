/**
 * A-57 (PLAN): the Israeli periodic-VAT reporting frequency — monthly above an annual turnover
 * ceiling, bimonthly at or below it — as dated rows with the Israel Tax Authority as source, plus
 * the check that a registration's own chosen frequency matches what the turnover assigns.
 *
 * What this is: the authority's assignment rule as a planning table. The ITA assigns the frequency
 * on the dealer's file and tells them on the account and on the return itself; the recorded
 * frequency on the registration (`filing` in `src/lib/tax/profile.ts`) is what the workspace says
 * its file carries. What it is not: an assignment — where the recorded frequency and the turnover
 * disagree, this file reports the disagreement for a person; it never concludes which is right,
 * because the authority's own letter governs. The threshold row is asserted from 2000-01-01 with
 * the check date on it: this file encodes no well-documented earlier figures, and the authority's
 * page must be read before a historical period is relied on. Nothing here files or posts.
 */
import { rateRule, where, type FilingEffect, type TaxRulePack } from '../rules/packs/shared';
import { monthEnd } from '../periodLock';

export type IlVatFrequency = 'monthly' | 'bimonthly';

export interface IlVatFrequencyRow {
  frequency: IlVatFrequency;
  /** the annual turnover band the authority assigns this frequency to, in agorot; null is open-ended */
  minAnnualTurnoverCents: number | null;
  maxAnnualTurnoverCents: number | null;
  /** when the return is due, in words from the authority */
  due: string;
  validFrom: string;
  source: string;
  checked: string;
  note?: string;
}

const CHECKED = '2026-10-13';
const ITA = 'https://www.gov.il/he/departments/israel_tax_authority';

/** ₪1,500,000 a year, excluding VAT: at or below it the authority assigns the bimonthly report. */
export const IL_BIMONTHLY_TURNOVER_CEILING_CENTS = 150_000_000;

export const IL_VAT_REPORT_FREQUENCY: IlVatFrequencyRow[] = [
  {
    frequency: 'bimonthly',
    minAnnualTurnoverCents: null,
    maxAnnualTurnoverCents: IL_BIMONTHLY_TURNOVER_CEILING_CENTS,
    due: 'by the 15th of the month after the two-month period ends',
    validFrom: '2000-01-01',
    source: ITA,
    checked: CHECKED,
    note: 'annual turnover of ₪1,500,000 or less, excluding VAT; the authority may move a file to monthly on its own or on request',
  },
  {
    frequency: 'monthly',
    minAnnualTurnoverCents: IL_BIMONTHLY_TURNOVER_CEILING_CENTS,
    maxAnnualTurnoverCents: null,
    due: 'by the 15th of the month after the month ends',
    validFrom: '2000-01-01',
    source: ITA,
    checked: CHECKED,
    note: 'annual turnover above ₪1,500,000, excluding VAT',
  },
];

/** The frequency the turnover assigns on a date; undefined for a figure that is not a turnover. */
export function assignedFrequency(annualTurnoverCents: number, date: string): IlVatFrequency | undefined {
  if (!Number.isFinite(annualTurnoverCents) || annualTurnoverCents < 0) return undefined;
  const row = IL_VAT_REPORT_FREQUENCY.find(r =>
    r.validFrom <= date &&
    (r.minAnnualTurnoverCents === null || annualTurnoverCents > r.minAnnualTurnoverCents) &&
    (r.maxAnnualTurnoverCents === null || annualTurnoverCents <= r.maxAnnualTurnoverCents));
  return row?.frequency;
}

export interface IlVatFrequencyCheck {
  /** what the turnover assigns, or undefined without a usable figure */
  assigned: IlVatFrequency | undefined;
  /** what the registration records, or undefined when the registration states no frequency */
  recorded: string | undefined;
  /** true/false when both sides are known; undefined when either is — never a guessed match */
  matches: boolean | undefined;
  note: string;
}

/**
 * The check the task asks for: the registration's own recorded frequency against what the annual
 * turnover assigns. A disagreement is reported for a person with the authority named as the one
 * that governs; a missing side is reported as unknown, never as a match.
 */
export function frequencyCheck(input: {
  /** the recorded `filing` on the workspace's Israeli VAT registration, if it states one */
  recordedFrequency?: string | null;
  /** the last twelve months' turnover in agorot, excluding VAT, if known */
  annualTurnoverCents?: number | null;
  date: string;
}): IlVatFrequencyCheck {
  const assigned = input.annualTurnoverCents === null || input.annualTurnoverCents === undefined
    ? undefined
    : assignedFrequency(input.annualTurnoverCents, input.date);
  const recorded = input.recordedFrequency || undefined;
  const matches = assigned && recorded ? (recorded === assigned ? true : recorded === 'monthly' || recorded === 'bimonthly' ? false : undefined) : undefined;
  const note = !assigned && !recorded ? 'neither the turnover nor the recorded frequency is known; nothing is concluded'
    : !assigned ? 'the turnover figure is missing or unusable; the recorded frequency stands unchallenged'
    : !recorded ? 'the registration records no frequency; the authority assigns one from the turnover'
    : matches === false ? `the turnover assigns ${assigned} but the registration records ${recorded}; the authority's own letter governs — review the file`
    : matches === true ? `the recorded ${recorded} frequency matches what the turnover assigns`
    : `the registration records "${recorded}", which is not a periodic-report frequency; the turnover assigns ${assigned}`;
  return { assigned, recorded, matches, note };
}

/** The two bands as entity-period filing rules with the band in the effect (A-51's shape). */
export function ilVatFrequencyPack(): TaxRulePack {
  const rules = IL_VAT_REPORT_FREQUENCY.map(row => rateRule<FilingEffect>({
    id: `il-vat-frequency-${row.frequency}`,
    name: `Israel: periodic VAT report, ${row.frequency}`,
    scope: 'entity-period',
    when: [where('country', ['IL']), where('taxTreatment', ['il_company', 'il_osek_murshe'])],
    effect: {
      kind: 'filing',
      form: 'דוח תקופתי למע״מ',
      frequency: row.frequency,
      due: row.due,
      tax: 'VAT',
      revenueBand: { minCents: row.minAnnualTurnoverCents, maxCents: row.maxAnnualTurnoverCents, currency: 'ILS' },
    },
    validFrom: row.validFrom,
    source: { authority: 'Israel Tax Authority', url: row.source, retrieved: row.checked },
  }));
  return { id: 'il-vat-frequency', name: 'Israel periodic VAT reporting frequency', rules, unmapped: [] };
}

/** Structural problems in the table (a bug in this file, not a tax opinion). */
export function ilVatFrequencyProblems(): string[] {
  const problems: string[] = [];
  for (const row of IL_VAT_REPORT_FREQUENCY) {
    if (!/^https:\/\//.test(row.source)) problems.push(`${row.frequency}: the source must be an https URL`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.validFrom)) problems.push(`${row.frequency}: validFrom is not a date`);
    if (row.minAnnualTurnoverCents !== null && row.maxAnnualTurnoverCents !== null && row.minAnnualTurnoverCents >= row.maxAnnualTurnoverCents) {
      problems.push(`${row.frequency}: the band is empty`);
    }
  }
  for (const cents of [0, IL_BIMONTHLY_TURNOVER_CEILING_CENTS, IL_BIMONTHLY_TURNOVER_CEILING_CENTS + 1, 900_000_000]) {
    if (!assignedFrequency(cents, '2026-10-13')) problems.push(`₪${(cents / 100).toLocaleString('en-US')} matches no band`);
  }
  return problems;
}

export interface IlVatReportPeriod {
  frequency: IlVatFrequency;
  /** the period's first and last months, YYYY-MM (the same month for a monthly report) */
  startMonth: string;
  endMonth: string;
  startDate: string;
  endDate: string;
  /** the planning due date: the 15th of the month after the period ends (the rows' `due`) */
  dueDate: string;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * CON-4: the periodic VAT report a month belongs to under a frequency. Monthly: the month itself.
 * Bimonthly: the two-month period it falls in — January–February, March–April, … November–December
 * (the periods start in the odd months). The due date is the planning date from the rows above; the
 * authority's own notice on the file governs. Undefined for text that is not a month.
 */
export function ilVatReportPeriod(month: string, frequency: IlVatFrequency): IlVatReportPeriod | undefined {
  const found = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(month || '').trim());
  if (!found) return undefined;
  const year = Number(found[1]);
  const m = Number(found[2]);
  const first = frequency === 'bimonthly' ? (m % 2 === 1 ? m : m - 1) : m;
  const last = frequency === 'bimonthly' ? first + 1 : m;
  const startMonth = `${year}-${pad2(first)}`;
  const endMonth = `${year}-${pad2(last)}`;
  const dueDate = last === 12 ? `${year + 1}-01-15` : `${year}-${pad2(last + 1)}-15`;
  return { frequency, startMonth, endMonth, startDate: `${startMonth}-01`, endDate: monthEnd(endMonth), dueDate };
}
