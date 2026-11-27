import { currencyDigits } from './currencyMinorUnits';

/**
 * Rounds float noise out of the amounts in a model's answer before it is shown: "$42,454.545454545456"
 * becomes "$42,454.55" (27 Nov 2026 model test: the sum was right, the display was not).
 * Only an amount is touched, meaning a number written next to a currency sign or code ("$", "€", "₪", "USD",
 * "KWD", "ש"ח"), and only when it has five or more decimals. Invoice numbers, rates and percentages are never
 * next to a currency mark in that way, so they stay as written. The amount is rounded to its currency's
 * minor units: the code written next to it, else the workspace currency, else two. Thousands separators
 * are kept as written.
 */
const SIGNS: Record<string, string> = { $: 'USD', '€': 'EUR', '£': 'GBP', '₪': 'ILS', '¥': 'JPY' };
const NUMBER = String.raw`(\d{1,3}(?:,\d{3})+|\d+)\.(\d{5,})`;
// a sign may touch the number ("$-12.5"); a code is followed by one space ("KWD 7.125"), so "INV-1.5" is no amount
const BEFORE = new RegExp(String.raw`(?:([$€£₪¥]) ?-?|\b([A-Z]{3}) )${NUMBER}(?!\w|\.\d)`, 'g');
const AFTER = new RegExp(String.raw`(?<![\w.]|\w-)${NUMBER} ?([₪]|[A-Z]{3}\b|ש["״]ח)`, 'g');

function digitsFor(mark: string, fallback: string | null | undefined): number {
  const code = SIGNS[mark] ?? (/^[A-Z]{3}$/.test(mark) ? mark : mark.startsWith('ש') ? 'ILS' : null);
  for (const c of [code, fallback]) {
    if (!c) continue;
    try { return currencyDigits(c); } catch { /* not a currency code: try the next */ }
  }
  return 2;
}

function round(whole: string, decimals: string, digits: number): string {
  const value = Number(`${whole.replace(/,/g, '')}.${decimals}`);
  const fixed = value.toFixed(digits);
  const [int, frac] = fixed.split('.');
  const grouped = whole.includes(',') ? Number(int).toLocaleString('en-US') : int;
  return frac === undefined ? grouped : `${grouped}.${frac}`;
}

export function tidyFigures(text: string, workspaceCurrency?: string | null): string {
  return text
    .replace(BEFORE, (match: string, sign: string | undefined, code: string | undefined, whole: string, decimals: string) =>
      match.replace(`${whole}.${decimals}`, round(whole, decimals, digitsFor(sign ?? code ?? '', workspaceCurrency))))
    .replace(AFTER, (match: string, whole: string, decimals: string, mark: string) =>
      match.replace(`${whole}.${decimals}`, round(whole, decimals, digitsFor(mark, workspaceCurrency))));
}
