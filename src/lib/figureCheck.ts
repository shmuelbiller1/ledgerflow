import { currencyDigits } from './currencyMinorUnits';
import { getIsoCurrency } from './isoCurrencyReference';
import { isRateContext } from './tidyFigures';

/**
 * Checks, in code, that the amounts in an assistant answer come from the books (27 Nov 2026 model tests:
 * Luna once stated a balance no tool returned, and mixed overdue with total owed). An amount in the answer
 * is a number written next to a currency sign or code. It is traced when it matches, within rounding:
 * - a number in a tool result, as stored or converted from minor units (cents);
 * - the sum, average or count-free total of a list of numbers in one tool result field;
 * - the sum or difference of two numbers found above;
 * - a number in the person's own question.
 * What cannot be traced is returned, so the caller can retry on the strong model or warn.
 */
const NUMBER = String.raw`(-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?)`;
const SCALE = String.raw`(?:\s?(k|K|thousand|m|M|million|bn|billion)\b)?`;
// a percentage is never an amount; three capitals are a currency only when ISO 4217 lists them ("VAT 17.5")
const BEFORE = new RegExp(String.raw`(?:([$€£₪¥])\s?|\b([A-Z]{3})\s)${NUMBER}${SCALE}(?!\d|\.\d|\s?%)`, 'g');
const AFTER = new RegExp(String.raw`(?<![\w.,])${NUMBER}${SCALE}\s?(?:([₪€])|\b([A-Z]{3})\b|(ש["״]ח))`, 'g');
const SIGN_CURRENCY: Record<string, string> = { '€': 'EUR', '£': 'GBP', '₪': 'ILS', $: 'USD', '¥': 'JPY' };
const SHARED_SIGN: Record<string, readonly string[]> = { $: ['USD', 'CAD', 'AUD', 'NZD', 'SGD', 'HKD', 'MXN'], '¥': ['JPY', 'CNY'] };
/** The currency an amount is written in: its code, or its sign (a shared sign takes the workspace currency when it can mean it). */
const currencyOf = (sign: string | undefined, code: string | undefined, workspace?: string | null) =>
  code ?? (sign ? (SHARED_SIGN[sign]?.includes(workspace ?? '') ? workspace! : SIGN_CURRENCY[sign] ?? (sign.startsWith('ש') ? 'ILS' : undefined)) : undefined);

const MULTIPLIER: Record<string, number> = { k: 1e3, K: 1e3, thousand: 1e3, m: 1e6, M: 1e6, million: 1e6, bn: 1e9, billion: 1e9 };
const parse = (raw: string, scale?: string) => Number(raw.replace(/,/g, '')) * (scale ? MULTIPLIER[scale] : 1);

export interface AnswerAmount { text: string; value: number; approximate: boolean; currency?: string }

/** The amounts written in an answer, each with the text it was read from and the currency it is written in. */
export function answerAmounts(text: string, workspace?: string | null): AnswerAmount[] {
  const found = new Map<number, AnswerAmount>();
  // [sign, code, number, scale]
  const reads: Array<[RegExp, (m: RegExpMatchArray) => [string | undefined, string | undefined, string, string | undefined]]> = [
    [BEFORE, m => [m[1], m[2], m[3], m[4]]],
    [AFTER, m => [m[3] ?? m[5], m[4], m[1], m[2]]],
  ];
  const spans: Array<[number, number]> = [];
  for (const [re, parts] of reads) {
    for (const m of text.matchAll(re)) {
      const index = m.index ?? 0;
      const end = index + m[0].length;
      // "$10 CAD" is one amount: the second pass's "10 CAD" overlaps the first's "$10"
      if (spans.some(([a, b]) => index < b && end > a)) continue;
      const [sign, written, number, scale] = parts(m);
      // a code written after a signed amount names its currency ("$10 CAD" is Canadian dollars)
      const code = written ?? (sign ? /^ ?([A-Z]{3})\b/.exec(text.slice(end))?.[1] : undefined);
      // an exchange rate is not an amount of the books
      if (found.has(index) || (code && !getIsoCurrency(code)) || isRateContext(text, index, index + m[0].length)) continue;
      const before = text.slice(Math.max(0, index - 12), index).toLowerCase();
      spans.push([index, end]);
      found.set(index, { text: m[0].trim(), value: parse(number, scale), currency: currencyOf(sign, code && getIsoCurrency(code) ? code : undefined, workspace),
        approximate: Boolean(scale) || /(about|around|roughly|approx|~|כ־|בערך)\s*$/.test(before) });
    }
  }
  // every nonzero amount, sub-unit ones too ($0.99 is checked like $99)
  return [...found.entries()].sort((x, y) => x[0] - y[0]).map(([, a]) => a).filter(a => Number.isFinite(a.value) && a.value !== 0);
}

const MAX_LEAVES = 400;
const MINOR_FIELD = /(cents|minor)(\[\])*$/i;

/** Every number in the tool results, plus the totals and averages of each numeric list field. */
const digitsOf = (code: unknown): number | undefined => {
  if (typeof code !== 'string' || !getIsoCurrency(code.toUpperCase())) return undefined;
  try { return currencyDigits(code.toUpperCase()); } catch { return undefined; }
};

/** Every number in the tool results, plus the totals and averages of each numeric list field. A record's own
 * `currency` decides how its minor units convert (a KWD row in a USD workspace has three decimals). */
/** The candidate numbers by declared currency ('' for records that declare none). */
function sourceNumbers(results: readonly unknown[], digits: number): Map<string, number[]> {
  type Leaf = { n: number; d: number; minor: boolean; cur: string };
  const leaves: Leaf[] = [];
  const lists = new Map<string, Leaf[]>();
  // `cur` is the record's declared currency ('' when none): totals, averages, sums and differences never mix currencies
  const walk = (value: unknown, key: string, depth: number, d: number, cur = '') => {
    if (depth > 8) return;
    if (typeof value === 'number' && Number.isFinite(value)) {
      // a field named in minor units ("balanceCents", "amountMinor") is only ever cents: $577,700 is not 577700 cents
      const leaf = { n: value, d, minor: MINOR_FIELD.test(key), cur };
      leaves.push(leaf);
      const listKey = `${key}@${cur}`;
      lists.set(listKey, [...(lists.get(listKey) ?? []), leaf]);
    } else if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) walk(Number(value), key, depth, d, cur);
    else if (Array.isArray(value)) value.forEach(item => walk(item, `${key}[]`, depth + 1, d, cur));
    else if (value && typeof value === 'object') {
      const declared = (value as Record<string, unknown>).currency;
      const ownDigits = digitsOf(declared);
      const ownCur = ownDigits === undefined ? cur : String(declared).toUpperCase();
      for (const [k, v] of Object.entries(value)) walk(v, `${key}.${k}`, depth + 1, ownDigits ?? d, ownCur);
    }
  };
  results.forEach((r, i) => walk(r, `#${i}`, 0, digits));
  // values with repeats kept: two $100 invoices add up to $200
  const groups = new Map<string, number[]>();
  const add = (n: number, { d, minor, cur }: Leaf) => {
    const group = groups.get(cur) ?? [];
    groups.set(cur, group);
    if (!minor) group.push(n);
    // a record that declares its currency converts with that currency's digits only (KWD 71.25 is not 7125 fils)
    group.push(n / 10 ** d);
  };
  leaves.forEach(leaf => add(leaf.n, leaf));
  for (const list of lists.values()) {
    if (list.length < 2) continue;
    const sum = list.reduce((s, leaf) => s + leaf.n, 0);
    add(sum, list[0]);
    add(sum / list.length, list[0]);
  }
  const out = new Map<string, number[]>();
  for (const [cur, values] of groups) {
    const group = new Set(values);
    const base = values.filter(n => Math.abs(n) >= 1).slice(0, MAX_LEAVES);
    for (let i = 0; i < base.length; i++)
      for (let j = i + 1; j < base.length; j++) { group.add(base[i] + base[j]); group.add(Math.abs(base[i] - base[j])); }
    out.set(cur, [...group]);
  }
  return out;
}

/** Within rounding: about one minor unit of the amount's currency (0.011 for cents, 0.0011 for fils), or a share of it. */
const close = (a: number, b: number, approximate: boolean, unit: number) => {
  const diff = Math.abs(Math.abs(a) - Math.abs(b));
  return diff <= unit * 1.1 || diff <= Math.abs(b) * (approximate ? 0.05 : 0.0005) || (Math.abs(a) >= 1000 && diff < 1);
};

export interface FigureCheck { checked: number; untraced: string[] }

export function checkFigures(answer: string, toolResults: readonly unknown[], question: string, currency?: string | null): FigureCheck {
  const amounts = answerAmounts(answer, currency);
  if (!amounts.length) return { checked: 0, untraced: [] };
  let digits = 2;
  try { if (currency) digits = currencyDigits(currency); } catch { /* unknown code: cents */ }
  const sources = sourceNumbers(toolResults, digits);
  // amounts the person wrote, with their currency ("EUR 85000" backs EUR 85,000, not USD 85,000)
  const askedAmounts = answerAmounts(question, currency);
  const asked: Array<{ value: number; currency?: string }> = [...askedAmounts];
  let rest = question;
  for (const a of askedAmounts) rest = rest.replace(a.text, ' ');
  // and bare numbers they typed ("pay Beta 850"), in no currency, but not digits inside an identifier ("INV-85000") or a year
  for (const m of rest.matchAll(/(?<![\w\-./#])\d[\d,]*(?:\.\d+)?(?![\w\-/])/g))
    if (!/^(19|20)\d\d$/.test(m[0])) asked.push({ value: Number(m[0].replace(/,/g, '')) });
  const workspace = currency?.toUpperCase() ?? '';
  // an amount matches only figures in its own currency: a record's declared one, or the workspace's for records
  // that declare none ("USD 10" is not backed by KWD 10; the books gave no conversion)
  const candidates = (a: AnswerAmount) => {
    if (!a.currency) return [...sources.values()].flat();
    const own = sources.get(a.currency) ?? [];
    return a.currency === workspace || !workspace ? own.concat(sources.get('') ?? []) : own;
  };
  const untraced = amounts.filter(a => {
    const unit = 10 ** -(digitsOf(a.currency) ?? digits);
    return !candidates(a).some(s => close(a.value, s, a.approximate, unit))
      && !asked.some(q => (!q.currency || !a.currency || q.currency === a.currency) && close(a.value, q.value, a.approximate, unit));
  }).map(a => a.text);
  return { checked: amounts.length, untraced };
}
