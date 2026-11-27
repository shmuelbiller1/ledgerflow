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

/** `step` is the place of the last digit printed, in units ($1.2 million: 100,000; $5,777: 1; $5,777.40: 0.01). */
export interface AnswerAmount { text: string; value: number; approximate: boolean; step: number; currency?: string }

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
      // (only a real ISO code: "$85,000 VAT included" stays a dollar amount)
      const trailing = sign ? /^ ?([A-Z]{3})\b/.exec(text.slice(end))?.[1] : undefined;
      const code = written ?? (trailing && getIsoCurrency(trailing) ? trailing : undefined);
      // an exchange rate is not an amount of the books
      if (found.has(index) || (code && !getIsoCurrency(code)) || isRateContext(text, index, index + m[0].length)) continue;
      const before = text.slice(Math.max(0, index - 12), index).toLowerCase();
      spans.push([index, end]);
      found.set(index, { text: m[0].trim(), value: parse(number, scale), currency: currencyOf(sign, code && getIsoCurrency(code) ? code : undefined, workspace),
        step: 10 ** -(number.split('.')[1]?.length ?? 0) * (scale ? MULTIPLIER[scale] : 1),
        approximate: Boolean(scale) || /(about|around|roughly|approx|~|כ־|בערך)\s*$/.test(before) });
    }
  }
  // every amount, sub-unit and zero ones too: "USD 0" against a 5,777 balance is checked like any other
  return [...found.entries()].sort((x, y) => x[0] - y[0]).map(([, a]) => a).filter(a => Number.isFinite(a.value));
}

const MAX_LEAVES = 400;
// the aging report's buckets as the route returns them (reportRoutes `/aging`), and the internal names
const AGING_SHAPES = [['current', '1-30', '31-60', '61-90', '90+', 'total'], ['current', 'd1_30', 'd31_60', 'd61_90', 'd90plus', 'total']];
const MAJOR_FIELD = /Major(\[\])*$/;
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
  type Leaf = { n: number; d: number; minor: boolean; major: boolean; cur: string };
  const leaves: Leaf[] = [];
  const lists = new Map<string, Leaf[]>();
  // `cur` is the record's declared currency ('' when none): totals, averages, sums and differences never mix currencies
  const walk = (value: unknown, key: string, depth: number, d: number, cur = '') => {
    if (depth > 8) return;
    if (typeof value === 'number' && Number.isFinite(value)) {
      // a field named in minor units ("balanceCents", "amountMinor") is only ever cents: $577,700 is not 577700 cents
      const leaf = { n: value, d, minor: MINOR_FIELD.test(key), major: MAJOR_FIELD.test(key), cur };
      leaves.push(leaf);
      const listKey = `${key}@${cur}`;
      // appended in place: a 20,000-row report must not be copied row by row
      const list = lists.get(listKey);
      if (list) list.push(leaf); else lists.set(listKey, [leaf]);
    } else if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) walk(Number(value), key, depth, d, cur);
    else if (Array.isArray(value)) {
      // an empty list is the books saying "none": it backs a zero
      if (!value.length) leaves.push({ n: 0, d, minor: false, major: true, cur });
      value.forEach(item => walk(item, `${key}[]`, depth + 1, d, cur));
    }
    else if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const declared = record.currency;
      // the calculate tool always answers in hundredths ({ cents, amount: cents / 100 }), whatever the workspace currency
      const calculator = typeof record.cents === 'number' && typeof record.amount === 'number' && Math.abs(record.amount * 100 - record.cents) < 1e-6;
      const ownDigits = calculator ? 2 : digitsOf(declared);
      // a calculation has no currency of its own: it backs an amount in any currency ('*')
      const ownCur = calculator ? '*' : digitsOf(declared) === undefined ? cur : String(declared).toUpperCase();
      // the aging report's buckets and total are minor units though their names do not say so
      const aging = AGING_SHAPES.some(keys => keys.every(k => typeof record[k] === 'number'));
      // the calculator's `amount` is already major units: it is not divided again ($1.20 is not 120)
      const unit = (k: string) => (aging || (calculator && k === 'cents') ? 'Cents' : calculator ? 'Major' : '');
      for (const [k, v] of Object.entries(value)) walk(v, `${key}.${k}${unit(k)}`, depth + 1, ownDigits ?? d, ownCur);
    }
  };
  results.forEach((r, i) => walk(r, `#${i}`, 0, digits));
  // values with repeats kept: two $100 invoices add up to $200
  const groups = new Map<string, number[]>();
  const add = (n: number, { d, minor, major, cur }: Leaf) => {
    const group = groups.get(cur) ?? [];
    groups.set(cur, group);
    if (!minor) group.push(n);
    // a record that declares its currency converts with that currency's digits only (KWD 71.25 is not 7125 fils)
    if (!major) group.push(n / 10 ** d);
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
    const base = values.filter(n => n !== 0).slice(0, MAX_LEAVES);
    for (let i = 0; i < base.length; i++)
      for (let j = i + 1; j < base.length; j++) { group.add(base[i] + base[j]); group.add(Math.abs(base[i] - base[j])); }
    out.set(cur, [...group]);
  }
  return out;
}

/** Within rounding: about one minor unit of the amount's currency (0.011 for cents, 0.0011 for fils), or a share of it. */
/**
 * Within rounding of what was printed: half the last printed digit, plus about one minor unit. "$5,777" backs
 * 5,777.40, "$1.2 million" backs 1,234,567, but "$10,004" does not back 10,000 and "about" widens nothing.
 */
const close = (a: number, b: number, step: number, unit: number) => Math.abs(Math.abs(a) - Math.abs(b)) <= step / 2 + unit * 1.1;

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
    const own = (sources.get(a.currency) ?? []).concat(sources.get('*') ?? []);
    return a.currency === workspace || !workspace ? own.concat(sources.get('') ?? []) : own;
  };
  const untraced = amounts.filter(a => {
    const unit = 10 ** -(digitsOf(a.currency) ?? digits);
    return !candidates(a).some(s => close(a.value, s, a.step, unit))
      && !asked.some(q => (!q.currency || !a.currency || q.currency === a.currency) && close(a.value, q.value, a.step, unit));
  }).map(a => a.text);
  return { checked: amounts.length, untraced };
}
