import type { Bill, Invoice } from "../types";

interface ExtraOptions {
  memo?: string;
  terms?: string;
  emailSubject?: string;
  attachments: number;
}
const hasText = (value: string | undefined) => Boolean(value?.trim());

/** Generated numbers and standard defaults must not expand an otherwise simple new document. */
function commonOptions(
  document: Partial<Invoice | Bill>,
  currency: string,
): boolean {
  return Boolean(
    (document.status && document.status !== "pending") ||
    (document.currency && document.currency !== currency) ||
    (document.exchangeRate != null && document.exchangeRate !== 1),
  );
}

export function hasInvoiceOptions(
  invoice: Partial<Invoice>,
  currency: string,
  extra: ExtraOptions,
): boolean {
  return Boolean(
    commonOptions(invoice, currency) ||
    (invoice.type && invoice.type !== "standard") ||
    (invoice.paymentTerms && invoice.paymentTerms !== "due_on_receipt") ||
    invoice.recurringInterval ||
    invoice.progressPercentage ||
    invoice.discountCents ||
    invoice.depositCents ||
    invoice.retainageCents ||
    hasText(invoice.milestone) ||
    hasText(extra.memo) ||
    hasText(extra.terms) ||
    hasText(extra.emailSubject) ||
    extra.attachments,
  );
}

export function hasBillOptions(
  bill: Partial<Bill>,
  currency: string,
  extra: ExtraOptions & { repeat: string },
): boolean {
  return Boolean(
    commonOptions(bill, currency) ||
    extra.repeat ||
    hasText(extra.memo) ||
    extra.attachments,
  );
}
