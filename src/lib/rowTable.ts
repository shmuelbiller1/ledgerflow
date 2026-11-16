/**
 * The column shapes of the declarative table (`components/ui/RowTable`), and the CSV export built from the very
 * same columns.
 *
 * These live apart from the component for two reasons: a table's columns are data a screen declares and a test
 * can inspect without rendering, and a module that exports a component *and* a plain function loses React's fast
 * refresh for that file.
 *
 * **One spec, not a union of two.** A column that renders once and a column that repeats over a list (a pivot, a
 * cohort matrix) used to be two interfaces in a union, and TypeScript then could not contextually type the `cell`
 * callback of either: every inline `columns={[{ header: 'Year', cell: row => row.year }]}` wrote `row` as an
 * implicit `any`. A union of object types that both declare a function-typed property loses the contextual type
 * for that property. So the repeated shape is the same interface with `over` set, and every caller's `row` is
 * typed from the table's rows alone.
 */
import type { ReactNode } from 'react';

/**
 * One column. A column declared once names itself with `header`; a column that renders one `<td>` per item
 * (`over`) names each of those columns with `head`, or with the item's own text.
 */
export interface RowTableColumn<T, C = never> {
  /** The header cell's contents: text, or markup such as the `sr-only` half of a two-line heading. A column that
   *  needs a different CSV name passes `csvHeader`. */
  header?: ReactNode;
  /** One column per item of this list — a month per column, a dimension per column. */
  over?: readonly C[];
  /** The header cell for one item of `over`. Defaults to the item's own text, which is right for month names. */
  head?: (item: C) => ReactNode;
  /** The CSV header, when `header` is markup. Defaults to `header` when that is plain text. */
  csvHeader?: string | ((item: C) => string);
  /** The cell contents for one row — and, for a repeated column, one item of `over`. */
  cell: (row: T, item: C) => ReactNode;
  /** Right-align, for money and counts. */
  align?: 'left' | 'right';
  /** A class for this column's body cells only. */
  className?: string;
  /** A class for this column's header cell only. Defaults to `py-2 font-semibold`; a caller reproducing an
   *  existing table passes the class its header cell already had, so no cell changes weight in the sweep. */
  headClassName?: string;
  /** The value written to the CSV. Defaults to the cell's text, which is wrong for a formatted figure. */
  csv?: (row: T, item: C) => string | number;
}

export type RowTableColumns<T, C = never> = ReadonlyArray<RowTableColumn<T, C>>;

/** One column as the table renders it: a spec (or one item of a repeated spec) closed over its item. */
export interface PlannedColumn<T> {
  /** What identifies the column: its header text, or the item's own value. Not its position, so adding a column
   *  to a screen does not re-key the ones after it. */
  key: string;
  header: ReactNode;
  csvHeader: string;
  cell: (row: T) => ReactNode;
  csv: (row: T) => string;
  align: 'left' | 'right';
  className?: string;
  headClassName?: string;
}

/** A cell's text, when the cell is text. A cell of markup has no text form; a CSV of it needs `csv`. */
function textOf(value: ReactNode): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

/** An item's own text, which is the header of a repeated column that does not give one. */
function itemText(item: unknown): string {
  return typeof item === 'string' || typeof item === 'number' ? String(item) : '';
}

/** Flatten the declared columns into the columns that are rendered, one per `<th>`. */
export function planColumns<T, C>(columns: RowTableColumns<T, C>): PlannedColumn<T>[] {
  const planned: PlannedColumn<T>[] = [];
  for (const column of columns) {
    const align = column.align ?? 'left';
    if (column.over !== undefined) {
      for (const item of column.over) {
        const header = column.head ? column.head(item) : itemText(item);
        planned.push({
          key: textOf(header) || itemText(item),
          header,
          csvHeader: typeof column.csvHeader === 'function' ? column.csvHeader(item) : column.csvHeader ?? textOf(header),
          cell: row => column.cell(row, item),
          csv: row => (column.csv ? String(column.csv(row, item)) : textOf(column.cell(row, item))),
          align,
          className: column.className,
          headClassName: column.headClassName,
        });
      }
      continue;
    }
    // a column declared once takes no item; the spec still types one, so the cell is closed over `never`
    const cell = column.cell as (row: T) => ReactNode;
    const csv = column.csv as ((row: T) => string | number) | undefined;
    planned.push({
      key: textOf(column.header),
      header: column.header,
      csvHeader: typeof column.csvHeader === 'function' ? '' : column.csvHeader ?? textOf(column.header),
      cell,
      csv: row => (csv ? String(csv(row)) : textOf(cell(row))),
      align,
      className: column.className,
      headClassName: column.headClassName,
    });
  }
  // two columns that render the same header are told apart by an occurrence suffix, not by where they are
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
export function rowTableCsv<T, C>(
  columns: RowTableColumns<T, C>,
  rows: readonly T[],
): { headers: string[]; rows: string[][] } {
  const planned = planColumns(columns);
  return {
    headers: planned.map(column => column.csvHeader),
    rows: rows.map(row => planned.map(column => column.csv(row))),
  };
}
