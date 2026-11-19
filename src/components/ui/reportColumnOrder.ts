import { Children, Fragment, createContext, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';

/** A report owns the layout; an embedded RowTable applies it where its native rows are built.
 * null outside a report: a document preview must not acquire column controls or indexing. */
export const ReportColumnOrder = createContext<number[] | null>(null);

export const ReportHiddenColumns = createContext<readonly number[]>([]);

interface CellProps { children?: ReactNode; colSpan?: number; rowSpan?: number; 'data-source-column'?: number; 'data-span-row'?: boolean; hidden?: boolean }
function flatten(children: ReactNode): ReactElement<CellProps>[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<CellProps>(child)) return [];
    return child.type === Fragment ? flatten(child.props.children).map(cell =>
      cloneElement(cell, { key: JSON.stringify([child.key, cell.key]) })) : [child];
  });
}
/** Reorder native, rectangular rows declaratively; never move DOM nodes owned by React. */
export function orderReportCells(children: ReactNode, order: number[], hidden: readonly number[] = []): ReactNode {
  return Children.map(children, child => {
    if (!isValidElement<CellProps>(child)) return child;
    if (child.type === 'tr') {
      const cells = flatten(child.props.children);
      if (!cells.length || cells.some(cell => (cell.props.rowSpan || 1) !== 1)) return child;
      // A total after a spanning label is not the nth child of its source column. Shorten the
      // label by the hidden columns it covers; hide only cells with no visible source column.
      if (cells.some(cell => (cell.props.colSpan || 1) > 1)) {
        let start = 0;
        return cloneElement(child, { 'data-span-row': true }, cells.map(cell => {
          const end = start + (cell.props.colSpan || 1);
          const visible = end - start - hidden.filter(index => index >= start && index < end).length;
          start = end;
          return cloneElement(cell, { colSpan: Math.max(visible, 1), hidden: cell.props.hidden || !visible });
        }));
      }
      const natural = cells.map((cell, index) => cloneElement(cell, { key: cell.key || `column-${index}`, 'data-source-column': index }));
      const arranged = order.length === natural.length ? order.map(index => natural[index]) : natural;
      return cloneElement(child, {}, arranged);
    }
    // Custom components retain their own rendering contract; only native markup/fragments is traversed.
    return typeof child.type === 'string' || child.type === Fragment
      ? cloneElement(child, {}, orderReportCells(child.props.children, order, hidden)) : child;
  });
}
