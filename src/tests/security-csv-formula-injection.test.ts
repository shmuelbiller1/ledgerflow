/**
 * Agent #6 (security lane) — AF-010-F5 / CWE-1236: CSV formula injection behind whitespace.
 *
 * The shared writer neutralised `=`, `+`, `-`, `@`, tab and carriage return when the cell *started*
 * with one. Excel, LibreOffice and Google Sheets all skip leading whitespace before deciding what a
 * cell is, so ` =HYPERLINK("http://evil.test","Invoice")` and the same text behind a non-breaking
 * space (the ordinary way Hebrew copied from a web page arrives) reached a reader's spreadsheet as a
 * live formula. The guard now decides on the first character the reader actually looks at.
 *
 * What must not change: a plain number stays a number (`-1,000.00` is a balance, not a formula), a
 * phone number `+1 555 0100` is still guarded, and a file written by an older version still reads
 * back unchanged through `unguardCsvCell` — otherwise exporting customers and importing them again
 * silently rewrites them.
 *
 * Evidence: docs/verification/ai6-2026-11-20.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeFormula, parseCsv, sanitizeCsvCell, unguardCsvCell } from '../lib/csv';
import { toCsv } from '../lib/csvExport';
import { reportCsv } from '../lib/scheduledReports';

/** The bytes a spreadsheet would receive for one cell, without the surrounding quotes. */
const cellText = (value: string): string => sanitizeCsvCell(value).slice(1, -1).replace(/""/g, '"');

test('AF-010-F5: a formula is neutralised behind every whitespace a spreadsheet ignores', () => {
  const formula = '=HYPERLINK("http://evil.test","Invoice")';
  for (const prefix of [' ', '  ', '\t', '\n', '\u00a0', '\u200b', '\ufeff', ' \u00a0']) {
    assert.equal(looksLikeFormula(prefix + formula), true, `leading ${JSON.stringify(prefix)} is not a hiding place`);
    assert.equal(cellText(prefix + formula), `'${prefix}${formula}`, 'the cell is marked as text, the data is untouched');
  }
  // The whole-character test that was there before must keep working for its own cases.
  for (const text of ['=1+1', '+SUM(A1:A2)', '-2+3', '@SUM(A1)', '\t=cmd', '\r=cmd', '=cmd|\' /C calc\'!A0']) {
    assert.equal(looksLikeFormula(text), true, `${JSON.stringify(text)} is a formula`);
    assert.equal(cellText(text).startsWith("'"), true, `${JSON.stringify(text)} is guarded`);
  }
});

test('AF-010-F5: ordinary text, and every plain number, is written exactly as it was', () => {
  const safe = [
    'Acme Ltd', 'Invoice 1001', 'שלום בע"מ', '100%', '(see note)', '#1001', 'Round Table', "'Round Table",
    'SALES-2026', 'A=B', 'notes: = and + in the middle',
  ];
  for (const text of safe) {
    assert.equal(looksLikeFormula(text), false, `${JSON.stringify(text)} is not a formula`);
    assert.equal(cellText(text), text, `${JSON.stringify(text)} is exported unchanged`);
  }
  const numbers = ['-1,000.00', '-$50.00', '1,234,567.89', '-12.5', '42', '0.00', ' -1,000.00', ' -0.01'];
  for (const text of numbers) {
    assert.equal(looksLikeFormula(text), false, `${JSON.stringify(text)} is a number, not a formula`);
    assert.equal(cellText(text), text, `${JSON.stringify(text)} keeps its exact text`);
  }
});

test('AF-010-F5: reading our own file back gives the same text, old files included', () => {
  for (const text of ['=1+1', ' =1+1', '\u00a0=1+1', '+1 555 0100', '-call first', '\t=cmd', '@name']) {
    const written = cellText(text);
    assert.equal(written, `'${text}`, `${JSON.stringify(text)} is guarded on the way out`);
    assert.equal(unguardCsvCell(written), text, `${JSON.stringify(text)} round-trips`);
  }
  // Names that genuinely start with an apostrophe are not a guard and must survive untouched.
  for (const text of ["'Round Table", "'", "'123"]) {
    assert.equal(unguardCsvCell(text), text, `${JSON.stringify(text)} keeps its own apostrophe`);
  }
  // A file written before this fix (a leading space was never guarded) still reads back unchanged.
  assert.equal(unguardCsvCell(' =1+1'), ' =1+1');
  assert.equal(unguardCsvCell('-1,000.00'), '-1,000.00');
});

test('AF-010-F5: every export that goes through the shared writer is guarded end to end', () => {
  const hostile = ' =cmd|\' /C calc\'!A0';
  const csv = toCsv(['Description', 'Amount'], [[hostile, -1234]]);
  assert.equal(csv, '"Description","Amount"\r\n"\' =cmd|\' /C calc\'!A0",-1234');
  assert.deepEqual(
    parseCsv(csv).map(row => row.map(unguardCsvCell)),
    [['Description', 'Amount'], [hostile, '-1234']],
    'the reader gets the text back, minus the guard',
  );
  const report = reportCsv({
    title: 'Profit and loss',
    headers: ['Account', 'Amount'],
    rows: [{ cells: [hostile, 1234] }],
  });
  assert.equal(report.includes(`"'${hostile}"`), true, 'the scheduled-report attachment is guarded too');
});
