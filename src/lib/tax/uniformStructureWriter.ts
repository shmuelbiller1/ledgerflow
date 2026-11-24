/**
 * E-33: the Israeli Uniform Structure (מבנה אחיד / OPEN FORMAT) writer.
 *
 * Turns the typed books shape (`UniformFixtureInput`, E-54) into the Tax Authority's two
 * fixed-width files: `INI.TXT` (A000 header + one 19-char summary line per record type) and
 * `BKMVDATA.TXT` (A100 opening, the data records, Z900 closing), each record exactly its
 * layout width with CRLF line endings, sequential record numbers, and the A000 total equal
 * to the Z900 total. Amounts use the spec's implied-decimal fields: X9(12)V99 is a sign plus
 * 14 digits of the books' minor units (agorot), X9(12)V9999 a sign plus 16 digits at four
 * decimals, X9(9)V99 a sign plus 11 digits at two — the same rule SHAAM's open generator
 * documents for these technical descriptions.
 *
 * Encoding is ISO-8859-8-i (field 1029 = 1): `encodeUniformIso88598` maps every character to
 * its single byte, so a character count is a byte count. Characters the encoding cannot hold
 * (emoji, most punctuation outside Latin-1/Hebrew) block the download and are named in
 * `problems`; a documented substitution list (gershayim, dashes, curly quotes, ellipsis)
 * normalises the few Hebrew/punctuation characters ISO-8859-8 lacks, and each substitution
 * is reported in `notes`.
 *
 * This is a calculation-status writer, never a filing: `readyForFiling` is always false and
 * nothing here is accepted by the Tax Authority simulator. `problems` blocks the download
 * (`canDownload` false) — a value that cannot be written correctly is reported, never
 * truncated or invented. See docs/UNIFORM_STRUCTURE_RESEARCH.md.
 *
 * Pure: no store, no I/O (the screen turns the text into a download).
 */
import {
  UNIFORM_A000,
  UNIFORM_A100,
  UNIFORM_B100,
  UNIFORM_B110,
  UNIFORM_C100,
  UNIFORM_D110,
  UNIFORM_D120,
  UNIFORM_M100,
  UNIFORM_Z900,
  UNIFORM_SYSTEM_CONSTANT,
  UNIFORM_DOCUMENT_TYPES,
  type UniformFixtureInput,
  type UniformRecordLayout,
} from './uniformStructure';

/** BKMVDATA.TXT record order: opening, data records, closing (A000 lives in INI.TXT only). */
export const UNIFORM_BKMV_RECORD_ORDER: readonly UniformRecordLayout[] = [
  UNIFORM_A100,
  UNIFORM_B100,
  UNIFORM_B110,
  UNIFORM_C100,
  UNIFORM_D110,
  UNIFORM_D120,
  UNIFORM_M100,
  UNIFORM_Z900,
];

/** What the writer needs about the run itself, beyond the books (A000 fields 1004/1026/1027…). */
export interface UniformWriteOptions {
  /** YYYYMMDD of the run — A000 field 1026 (and the OPENFRMT folder name). */
  processDate: string;
  /** HHMM of the run — A000 field 1027. */
  processTime: string;
  /**
   * Field 1004/1103/1153: fixed and unique per file, digits, at most 15. The screen derives
   * it from the tax ID and period; it is not an authority-issued number.
   */
  primaryIdentifier: string;
  /** Field 1032, the books' base currency code (default ILS). */
  baseCurrency?: string;
  /** Field 1016, the תיק ניכויים when the books record one. */
  withholdingFileNo?: string;
  software?: {
    /** Field 1006, 9(8). Not recorded by the books: written as zeros with a note. */
    registrationNo?: string;
    /** Field 1007. */
    name?: string;
    /** Field 1008. */
    version?: string;
    /** Field 1009, 9(9). Not recorded: zeros with a note. */
    vendorTaxId?: string;
    /** Field 1010. */
    vendorName?: string;
  };
}

export interface UniformRecordCount {
  code: string;
  count: number;
}

export interface UniformDocumentTypeTotal {
  documentType: string;
  count: number;
  totalInclVatCents: number;
  vatAmountCents: number;
}

export interface UniformFilesOutput {
  /** INI.TXT content: A000 then one summary line per record type present in BKMVDATA. */
  iniText: string;
  /** BKMVDATA.TXT content: A100 … Z900, every line exactly its layout width, CRLF ended. */
  bkmvdataText: string;
  /** Per record type in BKMVDATA, in file order. */
  recordCounts: UniformRecordCount[];
  /** Total records in BKMVDATA (A000 field 1002 = Z900 field 1155). */
  totalRecords: number;
  /** Per document type written: count and totals in the books' minor units (form 2.6 style). */
  documentTypeTotals: UniformDocumentTypeTotal[];
  journalDebitsCents: number;
  journalCreditsCents: number;
  /** Blocking: the file cannot be written correctly until these are resolved. */
  problems: string[];
  /** Visible limitations that do not block: substitutions and known gaps. */
  notes: string[];
  canDownload: boolean;
  readyForFiling: false;
}

interface Ctx {
  problems: string[];
  notes: string[];
  substitutions: number;
}

function problem(ctx: Ctx, message: string): void {
  if (!ctx.problems.includes(message)) ctx.problems.push(message);
}

function note(ctx: Ctx, message: string): void {
  if (!ctx.notes.includes(message)) ctx.notes.push(message);
}

/**
 * Characters ISO-8859-8 does not carry, mapped to the closest byte the encoding does carry.
 * Applied before every length check, so a field's width is counted after substitution.
 * Each substitution is counted and reported as a note, never silent.
 */
const SUBSTITUTIONS: ReadonlyArray<readonly [string, string]> = [
  ['״', '"'], // gershayim
  ['׳', "'"], // gersh
  ['–', '-'], // en dash
  ['—', '-'], // em dash
  ['‘', "'"],
  ['’', "'"],
  ['“', '"'],
  ['”', '"'],
  ['…', '...'],
  [' ', ' '], // nbsp
  ['‗', '_'], // double low line (0xDF in the encoding)
];

export function normalizeUniformText(text: string): string {
  let out = text;
  for (const [from, to] of SUBSTITUTIONS) out = out.split(from).join(to);
  return out;
}

/** The ISO-8859-8 byte for one (already normalised) character, or undefined if it has none. */
export function uniformCharByte(ch: string): number | undefined {
  const code = ch.codePointAt(0);
  if (code === undefined) return undefined;
  if (code < 0x80) return code; // ASCII
  return ISO_8859_8[ch];
}

/**
 * ISO-8859-8 (logical Hebrew) bytes for the non-Latin-1 repertoire, verified against Python's
 * `iso8859-8` codec: א=0xE0 … ת=0xFA with the final forms ך ם ן ף ץ, plus the Latin-1
 * punctuation subset the standard keeps. Anything absent (emoji, gershayim before
 * substitution, Cyrillic…) has no byte here.
 */
const ISO_8859_8: Readonly<Record<string, number>> = {
  '¢': 0xa2, '£': 0xa3, '¤': 0xa4, '¥': 0xa5, '¦': 0xa6, '§': 0xa7, '¨': 0xa8,
  '©': 0xa9, '×': 0xaa, '«': 0xab, '¬': 0xac, '®': 0xae, '¯': 0xaf, '°': 0xb0,
  '±': 0xb1, '²': 0xb2, '³': 0xb3, '´': 0xb4, 'µ': 0xb5, '¶': 0xb6, '·': 0xb7,
  '¸': 0xb8, '¹': 0xb9, '÷': 0xba, '»': 0xbb, '¼': 0xbc, '½': 0xbd, '¾': 0xbe,
  'א': 0xe0, 'ב': 0xe1, 'ג': 0xe2, 'ד': 0xe3, 'ה': 0xe4, 'ו': 0xe5, 'ז': 0xe6,
  'ח': 0xe7, 'ט': 0xe8, 'י': 0xe9, 'ך': 0xea, 'כ': 0xeb, 'ל': 0xec, 'ם': 0xed,
  'מ': 0xee, 'ן': 0xef, 'נ': 0xf0, 'ס': 0xf1, 'ע': 0xf2, 'ף': 0xf3, 'פ': 0xf4,
  'ץ': 0xf5, 'צ': 0xf6, 'ק': 0xf7, 'ר': 0xf8, 'ש': 0xf9, 'ת': 0xfa,
};

/**
 * ISO-8859-8-i bytes for one file. Substitutions run first (so `uniformStructureWriter`
 * widths and these bytes agree); a character with no byte throws rather than silently
 * dropping — the writer's `problems` list the same characters before a download is offered.
 */
export function encodeUniformIso88598(text: string): Uint8Array {
  const normalized = normalizeUniformText(text);
  const bytes = new Uint8Array(normalized.length);
  for (let i = 0; i < normalized.length; i++) {
    const byte = uniformCharByte(normalized[i]);
    if (byte === undefined) {
      throw new Error(`Uniform file character ${JSON.stringify(normalized[i])} is not in ISO-8859-8.`);
    }
    bytes[i] = byte;
  }
  return bytes;
}

/** Characters whose substitution ran, counted across every field of the file. */
export function countUniformSubstitutions(text: string): number {
  let count = 0;
  for (const [from] of SUBSTITUTIONS) {
    let at = text.indexOf(from);
    while (at !== -1) {
      count++;
      at = text.indexOf(from, at + from.length);
    }
  }
  return count;
}

function spaces(width: number): string {
  return ' '.repeat(width);
}

function zeros(width: number): string {
  return '0'.repeat(width);
}

/** Field 1003/1102/1202/…: 9(9) digits, zero-padded. An absent required value is a problem. */
function fmtNum(ctx: Ctx, value: string | number | undefined, width: number, label: string, required = true): string {
  if (value === undefined || value === null || String(value).trim() === '') {
    if (required) problem(ctx, `${label} is missing.`);
    return required ? zeros(width) : spaces(width);
  }
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) {
    problem(ctx, `${label} must be digits, got ${JSON.stringify(text)}.`);
    return required ? zeros(width) : spaces(width);
  }
  if (text.length > width) {
    problem(ctx, `${label} has ${text.length} digits; the field holds ${width}.`);
    return required ? zeros(width) : spaces(width);
  }
  return text.padStart(width, '0');
}

/** X(n) text: space-padded right, never truncated — an overflow is a problem. */
function fmtText(ctx: Ctx, value: string | undefined, width: number, label: string, required = true): string {
  if (value === undefined || value === '') {
    if (required) problem(ctx, `${label} is missing.`);
    return spaces(width);
  }
  const normalized = normalizeUniformText(value);
  const unmappable = [...normalized].find(ch => uniformCharByte(ch) === undefined);
  if (unmappable !== undefined) {
    problem(ctx, `${label} contains ${JSON.stringify(unmappable)}, which ISO-8859-8 cannot hold.`);
    return spaces(width);
  }
  if (normalized.length > width) {
    problem(ctx, `${label} is ${normalized.length} characters; the field holds ${width}.`);
    return spaces(width);
  }
  const substitutions = countUniformSubstitutions(value);
  if (substitutions > 0) ctx.substitutions += substitutions;
  return normalized.padEnd(width, ' ');
}

/** X9(12)V99 (15): sign + 14 digits of minor units — 1180000 agorot → "+00000001180000". */
function fmtAmount(ctx: Ctx, cents: number | undefined, width: number, label: string, required = true): string {
  const digits = width - 1;
  if (cents === undefined || cents === null) {
    if (required) problem(ctx, `${label} is missing.`);
    return required ? `+${zeros(digits)}` : spaces(width);
  }
  if (!Number.isSafeInteger(cents)) {
    problem(ctx, `${label} is not a whole number of minor units (${cents}).`);
    return `+${zeros(digits)}`;
  }
  const magnitude = String(Math.abs(cents));
  if (magnitude.length > digits) {
    problem(ctx, `${label} (${magnitude} minor units) does not fit the ${width}-character amount field.`);
    return `+${zeros(digits)}`;
  }
  return `${cents < 0 ? '-' : '+'}${magnitude.padStart(digits, '0')}`;
}

/** X9(12)V9999 (17): sign + 16 digits at four decimals — 10 units → "+0000000000100000". */
function fmtQuantity(ctx: Ctx, quantity: number | undefined, width: number, label: string, required = true): string {
  const digits = width - 1;
  if (quantity === undefined || quantity === null) {
    if (required) problem(ctx, `${label} is missing.`);
    return required ? `+${zeros(digits)}` : spaces(width);
  }
  if (!Number.isFinite(quantity)) {
    problem(ctx, `${label} is not a number (${quantity}).`);
    return `+${zeros(digits)}`;
  }
  const scaled = Math.round(quantity * 10000);
  const magnitude = String(Math.abs(scaled));
  if (magnitude.length > digits) {
    problem(ctx, `${label} (${quantity}) does not fit the ${width}-character quantity field.`);
    return `+${zeros(digits)}`;
  }
  return `${scaled < 0 ? '-' : '+'}${magnitude.padStart(digits, '0')}`;
}

/** X9(9)V99 (12): sign + 11 digits at two decimals — M100 stock quantities. */
function fmtQuantity2(ctx: Ctx, quantity: number | undefined, width: number, label: string, required = true): string {
  const digits = width - 1;
  if (quantity === undefined || quantity === null) {
    if (required) problem(ctx, `${label} is missing.`);
    return required ? `+${zeros(digits)}` : spaces(width);
  }
  if (!Number.isFinite(quantity)) {
    problem(ctx, `${label} is not a number (${quantity}).`);
    return `+${zeros(digits)}`;
  }
  const scaled = Math.round(quantity * 100);
  const magnitude = String(Math.abs(scaled));
  if (magnitude.length > digits) {
    problem(ctx, `${label} (${quantity}) does not fit the ${width}-character quantity field.`);
    return `+${zeros(digits)}`;
  }
  return `${scaled < 0 ? '-' : '+'}${magnitude.padStart(digits, '0')}`;
}

/** 8-digit calendar date (YYYYMMDD); a real calendar day, not a shape. */
function fmtDate8(ctx: Ctx, value: string | undefined, label: string, required = true): string {
  if (value === undefined || value === '') {
    if (required) problem(ctx, `${label} is missing.`);
    return required ? zeros(8) : spaces(8);
  }
  const text = String(value).trim();
  if (!/^\d{8}$/.test(text)) {
    problem(ctx, `${label} must be YYYYMMDD, got ${JSON.stringify(text)}.`);
    return zeros(8);
  }
  const month = Number(text.slice(4, 6));
  const day = Number(text.slice(6, 8));
  const year = Number(text.slice(0, 4));
  // arithmetic leap rule — a pure check with no Date/UTC calls (quality ratchet counts those)
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = month < 1 || month > 12 ? 0
    : month === 2 ? (leap ? 29 : 28)
      : [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day < 1 || day > daysInMonth) {
    problem(ctx, `${label} is not a real calendar day (${text}).`);
    return zeros(8);
  }
  return text;
}

/**
 * One record: every field of the layout in order, each exactly its width. A value the caller
 * did not fill is spaces (optional) or spaces/zeros plus a problem (required). A value whose
 * length disagrees with the layout is a writer bug and throws.
 */
function buildRecord(ctx: Ctx, layout: UniformRecordLayout, values: Record<number, string | undefined>): string {
  const parts: string[] = [];
  for (const field of layout.fields) {
    const value = values[field.no];
    if (value !== undefined) {
      if (value.length !== field.width) {
        throw new Error(
          `Uniform writer bug: ${layout.code} field ${field.no} (${field.key}) is ${value.length} characters, layout says ${field.width}.`,
        );
      }
      parts.push(value);
      continue;
    }
    if (field.required === 'Required') {
      problem(ctx, `${layout.code} field ${field.no} (${field.key}) is required but was not written.`);
    }
    parts.push(field.kind === 'num' && field.required === 'Required' ? zeros(field.width) : spaces(field.width));
  }
  const line = parts.join('');
  if (line.length !== layout.width) {
    throw new Error(`Uniform writer bug: ${layout.code} is ${line.length} characters, layout says ${layout.width}.`);
  }
  return line;
}

/**
 * Write INI.TXT and BKMVDATA.TXT from the books shape.
 *
 * Never throws for bad data: a value that cannot be written correctly becomes a `problems`
 * entry (and `canDownload` false). It throws only on a writer bug (a field whose length
 * disagrees with its layout), which tests would catch immediately.
 */
export function writeUniformFiles(input: UniformFixtureInput, options: UniformWriteOptions): UniformFilesOutput {
  const ctx: Ctx = { problems: [], notes: [], substitutions: 0 };

  const taxId = fmtNum(ctx, input.business.taxId, 9, 'Business tax ID (field 1003)');
  const primaryIdentifier = fmtNum(ctx, options.primaryIdentifier, 15, 'Primary identifier (field 1004)');
  const processDate = fmtDate8(ctx, options.processDate, 'Process start date (field 1026)');
  if (!/^\d{4}$/.test(String(options.processTime || ''))) {
    problem(ctx, `Process start time (field 1027) must be HHMM, got ${JSON.stringify(options.processTime)}.`);
  }
  const processTime = /^\d{4}$/.test(String(options.processTime || '')) ? String(options.processTime) : zeros(4);
  const taxYear = fmtNum(ctx, input.business.taxYear, 4, 'Tax year (field 1023)');
  const startDate = fmtDate8(ctx, input.business.startDate, 'Period start (field 1024)');
  const endDate = fmtDate8(ctx, input.business.endDate, 'Period end (field 1025)');

  // System identity the books do not record: written as zeros/blank with a note, never guessed.
  const software = options.software ?? {};
  if (!software.registrationNo) note(ctx, 'The software registration number (field 1006) is not recorded; it is written as zeros.');
  if (!software.vendorTaxId) note(ctx, "The software vendor's tax ID (field 1009) is not recorded; it is written as zeros.");
  const softwareRegistrationNo = fmtNum(ctx, software.registrationNo, 8, 'Software registration number (field 1006)', false);
  const softwareName = fmtText(ctx, software.name, 20, 'Software name (field 1007)');
  const softwareVersion = fmtText(ctx, software.version, 20, 'Software version (field 1008)');
  const softwareVendorTaxId = fmtNum(ctx, software.vendorTaxId, 9, 'Software vendor tax ID (field 1009)', false);
  const softwareVendorName = fmtText(ctx, software.vendorName, 20, 'Software vendor name (field 1010)', false);

  const businessName = fmtText(ctx, input.business.name, 50, 'Business name (field 1018)');
  const street = fmtText(ctx, input.business.street, 50, 'Business street (field 1019)', false);
  const houseNo = fmtText(ctx, input.business.houseNo, 10, 'Business house number (field 1020)', false);
  const city = fmtText(ctx, input.business.city, 30, 'Business city (field 1021)', false);
  const zip = fmtText(ctx, input.business.zip, 8, 'Business ZIP (field 1022)', false);

  // Journal balance: an export of lines that do not balance would misstate the books.
  let journalDebitsCents = 0;
  let journalCreditsCents = 0;
  for (const entry of input.journalEntries) {
    if (entry.debitCredit === '1') journalDebitsCents += entry.amountCents;
    else journalCreditsCents += entry.amountCents;
  }
  if (journalDebitsCents !== journalCreditsCents) {
    problem(ctx, `Journal lines do not balance: debits ${journalDebitsCents} vs credits ${journalCreditsCents} minor units.`);
  }

  // ---- BKMVDATA.TXT records, in file order, with one sequential number across the file ----
  const lines: string[] = [];
  const counts = new Map<string, number>();
  let recordNo = 0;
  const push = (layout: UniformRecordLayout, values: Record<number, string | undefined>): void => {
    recordNo++;
    lines.push(buildRecord(ctx, layout, values));
    counts.set(layout.code, (counts.get(layout.code) ?? 0) + 1);
  };

  // A100 opening
  push(UNIFORM_A100, {
    1100: UNIFORM_A100.code,
    1101: fmtNum(ctx, recordNo + 1, 9, 'A100 record number'),
    1102: taxId,
    1103: primaryIdentifier,
    1104: UNIFORM_SYSTEM_CONSTANT,
  });

  // B100 journal lines
  const linesByTransaction = new Map<string, number>();
  for (const entry of input.journalEntries) {
    const lineNo = (linesByTransaction.get(entry.transactionNo) ?? 0) + 1;
    linesByTransaction.set(entry.transactionNo, lineNo);
    if (entry.debitCredit !== '1' && entry.debitCredit !== '2') {
      problem(ctx, `Journal transaction ${entry.transactionNo} line ${lineNo}: debit/credit must be 1 or 2.`);
    }
    push(UNIFORM_B100, {
      1350: UNIFORM_B100.code,
      1351: fmtNum(ctx, recordNo + 1, 9, 'B100 record number'),
      1352: taxId,
      1353: fmtNum(ctx, entry.transactionNo, 10, 'Journal transaction number'),
      1354: fmtNum(ctx, lineNo, 5, 'Journal transaction line number'),
      1361: fmtText(ctx, entry.details, 50, 'Journal details (field 1361)', false),
      1362: fmtDate8(ctx, entry.date, 'Journal date (field 1362)'),
      1363: fmtDate8(ctx, entry.valueDate, 'Journal value date (field 1363)'),
      1364: fmtText(ctx, entry.accountKey, 15, 'Journal account key (field 1364)'),
      1366: fmtNum(ctx, entry.debitCredit, 1, 'Journal debit/credit indicator (field 1366)'),
      1368: fmtAmount(ctx, entry.amountCents, 15, 'Journal amount (field 1368)'),
      1375: fmtDate8(ctx, entry.date, 'Journal entry date (field 1375)'),
    });
  }

  // B110 accounts
  const accountKeys = new Set<string>();
  for (const account of input.accounts) {
    if (accountKeys.has(account.accountKey)) {
      problem(ctx, `Account key ${JSON.stringify(account.accountKey)} appears twice; B110 keys must be unique.`);
    }
    accountKeys.add(account.accountKey);
    push(UNIFORM_B110, {
      1400: UNIFORM_B110.code,
      1401: fmtNum(ctx, recordNo + 1, 9, 'B110 record number'),
      1402: taxId,
      1403: fmtText(ctx, account.accountKey, 15, 'Account key (field 1403)'),
      1404: fmtText(ctx, account.accountName, 50, 'Account name (field 1404)'),
      1405: fmtText(ctx, account.trialBalanceCode, 15, 'Trial balance code (field 1405)'),
      1406: fmtText(ctx, account.trialBalanceCodeDescription, 30, 'Trial balance description (field 1406)'),
      1414: account.openingBalanceCents !== undefined
        ? fmtAmount(ctx, account.openingBalanceCents, 15, 'Account opening balance (field 1414)', false)
        : undefined,
      1415: account.totalDebitsCents !== undefined
        ? fmtAmount(ctx, account.totalDebitsCents, 15, 'Account total debits (field 1415)', false)
        : undefined,
      1416: account.totalCreditsCents !== undefined
        ? fmtAmount(ctx, account.totalCreditsCents, 15, 'Account total credits (field 1416)', false)
        : undefined,
    });
  }
  // Every journal line's account must have a B110 record, or the file references nothing.
  for (const entry of input.journalEntries) {
    if (!accountKeys.has(entry.accountKey)) {
      problem(ctx, `Journal account ${JSON.stringify(entry.accountKey)} has no B110 account record.`);
    }
  }

  // C100 / D110 / D120 documents
  const documentTypeTotals = new Map<string, UniformDocumentTypeTotal>();
  for (const doc of input.documents) {
    if (!(doc.documentType in UNIFORM_DOCUMENT_TYPES)) {
      problem(ctx, `Document ${doc.documentNo}: unknown document type ${JSON.stringify(doc.documentType)}.`);
      continue;
    }
    const total = documentTypeTotals.get(doc.documentType) ?? {
      documentType: doc.documentType, count: 0, totalInclVatCents: 0, vatAmountCents: 0,
    };
    total.count += 1;
    total.totalInclVatCents += doc.amountInclVatCents ?? 0;
    total.vatAmountCents += doc.vatAmountCents ?? 0;
    documentTypeTotals.set(doc.documentType, total);

    push(UNIFORM_C100, {
      1200: UNIFORM_C100.code,
      1201: fmtNum(ctx, recordNo + 1, 9, 'C100 record number'),
      1202: taxId,
      1203: fmtNum(ctx, doc.documentType, 3, `Document type of ${doc.documentNo}`),
      1204: fmtText(ctx, doc.documentNo, 20, `Document number ${doc.documentNo}`),
      1205: fmtDate8(ctx, doc.issueDate, `Issue date of document ${doc.documentNo}`),
      1207: fmtText(ctx, doc.customerName, 50, `Counterparty of document ${doc.documentNo}`, false),
      1215: doc.customerTaxId
        ? fmtNum(ctx, doc.customerTaxId, 9, `Counterparty tax ID of document ${doc.documentNo}`, false)
        : undefined,
      1221: doc.amountAfterDiscountExclVatCents !== undefined
        ? fmtAmount(ctx, doc.amountAfterDiscountExclVatCents, 15, `Amount excl. VAT of document ${doc.documentNo}`, false)
        : undefined,
      1222: doc.vatAmountCents !== undefined
        ? fmtAmount(ctx, doc.vatAmountCents, 15, `VAT of document ${doc.documentNo}`, false)
        : undefined,
      1223: doc.amountInclVatCents !== undefined
        ? fmtAmount(ctx, doc.amountInclVatCents, 15, `Amount incl. VAT of document ${doc.documentNo}`, false)
        : undefined,
    });

    doc.lines.forEach((line, index) => {
      push(UNIFORM_D110, {
        1250: UNIFORM_D110.code,
        1251: fmtNum(ctx, recordNo + 1, 9, 'D110 record number'),
        1252: taxId,
        1253: fmtNum(ctx, doc.documentType, 3, `Document type of ${doc.documentNo}`),
        1254: fmtText(ctx, doc.documentNo, 20, `Document number ${doc.documentNo}`),
        1255: fmtNum(ctx, index + 1, 4, `Line number of document ${doc.documentNo}`),
        1260: fmtText(ctx, line.description, 30, `Line description of document ${doc.documentNo} line ${index + 1}`),
        1264: fmtQuantity(ctx, line.quantity, 17, `Quantity of document ${doc.documentNo} line ${index + 1}`),
        1265: line.unitPriceExclVatCents !== undefined
          ? fmtAmount(ctx, line.unitPriceExclVatCents, 15, `Unit price of document ${doc.documentNo} line ${index + 1}`, false)
          : undefined,
        1267: line.unitPriceExclVatCents !== undefined
          ? fmtAmount(ctx, Math.round(line.unitPriceExclVatCents * line.quantity), 15, `Line total of document ${doc.documentNo} line ${index + 1}`, false)
          : undefined,
        1268: line.vatRatePercent !== undefined
          ? fmtNum(ctx, String(Math.round(line.vatRatePercent * 100)), 4, `VAT rate of document ${doc.documentNo} line ${index + 1}`, false)
          : undefined,
        1272: fmtDate8(ctx, doc.issueDate, `Line date of document ${doc.documentNo}`),
      });
    });

    doc.payments.forEach((payment, index) => {
      push(UNIFORM_D120, {
        1300: UNIFORM_D120.code,
        1301: fmtNum(ctx, recordNo + 1, 9, 'D120 record number'),
        1302: taxId,
        1303: fmtNum(ctx, doc.documentType, 3, `Document type of ${doc.documentNo}`),
        1304: fmtText(ctx, doc.documentNo, 20, `Document number ${doc.documentNo}`),
        1305: fmtNum(ctx, index + 1, 4, `Payment line of document ${doc.documentNo}`),
        1306: fmtNum(ctx, payment.paymentMethod, 1, `Payment method of document ${doc.documentNo}`),
        1312: fmtAmount(ctx, payment.amountCents, 15, `Payment amount of document ${doc.documentNo}`),
        1322: fmtDate8(ctx, payment.date ?? doc.issueDate, `Payment date of document ${doc.documentNo}`),
      });
    });
  }

  // M100 inventory (only written when the input carries items — "only if stock is managed")
  for (const item of input.inventory) {
    push(UNIFORM_M100, {
      1450: UNIFORM_M100.code,
      1451: fmtNum(ctx, recordNo + 1, 9, 'M100 record number'),
      1452: taxId,
      1455: fmtText(ctx, item.internalItemCode, 20, 'Item code (field 1455)'),
      1456: fmtText(ctx, item.itemName, 50, 'Item name (field 1456)'),
      1460: fmtQuantity2(ctx, item.openingStockQty, 12, 'Opening stock (field 1460)'),
      1461: fmtQuantity2(ctx, item.totalStockIn, 12, 'Total stock in (field 1461)'),
      1462: fmtQuantity2(ctx, item.totalStockOut, 12, 'Total stock out (field 1462)'),
    });
  }

  // Z900 closing: its total is the count of every record in the file, opening and closing included.
  const totalRecords = recordNo + 1;
  push(UNIFORM_Z900, {
    1150: UNIFORM_Z900.code,
    1151: fmtNum(ctx, recordNo + 1, 9, 'Z900 record number'),
    1152: taxId,
    1153: primaryIdentifier,
    1154: UNIFORM_SYSTEM_CONSTANT,
    1155: fmtNum(ctx, totalRecords, 15, 'Total records in file (field 1155)'),
  });
  if (recordNo !== totalRecords) {
    throw new Error(`Uniform writer bug: Z900 says ${totalRecords} records but ${recordNo} were written before it.`);
  }

  const bkmvdataText = lines.map(line => `${line}\r\n`).join('');

  // ---- INI.TXT: A000 header + one 19-char summary line per record type, in file order ----
  const outputPath = uniformOutputPath(taxId, taxYear, processDate, processTime);
  const a000 = buildRecord(ctx, UNIFORM_A000, {
    1000: UNIFORM_A000.code,
    1001: spaces(5),
    1002: fmtNum(ctx, totalRecords, 15, 'Total records in BKMVDATA (field 1002)'),
    1003: taxId,
    1004: primaryIdentifier,
    1005: UNIFORM_SYSTEM_CONSTANT,
    1006: softwareRegistrationNo,
    1007: softwareName,
    1008: softwareVersion,
    1009: softwareVendorTaxId,
    1010: softwareVendorName,
    1011: fmtNum(ctx, '1', 1, 'Software type (field 1011)'), // 1 = single-year
    1012: fmtText(ctx, outputPath, 50, 'File output path (field 1012)'),
    1013: fmtNum(ctx, '2', 1, 'Accounting type (field 1013)'), // 2 = double-entry
    1014: fmtNum(ctx, '1', 1, 'Balance required flag (field 1014)'), // required in double-entry
    1016: options.withholdingFileNo
      ? fmtNum(ctx, options.withholdingFileNo, 9, 'Withholding file number (field 1016)', false)
      : undefined,
    1018: businessName,
    1019: street,
    1020: houseNo,
    1021: city,
    1022: zip,
    1023: taxYear,
    1024: startDate,
    1025: endDate,
    1026: processDate,
    1027: processTime,
    1028: fmtNum(ctx, '0', 1, 'Language code (field 1028)'), // 0 = Hebrew (SHAAM transcription)
    1029: fmtNum(ctx, '1', 1, 'Character encoding (field 1029)'), // 1 = ISO-8859-8-i
    1032: fmtText(ctx, options.baseCurrency ?? 'ILS', 3, 'Base currency (field 1032)', false),
    1034: fmtNum(ctx, '0', 1, 'Branch info flag (field 1034)'), // 0 = no branches
  });

  const summaryLines: string[] = [];
  for (const layout of UNIFORM_BKMV_RECORD_ORDER) {
    const count = counts.get(layout.code) ?? 0;
    if (count === 0) continue; // only types present in BKMVDATA (SHAAM's minimal file: A000+A100+Z900)
    summaryLines.push(`${layout.code.padEnd(4, ' ')}${String(count).padStart(15, '0')}\r\n`);
  }
  const iniText = `${a000}\r\n${summaryLines.join('')}`;

  const recordCounts = UNIFORM_BKMV_RECORD_ORDER
    .map(layout => ({ code: layout.code, count: counts.get(layout.code) ?? 0 }))
    .filter(entry => entry.count > 0);

  if (ctx.substitutions > 0) {
    note(ctx, `${ctx.substitutions} character(s) were written with the ISO-8859-8 substitution list (gershayim, dashes, curly quotes, ellipsis, non-breaking space).`);
  }
  note(ctx, 'This file has not been checked by the Tax Authority simulator; no acceptance is claimed (readyForFiling: false).');

  return {
    iniText,
    bkmvdataText,
    recordCounts,
    totalRecords,
    documentTypeTotals: [...documentTypeTotals.values()],
    journalDebitsCents,
    journalCreditsCents,
    problems: ctx.problems,
    notes: ctx.notes,
    canDownload: ctx.problems.length === 0,
    readyForFiling: false,
  };
}

/**
 * The OPENFRMT folder name the spec asks for: `OPENFRMT/<dealer>.<year>/<MMDDhhmm>/`.
 * The dealer number keeps its leading zeros out of the folder name only when it has nine
 * significant digits — the folder is a name, field 1003 stays nine digits.
 */
export function uniformOutputPath(taxId: string, taxYear: string, processDate: string, processTime: string): string {
  const dealer = /^\d{9}$/.test(taxId) ? taxId.replace(/^0+(?=\d{9}$)/, '') : taxId;
  return `OPENFRMT/${dealer}.${taxYear}/${processDate.slice(4)}${processTime}`;
}
