/**
 * Prompt 2, part 1 — "one list": the simplest shape of a table, declared instead of hand-written.
 *
 * The shared grid (`TanStackDataGrid`) is the destination, but most of the remaining raw tables are not
 * ready for it: they are a small block *inside* a document (a schedule under a chart, the lines of one
 * journal entry, a preview in a dialog) where sort, search, saved views and a toolbar would be noise. They
 * still should not each hand-write a head, a header cell per column and a row per record — that is the same
 * fifteen lines repeated, and it is where a column drifts out of line with its header.
 *
 * So this is the middle step, and it is deliberately **not** a new look. It renders the markup the screens
 * render today — same table class, same head class, same row-header class, same cell classes — because the
 * point is to remove the repetition, not to restyle a screen that already looks right. A caller that passes
 * the classes it used to write by hand gets the same table back, with four things it was missing:
 *
 *  - a caption, so the table has an accessible name;
 *  - a row header for the first column, which is what makes a screen reader read "Depreciation, 2026,
 *    $1,200" instead of a stream of unattributed numbers;
 *  - `align: 'right'` per column, so figures stay right-aligned when a column moves;
 *  - the same columns again as CSV rows, so an exported file cannot disagree with the screen.
 *
 * The shared grid is still the answer for a list that needs sorting, searching, column choice or a saved
 * view. This is for the table that is part of a sentence.
 */
import type { ReactNode } from 'react';
import { planColumns, type RowTableColumns } from '../../lib/rowTable';

export type { RowTableColumn, RowTableRepeatedColumn, RowTableColumns } from '../../lib/rowTable';

export interface RowTableProps<T> {
  /** The table's accessible name, rendered as a `<caption>`. Screen-reader only; the screen shows its own heading. */
  caption: ReactNode;
  rows: readonly T[];
  columns: RowTableColumns<T>;
  /** A stable identity per row. Defaults to the index, which is only safe for a static table. */
  rowKey?: (row: T, index: number) => string | number;
  /** The first column is a row header — the record's own name. */
  rowHeaderColumn?: boolean;
  /** An extra class for the row-header cells only. Empty by default: most screens' first column is not bold,
   *  and the sweep must not make it bold. */
  rowHeaderClassName?: string;
  /** A class for every row — the screen's row separator. A class that depends on the row stays hand-written. */
  rowClassName?: string;
  tableClassName?: string;
  headRowClassName?: string;
  bodyClassName?: string;
  /** A totals row (or rows) under the body, rendered as the caller wrote it. */
  footer?: ReactNode;
  /** Shown instead of the table when there are no rows. */
  empty?: ReactNode;
}

export function RowTable<T>({
  caption,
  rows,
  columns,
  rowKey,
  rowHeaderColumn = true,
  rowClassName,
  rowHeaderClassName = '',
  tableClassName = 'w-full text-xs',
  headRowClassName = 'text-[var(--muted)]',
  bodyClassName = 'divide-y divide-[var(--line)]',
  footer,
  empty,
}: RowTableProps<T>) {
  if (rows.length === 0 && empty !== undefined) return <>{empty}</>;
  const keyOf = rowKey ?? ((_row: T, position: number) => position);
  const planned = planColumns(columns);
  return (
    <table className={tableClassName}>
      <caption className="sr-only">{caption}</caption>
      <thead className={headRowClassName}>
        <tr>
          {planned.map(plannedColumn => {
            const align = 'single' in plannedColumn ? plannedColumn.single.align : plannedColumn.repeated.align;
            const headClassName = 'single' in plannedColumn ? plannedColumn.single.headClassName : plannedColumn.repeated.headClassName;
            const header = 'single' in plannedColumn ? plannedColumn.single.header : plannedColumn.repeated.header(plannedColumn.item);
            return (
              <th key={plannedColumn.key} scope="col" className={`${align === 'right' ? 'text-right' : 'text-left'} ${headClassName ?? 'py-2 font-semibold'}`.trim()}>
                {header}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody className={bodyClassName}>
        {rows.map((row, position) => (
          <tr key={keyOf(row, position)} className={rowClassName}>
            {planned.map(plannedColumn => {
              const align = 'single' in plannedColumn ? plannedColumn.single.align : plannedColumn.repeated.align;
              const extra = 'single' in plannedColumn ? plannedColumn.single.className : plannedColumn.repeated.className;
              const className = `${align === 'right' ? 'text-right' : 'text-left'} ${extra ?? ''}`.trim();
              const content = 'single' in plannedColumn ? plannedColumn.single.cell(row) : plannedColumn.repeated.cell(row, plannedColumn.item);
              // the first column names the record, so it is a header cell for the row it starts
              if (plannedColumn.key === planned[0].key && rowHeaderColumn) {
                return <th key={plannedColumn.key} scope="row" className={`${className} ${rowHeaderClassName}`.trim()}>{content}</th>;
              }
              return <td key={plannedColumn.key} className={className}>{content}</td>;
            })}
          </tr>
        ))}
      </tbody>
      {footer !== undefined ? <tfoot>{footer}</tfoot> : null}
    </table>
  );
}
