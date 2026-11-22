import { toBaseCents } from '../server/reports/partyReports';

/**
 * Bill approval (G-19, #893). A bill over the workspace's limit is held as 'pending' until an owner or
 * an accountant (or someone approving in their place) decides it. Owner decisions (docs/FOR_YOU.md):
 * - owners and accountants approve;
 * - the approver must be someone other than whoever entered the bill, unless the workspace has only
 *   one person who can approve; then they may approve their own bill and the record says so;
 * - the limit is set per workspace (Settings), starting at the old fixed $5,000;
 * - a bill in another currency is measured in the book's currency, at the bill's own rate.
 *
 * The limit is kept beside the invoice and purchase-order limits in `workspace.invoiceApproval`
 * (`billThresholdCents`), so the settings save needs no new field.
 */
export const DEFAULT_BILL_LIMIT_CENTS = 500000;

export interface BillApprovalRecord {
  state: 'awaiting' | 'approved' | 'rejected';
  thresholdCents: number;
  requestedBy?: string;
  requestedAt?: string;
  decidedBy?: string;
  decidedAt?: string;
  /** the only approver in the workspace approved a bill they entered themselves */
  selfApproved?: boolean;
}

export function billLimitCents(invoiceApproval: unknown): number {
  const raw = (invoiceApproval && typeof invoiceApproval === 'object' ? invoiceApproval : {}) as { billThresholdCents?: unknown };
  const cents = Number(raw.billThresholdCents);
  return Number.isFinite(cents) && cents > 0 ? Math.round(cents) : DEFAULT_BILL_LIMIT_CENTS;
}

/** The bill's total in the book's currency, at the rate the bill carries. */
export function billBookCents(bill: { amountCents?: unknown; splits?: unknown; exchangeRate?: unknown; currency?: unknown }, bookCurrency: string): number {
  const splits = Array.isArray(bill.splits) ? bill.splits as Array<{ amountCents?: unknown }> : [];
  const amount = bill.amountCents !== undefined && bill.amountCents !== null
    ? Number(bill.amountCents) || 0
    : splits.reduce((sum, line) => sum + (Number(line?.amountCents) || 0), 0);
  return toBaseCents(amount, typeof bill.exchangeRate === 'number' ? bill.exchangeRate : undefined, typeof bill.currency === 'string' ? bill.currency : null, bookCurrency);
}
