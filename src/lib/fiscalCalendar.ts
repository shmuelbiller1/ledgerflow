import { addDaysYMD, addMonthsYMD, dayNumber, fromDayNumber, getLocalDateISO } from './calendarDate';

export { addDaysYMD, addMonthsYMD, dayNumber, fromDayNumber };

export interface FiscalYearBounds {
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  fiscalYear: number;
}

export interface FiscalQuarterInfo {
  quarter: 1 | 2 | 3 | 4;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  label: string;      // e.g. "FY2026 Q1"
  fiscalYear: number;
}

/**
 * Calculates the start and end calendar dates for the fiscal year containing the given target date.
 * @param targetDate ISO string (YYYY-MM-DD) or Date instance
 * @param fiscalYearStartMonth 1 (Jan) to 12 (Dec). Defaults to 1 (calendar year).
 * @param fiscalYearStartDay 1 to 31. Defaults to 1.
 */
export function getFiscalYearBounds(
  targetDate: string | Date = new Date(),
  fiscalYearStartMonth = 1,
  fiscalYearStartDay = 1
): FiscalYearBounds {
  const dateStr = typeof targetDate === 'string' ? targetDate : getLocalDateISO(targetDate);
  const parts = dateStr.split('T')[0].split('-');
  const calYear = Number.parseInt(parts[0], 10);
  const calMonth = Number.parseInt(parts[1], 10);
  const calDay = Number.parseInt(parts[2], 10);

  // Normalize month: 1..12
  const startMonth = Math.min(Math.max(fiscalYearStartMonth || 1, 1), 12);
  const startDay = Math.min(Math.max(fiscalYearStartDay || 1, 1), 28); // Safe day bounds

  let fyStartYear: number;
  let fyEndYear: number;

  if (calMonth > startMonth || (calMonth === startMonth && calDay >= startDay)) {
    fyStartYear = calYear;
    fyEndYear = startMonth === 1 && startDay === 1 ? calYear : calYear + 1;
  } else {
    fyStartYear = calYear - 1;
    fyEndYear = calYear;
  }

  const startMonthStr = String(startMonth).padStart(2, '0');
  const startDayStr = String(startDay).padStart(2, '0');
  const startDate = `${fyStartYear}-${startMonthStr}-${startDayStr}`;

  // End date is 1 day before the next fiscal year start
  const nextFyStart = `${fyStartYear + 1}-${startMonthStr}-${startDayStr}`;
  const endDate = addDaysYMD(nextFyStart, -1);

  return {
    startDate,
    endDate,
    fiscalYear: fyEndYear
  };
}

/**
 * Calculates which fiscal quarter (Q1-Q4) a date falls into along with start and end dates.
 */
export function getFiscalQuarter(
  targetDate: string | Date = new Date(),
  fiscalYearStartMonth = 1,
  fiscalYearStartDay = 1
): FiscalQuarterInfo {
  const dateStr = (typeof targetDate === 'string' ? targetDate : getLocalDateISO(targetDate)).split('T')[0];
  const bounds = getFiscalYearBounds(dateStr, fiscalYearStartMonth, fiscalYearStartDay);

  const [fyY, fyM] = bounds.startDate.split('-').map(Number);
  const [tY, tM] = dateStr.split('-').map(Number);

  // Month offset from FY start
  const monthDiff = (tY - fyY) * 12 + (tM - fyM);
  const quarterIndex = Math.min(Math.max(Math.floor(monthDiff / 3), 0), 3) as 0 | 1 | 2 | 3;
  const quarterNumber = (quarterIndex + 1) as 1 | 2 | 3 | 4;

  const qStartDate = addMonthsYMD(bounds.startDate, quarterIndex * 3);
  const qEndDate = addDaysYMD(addMonthsYMD(bounds.startDate, (quarterIndex + 1) * 3), -1);

  return {
    quarter: quarterNumber,
    startDate: qStartDate,
    endDate: qEndDate,
    label: `FY${bounds.fiscalYear} Q${quarterNumber}`,
    fiscalYear: bounds.fiscalYear
  };
}

/**
 * Returns a human-friendly fiscal period label.
 */
export function getFiscalPeriodLabel(
  targetDate: string | Date = new Date(),
  fiscalYearStartMonth = 1,
  fiscalYearStartDay = 1
): string {
  const q = getFiscalQuarter(targetDate, fiscalYearStartMonth, fiscalYearStartDay);
  return q.label;
}

/**
 * Computes the prior period date range of equivalent length preceding the given date range.
 */
export function getPrevPeriod(startDate: string, endDate: string): { startDate: string; endDate: string } {
  const diffDays = Math.max(1, dayNumber(endDate) - dayNumber(startDate));
  const prevEnd = addDaysYMD(startDate, -1);
  const prevStart = addDaysYMD(prevEnd, -diffDays);

  return {
    startDate: prevStart,
    endDate: prevEnd
  };
}

export type ReportTimeframe = 'month' | 'quarter' | 'year';
export type CompareMode = 'none' | 'previous' | 'lastYear';

export interface ReportPeriod {
  startDate: string;
  endDate: string;
}

/**
 * The dates a report covers. `fiscalYear` is the label of the fiscal year (the calendar year it
 * ends in, as getFiscalYearBounds reports it); `quarter` is the fiscal quarter (0-3) and `month`
 * the calendar month (0-11) inside that fiscal year.
 */
export function getReportPeriod(
  timeframe: ReportTimeframe,
  fiscalYear: number,
  quarter: number,
  month: number,
  fiscalYearStartMonth = 1
): ReportPeriod {
  const startMonth = Math.min(Math.max(Math.round(fiscalYearStartMonth) || 1, 1), 12);
  const fyStartYear = startMonth === 1 ? fiscalYear : fiscalYear - 1;
  const fyStart = `${fyStartYear}-${String(startMonth).padStart(2, '0')}-01`;
  if (timeframe === 'year') {
    return { startDate: fyStart, endDate: addDaysYMD(addMonthsYMD(fyStart, 12), -1) };
  }
  if (timeframe === 'quarter') {
    const q = Math.min(Math.max(Math.round(quarter) || 0, 0), 3);
    const start = addMonthsYMD(fyStart, q * 3);
    return { startDate: start, endDate: addDaysYMD(addMonthsYMD(start, 3), -1) };
  }
  const m = Math.min(Math.max(Math.round(month) || 0, 0), 11);
  const year = m + 1 >= startMonth ? fyStartYear : fyStartYear + 1;
  const start = `${year}-${String(m + 1).padStart(2, '0')}-01`;
  return { startDate: start, endDate: addDaysYMD(addMonthsYMD(start, 1), -1) };
}

/**
 * The period to compare a report with. 'previous' is the period just before: whole months stay
 * whole (the month before March is February, the quarter before Q2 is Q1, the 12 months before a
 * fiscal year are the previous fiscal year); any other range moves back by its own length in days.
 * 'lastYear' is the same dates one year earlier (29 February becomes 28 February).
 */
export function getComparePeriod(startDate: string, endDate: string, mode: CompareMode): ReportPeriod | null {
  if (mode === 'none' || !startDate || !endDate) return null;
  if (mode === 'lastYear') {
    return { startDate: addMonthsYMD(startDate, -12), endDate: addMonthsYMD(endDate, -12) };
  }
  const isMonthStart = startDate.slice(8, 10) === '01';
  const isMonthEnd = addDaysYMD(endDate, 1).slice(8, 10) === '01';
  if (isMonthStart && isMonthEnd) {
    const [sy, sm] = startDate.split('-').map(Number);
    const [ey, em] = endDate.split('-').map(Number);
    const months = (ey - sy) * 12 + (em - sm) + 1;
    const start = addMonthsYMD(startDate, -months);
    return { startDate: start, endDate: addDaysYMD(startDate, -1) };
  }
  const days = dayNumber(endDate) - dayNumber(startDate) + 1;
  return { startDate: addDaysYMD(startDate, -days), endDate: addDaysYMD(startDate, -1) };
}
