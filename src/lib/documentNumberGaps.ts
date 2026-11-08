import { byCodeUnit } from './codeUnitOrder';
/**
 * A-184: missing numbers inside a document series (invoices, bills, credit notes…).
 *
 * Read-only. A gap is not an error by itself: a draft that was never issued, a document from
 * another numbering system or, worse, a deleted document all produce one. The report says which
 * numbers are absent between the first and the last recorded number of the same series, which
 * numbers were recorded twice, and how many documents have no readable number at all, so the
 * reader can look at the underlying documents instead of trusting a counter.
 */
export interface NumberedDocument {
  id: string;
  /** The collection or screen the document came from, shown as the series group. */
  collection: string;
  number?: string;
  date?: string;
  status?: string;
}

export interface NumberSeriesGap {
  collection: string;
  /** Everything in the number before the trailing digits, e.g. "INV-2026-". */
  prefix: string;
  documents: number;
  first: number;
  last: number;
  /** Numbers between first and last with no document, ascending. */
  missing: number[];
  /** True when the missing list was capped; the count still says how many are absent. */
  missingTruncated: boolean;
  missingCount: number;
  /** One number recorded on more than one document of the same series. */
  duplicates: Array<{ number: string; ids: string[] }>;
}

export interface DocumentNumberReport {
  series: NumberSeriesGap[];
  /** Documents whose number has no trailing digits to read a sequence from. */
  unparsable: Array<{ id: string; collection: string; number: string }>;
  /** Documents with no number at all (or an empty one). */
  unnumbered: number;
  missingTotal: number;
  duplicateTotal: number;
}

export const MAX_MISSING_PER_SERIES = 200;

/** Split a document number into its prefix and its trailing sequence, or null when it has none. */
export function parseDocumentNumber(number: unknown): { prefix: string; sequence: number } | null {
  if (typeof number !== 'string') return null;
  const trimmed = number.trim();
  const match = trimmed.match(/^(.*?)(\d+)$/);
  if (!match) return null;
  const digits = match[2];
  if (digits.length > 12) return null;
  const sequence = Number(digits);
  if (!Number.isSafeInteger(sequence)) return null;
  return { prefix: match[1], sequence };
}

export function documentNumberGaps(documents: readonly NumberedDocument[]): DocumentNumberReport {
  const buckets = new Map<string, Array<{ id: string; sequence: number; number: string }>>();
  const unparsable: DocumentNumberReport['unparsable'] = [];
  let unnumbered = 0;

  for (const document of documents) {
    if (!document || !document.id) continue;
    const collection = typeof document.collection === 'string' ? document.collection : '';
    const raw = typeof document.number === 'string' ? document.number.trim() : '';
    if (!raw) { unnumbered++; continue; }
    const parsed = parseDocumentNumber(raw);
    if (!parsed) { unparsable.push({ id: document.id, collection, number: raw }); continue; }
    const key = JSON.stringify([collection, parsed.prefix]);
    const bucket = buckets.get(key) || [];
    bucket.push({ id: document.id, sequence: parsed.sequence, number: raw });
    buckets.set(key, bucket);
  }

  const series: NumberSeriesGap[] = [];
  let missingTotal = 0;
  let duplicateTotal = 0;
  for (const [key, entries] of buckets) {
    const [collection, prefix] = JSON.parse(key) as [string, string];
    const sequences = new Set(entries.map(entry => entry.sequence));
    const first = Math.min(...sequences);
    const last = Math.max(...sequences);
    const missing: number[] = [];
    let missingCount = 0;
    for (let value = first; value <= last; value++) {
      if (sequences.has(value)) continue;
      missingCount++;
      if (missing.length < MAX_MISSING_PER_SERIES) missing.push(value);
    }
    const byNumber = new Map<string, string[]>();
    for (const entry of entries) {
      const ids = byNumber.get(entry.number) || [];
      ids.push(entry.id);
      byNumber.set(entry.number, ids);
    }
    const duplicates = [...byNumber.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([number, ids]) => ({ number, ids: [...ids].sort(byCodeUnit) }))
      .sort((a, b) => a.number.localeCompare(b.number));
    duplicateTotal += duplicates.length;
    missingTotal += missingCount;
    series.push({
      collection, prefix, documents: entries.length, first, last,
      missing, missingTruncated: missingCount > missing.length, missingCount, duplicates,
    });
  }

  series.sort((a, b) => a.collection.localeCompare(b.collection) || a.prefix.localeCompare(b.prefix));
  unparsable.sort((a, b) => a.collection.localeCompare(b.collection) || a.number.localeCompare(b.number) || a.id.localeCompare(b.id));
  return { series, unparsable, unnumbered, missingTotal, duplicateTotal };
}

export const DOCUMENT_NUMBER_GAP_CSV_HEADERS = [
  'Document type', 'Series', 'Documents', 'First number', 'Last number', 'Missing count', 'Missing numbers', 'Duplicate numbers',
];

export function documentNumberGapCsvRows(series: readonly NumberSeriesGap[]): Array<Array<string>> {
  return series.map(row => [
    row.collection, row.prefix, String(row.documents), String(row.first), String(row.last),
    String(row.missingCount),
    row.missing.join(' '), row.duplicates.map(duplicate => duplicate.number).join(' '),
  ]);
}
