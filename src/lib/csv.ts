/**
 * CSV text → rows of cells (RFC 4180): quoted cells may hold the delimiter, line breaks and
 * doubled quotes (""). The delimiter (comma, semicolon or tab) is taken from the first line, so
 * European exports ("Name;Price") read correctly. A leading byte-order mark is dropped and
 * empty lines are skipped.
 */
export function detectDelimiter(text: string): string {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  let best = ',';
  let bestCount = 0;
  for (const candidate of [',', ';', '\t']) {
    let count = 0;
    let quoted = false;
    for (const ch of firstLine) {
      if (ch === '"') quoted = !quoted;
      else if (ch === candidate && !quoted) count++;
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

export function parseCsv(input: string, delimiter = detectDelimiter(input.replace(/^\uFEFF/, ''))): string[][] {
  return readCsv(input, delimiter).rows;
}

/**
 * PREV-6: like parseCsv, but a quoted cell that never closes (a truncated download, or a stray
 * quote) refuses the whole file instead of swallowing the rest of it into one cell.
 */
export function parseCsvChecked(input: string, delimiter = detectDelimiter(input.replace(/^\uFEFF/, ''))): string[][] {
  const { rows, unclosedQuote } = readCsv(input, delimiter);
  if (unclosedQuote) {
    throw new Error('CSV: a quoted cell is never closed (the file may be cut off or have a stray quote). Nothing was imported.');
  }
  return rows;
}

function readCsv(input: string, delimiter: string): { rows: string[][]; unclosedQuote: boolean } {
  const text = input.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const endRow = () => {
    row.push(cell);
    if (row.some(c => c.trim() !== '')) rows.push(row);
    row = [];
    cell = '';
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else {
      cell += ch;
    }
  }
  const unclosedQuote = quoted;
  if (cell !== '' || row.length > 0) endRow();
  return { rows: rows.map(r => r.map(c => c.trim())), unclosedQuote };
}

/**
 * J-1 (Agent #11): undoes the formula guard on a cell that came back through our own export.
 *
 * `sanitizeCsvCell` writes a leading apostrophe before text a spreadsheet would run as a formula
 * (`=`, `+`, `-`, `@`, tab, carriage return) and leaves a plain number such as `-1,000.00` alone.
 * Reading our own file back, that apostrophe is a guard, not part of the data: a phone number
 * `+1 555 0100` or a note `-call first` must return unchanged, or exporting customers and
 * importing them again silently changes them. Only a cell whose text after the apostrophe would
 * really have been guarded is changed, so a name that genuinely starts with an apostrophe
 * (`'Round Table') is kept exactly as typed.
 */
export function unguardCsvCell(value: string): string {
  if (!value.startsWith("'")) return value;
  const rest = value.slice(1);
  if (!rest || !/^[=+\-@\t\r]/.test(rest)) return value; // a real leading apostrophe
  const isSafeNumber = /^-?\$?\s*\d{1,3}(,?\d{3})*(\.\d+)?$/.test(rest);
  return isSafeNumber ? value : rest;
}

/**
 * Sanitizes a string value against CSV/Formula injection attacks.
 * Prevents execution of spreadsheet formulas starting with =, +, -, @, \t, \r
 */
export function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  if (typeof value === 'number') return String(value);

  let str = String(value);

  // Purely formatted numbers (like -1,000.00 or -$50.00) are safe from formula injection
  const isSafeNumber = /^-?\$?\s*\d{1,3}(,?\d{3})*(\.\d+)?$/.test(str);

  if (!isSafeNumber && /^[=+\-@\t\r]/.test(str)) {
    str = "'" + str;
  }

  return `"${str.replace(/"/g, '""')}"`;
}
