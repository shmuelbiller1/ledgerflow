/**
 * J-7 (Agent #11): the Documents list — filtering and "what does this file belong to".
 *
 * Queue item J-7: "Documents screen: filter by type and month, show which entry or document each file
 * belongs to, open the preview; empty and error states; tests."
 *
 * The rows (`documents`, one per file) already carry everything needed: `linkedCollection` and
 * `linkedLabel` from `attachmentRecord` (K-07), `linkedTransactionId` from the Vault's own upload and
 * its receipt scan, `mimeType` and `createdAt`. `src/components/forensics/Vault.tsx` read almost none
 * of it: a free-text box and a tag button row, no type or month filter, and only a "linked to
 * transaction" icon. This module is the pure part of the fix so it can be tested without a database.
 *
 * Rules kept deliberately narrow:
 *  - a file with no usable `createdAt` is *undated*: it is shown under every month filter (never
 *    silently hidden) and counted as such, and it sorts last;
 *  - "type" is read from the record's own `linkedCollection` when it has one, else from the file's
 *    MIME type, so an invoice attachment and a loose PDF are both findable;
 *  - nothing here removes a row: filtering only decides what is shown.
 */
import type { CloudDocument } from '../model/operations';

export type DocumentFileType = 'pdf' | 'image' | 'spreadsheet' | 'document' | 'other';

/** The record kinds a file can be attached to, in the order the filter lists them. */
export const DOCUMENT_LINK_KINDS = [
  'invoices', 'bills', 'customers', 'vendors', 'creditNotes', 'vendorCredits', 'estimates',
  'purchaseOrders', 'supportTickets', 'chartAccounts', 'assets', 'inventory',
] as const;

export type DocumentLinkKind = typeof DOCUMENT_LINK_KINDS[number];

export interface DocumentLike {
  id: string;
  name?: string;
  mimeType?: string;
  sizeBytes?: number;
  createdAt?: string;
  tags?: string[];
  linkedCollection?: string;
  linkedId?: string;
  linkedLabel?: string;
  linkedTransactionId?: string;
}

/** What a file is, from its MIME type (a data address is never needed for this). */
export function documentFileType(mimeType: string | undefined): DocumentFileType {
  const mime = String(mimeType || '').toLowerCase().split(';')[0].trim();
  if (mime === 'application/pdf' || mime === 'application/x-pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (/spreadsheet|ms-excel|csv/.test(mime)) return 'spreadsheet';
  if (/^application\/(msword|vnd\.openxmlformats-officedocument\.wordprocessingml|vnd\.oasis\.opendocument\.text)/.test(mime)) return 'document';
  if (mime.startsWith('text/')) return 'document';
  return 'other';
}

const LINK_LABELS: Record<DocumentLinkKind, string> = {
  invoices: 'Invoice', bills: 'Bill', customers: 'Customer', vendors: 'Vendor',
  creditNotes: 'Credit note', vendorCredits: 'Vendor credit', estimates: 'Estimate',
  purchaseOrders: 'Purchase order', supportTickets: 'Support ticket', chartAccounts: 'Account',
  assets: 'Asset', inventory: 'Item',
};

/**
 * The record a file belongs to, in words ("Invoice INV-12"), or null for a file that belongs to
 * nothing yet. A file the Vault's receipt scan linked to an entry says so instead.
 */
export function documentOwnerLabel(doc: DocumentLike): string | null {
  const label = String(doc.linkedLabel || '').trim();
  const kind = String(doc.linkedCollection || '');
  if (label && (DOCUMENT_LINK_KINDS as readonly string[]).includes(kind)) {
    return label.startsWith(LINK_LABELS[kind as DocumentLinkKind])
      ? label
      : `${LINK_LABELS[kind as DocumentLinkKind]} ${label}`;
  }
  if (label) return label;
  if (doc.linkedId) return `Record ${doc.linkedId}`;
  if (doc.linkedTransactionId) return `Entry ${doc.linkedTransactionId}`;
  return null;
}

/** The month a file belongs to, `YYYY-MM`, or null when it has no usable date. */
export function documentMonth(doc: DocumentLike): string | null {
  const value = String(doc.createdAt || '').slice(0, 10);
  return /^\d{4}-\d{2}/.test(value) ? value.slice(0, 7) : null;
}

export interface DocumentFilters {
  /** Free text over the file name, its owner label and its tags. */
  search?: string;
  /** One of documentFileType, or 'all'. */
  fileType?: DocumentFileType | 'all';
  /** One of DOCUMENT_LINK_KINDS, 'unlinked', or 'all'. */
  linkedTo?: DocumentLinkKind | 'unlinked' | 'all';
  /** `YYYY-MM`, or 'all'. Files with no usable date stay visible (see the module note). */
  month?: string | 'all';
}

export interface DocumentListResult<T extends DocumentLike = DocumentLike> {
  rows: T[];
  /** Rows with no usable date, which the month filter deliberately keeps. */
  undated: number;
}

/** Newest first; an undated file sorts last but is never dropped. */
export function applyDocumentFilters<T extends DocumentLike>(
  documents: readonly T[],
  filters: DocumentFilters = {},
): DocumentListResult<T> {
  const search = String(filters.search || '').trim().toLowerCase();
  const fileType = filters.fileType || 'all';
  const linkedTo = filters.linkedTo || 'all';
  const month = filters.month || 'all';

  const rows = documents.filter(doc => {
    if (fileType !== 'all' && documentFileType(doc.mimeType) !== fileType) return false;
    if (linkedTo === 'unlinked') {
      if (isLinked(doc)) return false;
    } else if (linkedTo !== 'all' && String(doc.linkedCollection || '') !== linkedTo) {
      return false;
    }
    const docMonth = documentMonth(doc);
    if (month !== 'all' && docMonth !== null && docMonth !== month) return false;
    if (search) {
      const haystack = [doc.name, documentOwnerLabel(doc), ...(doc.tags || [])].join(' ').toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  const sortKey = (doc: DocumentLike) => String(doc.createdAt || '');
  rows.sort((a, b) => {
    const keyA = sortKey(a), keyB = sortKey(b);
    if (!keyA && !keyB) return String(a.name || '').localeCompare(String(b.name || ''));
    if (!keyA) return 1;
    if (!keyB) return -1;
    return keyB.localeCompare(keyA); // newest first
  });
  return { rows, undated: rows.filter(doc => documentMonth(doc) === null).length };
}

/** The months present in the data, newest first, for the month picker (`YYYY-MM`). */
export function documentMonths(documents: readonly DocumentLike[]): string[] {
  return [...new Set(documents.map(documentMonth).filter((m): m is string => m !== null))].sort((a, b) => b.localeCompare(a));
}

/** Is this file attached to anything (a record, a record id, or a ledger entry)? */
const isLinked = (doc: DocumentLike) => Boolean(doc.linkedCollection || doc.linkedId || doc.linkedTransactionId);

/**
 * The counts the filter buttons show, over the unfiltered set. `unlinked` uses the same test as the
 * filter, so the button's number and the filter's result always agree.
 */
export function documentCounts(documents: readonly DocumentLike[]): Record<string, number> {
  const counts: Record<string, number> = { all: documents.length, unlinked: 0 };
  for (const doc of documents) {
    const type = documentFileType(doc.mimeType);
    counts[type] = (counts[type] || 0) + 1;
    if (doc.linkedCollection) counts[doc.linkedCollection] = (counts[doc.linkedCollection] || 0) + 1;
    if (!isLinked(doc)) counts.unlinked += 1;
  }
  return counts;
}

/** The attachment fields `attachmentRecord` writes, as the Vault stores them (one shape, one reader). */
export type AttachmentRow = CloudDocument;
