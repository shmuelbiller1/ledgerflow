/**
 * J-2 (Agent #11): the rows the import preview shows before anything is written.
 *
 * The queue asks for "the first 20 rows as they will be saved, with the rows that will be refused (and
 * why) marked before anything is written". The screen already checked every row (`prepareImport`) and
 * listed the problems in a separate table; this projects both onto the file's own row numbers so a
 * refused row is marked *in place*, with the reason, next to the values it would have saved.
 */
import type { ImportIssue, ImportValue, PreparedRecord } from './recordImport';

export const PREVIEW_ROWS = 20;

export interface ImportPreviewRow {
  /** Spreadsheet row number (the header is row 1). */
  row: number;
  /** The typed values that would be saved; empty for a row that is wholly refused. */
  values: Record<string, ImportValue>;
  /** Every reason the row will be refused, in the checker's order; empty when it will be saved. */
  problems: string[];
}

export function importPreviewRows(
  records: readonly PreparedRecord[],
  errors: readonly ImportIssue[],
  limit = PREVIEW_ROWS,
): ImportPreviewRow[] {
  const problemsByRow = new Map<number, string[]>();
  for (const issue of errors) {
    const list = problemsByRow.get(issue.row) ?? [];
    list.push(issue.field ? `${issue.field}: ${issue.message}` : issue.message);
    problemsByRow.set(issue.row, list);
  }
  const ready = new Map(records.map(record => [record.row, record.data]));
  const rowNumbers = [...new Set([...ready.keys(), ...problemsByRow.keys()])]
    .sort((a, b) => a - b)
    .slice(0, Math.max(0, limit));
  return rowNumbers.map(row => ({
    row,
    values: ready.get(row) ?? {},
    problems: problemsByRow.get(row) ?? [],
  }));
}
