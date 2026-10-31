import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { toast } from 'sonner';
import '../stores/useAuthStore';
import { describeError } from './errorRemedies';
import {
  addToDateISO,
  calendarDateISO,
  civilDateParts,
  formatTzDate,
  getDateInTimezoneISO,
  getLocalDateISO,
  monthBoundsISO,
  parseDateInTimezone,
  parseLocalDate,
  workspaceYearMonth,
} from './calendarDate';

export { roundCents, calculateFXCents } from './cents';
export { THREE_DECIMAL_CURRENCIES, amountStep, minorToMajor } from './currencyMinorUnits';
export {
  currencyChartValue,
  formatCurrency,
  formatDecimal,
  formatDollars,
  formatMoney,
  formatSignedAmount,
  getCurrencyDivisor,
  getCurrencyFractionDigits,
  isAmountText,
  parseAmountToCents,
  readAmountCents,
} from './moneyFormat';
export {
  addToDateISO,
  calendarDateISO,
  formatTzDate,
  getDateInTimezoneISO,
  getLocalDateISO,
  monthBoundsISO,
  parseDateInTimezone,
  parseLocalDate,
  workspaceYearMonth,
};
export { sanitizeCsvCell } from './csv';

/**
 * Masks sensitive PII (Personally Identifiable Information) for Display
 */
export function maskPII(text: string | undefined | null): string {
  if (!text) return '';
  if (text.includes('@')) {
    const parts = text.split('@');
    if (parts.length >= 2) {
      const user = parts[0];
      const domain = parts.slice(1).join('@');
      return `${user.slice(0, 2)}***@${domain}`;
    }
  }
  const digitsOnly = text.replace(/[\s-]/g, '');
  if (/^\d{8,20}$/.test(digitsOnly)) {
    return `****${digitsOnly.slice(-4)}`;
  }
  return text;
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
    stack,
  };

  console.error(`[FORENSIC ERROR] ${(operationType || 'UNKNOWN').toUpperCase()}:`, JSON.stringify(errInfo, null, 2));

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
  context?: Record<string, unknown>,
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
  baseDelayMs: number = 500,
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
 * Keyboard activation for an element that acts as a button but isn't one (E-23): Enter or Space
 * runs its onClick, like a real button.
 */
export function activateOnKey(e: { key: string; preventDefault: () => void; currentTarget: { click: () => void } }): void {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    e.currentTarget.click();
  }
}
