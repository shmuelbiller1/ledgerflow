/**
 * Pure civil-calendar arithmetic on YYYY-MM-DD strings.
 * Uses integer proleptic Gregorian day numbers with zero Date/timezone/UTC calls.
 */

const pad2 = (n: number) => String(n).padStart(2, '0');

export const isLeapYear = (y: number): boolean =>
  (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export const daysInMonth = (y: number, m: number): number =>
  [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

/** Days since 1970-01-01 (proleptic Gregorian). */
export function dayNumber(ymd: string): number {
  const [yy, m, d] = ymd.slice(0, 10).split('-').map(Number);
  if (Number.isNaN(yy) || Number.isNaN(m) || Number.isNaN(d)) return NaN;
  const y = m <= 2 ? yy - 1 : yy;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/**
 * The year, month (1–12) and day written in a stored YYYY-MM-DD date, or null when the text is not
 * a calendar date (a timestamp, free text, or an impossible day such as 2026-02-30). The parts are
 * the ones written down: no zone is applied, so the answer is the same on every device (D-65).
 */
export function civilDateParts(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

/** The year a stored date is in, read from its own text ('2026-01-01' is 2026 on every device and in every zone). */
export function civilYear(value: string | null | undefined): number | null {
  const match = /^(\d{4})-/.exec(String(value ?? '').trim());
  return match ? Number(match[1]) : null;
}

export function fromDayNumber(n: number): string {
  const z = Math.trunc(n) + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** Calendar-month arithmetic on a YYYY-MM-DD day; month-end and leap-day dates clamp to the target month. */
export function addMonthsYMD(ymd: string, months: number, anchorDay?: number): string {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12 + 1;
  const targetDay = anchorDay ?? d;
  return `${ny}-${pad2(nm)}-${pad2(Math.min(targetDay, daysInMonth(ny, nm)))}`;
}

export function addDaysYMD(ymd: string, days: number): string {
  return fromDayNumber(dayNumber(ymd) + days);
}

/** Day of week for a YYYY-MM-DD date (0 = Sunday .. 6 = Saturday). */
export function weekdayYMD(ymd: string): number {
  const n = dayNumber(ymd);
  return (((n + 4) % 7) + 7) % 7;
}
