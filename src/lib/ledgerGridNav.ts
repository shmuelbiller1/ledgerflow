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
 * What a field is called in the live region ("amountCents" is stored that way, but nobody says it).
 * A field with no label of its own is announced as it is stored.
 */
const FIELD_LABELS: Record<string, string> = {
  date: 'Date',
  description: 'Description',
  category: 'Category',
  project: 'Project',
  amountCents: 'Amount',
  status: 'Status',
};

export function gridFieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

/**
 * Whether Enter on this cell can open an inline editor: the row draws one only for these fields
 * (category hidden on phones, project on phones and tablets). Editing any other cell would leave the
 * grid in edit mode with nothing to type into and nothing to close.
 */
export function gridFieldEditable(field: string, layout: { mobile: boolean; tablet: boolean }): boolean {
  if (field === 'description' || field === 'amountCents') return true;
  if (field === 'category') return !layout.mobile;
  if (field === 'project') return !layout.mobile && !layout.tablet;
  return false;
}

/**
 * The cell the highlight starts on when the keyboard reaches a list that has none yet — a
 * keyboard-only user pressing an arrow key must land somewhere. `end` starts on the last row
 * (End, ArrowUp, ArrowLeft). Null when there is no row or no navigable column to land on.
 */
export function startGridFocus(
  rows: ReadonlyArray<{ id: string }>,
  fields: string[],
  edge: 'start' | 'end' = 'start',
): GridFocus | null {
  if (!rows.length || !fields.length) return null;
  const index = edge === 'end' ? rows.length - 1 : 0;
  return { id: rows[index].id, field: fields[0], index };
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
