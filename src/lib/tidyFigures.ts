import { currencyDigits } from './currencyMinorUnits';
import { getIsoCurrency } from './isoCurrencyReference';

/**
 * Rounds float noise out of the amounts in a model's answer before it is shown: "$42,454.545454545456"
 * becomes "$42,454.55" (27 Nov 2026 model test: the sum was right, the display was not).
 * Only an amount is touched, meaning a number written next to a currency sign or code ("$", "€", "₪", "USD",
 * "KWD", "ש"ח"), and only when it has five or more decimals. Invoice numbers, percentages, scaled
 * amounts ("$1.2345678 million") and exchange rates stay as written. The amount is rounded to its currency's
 * minor units: the code written next to it, else the workspace currency, else two. Thousands separators
 * are kept as written.
 */
const SIGNS: Record<string, string> = { $: 'USD', '€': 'EUR', '£': 'GBP', '₪': 'ILS', '¥': 'JPY' };
// signs more than one currency writes: the code next to the amount decides, then the workspace currency
const SHARED_SIGNS: Record<string, readonly string[]> = { '¥': ['JPY', 'CNY'], $: ['USD', 'CAD', 'AUD', 'NZD', 'SGD', 'HKD', 'MXN'] };
const NUMBER = String.raw`(\d{1,3}(?:,\d{3})+|\d+)\.(\d{5,})`;
// a sign may touch the number ("$-12.5"); a code is followed by one space ("KWD 7.125"), so "INV-1.5" is no amount
// not before a scale word ("$0.00123456 million" is $1,234.56: rounding it would make it zero) or a percent sign
const NOT_AFTER = String.raw`(?!\w|\.\d|\s?%|\s?(?:k|K|m|M|bn|thousand|million|billion)\b)`;
// Read around the whole currency-and-number expression, not just the next character: a scale word or a
// percent sign after it ("0.00123456 USD million", "$0.0012345 USD million") means the digits are not minor
// units, and "=", "@", "rate" or "per" around it mean an exchange rate ("1 USD = 0.923456 EUR"), whose precision
// is its own. Either way the number is left as written.
const SCALED_AFTER = /^\s?(?:[A-Z]{3}\s?)?(?:%|(?:k|K|m|M|bn|thousand|million|billion)\b)/;
// "=" or "@" is a conversion only after another currency's amount ("1 USD =", "€1 ="): "Total owed = $85,000" is a total
// only a currency conversion counts: "the monthly rate is $85,000 per month" is an amount, and is rounded and checked
const RATE_BEFORE = /(?:(?:\d[\d.,]*\s?[A-Z]{3}|[A-Z]{3}\s?\d[\d.,]*|[$€£₪¥]\s?\d[\d.,]*)\s*[=@]|\bexchange rate\b[^.\n]*)\s*$/i;
/** The number between `start` and `end` is an exchange rate, not an amount ("1 USD = 0.92 EUR", "EUR 0.92 per USD"). */
export const isRateContext = (all: string, start: number, end: number) =>
  RATE_BEFORE.test(all.slice(Math.max(0, start - 40), start)) || /^\s?(?:[A-Z]{3}\s?)?(?:=|(?:per\b|\/)\s?(?:[A-Z]{3}\b|[$€£₪¥]|ש))/.test(all.slice(end, end + 16));
const leaveAlone = (all: string, start: number, end: number) => SCALED_AFTER.test(all.slice(end, end + 16)) || isRateContext(all, start, end);
const BEFORE = new RegExp(String.raw`(?:([$€£₪¥]) ?-?|\b([A-Z]{3}) )${NUMBER}${NOT_AFTER}`, 'g');
const AFTER = new RegExp(String.raw`(?<![\w.]|\w-)${NUMBER} ?([₪€]|[A-Z]{3}\b|ש["״]ח)`, 'g');

function digitsFor(mark: string, written: string | undefined, fallback: string | null | undefined): number {
  const shared = SHARED_SIGNS[mark];
  const fromSign = shared && fallback && shared.includes(fallback) ? fallback : SIGNS[mark];
  const code = written ?? (/^[A-Z]{3}$/.test(mark) ? mark : mark.startsWith('ש') ? 'ILS' : fromSign);
  for (const c of [code, fallback]) {
    if (!c) continue;
    try { return currencyDigits(c); } catch { /* not a currency code: try the next */ }
  }
  return 2;
}

/** Half-up rounding on the decimal text itself, so 2.675 is 2.68 (a binary float would give 2.67). */
function round(whole: string, decimals: string, digits: number): string {
  const plain = whole.replace(/,/g, '');
  const kept = BigInt(plain + decimals.slice(0, digits).padEnd(digits, '0')) + (Number(decimals[digits] ?? '0') >= 5 ? 1n : 0n);
  const text = kept.toString().padStart(digits + 1, '0');
  const int = text.slice(0, text.length - digits) || '0';
  const frac = text.slice(text.length - digits);
  const grouped = whole.includes(',') ? BigInt(int).toLocaleString('en-US') : int;
  return digits ? `${grouped}.${frac}` : grouped;
}

export function tidyFigures(text: string, workspaceCurrency?: string | null): string {
  return text
    .replace(BEFORE, (match: string, sign: string | undefined, code: string | undefined, whole: string, decimals: string, offset: number, all: string) => {
      // three capitals are a currency only when ISO 4217 lists them ("VAT 17.123456" is not an amount)
      if ((code && !getIsoCurrency(code)) || leaveAlone(all, offset, offset + match.length)) return match;
      // "¥123.456 CNY": a code written after the amount names its currency
      const trailing = /^ ?([A-Z]{3})\b/.exec(all.slice(offset + match.length))?.[1];
      // only a real ISO code overrides the sign ("$1.2345678 VAT" stays dollars)
      const after = trailing && getIsoCurrency(trailing) ? trailing : undefined;
      return match.replace(`${whole}.${decimals}`, round(whole, decimals, digitsFor(sign ?? code ?? '', code ?? after, workspaceCurrency)));
    })
    .replace(AFTER, (match: string, whole: string, decimals: string, mark: string, offset: number, all: string) =>
      (/^[A-Z]{3}$/.test(mark) && !getIsoCurrency(mark)) || leaveAlone(all, offset, offset + match.length) ? match :
      match.replace(`${whole}.${decimals}`, round(whole, decimals, digitsFor(mark, undefined, workspaceCurrency))));
}
