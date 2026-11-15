/**
 * Moving between rows with the keyboard (prompt 2, part 1: "row keyboard movement"), kept away from
 * React so the rules can be stated once and tested on their own.
 *
 * The shared list draws one focusable region around its rows. The rows themselves are not tab stops
 * (`<tr tabIndex>`) and do not carry click handlers: a person tabbing through the page should meet the
 * list once, not once per row, and a row must not pretend to be a button. Instead the region keeps a
 * *logical* highlight — the id of the highlighted record — and an `aria-activedescendant` points the
 * screen reader at the row that holds it. Only the highlighted row is a real tab stop, so Tab leaves
 * the list on the row the person was reading rather than at the top.
 *
 * The same keys work on the phone layout, where rows are cards in a list.
 */

/** Keys that belong to the list, not to the page (so the page must not scroll as well). */
const ROW_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End']);

export function isRowNavKey(key: string): boolean {
  return ROW_KEYS.has(key);
}

/**
 * What a key does to the highlight. `rows` is the list as drawn, in the order the reader sees it, so
 * Home is the first row of the page and End the last — pagination is not part of this.
 *
 * ArrowDown on no highlight starts on the first row (End starts on the last), so a keyboard user
 * pressing down gets into the list instead of nothing happening. ArrowUp with no highlight starts on
 * the last row, which is where a person reading upwards expects to enter.
 */
export function nextRowId(
  rows: ReadonlyArray<{ id: string }>,
  current: string | null,
  key: string,
): string | null {
  if (!rows.length) return null;
  const last = rows.length - 1;
  const index = current === null ? -1 : rows.findIndex(row => row.id === current);
  // the highlighted record is gone (filtered out, deleted): the nearest row by key is an honest answer
  const from = index === -1 ? -1 : index;
  switch (key) {
    case 'ArrowDown':
      return rows[Math.min(last, from + 1)].id;
    case 'ArrowUp':
      // nothing highlighted yet: entering from below lands on the last row; otherwise the first row is the top
      return from < 0 ? rows[last].id : rows[Math.max(0, from - 1)].id;
    case 'Home':
      return rows[0].id;
    case 'End':
      return rows[last].id;
    default:
      return current;
  }
}

/** What the live region says when the highlight moves; empty when nothing is highlighted. */
export function rowAnnouncement<T>(
  rows: ReadonlyArray<{ id: string }>,
  current: string | null,
  describe: (row: T, index: number) => string,
  data: ReadonlyArray<T>,
): string {
  if (!current) return '';
  const index = rows.findIndex(row => row.id === current);
  if (index === -1) return '';
  const row = data[index] as T | undefined;
  if (row === undefined) return '';
  return `Row ${index + 1} of ${rows.length}: ${describe(row, index)}`;
}
