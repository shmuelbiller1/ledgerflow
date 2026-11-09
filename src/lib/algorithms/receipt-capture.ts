import { AlgorithmDefinition } from './types';

/**
 * AUD-14: reads the merchant, date and total from a receipt's text lines (from a scanner or OCR) with simple positional
 * rules — no model. It reads the text the person pastes; the built-in receipt is shown only as a labelled example. What
 * the rules cannot be sure of is a warning, never a confident answer: more than one total, more than one date, a total
 * found without the word "total", a currency that is not stated. No accuracy figure is claimed: none was measured.
 */
export interface ReceiptReading {
  merchant: string;
  dateStr: string;
  totalCents: number;
  /** the currency the receipt states ($, €, £, ₪ or a code), when it states one */
  currency?: string;
  warnings: string[];
}

const SYMBOLS: Record<string, string> = { '$': 'USD', '€': 'EUR', '£': 'GBP', '₪': 'ILS' };
const DOLLAR_CODES = new Set(['USD', 'CAD', 'AUD', 'NZD']);
const CODE = /\b(USD|EUR|GBP|ILS|NIS|CAD|AUD|NZD)\b/g;
// An amount with dot decimals. Comma thousands anywhere; space / no-break-space thousands only right after a symbol
// ("$1 234.56"). The look-behind keeps a digit group from being split, so "1 234.56" is never read as 234.56.
const AMOUNT = /(?<![\d.,]|\d[ \u00a0\u202f])(?:([$€£₪])\s*(\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?![\d,])|\d{1,3}(?:,\d{3})+|\d+)|(\d{1,3}(?:,\d{3})+|\d+))\.(\d{2})(?!\d)/;
const SPACED = /\d[ \u00a0\u202f]\d{3}\.\d{2}(?!\d)/;
const DATE = /(?<!\d)(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/.-]\d{1,2}[/.-](?:\d{4}|\d{2}))(?!\d)/g;
const PAYABLE = /\b(?:grand\s+total|amount\s+due|balance\s+due|total\s+due|total)\b/i;
const QUALIFIED = /sub\s*-?\s*total|\btotal\s+(?:savings?|saved|tax(?:es)?|discounts?|items?|qty|quantity)\b|\b(?:savings?|tax(?:es)?|discounts?|items?|qty|quantity)\s+total\b/i;

interface Amount { symbol?: string; whole: string; fraction: string; line: string }
const readAmount = (line: string): Amount | undefined => {
  const m = line.match(AMOUNT);
  return m ? { symbol: m[1], whole: m[2] ?? m[3], fraction: m[4], line } : undefined;
};
const cents = (a: Amount) => Number(a.whole.replace(/[^\d]/g, '')) * 100 + Number(a.fraction);
const shown = (a: Amount) => `${a.whole.replace(/[^\d]/g, '').replace(/\B(?=(\d{3})+$)/g, ',')}.${a.fraction}`;

const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const validDay = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= MONTH_DAYS[m - 1] + (m === 2 && leap(y) ? 1 : 0);
/** A date is kept only when its parts can be a calendar date (as day/month or month/day). */
function isDate(s: string): boolean {
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return validDay(+iso[1], +iso[2], +iso[3]);
  const [a, b, y] = s.split(/[/.-]/).map(Number);
  const year = y < 100 ? 2000 + y : y;
  if (year < 1900 || year > 2100) return false;
  return validDay(year, b, a) || validDay(year, a, b);
}

const tokens = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);
/** A known payee matches a line only as whole words, in order ("Mart" does not match "WALMART"). */
function hasWords(line: string, name: string): boolean {
  const l = tokens(line), n = tokens(name);
  if (!n.length) return false;
  for (let i = 0; i + n.length <= l.length; i++) if (n.every((t, j) => l[i + j] === t)) return true;
  return false;
}

export function parseReceiptOCR(ocrLines: string[], existingMerchants: string[]): ReceiptReading {
  const lines = ocrLines.map(l => l.trim()).filter(Boolean);
  const warnings: string[] = [];

  // 1. Merchant: a known merchant (whole words) in the first lines, else the first line
  let merchant = lines[0] || 'Unknown';
  for (const line of lines.slice(0, 5)) {
    const match = existingMerchants.find(m => m && hasWords(line, m));
    if (match) { merchant = match; break; }
  }
  if (!lines.length) warnings.push('The receipt has no text.');

  // 2. Date: the first valid one; a second, different one is a warning; impossible dates are refused
  const found = [...new Set(lines.flatMap(l => l.match(DATE) || []))];
  const dates = found.filter(isDate);
  const dateStr = dates[0] || '';
  if (!dateStr) warnings.push(found.length ? `No valid date was found (${found.join(', ')} cannot be a calendar date).` : 'No date was found.');
  if (dates.length > 1) warnings.push(`More than one date (${dates.join(', ')}): the first is used — check it.`);

  // 3. Total: the amount on a payable "total" line (not subtotal, tax, savings, items…), from the bottom; else the largest
  const totals = lines.filter(l => PAYABLE.test(l) && !QUALIFIED.test(l)).map(readAmount).filter((a): a is Amount => Boolean(a));
  const amounts = lines.map(readAmount).filter((a): a is Amount => Boolean(a));
  let chosen: Amount | undefined = totals[totals.length - 1];
  if (!chosen) {
    chosen = [...amounts].sort((a, b) => cents(b) - cents(a))[0];
    if (chosen) warnings.push('No line says "total": the largest amount is used — check it.');
  } else if (new Set(totals.map(cents)).size > 1) {
    warnings.push(`More than one total (${totals.map(shown).join(', ')}): the last is used — check it.`);
  }
  if (!chosen) warnings.push('No amount was found.');
  const spaced = lines.filter(l => SPACED.test(l) && !readAmount(l));
  if (spaced.length) warnings.push(`Digits split by a space without a currency symbol were not read (${spaced.join('; ')}) — check them.`);
  const totalCents = chosen ? cents(chosen) : 0;

  // 4. Currency: a code on the total line, else on the receipt, overrides "$"; a symbol and code that disagree is a warning
  const symbol = chosen?.symbol || lines.map(l => l.match(/[$€£₪]/)?.[0]).find(Boolean);
  const norm = (c: string) => (c === 'NIS' ? 'ILS' : c);
  const lineCodes = [...(chosen?.line.match(CODE) || [])].map(norm);
  const allCodes = [...new Set(lines.flatMap(l => l.match(CODE) || []).map(norm))];
  const code = lineCodes[0] || allCodes[0];
  if (allCodes.length > 1) warnings.push(`More than one currency code (${allCodes.join(', ')}): ${code} is used — check it.`);
  let currency = symbol ? SYMBOLS[symbol] : code;
  if (symbol && code && SYMBOLS[symbol] !== code) {
    if (symbol === '$' && DOLLAR_CODES.has(code)) {
      currency = code;
      warnings.push(`"$" alone is ambiguous and the receipt says ${code}: ${code} is used — check it.`);
    } else {
      warnings.push(`The symbol ${symbol} and the code ${code} disagree: ${currency} is used — check it.`);
    }
  }
  if (!currency) warnings.push('The receipt states no currency: check which it is in.');

  return { merchant, dateStr, totalCents, ...(currency ? { currency } : {}), warnings };
}

/** A sample receipt, shown only when no text was pasted, and labelled as an example. */
const EXAMPLE = [
  'HOME DEPOT 123',
  '123 MAIN ST',
  '04/15/2026 14:23',
  'HAMMER      12.99',
  'NAILS        5.49',
  'SUBTOTAL    18.48',
  'TAX          1.52',
  'TOTAL      $20.00',
  'VISA **** 1234',
];

export const RECEIPT_CAPTURE_ALGO: AlgorithmDefinition = {
  id: 'receipt_capture',
  domain: 'operations',
  name: 'Positional Receipt Capture (No ML)',
  description: 'Reads the merchant, date and total from the text of a receipt you paste (from a scanner or OCR), with positional rules and no vision model. What it cannot be sure of is listed as a warning.',
  help: {
    scope: 'The text of one receipt you paste (one line per row); nothing is posted or changed.',
    method: 'Positional rules, no vision model. Merchant: a known payee whose words appear whole in the first five lines, else the first line. Date: the first dd/mm/yyyy, mm/dd/yyyy (also with . or -, two- or four-digit year) or yyyy-mm-dd that is a real calendar date. Total: the amount on the last TOTAL, GRAND TOTAL, AMOUNT DUE, BALANCE DUE or TOTAL DUE line, skipping subtotal, tax, savings, discount, items and qty totals; else the largest amount, with a warning. Currency: $, €, £, ₪ or a code; a code (CAD, AUD…) overrides "$".',
    example: 'Lines "SHOP", "15/09/2026", "TOTAL SAVINGS $5.00", "TOTAL CAD $1 234.56": date 15/09/2026, total 123,456 cents, CAD, with a warning that "$" alone is ambiguous.',
    limits: 'Dot decimals only (1.234,56 is not read); English "total" labels only; the date order is kept as printed, and impossible dates are refused; currencies USD, EUR, GBP, ILS/NIS, CAD, AUD, NZD; space thousands only after a symbol; no vision model, so the text must already be read; nothing is posted — check the figures.',
  },
  inputs: [{ kind: 'text', key: 'receiptText', label: 'Receipt text (one line per row)', defaultValue: '', placeholder: 'Paste the text of a receipt' }],
  compute: (ctx, inputs) => {
    const { transactions } = ctx;
    const start = performance.now();
    const pasted = String(inputs.receiptText || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const example = pasted.length === 0;
    const merchants = Array.from(new Set<string>(transactions.map(t => t.payee || t.description || ''))).filter(m => m.length > 3);
    const result = parseReceiptOCR(example ? EXAMPLE : pasted, merchants);
    const ms = performance.now() - start;
    const money = result.currency ? `${result.currency} ${(result.totalCents / 100).toFixed(2)}` : (result.totalCents / 100).toFixed(2);

    return {
      metrics: [
        { label: 'Merchant', value: result.merchant },
        { label: 'Date', value: result.dateStr || 'Not found' },
        { label: 'Total', value: money },
        { label: 'Warnings', value: result.warnings.length },
      ],
      charts: [],
      insights: [
        ...(example ? ['Example only: no receipt text was pasted, so this reads a built-in sample receipt. Paste a receipt\'s text to read yours.'] : []),
        ...result.warnings,
        'How it reads: merchant from a known payee (whole words) in the first lines, else the first line; the first valid date; total from the last payable "total" line (not subtotal, tax, savings or items), else the largest amount.',
        `Read in ${ms.toFixed(2)} ms. Nothing is posted: check the figures before using them.`,
      ],
    };
  },
};
