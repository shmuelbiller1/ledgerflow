import Decimal from 'decimal.js';
import { currencyDigits } from './currencyMinorUnits';
import { readBrowserWorkspacePrefs } from './workspacePrefs';

// Set default rounding mode to HALF_UP (standard financial rounding)
Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

export interface MoneyDisplaySettings {
  locale?: string;
  negativeStyle?: 'minus' | 'accounting';
}

/** Display only. The caller supplies currency minor-unit precision; no amount is written back. */
export function moneyText(cents: number | null | undefined, currency: string, digits: number, settings: MoneyDisplaySettings = {}): string {
  const amount = typeof cents === 'number' && Number.isFinite(cents) ? cents : 0;
  let locale: string | undefined;
  try { if (settings.locale && settings.locale.length <= 64) locale = Intl.getCanonicalLocales(settings.locale)[0]; } catch { /* retain the browser default */ }
  const accounting = settings.negativeStyle === 'accounting' && amount < 0;
  let text: string;
  try {
    text = new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format((accounting ? Math.abs(amount) : amount) / 10 ** digits);
  } catch { text = `${currency} ${((accounting ? Math.abs(amount) : amount) / 10 ** digits).toFixed(digits)}`; }
  return accounting ? `(${text})` : text;
}

/** Number styles offered (BB-05, BM-01..BM-03); the workspace may keep another valid one. */
export const MONEY_LOCALES = [
  { value: '', label: 'This browser\'s' },
  { value: 'en-US', label: 'United States' },
  { value: 'en-GB', label: 'United Kingdom' },
  { value: 'he-IL', label: 'Israel' },
  { value: 'de-DE', label: 'Germany' },
  { value: 'fr-FR', label: 'France' },
  { value: 'es-ES', label: 'Spain' },
  { value: 'it-IT', label: 'Italy' },
  { value: 'nl-NL', label: 'Netherlands' },
  { value: 'de-CH', label: 'Switzerland' },
  { value: 'en-IN', label: 'India' },
  { value: 'ja-JP', label: 'Japan' },
] as const;

/** The decimals amounts in this currency are stored and shown with (BM-04: src/lib/currencyMinorUnits.ts). */
export function getCurrencyFractionDigits(currency?: string): number {
  return currencyDigits(currency);
}

export function getCurrencyDivisor(currency?: string): number {
  const digits = getCurrencyFractionDigits(currency);
  return Math.pow(10, digits);
}

/**
 * Pure explicit-context currency formatter for backend and pure domain callers.
 * Never touches window or frontend stores; pass workspace currency and moneyDisplay explicitly.
 */
export function formatMoney(
  cents: number | undefined | null,
  currency?: string,
  moneyDisplay?: MoneyDisplaySettings,
): string {
  const targetCurrency = currency || 'USD';
  return moneyText(cents, targetCurrency, getCurrencyFractionDigits(targetCurrency), moneyDisplay);
}

function readWindowBaseCurrency(): string {
  try {
    const win = typeof window !== 'undefined' ? (window as Window & { __ledgerBaseCurrency?: string }) : undefined;
    return win?.__ledgerBaseCurrency || 'USD';
  } catch {
    return 'USD';
  }
}

/** Numeric chart value in the same major units as formatCurrency; never parse display text. */
export function currencyChartValue(cents: number, currency?: string): number {
  const target = currency || readWindowBaseCurrency();
  return cents / getCurrencyDivisor(target);
}

export function formatCurrency(
  cents: number | undefined | null,
  currency?: string,
  moneyDisplay?: MoneyDisplaySettings,
): string {
  const targetCurrency = currency || readWindowBaseCurrency();
  const resolvedDisplay = moneyDisplay ?? readBrowserWorkspacePrefs()?.moneyDisplay;
  return formatMoney(cents, targetCurrency, resolvedDisplay);
}

/**
 * Safe currency formatter for amounts already in dollars / major units.
 */
export function formatDollars(
  dollars: number | undefined | null,
  currency?: string,
  moneyDisplay?: MoneyDisplaySettings,
): string {
  const safeDollars = (dollars === undefined || dollars === null || isNaN(dollars)) ? 0 : dollars;
  const divisor = getCurrencyDivisor(currency);
  return formatCurrency(safeDollars * divisor, currency, moneyDisplay);
}

/**
 * An amount with its direction as text, not only colour (E-26): "+$12.00" for money in,
 * "−$12.00" (minus sign) for money out, no sign when neither. `cents` is the size (any sign).
 */
export function formatSignedAmount(
  cents: number,
  direction: 'in' | 'out' | 'none',
  currency?: string,
  moneyDisplay?: MoneyDisplaySettings,
): string {
  const sign = direction === 'in' ? '+' : direction === 'out' ? '\u2212' : '';
  return `${sign}${formatCurrency(Math.abs(cents || 0), currency, moneyDisplay)}`;
}

/**
 * Accurately formats a cents value into a string representing decimal dollars without binary float issues.
 * Used for CSV exports. Example: 1005 -> "10.05"
 */
export function formatDecimal(cents: number): string {
  if (cents === null || cents === undefined || isNaN(cents)) return '0.00';
  const isNegative = cents < 0;
  const absCents = Math.abs(Math.round(cents));
  const dollars = Math.floor(absCents / 100);
  const remainder = absCents % 100;
  return `${isNegative && absCents > 0 ? '-' : ''}${dollars}.${remainder.toString().padStart(2, '0')}`;
}

/** Amount text as typed or pasted: direction marks dropped (he-IL money text carries them), no-break spaces made plain. */
function plainAmountText(val: string): string {
  return String(val).replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '').replace(/[\u00A0\u202F]/g, ' ').replace(/\u2019/g, "'").trim();
}

/** Whether the books' money locale (or the browser's) writes the decimal with a comma, as de-DE and fr-FR do. */
function localeWritesDecimalComma(localeOverride?: string): boolean {
  try {
    const wanted = localeOverride !== undefined ? localeOverride : readBrowserWorkspacePrefs()?.moneyDisplay?.locale;
    const locale = wanted && wanted.length <= 64 ? Intl.getCanonicalLocales(wanted)[0] : undefined;
    return new Intl.NumberFormat(locale).formatToParts(1.5).find(part => part.type === 'decimal')?.value === ',';
  } catch {
    return false;
  }
}

/**
 * AF-011: many locales write the decimal with a comma ('12,50', '1.234,56', '1 234,56 €'). The comma is the
 * decimal point only when it is the last separator and exactly two digits follow it.
 */
function decimalCommaAsPoint(text: string, opts: { complete?: boolean; locale?: string } = {}): string {
  const m = text.match(/^([^\d,.]*)(\d{1,3}(?:\.\d{3})+|\d{1,3}(?:[ ']\d{3})+|\d+),(\d{2})([^\d,.]*)$/);
  if (!m) return text;
  if (opts.complete && /^\d{1,3}$/.test(m[2]) && !localeWritesDecimalComma(opts.locale)) return text;
  return `${m[1]}${m[2].replace(/\./g, '')}.${m[3]}${m[4]}`;
}

export function isAmountText(val: string, opts: { complete?: boolean; locale?: string } = {}): boolean {
  const text = decimalCommaAsPoint(plainAmountText(val), opts);
  const inner = text.replace(/^\(/, '').replace(/\)$/, '').trim();
  if (!/\d/.test(inner)) return false;
  if ((inner.match(/[-+]/g) || []).length > 1) return false;
  if (opts.complete) {
    if (text.startsWith('(') !== text.endsWith(')')) return false;
    return /^[-+]?\s*(?:[A-Za-z]{1,3}\s*)?\p{Sc}?\s*[-+]?\s*(?:\d{1,3}(?:([, '])\d{3})?(?:\1\d{3})*|\d{1,2}(?:,\d{2})+,\d{3}|\d+)?(?:\.\d*)?\s*(?:[A-Za-z]{1,3}\s*)?\p{Sc}?$/u.test(inner);
  }
  return /^[-+]?\s*(?:[A-Za-z]{1,3}\s*)?\p{Sc}?\s*[-+]?\s*(?:\d+(?:[, ']\d{0,3})*)?(?:\.\d*)?\s*(?:[A-Za-z]{1,3}\s*)?\p{Sc}?$/u.test(inner);
}

export function parseAmountToCents(val: string | number | undefined | null, opts: { locale?: string } = {}): number {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return 0;
    return new Decimal(val).mul(100).round().toNumber();
  }
  const text = decimalCommaAsPoint(plainAmountText(val), { locale: opts.locale });
  if (!/\d/.test(text)) return 0;
  if (/\d[\s\p{L}\p{Sc}]*[+*/×÷=][\s\p{L}\p{Sc}(]*\d/u.test(text)) throw new Error(`"${text}" is not an amount`);
  const cleanStr = text.replace(/[^0-9.-]/g, '');
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(cleanStr)) throw new Error(`"${text}" is not an amount`);
  const cents = new Decimal(cleanStr).mul(100).round().toNumber();
  return text.startsWith('(') ? -Math.abs(cents) : cents;
}

/**
 * Typed amount text as cents, or null when it is blank or not a finished amount ('1.2.3', '1,2', '(100').
 * For screens that read an amount while drawing or before saving: never throws, never turns a typo into 0.
 */
export function readAmountCents(val: string | null | undefined, opts: { locale?: string } = {}): number | null {
  if (val == null || !String(val).trim() || !isAmountText(String(val), { complete: true, locale: opts.locale })) return null;
  const letters = plainAmountText(String(val)).replace(/[A-Za-z]{1,3}(?=\s*\p{Sc})/gu, '').match(/[A-Za-z]+/g) || [];
  if (letters.some(w => w.length !== 3)) return null;
  try {
    return parseAmountToCents(String(val), opts);
  } catch {
    return null;
  }
}
