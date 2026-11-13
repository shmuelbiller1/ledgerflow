/**
 * EU-C4: snap a receipt from the phone.
 *
 * The photo is kept as a document, and a **draft** bill is saved with it. A draft posts nothing
 * (src/services/ledgerPost/billPosting.ts returns before building a line for one), so the ledger
 * is unchanged until someone approves the bill. Paying it — or matching it to the bank line that
 * paid it — stays the usual step in Bills and bank review.
 */

import { currencyDigits } from './currencyMinorUnits';

/** The same limit as Documents: a photo is stored inside one database record. */
export const MAX_RECEIPT_BYTES = 700_000;

export interface ReceiptDraftInput {
  vendorId: string;
  vendorName: string;
  /** Minor units; 0 is allowed when the amount is not known yet. */
  amountCents: number;
  /** YYYY-MM-DD */
  date: string;
  currency: string;
  /** The `documents` record holding the photo. */
  receiptDocId: string;
}

export interface ReceiptDraftBill {
  vendorId: string;
  vendorName: string;
  amountCents: number;
  amountPaidCents: 0;
  date: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  status: 'draft';
  posted: false;
  tags: string[];
  /** One line carrying the amount, so the bill editor opens with it (it reads its lines, not the total). */
  splits: Array<{ amountCents: number; accountId: string; description: string }>;
  metadata: { source: 'phone-receipt'; receiptDocId: string };
}

/** Why the draft cannot be saved yet, or null when it can. */
export function receiptDraftProblem(input: Partial<ReceiptDraftInput>): string | null {
  if (!input.vendorId) return 'Choose who the receipt is from.';
  if (!Number.isInteger(input.amountCents) || (input.amountCents as number) < 0) return 'The amount must be zero or more.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date || '')) return 'Choose the receipt date.';
  if (!input.receiptDocId) return 'The photo was not saved.';
  return null;
}

/** The exact draft bill a snapped receipt is saved as. */
export function receiptDraftBill(input: ReceiptDraftInput): ReceiptDraftBill {
  const problem = receiptDraftProblem(input);
  if (problem) throw new Error(problem);
  return {
    vendorId: input.vendorId,
    vendorName: input.vendorName,
    amountCents: input.amountCents,
    amountPaidCents: 0,
    date: input.date,
    issueDate: input.date,
    dueDate: input.date,
    currency: input.currency,
    status: 'draft',
    posted: false,
    tags: ['Receipt'],
    splits: [{ amountCents: input.amountCents, accountId: '', description: 'Receipt' }],
    metadata: { source: 'phone-receipt', receiptDocId: input.receiptDocId },
  };
}

/**
 * Typed text as minor units of `currency` (its ISO 4217 decimals: 2 for USD, 0 for JPY, 3 for KWD;
 * src/lib/currencyMinorUnits.ts). "12.34" or "12,34"; null when it is not an amount in that currency.
 */
export function parseReceiptAmount(text: string, currency = 'USD'): number | null {
  const digits = currencyDigits(currency);
  const t = text.trim().replace(/\s/g, '');
  if (!t) return 0;
  const m = /^(\d+)(?:[.,](\d+))?$/.exec(t);
  if (!m || (m[2] || '').length > digits) return null;
  return Number(m[1]) * 10 ** digits + Number((m[2] || '').padEnd(digits, '0') || 0);
}

/** Minor units of `currency` as the text the amount field shows ("42.50", "1000", "1.250"). */
export function receiptAmountText(minor: number, currency = 'USD'): string {
  const digits = currencyDigits(currency);
  return (Math.abs(minor) / 10 ** digits).toFixed(digits);
}

/**
 * The receipt reader answers in two-decimal cents whatever the currency
 * (src/server/services/aiBackendService.ts asks for integer cents). Convert to minor units of
 * `currency`: 125 "cents" of a KWD receipt is 1.25 KWD = 1,250 fils; 1,000 "cents" of JPY is ¥10.
 */
export function readerCentsToMinor(cents: number, currency = 'USD'): number {
  return Math.round(Math.abs(cents) * 10 ** currencyDigits(currency) / 100);
}

/** The file name a photo is saved under, dated so it sorts in Documents. */
export function receiptFileName(date: string, original: string): string {
  const ext = /\.[a-z0-9]{1,5}$/i.exec(original)?.[0] || '.jpg';
  return `Receipt ${date}${ext.toLowerCase()}`;
}
