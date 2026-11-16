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

export type { RowTableColumn, RowTableColumns } from '../../lib/rowTable';

export interface RowTableProps<T, C = never> {
  /** The table's accessible name, rendered as a `<caption>`. Screen-reader only unless `captionClassName` says
   *  otherwise; the screen usually shows its own heading. */
  caption: ReactNode;
  /** A class for the caption. A screen that showed the caption as a visible line above the table — "Sales by
   *  month", a schedule's own title — passes the class it used, so the sweep does not hide that line. */
  captionClassName?: string;
  rows: readonly T[];
  columns: RowTableColumns<T, C>;
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
  /** A class for the `<thead>` — `sticky top-0 bg-…` on a long list, which is a class of the head, not of a row. */
  headRowClassName?: string;
  bodyClassName?: string;
  /** A totals row (or rows) under the body, rendered as the caller wrote it. */
  footer?: ReactNode;
  /** A class for the `<tfoot>` the footer renders in — `sticky bottom-0` on a long list. */
  footerClassName?: string;
  /** A row to show *inside* the body when there are no rows: the sentence a report prints in place of its list.
   *  Unlike `empty`, the table stays, so the sentence still sits under the columns it is about. */
  emptyRow?: ReactNode;
  /** Shown instead of the table when there are no rows. */
  empty?: ReactNode;
}

/**
 * A cell's class: the column's own alignment, when it declares one, then its class. A column that declares no
 * alignment gets no alignment class, so a cell that inherited alignment from its table still does — a bare header
 * cell in a table someone centred, a data cell that follows the start edge in a right-to-left layout.
 */
function alignClass(align: 'left' | 'right' | undefined, className: string | undefined): string {
  return [align === 'right' ? 'text-right' : align === 'left' ? 'text-left' : '', className ?? ''].filter(Boolean).join(' ');
}

export function RowTable<T, C = never>({
  caption,
  captionClassName = 'sr-only',
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
  footerClassName,
  emptyRow,
  empty,
}: RowTableProps<T, C>) {
  if (rows.length === 0 && empty !== undefined) return <>{empty}</>;
  const keyOf = rowKey ?? ((_row: T, position: number) => position);
  const planned = planColumns(columns);
  return (
    <table className={tableClassName}>
      <caption className={captionClassName}>{caption}</caption>
      <thead className={headRowClassName}>
        <tr>
          {planned.map(column => (
            <th key={column.key} scope="col" className={alignClass(column.align, column.headClassName ?? 'py-2 font-semibold')}>
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className={bodyClassName}>
        {rows.length === 0 && emptyRow !== undefined ? emptyRow : rows.map((row, position) => (
          <tr key={keyOf(row, position)} className={rowClassName}>
            {planned.map((column, index) => {
              const className = alignClass(column.align, column.className);
              const cellProps = typeof column.cellProps === 'function' ? column.cellProps(row) : column.cellProps;
              // the first column names the record, so it is a header cell for the row it starts
              if (index === 0 && rowHeaderColumn) {
                return <th key={column.key} scope="row" className={`${className} ${rowHeaderClassName}`.trim()} {...cellProps}>{column.cell(row)}</th>;
              }
              return <td key={column.key} className={className} {...cellProps}>{column.cell(row)}</td>;
            })}
          </tr>
        ))}
      </tbody>
      {footer !== undefined ? <tfoot className={footerClassName}>{footer}</tfoot> : null}
    </table>
  );
}
