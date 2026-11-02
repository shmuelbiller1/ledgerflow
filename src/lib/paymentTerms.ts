import { addDaysYMD, getLocalDateISO } from './calendarDate';

export type PaymentTerm = 'due_on_receipt' | 'net_15' | 'net_30' | 'net_45' | 'net_60' | 'custom';
/** A term with a fixed number of days: due on receipt, or `net_N` for any N from 1 to 365 (CC-08). */
export type FixedTerm = 'due_on_receipt' | `net_${number}`;

const NET_TERM = /^net_(\d{1,3})$/;
export const MAX_TERM_DAYS = 365;

/** Days a fixed term gives; null for 'custom', unknown values, or net_N outside 1–365. */
export function termDays(term: unknown): number | null {
  if (term === 'due_on_receipt') return 0;
  const m = typeof term === 'string' ? NET_TERM.exec(term) : null;
  if (!m) return null;
  const days = Number(m[1]);
  return days >= 1 && days <= MAX_TERM_DAYS ? days : null;
}

/**
 * Derives due date from invoice issue date and payment terms.
 */
export function calculateDueDate(issueDateIso: string, term: PaymentTerm | FixedTerm, customDays = 0): string {
  const baseDate = (issueDateIso || getLocalDateISO()).slice(0, 10);
  const daysToAdd = term === 'custom' ? Math.max(0, customDays) : (termDays(term) ?? 0);

  return addDaysYMD(baseDate, daysToAdd);
}

/**
 * Calculates late fee for an overdue invoice.
 */
export function calculateLateFee(
  outstandingBalanceCents: number,
  dueDateIso: string,
  asOfDateIso: string = getLocalDateISO(),
  annualInterestRatePct = 18.0,
  flatFeeCents = 2500 // $25.00 default flat fee
): { isOverdue: boolean; daysOverdue: number; lateFeeCents: number } {
  const due = new Date(dueDateIso).getTime();
  const asOf = new Date(asOfDateIso).getTime();

  if (asOf <= due || outstandingBalanceCents <= 0) {
    return { isOverdue: false, daysOverdue: 0, lateFeeCents: 0 };
  }

  const diffMs = asOf - due;
  const daysOverdue = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  // Daily interest = (annualRate / 365) * balance
  const dailyRate = (annualInterestRatePct / 100) / 365;
  const interestFeeCents = Math.round(outstandingBalanceCents * dailyRate * daysOverdue);
  const totalLateFeeCents = flatFeeCents + interestFeeCents;

  return {
    isOverdue: true,
    daysOverdue,
    lateFeeCents: totalLateFeeCents
  };
}

/** A term with a fixed number of days ('custom' and unknown values are not). */
export function isFixedTerm(term: unknown): term is FixedTerm {
  return termDays(term) !== null;
}

/** The terms every workspace offers. */
export const STANDARD_TERM_DAYS: readonly number[] = [15, 30, 60];

/**
 * CC-08: a workspace's own payment terms, as whole days (Net N). Keeps whole numbers from 1 to 365,
 * once each, in ascending order; anything else is dropped.
 */
export function normalizeTermDays(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  const days = input.filter((d): d is number => Number.isInteger(d) && d >= 1 && d <= MAX_TERM_DAYS);
  return [...new Set(days)].sort((a, b) => a - b);
}

/**
 * The choices for a document's terms: due on receipt, the standard terms, the workspace's own, and
 * the document's current term if it is a fixed one no longer listed (so editing never changes it).
 */
export function termOptions(workspaceDays: unknown, current?: unknown): Array<{ value: FixedTerm; label: string }> {
  const days = new Set<number>([...STANDARD_TERM_DAYS, ...normalizeTermDays(workspaceDays)]);
  const currentDays = termDays(current);
  if (currentDays) days.add(currentDays);
  return [
    { value: 'due_on_receipt', label: 'Due on Receipt' },
    ...[...days].sort((a, b) => a - b).map(d => ({ value: `net_${d}` as FixedTerm, label: `Net ${d}` })),
  ];
}

/**
 * Terms for a customer's new invoice (I-23): the customer's own, else the terms on their most
 * recent invoice, else none (the form keeps its default).
 */
export function termsForCustomer(
  customer: { id: string; paymentTerms?: string } | undefined,
  invoices: Array<{ customerId?: string; paymentTerms?: string; date?: string; status?: string }>,
): FixedTerm | null {
  if (!customer) return null;
  if (isFixedTerm(customer.paymentTerms)) return customer.paymentTerms;
  const last = invoices
    .filter(i => i.customerId === customer.id && i.status !== 'void' && isFixedTerm(i.paymentTerms))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0];
  return last && isFixedTerm(last.paymentTerms) ? last.paymentTerms : null;
}
