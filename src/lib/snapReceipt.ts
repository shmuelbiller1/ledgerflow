/**
 * EU-C4: snap a receipt from the phone.
 *
 * The photo is kept as a document, and a **draft** bill is saved with it. A draft posts nothing
 * (src/services/ledgerPost/billPosting.ts returns before building a line for one), so the ledger
 * is unchanged until someone approves the bill. Paying it — or matching it to the bank line that
 * paid it — stays the usual step in Bills and bank review.
 */

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
    metadata: { source: 'phone-receipt', receiptDocId: input.receiptDocId },
  };
}

/** "12.34" or "12,34" → 1234 minor units (two decimals); null when it is not an amount. */
export function parseReceiptAmount(text: string): number | null {
  const t = text.trim().replace(/\s/g, '');
  if (!t) return 0;
  const m = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(t);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0'));
}

/** The file name a photo is saved under, dated so it sorts in Documents. */
export function receiptFileName(date: string, original: string): string {
  const ext = /\.[a-z0-9]{1,5}$/i.exec(original)?.[0] || '.jpg';
  return `Receipt ${date}${ext.toLowerCase()}`;
}
