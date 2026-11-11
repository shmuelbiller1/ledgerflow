import { useEffect, useState } from 'react';

/**
 * R-5: a long report list draws its first page at once and the rest on request, so a year of thousands of rows
 * opens in under a second. Totals, counts and exports keep using the full list; only the drawing is paged.
 * `keep` marks rows that are always drawn wherever they fall (e.g. an unbalanced entry the header counts).
 * The page size belongs to `resetKey` (the period or filter it was widened for): a new key starts at one page.
 * `page` is the size of a page: a screen that lists many such blocks (the general ledger, one per account) uses less.
 * #642: printing always carries every row (beforeprint draws them all, afterprint returns to the reader's page),
 * so a printed report's totals reconcile with its printed rows.
 */
export const SHOW_MORE_PAGE = 200;

export function usePagedRows<T>(rows: T[], resetKey: string, keep?: (row: T) => boolean, page = SHOW_MORE_PAGE): {
  visible: T[]; total: number; more: () => void; all: () => void;
} {
  const [shown, setShown] = useState({ key: resetKey, count: page });
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const before = () => setPrinting(true);
    const after = () => setPrinting(false);
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => { window.removeEventListener('beforeprint', before); window.removeEventListener('afterprint', after); };
  }, []);
  const count = printing ? rows.length : shown.key === resetKey ? shown.count : page;
  const visible = rows.length > count ? rows.filter((row, i) => i < count || Boolean(keep?.(row))) : rows;
  return {
    visible,
    total: rows.length,
    more: () => setShown({ key: resetKey, count: count + page }),
    all: () => setShown({ key: resetKey, count: rows.length }),
  };
}
