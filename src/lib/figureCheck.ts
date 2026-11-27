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
const BEFORE = new RegExp(String.raw`(?:[$€£₪¥]\s?|\b([A-Z]{3})\s)${NUMBER}${SCALE}(?!\d|\.\d|\s?%)`, 'g');
const AFTER = new RegExp(String.raw`(?<![\w.,])${NUMBER}${SCALE}\s?(?:₪|€|\b([A-Z]{3})\b|ש["״]ח)`, 'g');

const MULTIPLIER: Record<string, number> = { k: 1e3, K: 1e3, thousand: 1e3, m: 1e6, M: 1e6, million: 1e6, bn: 1e9, billion: 1e9 };
const parse = (raw: string, scale?: string) => Number(raw.replace(/,/g, '')) * (scale ? MULTIPLIER[scale] : 1);

/** The amounts written in an answer, each with the text it was read from. */
export function answerAmounts(text: string): Array<{ text: string; value: number; approximate: boolean }> {
  const found = new Map<number, { text: string; value: number; approximate: boolean }>();
  const reads: Array<[RegExp, (m: RegExpMatchArray) => [string | undefined, string, string | undefined]]> = [
    [BEFORE, m => [m[1], m[2], m[3]]],
    [AFTER, m => [m[3], m[1], m[2]]],
  ];
  for (const [re, parts] of reads) {
    for (const m of text.matchAll(re)) {
      const index = m.index ?? 0;
      const [code, number, scale] = parts(m);
      // an exchange rate is not an amount of the books
      if (found.has(index) || (code && !getIsoCurrency(code)) || isRateContext(text, index, index + m[0].length)) continue;
      const before = text.slice(Math.max(0, index - 12), index).toLowerCase();
      found.set(index, { text: m[0].trim(), value: parse(number, scale), approximate: Boolean(scale) || /(about|around|roughly|approx|~|כ־|בערך)\s*$/.test(before) });
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
function sourceNumbers(results: readonly unknown[], digits: number): number[] {
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
  const groups = new Map<string, Set<number>>();
  const add = (n: number, { d, minor, cur }: Leaf) => {
    const group = groups.get(cur) ?? new Set<number>();
    groups.set(cur, group);
    if (!minor) group.add(n);
    // a record that declares its currency converts with that currency's digits only (KWD 71.25 is not 7125 fils)
    group.add(n / 10 ** d);
  };
  leaves.forEach(leaf => add(leaf.n, leaf));
  for (const list of lists.values()) {
    if (list.length < 2) continue;
    const sum = list.reduce((s, leaf) => s + leaf.n, 0);
    add(sum, list[0]);
    add(sum / list.length, list[0]);
  }
  const out = new Set<number>();
  for (const group of groups.values()) {
    const base = [...group].filter(n => Math.abs(n) >= 1).slice(0, MAX_LEAVES);
    for (let i = 0; i < base.length; i++)
      for (let j = i + 1; j < base.length; j++) { group.add(base[i] + base[j]); group.add(Math.abs(base[i] - base[j])); }
    group.forEach(n => out.add(n));
  }
  return [...out];
}

const close = (a: number, b: number, approximate: boolean) => {
  const diff = Math.abs(Math.abs(a) - Math.abs(b));
  return diff <= 0.011 || diff <= Math.abs(b) * (approximate ? 0.05 : 0.0005) || (Math.abs(a) >= 1000 && diff < 1);
};

export interface FigureCheck { checked: number; untraced: string[] }

export function checkFigures(answer: string, toolResults: readonly unknown[], question: string, currency?: string | null): FigureCheck {
  const amounts = answerAmounts(answer);
  if (!amounts.length) return { checked: 0, untraced: [] };
  let digits = 2;
  try { if (currency) digits = currencyDigits(currency); } catch { /* unknown code: cents */ }
  const sources = sourceNumbers(toolResults, digits);
  const asked = answerAmounts(question).map(a => a.value)
    // a bare number the person typed ("pay Beta 850"), but not digits inside an identifier ("INV-85000") or a year
    .concat([...question.matchAll(/(?<![\w\-./#])\d[\d,]*(?:\.\d+)?(?![\w\-/])/g)]
      .map(m => m[0]).filter(n => !/^(19|20)\d\d$/.test(n)).map(n => Number(n.replace(/,/g, ''))));
  const untraced = amounts.filter(a => !sources.some(s => close(a.value, s, a.approximate)) && !asked.some(q => close(a.value, q, a.approximate))).map(a => a.text);
  return { checked: amounts.length, untraced };
}
