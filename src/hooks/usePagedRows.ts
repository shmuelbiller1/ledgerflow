import { useState } from 'react';

/**
 * R-5: a long report list draws its first page at once and the rest on request, so a year of thousands of rows
 * opens in under a second. Totals, counts and exports keep using the full list; only the drawing is paged.
 * `keep` marks rows that are always drawn wherever they fall (e.g. an unbalanced entry the header counts).
 * The page size belongs to `resetKey` (the period or filter it was widened for): a new key starts at one page.
 */
export const SHOW_MORE_PAGE = 200;

export function usePagedRows<T>(rows: T[], resetKey: string, keep?: (row: T) => boolean): {
  visible: T[]; total: number; more: () => void; all: () => void;
} {
  const [shown, setShown] = useState({ key: resetKey, count: SHOW_MORE_PAGE });
  const count = shown.key === resetKey ? shown.count : SHOW_MORE_PAGE;
  const visible = rows.length > count ? rows.filter((row, i) => i < count || Boolean(keep?.(row))) : rows;
  return {
    visible,
    total: rows.length,
    more: () => setShown({ key: resetKey, count: count + SHOW_MORE_PAGE }),
    all: () => setShown({ key: resetKey, count: rows.length }),
  };
}
