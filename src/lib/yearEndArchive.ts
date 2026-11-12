/**
 * J-8 (Agent #11): "Download everything for <year>" — a ZIP of that year's CSV exports plus the PDFs
 * of that year's invoices, for a year-end hand-over to an accountant.
 *
 * Queue item J-8: "Settings → Data: 'Download everything for <year>' as a zip of the CSV exports plus
 * the PDFs of that year's invoices; built from existing exports only; a test checks the file list."
 *
 * Deliberately built from what already exists and is already verified:
 *  - the collection rows come from `verifiedBackupCollections` (the checksum-verified server backup, the
 *    same source E-21's workspace archive uses — never the browser cache);
 *  - every CSV is the shared `recordExportTable` + `toCsv` writer, with the UTF-8 BOM the other archives
 *    write (J-5);
 *  - the invoice PDFs are fetched from the existing document route by the screen, and the ZIP is the
 *    existing `makeStoredZip`.
 *
 * Two rules the year scoping keeps:
 *  - a record is *in* the year when its own date (`date`, else `issueDate`, `dueDate`, `createdAt`) falls
 *    in it; a record with no usable date is left out of the year's files and **counted as undated**, so
 *    the manifest can say so rather than pretending the year is complete;
 *  - company-wide lists with no date at all (customers, vendors, items, accounts) are written whole,
 *    because those are what the year's numbers refer to; the manifest says that in words.
 */
import { toCsv } from './csvExport';
import { recordExportTable } from './workspaceExports';
import type { JsonObject, ZipEntry } from './workspaceArchive';
import { byCodeUnit } from './codeUnitOrder';

/** The collections a year-end archive writes, in the order an accountant reads them. */
export const YEAR_ARCHIVE_COLLECTIONS = [
  'transactions', 'invoices', 'bills', 'payments', 'creditNotes', 'vendorCredits', 'estimates',
  'purchaseOrders', 'bankLines', 'expenses', 'journalEntries',
] as const;

/** Date fields tried in order to decide which year a record belongs to. */
const YEAR_FIELDS = ['date', 'issueDate', 'documentDate', 'dueDate', 'createdAt'] as const;

export interface YearArchivePlanOptions {
  year: number;
  /** Collections that are company-wide lists and are always written whole. */
  alwaysWhole?: readonly string[];
}

export interface YearArchiveFilePlan {
  /** Path inside the ZIP. */
  path: string;
  kind: 'csv' | 'pdf';
  collection?: string;
  /** How many rows this file holds (CSV only). */
  rows?: number;
  /** The record whose PDF this is (PDF only). */
  documentId?: string;
  /** The document's number, used in the file name. */
  documentNumber?: string;
}

export interface YearArchivePlan {
  year: number;
  files: YearArchiveFilePlan[];
  manifest: JsonObject;
}

/** `accounts` is the chart of accounts as the server backup names it; `chartAccounts` is the same list under its older key. */
const WHOLE_COLLECTIONS = ['customers', 'vendors', 'inventory', 'accounts', 'chartAccounts'] as const;

/** The year a record belongs to, or null when it carries no usable date. */
export function recordYear(record: unknown): number | null {
  if (!record || typeof record !== 'object') return null;
  const row = record as Record<string, unknown>;
  for (const field of YEAR_FIELDS) {
    const value = row[field];
    if (typeof value === 'string') {
      const match = /^(\d{4})-\d{2}-\d{2}/.exec(value);
      if (match) {
        const year = Number(match[1]);
        if (year >= 1900 && year <= 2200) return year;
      }
    }
  }
  return null;
}

/** A file-name-safe document number ("INV/2026-1" → "INV-2026-1"). */
export function safeFilePart(value: unknown, fallback = 'document'): string {
  const text = String(value ?? '').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, ''); // NOSONAR: S8786 — single negated character class; a linear scan, not super-linear backtracking
  return text.slice(0, 80) || fallback;
}

/**
 * Plans the archive without writing anything: which files it will hold, which rows are in the year, and
 * the manifest. Throws when the year is not a real year — a silent "everything" archive would be worse.
 */
export function planYearArchive(
  collections: Record<string, unknown[]>,
  options: YearArchivePlanOptions,
): YearArchivePlan {
  const { year } = options;
  if (!Number.isInteger(year) || year < 1900 || year > 2200) throw new Error('Choose a year between 1900 and 2200.');
  const files: YearArchiveFilePlan[] = [];
  const counts: Record<string, unknown> = {};
  const undated: Record<string, number> = {};

  const collectionKeys = Object.keys(collections).sort(byCodeUnit);
  for (const key of collectionKeys) {
    const all = collections[key];
    if (!Array.isArray(all)) continue;
    const whole = (WHOLE_COLLECTIONS as readonly string[]).includes(key) || (options.alwaysWhole || []).includes(key);
    const inYear = whole ? all : all.filter(record => recordYear(record) === year);
    if (!whole) {
      const missing = all.length - inYear.length;
      const withoutDate = all.filter(record => recordYear(record) === null).length;
      if (withoutDate > 0) undated[key] = withoutDate;
      if (missing === 0 && all.length === 0) continue;
    }
    if (!inYear.length) continue;
    const table = recordExportTable(inYear as object[]);
    files.push({ path: `collections/${key}-${year}.csv`, kind: 'csv', collection: key, rows: inYear.length });
    counts[key] = { rows: inYear.length, wholeCollection: whole, columns: table.headers.length };
  }

  // one PDF per invoice of the year; the screen fetches and adds the bytes (documentRoutes has the PDF)
  const invoices = Array.isArray(collections.invoices) ? collections.invoices : [];
  const invoiceDocs = invoices.filter(record => recordYear(record) === year);
  for (const invoice of invoiceDocs) {
    const row = invoice as Record<string, unknown>;
    const id = String(row.id ?? '');
    if (!id) continue;
    const number = safeFilePart(row.number ?? id, id);
    files.push({ path: `invoices/${number}-${id}.pdf`, kind: 'pdf', documentId: id, documentNumber: String(row.number ?? '') });
  }

  const manifest: JsonObject = {
    format: 'ledgerflow-year-archive-v1',
    year,
    builtFrom: 'checksum-verified server workspace backup (same source as the workspace archive)',
    collections: counts,
    invoicePdfCount: invoiceDocs.length,
    invoicePdfsMissing: [],
    undatedRecords: undated,
    wholeCollections: [...WHOLE_COLLECTIONS],
    notes: [
      'Dated collections hold only the records whose own date falls in this year.',
      'A record with no usable date is left out of the year files and counted under undatedRecords.',
      'Customers, vendors, items and accounts are company-wide lists with no document date, so they are written whole.',
      'Each invoice PDF is the same file the invoice screen prints.',
      'CSV files carry a UTF-8 byte-order mark and keep nested values in a Record JSON column.',
    ],
  };
  return { year, files, manifest };
}

/** Builds the CSV entries of the plan (the PDFs are added by the caller that fetched them). */
export function buildYearArchiveCsvEntries(
  collections: Record<string, unknown[]>,
  plan: YearArchivePlan,
): ZipEntry[] {
  const entries: ZipEntry[] = [];
  for (const file of plan.files) {
    if (file.kind !== 'csv' || !file.collection) continue;
    const all = collections[file.collection] ?? [];
    const whole = (WHOLE_COLLECTIONS as readonly string[]).includes(file.collection)
      || Boolean((plan.manifest.wholeCollections as string[] | undefined)?.includes(file.collection));
    const rows = whole ? all : all.filter(record => recordYear(record) === plan.year);
    const table = recordExportTable(rows as object[]);
    entries.push({ path: file.path, content: '\uFEFF' + toCsv(table.headers, table.rows) });
  }
  entries.push({ path: 'manifest.json', content: JSON.stringify(plan.manifest, null, 2) });
  return entries;
}

/**
 * The manifest as the ZIP really is: how many invoice PDFs are inside, and which invoices have none
 * because their PDF could not be made. Replaces the planned manifest entry.
 */
export function withPdfOutcome(entries: readonly ZipEntry[], plan: YearArchivePlan, pdfCount: number, missing: readonly string[]): ZipEntry[] {
  const manifest = { ...plan.manifest, invoicePdfCount: pdfCount, invoicePdfsMissing: [...missing] };
  return entries.map(entry => (entry.path === 'manifest.json' ? { path: entry.path, content: JSON.stringify(manifest, null, 2) } : entry));
}

/** How long the server asks to wait after "too many requests" (it makes only a few PDFs a minute), in ms. */
export function pdfRetryDelayMs(headers: { get(name: string): string | null }): number {
  const seconds = Number(headers.get('RateLimit-Reset') ?? headers.get('Retry-After'));
  return Math.min(65, Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) + 1 : 61) * 1000;
}
