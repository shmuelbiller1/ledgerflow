/**
 * The column shapes of the declarative table (`components/ui/RowTable`), and the CSV export built from the very
 * same columns.
 *
 * These live apart from the component for two reasons: a table's columns are data a screen declares and a test
 * can inspect without rendering, and a module that exports a component *and* a plain function loses React's fast
 * refresh for that file.
 */
import type { ReactNode } from 'react';

export interface RowTableColumn<T> {
  /** The header cell's contents: text, or markup such as the `sr-only` half of a two-line heading. A column that
   *  needs a different CSV name passes `csvHeader`. */
  header: ReactNode;
  /** The CSV header, when `header` is markup. Defaults to `header` when that is plain text. */
  csvHeader?: string;
  /** The cell contents for one row. */
  cell: (row: T) => ReactNode;
  /** Right-align, for money and counts. */
  align?: 'left' | 'right';
  /** A class for this column's body cells only. */
  className?: string;
  /** A class for this column's header cell only. Defaults to `py-2 font-semibold`; a caller reproducing an
   *  existing table passes the class its header cell already had, so no cell changes weight in the sweep. */
  headClassName?: string;
  /** The value written to the CSV. Defaults to the cell's text, which is wrong for a formatted figure. */
  csv?: (row: T) => string | number;
}

/**
 * One entry that renders **many** columns: a cohort matrix with a month per column, a pivot, a per-dimension
 * breakdown. The header and the cell are both a function of the column's own item, so the screen says "one
 * column per month" once instead of mapping the header row and the body separately and hoping they agree.
 */
export interface RowTableRepeatedColumn<T, C> {
  over: readonly C[];
  header: (item: C) => ReactNode;
  cell: (row: T, item: C) => ReactNode;
  align?: 'left' | 'right';
  className?: string;
  headClassName?: string;
  /** The CSV header for this column's item. Defaults to the header when that is plain text. */
  csvHeader?: (item: C) => string;
  csv?: (row: T, item: C) => string | number;
}

export type RowTableColumns<T> = ReadonlyArray<RowTableColumn<T> | RowTableRepeatedColumn<T, never>>;

/** One rendered column: a single spec, or one item of a repeated spec, and the key its cells are identified by. */
export type PlannedColumn<T> =
  | { single: RowTableColumn<T>; key: string }
  | { repeated: RowTableRepeatedColumn<T, unknown>; item: unknown; key: string };

/**
 * The key of a header: its text, or the item's own value for a repeated column. Not its position, so adding a
 * column to a screen does not re-key the ones after it. Two columns that render the same name are told apart by an
 * occurrence suffix rather than by where they are.
 */
function keyOfHeader(header: ReactNode, item: unknown): string {
  if (typeof header === 'string' || typeof header === 'number') return String(header);
  if (typeof item === 'string' || typeof item === 'number') return String(item);
  return '';
}

/** Flatten the declared columns into the columns that are rendered, one per cell. */
export function planColumns<T>(columns: RowTableColumns<T>): PlannedColumn<T>[] {
  const planned: PlannedColumn<T>[] = columns.flatMap(column => ('over' in column
    ? column.over.map(item => ({
        repeated: column as RowTableRepeatedColumn<T, unknown>,
        item,
        key: keyOfHeader((column as RowTableRepeatedColumn<T, unknown>).header(item as never), item),
      }))
    : [{ single: column as RowTableColumn<T>, key: keyOfHeader((column as RowTableColumn<T>).header, undefined) }]));
  const seen = new Map<string, number>();
  for (const column of planned) {
    const count = seen.get(column.key) ?? 0;
    seen.set(column.key, count + 1);
    if (count > 0) column.key = `${column.key}#${count}`;
  }
  return planned;
}

/**
 * The same columns as CSV rows, so an exported file cannot drift from the table it came from.
 *
 * A column with no `csv` writes its cell as text, which is *not* good enough for a money column — the display
 * format carries a currency symbol — so a caller exporting money passes `csv` and gets a plain decimal.
 */
export function rowTableCsv<T>(
  columns: RowTableColumns<T>,
  rows: readonly T[],
): { headers: string[]; rows: string[][] } {
  const planned = planColumns(columns);
  const textOf = (value: ReactNode) => (typeof value === 'string' || typeof value === 'number' ? String(value) : '');
  return {
    headers: planned.map(plannedColumn => {
      if ('single' in plannedColumn) {
        return plannedColumn.single.csvHeader ?? textOf(plannedColumn.single.header);
      }
      const { repeated, item } = plannedColumn;
      if (repeated.csvHeader) return repeated.csvHeader(item as never);
      return textOf(repeated.header(item as never));
    }),
    rows: rows.map(row => planned.map(plannedColumn => {
      if ('single' in plannedColumn) {
        const { single } = plannedColumn;
        return single.csv ? String(single.csv(row)) : textOf(single.cell(row));
      }
      const { repeated, item } = plannedColumn;
      return repeated.csv ? String(repeated.csv(row, item as never)) : textOf(repeated.cell(row, item as never));
    })),
  };
}
