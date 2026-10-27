/**
 * Keyboard navigation of the transaction grid (#104), kept away from React and react-window so the
 * rules can be tested on their own: which cell holds the highlight, what an arrow moves it to, and
 * what happens to it when the visible rows change (a filter, a sort, a deletion).
 *
 * The highlight is logical: the row list may be virtualized (only the rows on screen exist in the
 * DOM), so the grid scrolls the highlighted row into view instead of assuming it is rendered.
 */

export interface GridFocus {
  id: string;
  field: string;
  index: number;
}

export type GridNavKey = 'ArrowDown' | 'ArrowUp' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End';

const NAV_KEYS = new Set<string>(['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End']);

export function isGridNavKey(key: string): key is GridNavKey {
  return NAV_KEYS.has(key);
}

/** The fields the arrow keys visit, in the order the columns are drawn ('amount' is stored as `amountCents`). */
export function gridFields(navigationKey: string): string[] {
  return navigationKey
    .split(',')
    .map(id => id.trim())
    .filter(Boolean)
    .map(id => (id === 'amount' ? 'amountCents' : id));
}

/**
 * Keep the highlight on the same record after the rows change, and let its index follow the record
 * when a sort moves it. A record that is no longer visible (filtered out, deleted) loses the
 * highlight rather than silently landing on whichever row now holds the old index.
 */
export function reconcileGridFocus(
  focus: GridFocus | null,
  rows: ReadonlyArray<{ id: string }>,
): GridFocus | null {
  if (!focus) return null;
  if (!rows.length) return null;
  const index = rows.findIndex(row => row.id === focus.id);
  if (index === -1) return null;
  return index === focus.index ? focus : { ...focus, index };
}

function rowIndexFor(focus: GridFocus, rows: ReadonlyArray<{ id: string }>): number {
  if (rows[focus.index]?.id === focus.id) return focus.index;
  return rows.findIndex(row => row.id === focus.id);
}

function fieldIndexFor(focus: GridFocus, fields: string[]): number {
  const index = fields.indexOf(focus.field);
  return index === -1 ? 0 : index;
}

/**
 * Where `key` moves the highlight. Returns null when there is nothing to move to (no rows, or the
 * row is gone), so the caller clears the highlight instead of pointing at a row that does not exist.
 */
export function moveGridFocus(
  focus: GridFocus,
  key: GridNavKey,
  fields: string[],
  rows: ReadonlyArray<{ id: string }>,
): GridFocus | null {
  if (!rows.length) return null;
  const rowIndex = rowIndexFor(focus, rows);
  if (rowIndex === -1) return null;
  const fieldIndex = fieldIndexFor(focus, fields);
  const lastRow = rows.length - 1;
  // every navigable column is hidden: there is no cell to move sideways to
  if ((key === 'ArrowRight' || key === 'ArrowLeft') && !fields.length) return focus;

  switch (key) {
    case 'ArrowDown':
      return atRow(Math.min(lastRow, rowIndex + 1));
    case 'ArrowUp':
      return atRow(Math.max(0, rowIndex - 1));
    case 'Home':
      return atRow(0);
    case 'End':
      return atRow(lastRow);
    case 'ArrowRight': {
      // Right at the last field goes on to the first field of the next row (as the columns read).
      if (fieldIndex < fields.length - 1) return atCell(rowIndex, fieldIndex + 1);
      if (rowIndex === lastRow) return atCell(rowIndex, fieldIndex);
      return atCell(rowIndex + 1, 0);
    }
    case 'ArrowLeft': {
      // Left at the first field goes back to the last field of the previous row.
      if (fieldIndex > 0) return atCell(rowIndex, fieldIndex - 1);
      if (rowIndex === 0) return atCell(rowIndex, fieldIndex);
      return atCell(rowIndex - 1, fields.length - 1);
    }
    default:
      return focus;
  }

  function atRow(index: number): GridFocus {
    return { id: rows[index].id, field: focus.field, index };
  }

  function atCell(index: number, field: number): GridFocus {
    return { id: rows[index].id, field: fields[field] ?? focus.field, index };
  }
}
