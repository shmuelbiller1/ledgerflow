import { currencyDigits } from './currencyMinorUnits';
import { moneyText, type MoneyDisplaySettings } from './moneyFormat';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { toast } from 'sonner';
import Decimal from 'decimal.js';
import { useAuthStore } from '../stores/useAuthStore';
import { describeError } from './errorRemedies';
import { civilDateParts } from './calendarDate';

// Set default rounding mode to HALF_UP (standard financial rounding)
Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

/**
 * Specialized financial rounding using Decimal.js to prevent half-cent floating point drift.
 */
export { roundCents, calculateFXCents } from './cents';

/**
 * Safely parses string or numeric monetary inputs into integer cents without floating point precision errors.
 */
export function parseAmountToCents(val: string | number | undefined | null): number {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') {
    if (isNaN(val)) return 0;
    return new Decimal(val).mul(100).round().toNumber();
  }
  const cleanStr = String(val).replace(/[^0-9.-]/g, '');
  if (!cleanStr || cleanStr === '-') return 0;
  return new Decimal(cleanStr).mul(100).round().toNumber();
}

/** Known 3-decimal currencies per ISO 4217 (KWD, BHD, OMR, JOD, TND, LYD, IQD); one list with the storage rule (BM-04). */
export { THREE_DECIMAL_CURRENCIES, amountStep, minorToMajor } from './currencyMinorUnits';

/** The decimals amounts in this currency are stored and shown with (BM-04: src/lib/currencyMinorUnits.ts). */
export function getCurrencyFractionDigits(currency?: string): number {
  return currencyDigits(currency);
}

export function getCurrencyDivisor(currency?: string): number {
  const digits = getCurrencyFractionDigits(currency);
  return Math.pow(10, digits);
}

/** Numeric chart value in the same major units as formatCurrency; never parse display text. */
export function currencyChartValue(cents: number): number {
  const currency = typeof window !== 'undefined' ? window.__ledgerBaseCurrency || 'USD' : 'USD';
  return cents / getCurrencyDivisor(currency);
}

/**
 * Safe currency formatter with fallback
 */
/**
 * An amount with its direction as text, not only colour (E-26): "+$12.00" for money in,
 * "−$12.00" (minus sign) for money out, no sign when neither. `cents` is the size (any sign).
 */
export function formatSignedAmount(cents: number, direction: 'in' | 'out' | 'none', currency?: string): string {
  const sign = direction === 'in' ? '+' : direction === 'out' ? '\u2212' : '';
  return `${sign}${formatCurrency(Math.abs(cents || 0), currency)}`;
}

export function formatCurrency(cents: number | undefined | null, currency?: string): string {
  let targetCurrency = currency;
  if (!targetCurrency) {
    try {
      targetCurrency = (typeof window !== 'undefined' && window.__ledgerBaseCurrency) || 'USD';
    } catch {
      targetCurrency = 'USD';
    }
  }

  const state = useAuthStore.getState();
  const workspace = state.workspaces.find(w => w.id === state.currentWorkspaceId) as (typeof state.workspaces[number] & { moneyDisplay?: MoneyDisplaySettings }) | undefined;
  return moneyText(cents, targetCurrency, getCurrencyFractionDigits(targetCurrency), workspace?.moneyDisplay);

}

/**
 * Safe currency formatter for amounts already in dollars / major units
 */
export function formatDollars(dollars: number | undefined | null, currency?: string): string {
  const safeDollars = (dollars === undefined || dollars === null || isNaN(dollars)) ? 0 : dollars;
  const divisor = getCurrencyDivisor(currency);
  return formatCurrency(safeDollars * divisor, currency);
}

/**
 * Masks sensitive PII (Personally Identifiable Information) for Display
 */
export function maskPII(text: string | undefined | null): string {
  if (!text) return "";
  if (text.includes('@')) {
    const parts = text.split('@');
    if (parts.length >= 2) {
      const user = parts[0];
      const domain = parts.slice(1).join('@');
      return `${user.slice(0, 2)}***@${domain}`;
    }
  }
  // Mask potential account numbers
  const digitsOnly = text.replace(/[\s-]/g, '');
  if (/^\d{8,20}$/.test(digitsOnly)) {
    return `****${digitsOnly.slice(-4)}`;
  }
  return text;
}

/**
 * Accurately formats a cents value into a string representing decimal dollars without binary float issues.
 * Used for CSV exports. Example: 1005 -> "10.05"
 */
export function formatDecimal(cents: number): string {
  if (cents === null || cents === undefined || isNaN(cents)) return "0.00";
  const isNegative = cents < 0;
  const absCents = Math.abs(Math.round(cents));
  const dollars = Math.floor(absCents / 100);
  const remainder = absCents % 100;
  return `${isNegative && absCents > 0 ? '-' : ''}${dollars}.${remainder.toString().padStart(2, '0')}`;
}

/**
 * The date of a moment (default: now) in the workspace's time zone, or the device's when the
 * workspace has none: "today in the workspace". For a Date that stands for a calendar day
 * (new Date(y, m, d), a date picker), use calendarDateISO; for date arithmetic on YYYY-MM-DD
 * strings, use addToDateISO / monthEndISO (L-80).
 */
export function getLocalDateISO(d: Date = new Date()): string {
  let timezone = '';
  try {
    const state = useAuthStore.getState();
    const activeWorkspace = state?.workspaces?.find((w) => w.id === state?.currentWorkspaceId);
    if (activeWorkspace?.timezone) {
      timezone = activeWorkspace.timezone;
    }
  } catch {
    // Fallback if store is not yet accessible
  }

  if (!timezone) {
    try {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      timezone = 'UTC';
    }
  }

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
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
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * The calendar day a Date stands for, read in the device's own time zone (L-80): for Dates built
 * from a day (new Date(y, m, d), parseLocalDate), which getLocalDateISO would move to the
 * previous or next day when the workspace's time zone differs from the device's.
 */
export function calendarDateISO(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
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

function daysInMonth(year: number, month: number): number {
  return [31, (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

// Day numbers for the proleptic Gregorian calendar (H. Hinnant's algorithms): pure integer maths
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

/** This year and month (0–11) in the workspace, for "this year" defaults (L-80). */
export function workspaceYearMonth(): { year: number; month: number } {
  const today = getLocalDateISO();
  return { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 };
}

/** The first and last day of the month a YYYY-MM-DD date is in. */
export function monthBoundsISO(ymd: string): { start: string; end: string } {
  const start = `${ymd.slice(0, 7)}-01`;
  return { start, end: addToDateISO(addToDateISO(start, { months: 1 }), { days: -1 }) };
}

/**
 * Parses a YYYY-MM-DD string into a timezone-midnight Date object
 * Prevents UTC off-by-one errors from standard new Date('YYYY-MM-DD')
 */
export function parseLocalDate(s: string): Date {
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

    let timezone = '';
    try {
      const state = useAuthStore.getState();
      const activeWorkspace = state?.workspaces?.find((w) => w.id === state?.currentWorkspaceId);
      if (activeWorkspace?.timezone) {
        timezone = activeWorkspace.timezone;
      }
    } catch {
      // Fallback if auth store is unavailable
    }

    if (!timezone) {
      try {
        timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      } catch {
        timezone = 'UTC';
      }
    }

    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: false,
      });

      const utcDateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T00:00:00Z`;
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

/** Date display choices (Preferences → Date Display Format, I-12). */
export const DATE_DISPLAY_FORMATS = ['MMM DD, YYYY', 'YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY'] as const;
export const DEFAULT_DATE_DISPLAY = 'MMM DD, YYYY';
let dateDisplay: string | null = null;
/** The user's choice (saved by useUIStore.setDateFormatPref), read when first needed. */
function currentDateDisplay(): string {
  if (dateDisplay === null) {
    let saved: string | null = null;
    try { saved = typeof localStorage !== 'undefined' ? localStorage.getItem('lf_date_format') : null; } catch { /* storage unavailable */ }
    dateDisplay = saved && (DATE_DISPLAY_FORMATS as readonly string[]).includes(saved) ? saved : DEFAULT_DATE_DISPLAY;
  }
  return dateDisplay;
}
/** Called when the user picks another format. */
export function setDateDisplayFormat(pref: string): void {
  dateDisplay = (DATE_DISPLAY_FORMATS as readonly string[]).includes(pref) ? pref : DEFAULT_DATE_DISPLAY;
}

/**
 * A calendar date for display, in the user's chosen format (never for inputs or files: use
 * YYYY-MM-DD there). A stored calendar date (YYYY-MM-DD) is shown exactly as written, on every
 * device and in every workspace zone; a moment (a Date, or a timestamp with a time in it) is read
 * in the device's zone as before (D-65).
 */
export function formatDate(dateStr: string | Date | undefined | null, pref: string = currentDateDisplay()): string {
  if (!dateStr) return '';
  const civil = typeof dateStr === 'string' ? civilDateParts(dateStr) : null;
  const d = civil ? null : (typeof dateStr === 'string' ? parseLocalDate(dateStr) : dateStr);
  if (d && isNaN(d.getTime())) return String(dateStr);
  const year = civil ? civil.year : d!.getFullYear();
  const monthIndex = civil ? civil.month - 1 : d!.getMonth();
  const dayOfMonth = civil ? civil.day : d!.getDate();
  const y = String(year);
  const m = String(monthIndex + 1).padStart(2, '0');
  const day = String(dayOfMonth).padStart(2, '0');
  switch (pref) {
    case 'YYYY-MM-DD': return `${y}-${m}-${day}`;
    case 'MM/DD/YYYY': return `${m}/${day}/${y}`;
    case 'DD/MM/YYYY': return `${day}/${m}/${y}`;
    default: return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][monthIndex]} ${day}, ${y}`;
  }
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Sanitizes a string value against CSV/Formula injection attacks.
 * Prevents execution of spreadsheet formulas starting with =, +, -, @, \t, \r
 */
export function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  if (typeof value === 'number') return String(value);
  
  let str = String(value);
  
  // Purely formatted numbers (like -1,000.00 or -$50.00) are safe from formula injection
  const isSafeNumber = /^-?\$?\s*\d{1,3}(,?\d{3})*(\.\d+)?$/.test(str);
  
  if (!isSafeNumber && /^[=+\-@\t\r]/.test(str)) {
    str = "'" + str;
  }
  
  return `"${str.replace(/"/g, '""')}"`;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
  AUTH = 'auth',
  SYNC = 'sync'
}

export interface AppErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  timestamp: string;
  context?: Record<string, unknown>;
  stack?: string;
}

/**
 * Enhanced Error Logger
 * Captures deep context for forensic debugging
 */
export function reportError(error: unknown, operationType: OperationType, path: string | null = null, context?: Record<string, unknown>) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  
  const errInfo: AppErrorInfo = {
    error: message,
    operationType,
    path,
    timestamp: new Date().toISOString(),
    context,
    stack
  };

  console.error(`[FORENSIC ERROR] ${(operationType || 'UNKNOWN').toUpperCase()}:`, JSON.stringify(errInfo, null, 2));
  
  // UI feedback: what happened in plain words and what to do (errorRemedies.ts); details stay in the console
  const described = describeError(error, String(operationType || ''));
  toast.error(described.title, { description: described.remedy });

  return errInfo;
}

/**
 * Async Safety Wrapper
 * Automatically handles errors and reports them
 */
export async function safeAsync<T>(
  promise: Promise<T>, 
  operationType: OperationType, 
  path: string | null = null,
  context?: Record<string, unknown>
): Promise<[T | null, AppErrorInfo | null]> {
  try {
    const result = await promise;
    return [result, null];
  } catch (error) {
    const errInfo = reportError(error, operationType, path, context);
    return [null, errInfo];
  }
}

/**
 * Reliability Engine: Execute async function with exponential backoff retry logic.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 500
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      attempt++;
      if (attempt > maxRetries || ((error as Error & { code: string })?.code && (error as Error & { code: string }).code === 'permission-denied')) {
        throw error;
      }
      const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 200;
      console.warn(`[RETRY] Operation failed (Attempt ${attempt}/${maxRetries}). Retrying in ${delay.toFixed(0)}ms...`, error);
      await new Promise(res => setTimeout(res, delay));
    }
  }
}

/**
 * Safe confirmation modal dialog helper.
 * Degrades gracefully inside sandboxed browser iframes where window.confirm causes SecurityError.
 * Fails closed (returns false) to prevent accidental execution of destructive actions.
 */
export function safeConfirm(message: string): boolean {
  try {
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      return window.confirm(message);
    }
    return false;
  } catch (error) {
    console.warn('[SANDBOX CAUGHT] window.confirm execution prevented by environment. Refusing destructive action for safety.', error);
    return false;
  }
}

/**
 * Resolves account name dynamically from chart of accounts using accountId first,
 * falling back to line.accountName or line.accountId if deleted/archived.
 */
export function resolveAccountName(accounts: { id: string; name?: string }[], accountId?: string, fallbackName?: string): string {
  if (!accountId && !fallbackName) return 'Uncategorized';
  if (accountId && Array.isArray(accounts)) {
    const matched = accounts.find(a => a.id === accountId);
    if (matched?.name) return matched.name;
  }
  return fallbackName || accountId || 'Uncategorized';
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
      day: '2-digit'
    });
    return formatter.format(d); // Output: YYYY-MM-DD in en-CA locale
  } catch {
    return d.toISOString().split('T')[0];
  }
}


/**
 * Keyboard activation for an element that acts as a button but isn't one (E-23): Enter or Space
 * runs its onClick, like a real button.
 */
export function activateOnKey(e: { key: string; preventDefault: () => void; currentTarget: { click: () => void } }): void {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    e.currentTarget.click();
  }
}
