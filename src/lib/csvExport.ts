import { formatDecimal } from './moneyFormat';
import { sanitizeCsvCell } from './csv';

/**
 * The one way the app writes a CSV file (F-22, shared report shell). Every cell is quoted with
 * quotes doubled, so commas, quotes and line breaks in names stay in their cell; text that a
 * spreadsheet would run as a formula (=, +, -, @ first) is neutralised (sanitizeCsvCell). The file
 * starts with a UTF-8 marker so Excel shows accented and Hebrew names correctly, and it is built
 * as a Blob: a data: link cut the file at the first "#" (e.g. "Invoice #1001").
 */
export type CsvValue = string | number | boolean | null | undefined;

/** Money in a CSV file: a plain decimal from cents ("1234.50", "-12.00"), no currency sign. */
export function csvMoney(cents: number | null | undefined): string {
  return formatDecimal(cents ?? 0);
}

export function toCsv(headers: CsvValue[], rows: CsvValue[][]): string {
  const cell = (v: CsvValue) => sanitizeCsvCell(typeof v === 'boolean' ? String(v) : v);
  return [headers, ...rows].map(row => row.map(cell).join(',')).join('\r\n');
}

/** Builds the file and starts the download in the browser. */
export function downloadCsv(filename: string, headers: CsvValue[], rows: CsvValue[][]): void {
  const blob = new Blob(['﻿' + toCsv(headers, rows)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
