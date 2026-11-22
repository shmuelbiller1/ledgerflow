import type { HTMLAttributes, Key, ReactNode, TdHTMLAttributes } from 'react';

/** A statement can have a different number of cells on a group heading, movement and total.
 * Keep those shapes explicit rather than pretending a spanning label is a sortable record. */
export type Bands<T> = T | Bands<T>[] | false | null | undefined;
export interface BandCell extends Omit<TdHTMLAttributes<HTMLTableCellElement>, 'content'> {
  key?: Key;
  content?: ReactNode;
  scope?: 'col' | 'row' | 'colgroup' | 'rowgroup' | (string & {});
  'data-testid'?: string;
}
export interface BandRow extends HTMLAttributes<HTMLTableRowElement> {
  key?: Key;
  cells: Bands<BandCell>[];
  'data-testid'?: string;
}
export interface RowGroup {
  key?: Key;
  className?: string;
  rows: Bands<BandRow>[];
}
