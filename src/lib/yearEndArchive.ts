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
 *  - a record is *in* the year when its own date (`date`, else `issueDate`, `documentDate`, `dueDate`,
 *    `createdAt`) falls in it; a record with no usable date is left out of the year's files and **counted
 *    as undated**, so the manifest can say so rather than pretending the year is complete;
 *  - company-wide lists with no document date (customers, vendors, items, accounts) are written whole,
 *    because those are what the year's numbers refer to; the manifest says that in words.
 */
import { toCsv } from './csvExport';
import { recordExportTable } from './workspaceExports';
import type { JsonObject, ZipEntry } from './workspaceArchive';
import { byCodeUnit } from './codeUnitOrder';
import { trimChar } from './textShape';

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

export interface YearArchiveFailedPdf {
  documentId: string;
  documentNumber: string;
  path: string;
}

export interface YearArchivePdfOutcome {
  /** Actual count of invoice PDFs written into the ZIP. */
  writtenPdfCount?: number;
  /** Invoice PDFs planned for the year that could not be fetched from the PDF route. */
  failedInvoicePdfs?: readonly YearArchiveFailedPdf[];
}

/**
 * Company-wide master collections written whole regardless of creation year.
 * The server `/export` backup names the chart of accounts `accounts` (`RESTORE_COLLECTIONS`),
 * while in-memory callers may pass `chartAccounts`; both keys are treated identically.
 */
export const WHOLE_COLLECTIONS = ['customers', 'vendors', 'inventory', 'accounts', 'chartAccounts'] as const;

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

/** A file-name-safe document number ("INV/2026-1" → "INV-2026-1"), linear in input length (Sonar S8786). */
export function safeFilePart(value: unknown, fallback = 'document'): string {
  const dashed = String(value ?? '').replace(/[^\p{L}\p{N}._-]+/gu, '-');
  const trimmed = trimChar(dashed, '-');
  return trimmed.slice(0, 80) || fallback;
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
  let plannedPdfs = 0;
  for (const invoice of invoiceDocs) {
    const row = invoice as Record<string, unknown>;
    const id = String(row.id ?? '');
    if (!id) continue;
    const number = safeFilePart(row.number ?? id, id);
    files.push({ path: `invoices/${number}-${id}.pdf`, kind: 'pdf', documentId: id, documentNumber: String(row.number ?? '') });
    plannedPdfs += 1;
  }

  const manifest: JsonObject = {
    format: 'ledgerflow-year-archive-v1',
    year,
    builtFrom: 'checksum-verified server workspace backup (same source as the workspace archive)',
    collections: counts,
    invoicePdfPlannedCount: plannedPdfs,
    invoicePdfCount: plannedPdfs,
    failedInvoicePdfs: [],
    undatedRecords: undated,
    wholeCollections: [...new Set([...WHOLE_COLLECTIONS, ...(options.alwaysWhole || [])])],
    notes: [
      'Dated collections hold only the records whose own date falls in this year.',
      'A record with no usable date is left out of the year files and counted under undatedRecords.',
      'Customers, vendors, items and accounts are company-wide lists with no document date, so they are written whole.',
      'Each invoice PDF is generated by the invoice PDF route; any PDF that could not be generated is listed under failedInvoicePdfs.',
      'CSV files carry a UTF-8 byte-order mark and keep nested values in a Record JSON column.',
    ],
  };
  return { year, files, manifest };
}

/** Returns a manifest updated with the actual written PDF count and any failed invoice PDFs. */
export function finalizeYearArchiveManifest(
  manifest: JsonObject,
  outcome?: YearArchivePdfOutcome,
): JsonObject {
  if (!outcome) return manifest;
  const failed = (outcome.failedInvoicePdfs || []).map(item => ({
    documentId: item.documentId,
    documentNumber: item.documentNumber,
    path: item.path,
  }));
  const planned = typeof manifest.invoicePdfPlannedCount === 'number'
    ? manifest.invoicePdfPlannedCount
    : typeof manifest.invoicePdfCount === 'number'
      ? manifest.invoicePdfCount
      : 0;
  const written = typeof outcome.writtenPdfCount === 'number'
    ? outcome.writtenPdfCount
    : Math.max(0, planned - failed.length);
  return {
    ...manifest,
    invoicePdfPlannedCount: planned,
    invoicePdfCount: written,
    failedInvoicePdfs: failed,
  };
}

/** The invoice PDF, from the route the invoice screen itself uses (src/services/documentDownloads.ts). */
export async function fetchInvoicePdf(
  workspaceId: string,
  documentId: string,
  token: string,
  signal?: AbortSignal,
): Promise<Blob | null> {
  const query = new URLSearchParams({ workspaceId });
  try {
    const response = await fetch(
      `/api/v1/documents/invoice/${encodeURIComponent(documentId)}/pdf?${query.toString()}`,
      { headers: { Authorization: `Bearer ${token}` }, signal },
    );
    if (!response.ok) return null;
    return await response.blob();
  } catch (err) {
    if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) throw err;
    return null;
  }
}

/** Builds the CSV entries and manifest of the plan (the fetched PDF bytes are appended by the caller). */
export function buildYearArchiveCsvEntries(
  collections: Record<string, unknown[]>,
  plan: YearArchivePlan,
  pdfOutcome?: YearArchivePdfOutcome,
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
  const finalManifest = finalizeYearArchiveManifest(plan.manifest, pdfOutcome);
  entries.push({ path: 'manifest.json', content: JSON.stringify(finalManifest, null, 2) });
  return entries;
}
