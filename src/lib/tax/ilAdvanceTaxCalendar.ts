/**
 * A-101 (PLAN §10, §15): Israel advance income-tax payment (מקדמות מס הכנסה) reminder calendar
 * and entity rate support.
 *
 * What this is: statutory schedule and planning calendar for Israeli advance income-tax payments
 * under Section 175 of the Income Tax Ordinance [New Version], 5721-1961 (פקודת מס הכנסה, פרק ב' לחלק י': מקדמות).
 * Advances are paid periodically (monthly or bi-monthly) on turnover, by the 15th of the month following
 * the period. When the 15th falls on Friday or Saturday (Shabbat), the statutory deadline is postponed
 * to the following Sunday under the Interpretation Law (חוק הפרשנות, סעיף 10(ג)).
 *
 * What it is not: an assessment or filing service. The Israel Tax Authority determines the personal advance
 * rate (שיעור מקדמות) on the taxpayer's file. Estimated amounts are for cash-flow planning only; nothing here
 * posts, files, assesses, or transfers funds.
 */

export type IlAdvanceTaxFrequency = 'monthly' | 'bimonthly';

export interface IlAdvanceTaxScheduleRow {
  frequency: IlAdvanceTaxFrequency;
  statutoryDueDay: 15;
  statutoryBasis: string;
  hebrewBasis: string;
  dueDescription: string;
  validFrom: string;
  source: string;
  checked: string;
  note: string;
}

const CHECKED = '2026-10-20';
const ITA = 'https://www.gov.il/he/departments/israel_tax_authority';

/**
 * Statutory schedule rules for Israeli advance income-tax payments (Section 175 of the Income Tax Ordinance).
 * Catalogued in scripts/tax-table-catalog.ts for check:tax-tables validation.
 */
export const IL_ADVANCE_TAX_SCHEDULE: readonly IlAdvanceTaxScheduleRow[] = [
  {
    frequency: 'bimonthly',
    statutoryDueDay: 15,
    statutoryBasis: 'Section 175, Income Tax Ordinance [New Version], 5721-1961',
    hebrewBasis: 'סעיף 175 לפקודת מס הכנסה (מקדמות)',
    dueDescription: 'By the 15th of the month following the two-month period',
    validFrom: '2000-01-01',
    source: ITA,
    checked: CHECKED,
    note: 'Bi-monthly advance income-tax payments (מקדמות דו-חודשיות) on turnover; statutory due date is the 15th of the month following the period, postponed to Sunday if falling on Friday or Shabbat.',
  },
  {
    frequency: 'monthly',
    statutoryDueDay: 15,
    statutoryBasis: 'Section 175, Income Tax Ordinance [New Version], 5721-1961',
    hebrewBasis: 'סעיף 175 לפקודת מס הכנסה (מקדמות)',
    dueDescription: 'By the 15th of each month for the preceding month',
    validFrom: '2000-01-01',
    source: ITA,
    checked: CHECKED,
    note: 'Monthly advance income-tax payments (מקדמות חודשיות) on turnover; statutory due date is the 15th of the following month, postponed to Sunday if falling on Friday or Shabbat.',
  },
];

export interface IlAdvanceTaxPeriod {
  /** Period identifier, e.g. "2026-01" or "2026-01-02" */
  periodKey: string;
  /** English label, e.g. "January 2026" or "Jan–Feb 2026" */
  name: string;
  /** Hebrew label, e.g. "ינואר 2026" or "ינואר–פברואר 2026" */
  nameHe: string;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD */
  endDate: string;
  /** Statutory due day of the following month (15) */
  statutoryDueDay: 15;
  /** Statutory due date: YYYY-MM-DD */
  statutoryDueDate: string;
  /** Adjusted due date postponed to Sunday if statutory date falls on Friday/Saturday: YYYY-MM-DD */
  adjustedDueDate: string;
  /** True if the deadline moved due to Friday or Shabbat */
  wasPostponedForRestDay: boolean;
  frequency: IlAdvanceTaxFrequency;
}

export type IlAdvancePeriodStatus = 'upcoming' | 'due-soon' | 'active' | 'past';

const MONTH_NAMES_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MONTH_NAMES_HE = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

const pad2 = (n: number) => String(n).padStart(2, '0');

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** Last day of a month (1-based month) in YYYY-MM-DD format. Pure integer math. */
function lastDayOfMonth(year: number, month: number): string {
  const days = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
  return `${year}-${pad2(month)}-${pad2(days)}`;
}

/**
 * Pure Sakamoto algorithm for day of week: 0 = Sunday, 1 = Monday, ..., 5 = Friday, 6 = Saturday.
 * Avoids Date object UTC method allocations.
 */
function sakamotoDayOfWeek(y: number, m: number, d: number): number {
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const yAdj = m < 3 ? y - 1 : y;
  return (yAdj + Math.floor(yAdj / 4) - Math.floor(yAdj / 100) + Math.floor(yAdj / 400) + t[m - 1] + d) % 7;
}

/**
 * Postpones Friday (day 5) or Saturday / Shabbat (day 6) to Sunday under Israeli administrative practice
 * (Interpretation Law, 5741-1981, Section 10(c)).
 */
export function ilAdjustDueDateForRestDay(ymd: string): { adjustedDate: string; postponed: boolean } {
  const [y, m, d] = ymd.split('-').map(Number);
  const dow = sakamotoDayOfWeek(y, m, d);
  if (dow === 5) {
    // Friday -> Sunday (+2 days)
    return { adjustedDate: `${y}-${pad2(m)}-${pad2(d + 2)}`, postponed: true };
  }
  if (dow === 6) {
    // Saturday -> Sunday (+1 day)
    return { adjustedDate: `${y}-${pad2(m)}-${pad2(d + 1)}`, postponed: true };
  }
  return { adjustedDate: ymd, postponed: false };
}

/**
 * Builds the full calendar of advance income-tax payment periods for a tax year.
 * Monthly: 12 periods. Bi-monthly: 6 periods.
 */
export function ilAdvanceTaxPeriods(year: number, frequency: IlAdvanceTaxFrequency): IlAdvanceTaxPeriod[] {
  if (!Number.isInteger(year) || year < 1900 || year > 2100) return [];
  const periods: IlAdvanceTaxPeriod[] = [];

  if (frequency === 'monthly') {
    for (let m = 1; m <= 12; m++) {
      const periodKey = `${year}-${pad2(m)}`;
      const name = `${MONTH_NAMES_EN[m - 1]} ${year}`;
      const nameHe = `${MONTH_NAMES_HE[m - 1]} ${year}`;
      const startDate = `${year}-${pad2(m)}-01`;
      const endDate = lastDayOfMonth(year, m);

      // Statutory due date is 15th of the following month (or Jan 15 of next year for December)
      const dueYear = m === 12 ? year + 1 : year;
      const dueMonth = m === 12 ? 1 : m + 1;
      const statutoryDueDate = `${dueYear}-${pad2(dueMonth)}-15`;
      const { adjustedDate, postponed } = ilAdjustDueDateForRestDay(statutoryDueDate);

      periods.push({
        periodKey,
        name,
        nameHe,
        startDate,
        endDate,
        statutoryDueDay: 15,
        statutoryDueDate,
        adjustedDueDate: adjustedDate,
        wasPostponedForRestDay: postponed,
        frequency: 'monthly',
      });
    }
  } else {
    // Bi-monthly: 6 two-month periods
    for (let p = 1; p <= 6; p++) {
      const startM = (p - 1) * 2 + 1;
      const endM = p * 2;
      const periodKey = `${year}-${pad2(startM)}-${pad2(endM)}`;
      const name = `${MONTH_NAMES_EN[startM - 1].slice(0, 3)}–${MONTH_NAMES_EN[endM - 1].slice(0, 3)} ${year}`;
      const nameHe = `${MONTH_NAMES_HE[startM - 1]}–${MONTH_NAMES_HE[endM - 1]} ${year}`;
      const startDate = `${year}-${pad2(startM)}-01`;
      const endDate = lastDayOfMonth(year, endM);

      // Due 15th of month following the 2-month period
      const dueYear = endM === 12 ? year + 1 : year;
      const dueMonth = endM === 12 ? 1 : endM + 1;
      const statutoryDueDate = `${dueYear}-${pad2(dueMonth)}-15`;
      const { adjustedDate, postponed } = ilAdjustDueDateForRestDay(statutoryDueDate);

      periods.push({
        periodKey,
        name,
        nameHe,
        startDate,
        endDate,
        statutoryDueDay: 15,
        statutoryDueDate,
        adjustedDueDate: adjustedDate,
        wasPostponedForRestDay: postponed,
        frequency: 'bimonthly',
      });
    }
  }

  return periods;
}

/**
 * Status of a period relative to an assessment date.
 */
export function ilAdvanceTaxPeriodStatus(period: IlAdvanceTaxPeriod, asOfDate: string): IlAdvancePeriodStatus {
  if (asOfDate < period.startDate) return 'upcoming';
  if (asOfDate > period.adjustedDueDate) return 'past';

  // Inside the period or grace window before adjusted due date
  const asOfTime = Date.parse(asOfDate + 'T12:00:00Z');
  const dueTime = Date.parse(period.adjustedDueDate + 'T12:00:00Z');
  const diffDays = Math.round((dueTime - asOfTime) / 86400000);

  if (diffDays >= 0 && diffDays <= 15) return 'due-soon';
  return 'active';
}

/**
 * Computes estimated advance income-tax payment (מקדמה משוערת לתשלום) in whole agorot/cents.
 * Math: turnoverCents × ratePercent / 100, strictly rounded to nearest integer minor unit.
 * Negative turnover or non-finite rates return 0.
 */
export function ilAdvanceTaxEstimateCents(turnoverCents: number, ratePercent: number): number {
  if (!Number.isFinite(turnoverCents) || turnoverCents <= 0) return 0;
  if (!Number.isFinite(ratePercent) || ratePercent <= 0) return 0;
  const result = Math.round((turnoverCents * ratePercent) / 100);
  return Number.isSafeInteger(result) && result >= 0 ? result : 0;
}

/**
 * Self-diagnostic problem checker for the schedule table.
 */
export function ilAdvanceTaxProblems(rows: readonly IlAdvanceTaxScheduleRow[] = IL_ADVANCE_TAX_SCHEDULE): string[] {
  const problems: string[] = [];
  if (!Array.isArray(rows) || rows.length !== 2) {
    problems.push(`Expected exactly 2 schedule rows (monthly and bimonthly), found ${rows?.length ?? 0}.`);
    return problems;
  }
  const freqs = new Set<string>();
  for (const r of rows) {
    if (r.frequency !== 'monthly' && r.frequency !== 'bimonthly') {
      problems.push(`Unknown frequency: ${String(r.frequency)}`);
    }
    if (freqs.has(r.frequency)) problems.push(`Duplicate frequency row: ${r.frequency}`);
    freqs.add(r.frequency);
    if (r.statutoryDueDay !== 15) problems.push(`Statutory due day must be 15, got ${r.statutoryDueDay}`);
    if (!r.source || !r.source.startsWith('https://')) problems.push(`Row ${r.frequency} needs an HTTPS source URL.`);
    if (!r.validFrom || !/^\d{4}-\d{2}-\d{2}$/.test(r.validFrom)) problems.push(`Row ${r.frequency} needs a valid YYYY-MM-DD validFrom.`);
  }
  return problems;
}

export const IL_ADVANCE_TAX_CALENDAR_CSV_HEADERS: readonly string[] = [
  'Period Key',
  'Period Name',
  'Period Name (Hebrew)',
  'Start Date',
  'End Date',
  'Statutory Due Date',
  'Adjusted Due Date',
  'Rest Day Postponed',
  'Frequency',
  'Statutory Basis',
  'Source',
];

export function ilAdvanceTaxCalendarCsvRows(year: number, frequency: IlAdvanceTaxFrequency): string[][] {
  const periods = ilAdvanceTaxPeriods(year, frequency);
  const scheduleRow = IL_ADVANCE_TAX_SCHEDULE.find(s => s.frequency === frequency);
  return periods.map(p => [
    p.periodKey,
    p.name,
    p.nameHe,
    p.startDate,
    p.endDate,
    p.statutoryDueDate,
    p.adjustedDueDate,
    p.wasPostponedForRestDay ? 'Yes (moved to Sunday)' : 'No',
    p.frequency,
    scheduleRow?.statutoryBasis ?? 'Section 175, Income Tax Ordinance',
    scheduleRow?.source ?? ITA,
  ]);
}
