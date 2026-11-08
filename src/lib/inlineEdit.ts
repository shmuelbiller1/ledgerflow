/**
 * Edit in place (I-22) and help while typing (I-23): pure helpers for InlineEdit.
 */
import { TruthEngine } from '../modules/integrity/TruthEngine';
import { isEmailShape } from './textShape';

export type InlineKind = 'text' | 'email' | 'tel' | 'number' | 'money' | 'date' | 'textarea' | 'select';

/** What a typed value becomes: money → integer cents, number → number, else trimmed text. Null when invalid. */
export function parseInlineValue(kind: InlineKind, raw: string): string | number | null {
  const text = raw.trim();
  if (kind === 'money') {
    if (!text) return 0;
    if (!/^-?[\d.,\s]+$/.test(text.replace(/[^\d.,\s-]/g, '')) || !/\d/.test(text)) return null;
    return TruthEngine.parseAmountToCents(text);
  }
  if (kind === 'number') {
    if (!text) return 0;
    const n = Number(text.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  if (kind === 'email' && text && !isEmailShape(text)) return null;
  if (kind === 'date' && text && !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return text;
}

/** The text put in the box when editing starts (money in cents → "12.50"). */
export function inlineEditText(kind: InlineKind, value: unknown): string {
  if (value === null || value === undefined) return '';
  if (kind === 'money' && typeof value === 'number') return (value / 100).toFixed(2);
  return String(value);
}

/** True when saving would change nothing. */
export function sameInlineValue(kind: InlineKind, before: unknown, after: string | number, raw?: string): boolean {
  if (kind === 'money' || kind === 'number') {
    const unset = before === undefined || before === null || before === '';
    // an empty field left blank stays empty (a missing credit limit is not saved as 0) ...
    if (unset) return raw !== undefined && raw.trim() === '';
    // ... while a typed 0 on an empty field is a real value (a standard cost of 0)
    return Number(before) === after;
  }
  return String(before ?? '').trim() === after;
}

/**
 * Suggestions learned from the workspace's own records: the distinct values of a field, the most
 * used first (then A–Z), blanks left out, at most `limit`.
 */
export function suggestionsFrom<T>(records: T[], pick: (r: T) => unknown, limit = 50): string[] {
  const counts = new Map<string, { value: string; n: number }>();
  for (const r of records) {
    const raw = pick(r);
    for (const v of Array.isArray(raw) ? raw : [raw]) {
      if (typeof v !== 'string' || !v.trim()) continue;
      const value = v.trim();
      const key = value.toLocaleLowerCase();
      const hit = counts.get(key);
      if (hit) hit.n++; else counts.set(key, { value, n: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.value.localeCompare(b.value)).slice(0, limit).map(c => c.value);
}
