/**
 * J-8 / J-9 (Agent #11): "Download everything for <year>" — a ZIP of that year's CSV exports plus
 * the PDFs of that year's invoices, for a year-end hand-over to an accountant.
 *
 * Deliberately built from what already exists and is already verified:
 *  - the collection rows come from `verifiedBackupCollections` (the checksum-verified server backup, the
 *    same source E-21's workspace archive uses — never the browser cache);
 *  - every CSV is the shared `recordExportTable` + `toCsv` writer, with the UTF-8 BOM the other archives
 *    write (J-5);
 *  - the invoice PDFs are fetched in bounded batches from `POST /api/v1/documents/zip` (J-9), unpacked
 *    in the browser with `readStoredZip`, and packaged into the final archive with `makeStoredZip`.
 *
 * Two rules the year scoping keeps:
 *  - a record is *in* the year when its own date (`date`, else `issueDate`, `documentDate`, `dueDate`,
 *    `createdAt`) falls in it; a record with no usable date is left out of the year's files and **counted
 *    as undated**, so the manifest can say so rather than pretending the year is complete;
 *  - company-wide lists with no date at all (customers, vendors, items, accounts) are written whole,
 *    because those are what the year's numbers refer to; the manifest says that in words.
 */
import { toCsv } from './csvExport';
import { recordExportTable } from './workspaceExports';
import { readStoredZip, type JsonObject, type ZipEntry } from './workspaceArchive';
import { byCodeUnit } from './codeUnitOrder';

/** The collections a year-end archive writes, in the order an accountant reads them. */
export const YEAR_ARCHIVE_COLLECTIONS = [
  'transactions', 'invoices', 'bills', 'payments', 'creditNotes', 'vendorCredits', 'estimates',
  'purchaseOrders', 'bankLines', 'expenses', 'journalEntries',
] as const;

/**
 * Bounded batch size for `POST /api/v1/documents/zip` (`ZipSchema` caps `ids` at 100; 50 keeps each
 * stored ZIP response modest and turns 200 invoices into 4 requests instead of 200).
 */
export const YEAR_ARCHIVE_PDF_BATCH_SIZE = 50;

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
  const text = String(value ?? '').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '');
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

  // one PDF per invoice of the year; the screen fetches them in batches via POST /api/v1/documents/zip (J-9)
  const invoices = Array.isArray(collections.invoices) ? collections.invoices : [];
  const invoiceDocs = invoices.filter(record => recordYear(record) === year);
  const seenIds = new Set<string>();
  let plannedPdfCount = 0;
  for (const invoice of invoiceDocs) {
    const row = invoice as Record<string, unknown>;
    const id = String(row.id ?? '');
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);
    const number = safeFilePart(row.number ?? id, id);
    files.push({ path: `invoices/${number}-${id}.pdf`, kind: 'pdf', documentId: id, documentNumber: String(row.number ?? '') });
    plannedPdfCount += 1;
  }

  const manifest: JsonObject = {
    format: 'ledgerflow-year-archive-v1',
    year,
    builtFrom: 'checksum-verified server workspace backup (same source as the workspace archive)',
    collections: counts,
    invoicePdfCount: plannedPdfCount,
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

/** How long the server asks to wait after "too many requests" (it makes only a few PDF batches a minute), in ms. */
export function pdfRetryDelayMs(headers: { get(name: string): string | null }): number {
  const seconds = Number(headers.get('RateLimit-Reset') ?? headers.get('Retry-After'));
  return Math.min(65, Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) + 1 : 61) * 1000;
}

/** Splits planned invoice PDFs into bounded batches (1..100, default 50) for `POST /api/v1/documents/zip`. */
export function chunkYearArchivePdfBatches(
  files: readonly YearArchiveFilePlan[],
  batchSize = YEAR_ARCHIVE_PDF_BATCH_SIZE,
): YearArchiveFilePlan[][] {
  const bounded = Math.max(1, Math.min(100, Math.trunc(batchSize) || YEAR_ARCHIVE_PDF_BATCH_SIZE));
  const pdfFiles = files.filter(file => file.kind === 'pdf' && Boolean(file.documentId));
  const batches: YearArchiveFilePlan[][] = [];
  for (let i = 0; i < pdfFiles.length; i += bounded) {
    batches.push(pdfFiles.slice(i, i + bounded));
  }
  return batches;
}

/** Entry stem `POST /api/v1/documents/zip` (`handleZipRequest`) uses inside its returned stored ZIP. */
export function serverZipInvoiceBaseName(file: Pick<YearArchiveFilePlan, 'documentId' | 'documentNumber'>): string {
  const raw = String(file.documentNumber || file.documentId || '').replace(/[^\p{L}\p{N}._-]+/gu, '-');
  return `invoice_${raw}`;
}

/**
 * Reads a stored ZIP returned by `POST /api/v1/documents/zip` in the browser and pairs each PDF back to
 * its planned archive path, recording any invoice omitted by the server as missing.
 */
export function unpackInvoicePdfBatch(
  batch: readonly YearArchiveFilePlan[],
  zipBytes: Uint8Array,
): { entries: ZipEntry[]; missing: string[] } {
  const stored = readStoredZip(zipBytes);
  const claimed = new Set<string>();
  const entries: ZipEntry[] = [];
  const missing: string[] = [];
  // The server names PDFs by document number (not ID), and skips missing documents.
  // When multiple documents have the same number, a missing earlier invoice shifts the
  // numbered ZIP filenames. Without an ID in the response there is no safe way to tell
  // which invoice the remaining PDF belongs to. Conservatively mark the entire ambiguous
  // number group as missing rather than misfile a different invoice's PDF.
  const plannedCounts = new Map<string, number>();
  for (const file of batch) {
    const base = serverZipInvoiceBaseName(file);
    plannedCounts.set(base, (plannedCounts.get(base) || 0) + 1);
  }
  const ambiguousBases = new Set<string>();
  for (const [base, count] of plannedCounts) {
    if (count <= 1) continue;
    let returned = 0;
    for (let n = 1; n <= count; n += 1) {
      if (stored.has(n === 1 ? `${base}.pdf` : `${base}_${n}.pdf`)) returned += 1;
    }
    if (returned !== count) ambiguousBases.add(base);
  }

  for (const file of batch) {
    const base = serverZipInvoiceBaseName(file);
    if (ambiguousBases.has(base)) {
      missing.push(file.documentNumber || String(file.documentId || file.path));
      continue;
    }
    let matchedName: string | null = null;
    for (let n = 1; n <= stored.size + 1; n += 1) {
      const candidate = n === 1 ? `${base}.pdf` : `${base}_${n}.pdf`;
      if (stored.has(candidate) && !claimed.has(candidate)) {
        matchedName = candidate;
        break;
      }
    }
    if (matchedName) {
      claimed.add(matchedName);
      entries.push({ path: file.path, bytes: stored.get(matchedName)! });
    } else {
      missing.push(file.documentNumber || String(file.documentId || file.path));
    }
  }
  return { entries, missing };
}

/** Waits `ms`, or resolves `false` immediately when `signal` aborts. */
export function pauseAbortable(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    if (signal.aborted) { resolve(false); return; }
    const done = () => { clearTimeout(timer); resolve(false); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', done); resolve(true); }, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

export interface FetchYearArchivePdfBatchesOptions {
  workspaceId: string;
  plan: YearArchivePlan;
  getToken: () => Promise<string>;
  signal: AbortSignal;
  onProgress?: (line: string) => void;
  batchSize?: number;
  fetchImpl?: typeof fetch;
  pauseImpl?: (ms: number, signal: AbortSignal) => Promise<boolean>;
}

export interface FetchYearArchivePdfBatchesResult {
  aborted: boolean;
  entries: ZipEntry[];
  pdfCount: number;
  missing: string[];
}

/**
 * J-9: Fetches all planned invoice PDFs in bounded batches via `POST /api/v1/documents/zip`, reads each
 * returned stored ZIP in memory, keeps progress + cancel checks + 429 retry with fresh sign-in token,
 * and reports any missing invoice PDFs for `manifest.json`.
 */
export async function fetchYearArchivePdfBatches({
  workspaceId,
  plan,
  getToken,
  signal,
  onProgress,
  batchSize = YEAR_ARCHIVE_PDF_BATCH_SIZE,
  fetchImpl = fetch,
  pauseImpl = pauseAbortable,
}: FetchYearArchivePdfBatchesOptions): Promise<FetchYearArchivePdfBatchesResult> {
  const batches = chunkYearArchivePdfBatches(plan.files, batchSize);
  const total = batches.reduce((sum, batch) => sum + batch.length, 0);
  const entries: ZipEntry[] = [];
  const missing: string[] = [];
  let processed = 0;

  for (const batch of batches) {
    if (signal.aborted) return { aborted: true, entries: [], pdfCount: 0, missing: [] };
    const from = processed + 1;
    const to = processed + batch.length;
    const at = from === to ? `Invoice PDF ${from} of ${total}` : `Invoice PDFs ${from}–${to} of ${total}`;
    onProgress?.(`${at}…`);

    const ids = batch.map(file => String(file.documentId));
    let response: Response | null = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (signal.aborted) return { aborted: true, entries: [], pdfCount: 0, missing: [] };
      const token = await getToken();
      if (signal.aborted) return { aborted: true, entries: [], pdfCount: 0, missing: [] };
      const current = await fetchImpl('/api/v1/documents/zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ workspaceId, type: 'invoice', ids }),
        signal,
      });
      if (current.status !== 429) {
        response = current;
        break;
      }
      onProgress?.(`${at}: the server makes about 10 PDF batches a minute, waiting to continue…`);
      if (!(await pauseImpl(pdfRetryDelayMs(current.headers), signal))) {
        return { aborted: true, entries: [], pdfCount: 0, missing: [] };
      }
    }

    if (signal.aborted) return { aborted: true, entries: [], pdfCount: 0, missing: [] };
    if (!response || !response.ok) {
      for (const file of batch) missing.push(file.documentNumber || String(file.documentId || file.path));
      processed += batch.length;
      continue;
    }

    const zipBytes = new Uint8Array(await response.arrayBuffer());
    if (signal.aborted) return { aborted: true, entries: [], pdfCount: 0, missing: [] };
    try {
      const unpacked = unpackInvoicePdfBatch(batch, zipBytes);
      entries.push(...unpacked.entries);
      missing.push(...unpacked.missing);
    } catch {
      for (const file of batch) missing.push(file.documentNumber || String(file.documentId || file.path));
    }
    processed += batch.length;
  }

  return { aborted: false, entries, pdfCount: entries.length, missing };
}
