import { readBrowserWorkspacePrefs } from './workspacePrefs';

/**
 * Pure civil-calendar arithmetic and explicit-timezone date helpers.
 * Never imports UI stores or browser-only libraries; server callers pass workspace timezone
 * explicitly from trusted request/database context.
 */

const pad2 = (n: number) => String(n).padStart(2, '0');

export const isLeapYear = (y: number): boolean =>
  (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export const daysInMonth = (y: number, m: number): number =>
  [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

/** Days since 1970-01-01 (proleptic Gregorian). */
export function dayNumber(ymd: string): number {
  const [yy, m, d] = ymd.slice(0, 10).split('-').map(Number);
  if (Number.isNaN(yy) || Number.isNaN(m) || Number.isNaN(d)) return Number.NaN;
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
const CIVIL_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Short civil displays read from the stored text alone, for date badges and list rows: 'Jan 01',
 * 'Jan 2026', '01'. Formatting a stored date through an instant (`format(parseLocalDate(x), …)`)
 * reads the device zone instead, so a Jan-1 entry in an Auckland workspace showed as Dec-31 on a
 * UTC laptop (#342). An unparseable value shows nothing rather than throwing the way date-fns does
 * on an invalid Date.
 */
export function civilMonthDay(value: string | null | undefined): string {
  const parts = value ? civilDateParts(value) : null;
  return parts ? `${CIVIL_MONTHS[parts.month - 1]} ${String(parts.day).padStart(2, '0')}` : '';
}

export function civilMonthYear(value: string | null | undefined): string {
  const parts = value ? civilDateParts(value) : null;
  return parts ? `${CIVIL_MONTHS[parts.month - 1]} ${parts.year}` : '';
}

export function civilDayOfMonth(value: string | null | undefined): string {
  const parts = value ? civilDateParts(value) : null;
  return parts ? String(parts.day).padStart(2, '0') : '';
}

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

/**
 * The calendar day a Date stands for, read in the device's own time zone (L-80): for Dates built
 * from a day (new Date(y, m, d), parseLocalDate), which getLocalDateISO would move to the
 * previous or next day when the workspace's time zone differs from the device's.
 */
export function calendarDateISO(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe;
}

function civilFromDays(days: number): string {
  const era = Math.floor(days / 146097);
  const doe = days - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/**
 * A YYYY-MM-DD date moved by whole years, months and days, in plain calendar maths (no time
 * zones). Moving by months or years keeps the day, capped at the month's last day
 * (2024-02-29 − 1 year = 2023-02-28; 2026-01-31 + 1 month = 2026-02-28).
 */
export function addToDateISO(ymd: string, by: { years?: number; months?: number; days?: number }): string {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  const monthIndex = (y + (by.years || 0)) * 12 + (m - 1) + (by.months || 0);
  const year = Math.floor(monthIndex / 12);
  const month = monthIndex - year * 12 + 1;
  const day = Math.min(d, daysInMonth(year, month));
  return civilFromDays(daysFromCivil(year, month, day) + (by.days || 0));
}

/** The first and last day of the month a YYYY-MM-DD date is in. */
export function monthBoundsISO(ymd: string): { start: string; end: string } {
  const start = `${ymd.slice(0, 7)}-01`;
  return { start, end: addToDateISO(addToDateISO(start, { months: 1 }), { days: -1 }) };
}

function resolvedSystemTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Formats a Date into YYYY-MM-DD for an explicit timezone (or system timezone / UTC when omitted).
 * Server routes and services pass the workspace timezone from trusted request context.
 */
export function getDateInTimezoneISO(d: Date = new Date(), timezone?: string): string {
  const tz = (typeof timezone === 'string' && timezone.trim()) ? timezone.trim() : resolvedSystemTimezone();
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(d);
    const y = parts.find(p => p.type === 'year')?.value;
    const m = parts.find(p => p.type === 'month')?.value;
    const day = parts.find(p => p.type === 'day')?.value;
    if (y && m && day) {
      return `${y}-${m}-${day}`;
    }
  } catch {
    // Fallback to standard local Date string formatting
  }
  const year = d.getFullYear();
  const month = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  return `${year}-${month}-${day}`;
}

/**
 * The date of a moment (default: now) in the given or active workspace's time zone, or the
 * device's when the workspace has none.
 */
export function getLocalDateISO(d: Date = new Date(), timezone?: string): string {
  const resolvedTz = timezone ?? readBrowserWorkspacePrefs()?.timezone;
  return getDateInTimezoneISO(d, resolvedTz);
}

/** This year and month (0–11) in the workspace, for "this year" defaults (L-80). */
export function workspaceYearMonth(timezone?: string): { year: number; month: number } {
  const today = getLocalDateISO(new Date(), timezone);
  return { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 };
}

/**
 * Parses a YYYY-MM-DD string into a timezone-midnight Date object in an explicit timezone
 * (or system timezone / UTC when omitted).
 */
export function parseDateInTimezone(s: string, timezone?: string): Date {
  if (!s) return new Date();
  let parts: number[] = [];
  if (s.includes('T')) {
    const dObj = new Date(s);
    parts = [dObj.getFullYear(), dObj.getMonth() + 1, dObj.getDate()];
  } else {
    const splitParts = s.split('-');
    if (splitParts.length === 3) {
      parts = splitParts.map(Number);
    }
  }

  if (parts.length === 3) {
    const [y, m, d] = parts;
    const localDate = new Date(y, m - 1, d, 0, 0, 0, 0);
    const tz = (typeof timezone === 'string' && timezone.trim()) ? timezone.trim() : resolvedSystemTimezone();

    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: false,
      });

      const utcDateStr = `${y}-${pad2(m)}-${pad2(d)}T00:00:00Z`;
      const tempDate = new Date(utcDateStr);

      const partsArr = formatter.formatToParts(tempDate);
      const fY = Number(partsArr.find(p => p.type === 'year')?.value);
      const fM = Number(partsArr.find(p => p.type === 'month')?.value);
      const fD = Number(partsArr.find(p => p.type === 'day')?.value);
      const fH = Number(partsArr.find(p => p.type === 'hour')?.value);
      const fMin = Number(partsArr.find(p => p.type === 'minute')?.value);

      const formattedDate = new Date(fY, fM - 1, fD, fH, fMin, 0, 0);
      const offsetMs = tempDate.getTime() - formattedDate.getTime();

      return new Date(localDate.getTime() + offsetMs);
    } catch {
      return localDate;
    }
  }
  return new Date(s);
}

/**
 * Parses a YYYY-MM-DD string into a timezone-midnight Date object using the explicit or active
 * browser workspace timezone.
 */
export function parseLocalDate(s: string, timezone?: string): Date {
  const resolvedTz = timezone ?? readBrowserWorkspacePrefs()?.timezone;
  return parseDateInTimezone(s, resolvedTz);
}

/**
 * Formats a Date into YYYY-MM-DD for a specific timezone (e.g., 'America/New_York', 'Pacific/Auckland').
 */
export function formatTzDate(d: Date = new Date(), timezone = 'UTC'): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(d);
  } catch {
    return d.toISOString().split('T')[0];
  }
}
