/**
 * C-67: presentation-only column hiding for the main document lists. Selection and row actions are
 * always visible; at least two columns remain. No row data, filter or amount is stored.
 */
export const listColumnKey = (user: string, workspace: string, label: string): string =>
  JSON.stringify(['lf_list_columns_v1', user, workspace, label]);

export function normalizeListHidden(hidden: unknown, count: number): number[] {
  if (!Array.isArray(hidden) || count < 3) return [];
  return [...new Set(hidden.filter((value): value is number =>
    Number.isInteger(value) && value > 0 && value < count - 1,
  ))].sort((a, b) => a - b).slice(0, count - 2);
}

export function toggleListColumn(hidden: number[], index: number, count: number): number[] {
  const current = normalizeListHidden(hidden, count);
  if (index <= 0 || index >= count - 1) return current;
  if (current.includes(index)) return current.filter(value => value !== index);
  // The first and last columns are locked, so two visible columns always remain.
  if (count - current.length <= 2) return current;
  return [...current, index].sort((a, b) => a - b);
}

export function readListHidden(key: string, count: number): number[] {
  try { return normalizeListHidden(JSON.parse(localStorage.getItem(key) || '[]'), count); }
  catch { return []; }
}

export function saveListHidden(key: string, hidden: number[]): boolean {
  try {
    if (hidden.length) localStorage.setItem(key, JSON.stringify(hidden));
    else localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/** Hide the same cell index in the header, body and footer; colspan status rows are never hidden. */
export function listColumnCss(scope: string, hidden: number[]): string {
  const safeScope = scope.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeScope || !hidden.length) return '';
  const selectors = hidden.flatMap(index => ['thead', 'tbody', 'tfoot'].map(section =>
    `:is([data-list-columns="${safeScope}"] > table, table[data-list-table="${safeScope}"]) > ${section} > tr:not(:has(> [colspan])) > :nth-child(${index + 1}):not([colspan])`,
  ));
  for (const index of hidden) selectors.push(`[data-list-columns="${safeScope}"] [data-grid-card-column="${index}"]`);
  return `@media screen {\n${selectors.join(',\n')} { display: none; }\n}`;
}
