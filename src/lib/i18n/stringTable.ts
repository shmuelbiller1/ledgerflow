import type { UiLanguage } from './uiLanguage';

/**
 * AI12-N10-01 (#838): one way to read a two-language string table.
 *
 * Every onboarding surface keeps its own table — the sign-in screen's copy is needed in the first
 * download, the wizard's and the Overview screens' copy is not — but they all answer the same two
 * questions: which sentence is shown for this key and this language, and what gets filled into it.
 * Answering them in one place keeps a third copy of the lookup out of the bundle and out of the
 * duplicate-lines measure, and makes every table behave the same way when an entry is missing.
 */

export interface StringEntry {
  key: string;
  en: string;
  he: string;
}

/** Shown in both languages: an example address, not copy. */
export const EXAMPLE_EMAIL = 'you@company.com';

/**
 * The sentence for a key in the selected language.
 *
 * The English column is the fallback, so a translation that is still blank shows the English
 * sentence rather than nothing. A key the table does not know falls back to its last segment (never
 * `undefined`, never a dotted path on screen); the guard tests fail first for the keys in use.
 */
export function tableText(
  byKey: ReadonlyMap<string, StringEntry>,
  key: string,
  language: UiLanguage,
): string {
  const entry = byKey.get(key);
  if (!entry) return String(key).split('.').pop() || '';
  const candidate = language === 'he' ? entry.he : entry.en;
  return candidate.trim() ? candidate : entry.en;
}

/** Fills `{name}` placeholders. Values are not translated: amounts, counts and names stay as given. */
export function fillOnboarding(
  template: string,
  values: Readonly<Record<string, string | number>>,
): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : whole);
}

/** A keyed lookup over a table written as an object literal. */
export function indexTable(strings: Readonly<Record<string, { en: string; he: string }>>): Map<string, StringEntry> {
  return new Map(Object.entries(strings).map(([key, value]) => [key, { key, en: value.en, he: value.he }]));
}

/** A table as rows, for the guard tests that check every entry has its Hebrew. */
export function tableRows(strings: Readonly<Record<string, { en: string; he: string }>>): StringEntry[] {
  return Object.entries(strings).map(([key, value]) => ({ key, en: value.en, he: value.he }));
}

export type TranslationGap = {
  key: string;
  problem: 'missing Hebrew' | 'blank English' | 'Hebrew identical to English';
};

/**
 * Every entry that would leave a Hebrew reader with English (or nothing). Read by the guard tests for
 * every onboarding table, so a new sentence cannot ship without its Hebrew.
 */
export function translationGaps(entries: readonly StringEntry[]): TranslationGap[] {
  const gaps: TranslationGap[] = [];
  for (const entry of entries) {
    if (!entry.en.trim()) gaps.push({ key: entry.key, problem: 'blank English' });
    else if (!entry.he.trim()) gaps.push({ key: entry.key, problem: 'missing Hebrew' });
    else if (!/\p{Script=Hebrew}/u.test(entry.he)) gaps.push({ key: entry.key, problem: 'Hebrew identical to English' });
  }
  return gaps;
}
