import { addDaysYMD, getLocalDateISO } from './calendarDate';

export type PaymentTerm = 'due_on_receipt' | 'net_15' | 'net_30' | 'net_45' | 'net_60' | 'custom';

/**
 * Derives due date from invoice issue date and payment terms.
 */
export function calculateDueDate(issueDateIso: string, term: PaymentTerm, customDays = 0): string {
  const baseDate = (issueDateIso || getLocalDateISO()).slice(0, 10);
  let daysToAdd = 0;

  switch (term) {
    case 'due_on_receipt':
      daysToAdd = 0;
      break;
    case 'net_15':
      daysToAdd = 15;
      break;
    case 'net_30':
      daysToAdd = 30;
      break;
    case 'net_45':
      daysToAdd = 45;
      break;
    case 'net_60':
      daysToAdd = 60;
      break;
    case 'custom':
      daysToAdd = Math.max(0, customDays);
      break;
  }

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

const TERMS: readonly PaymentTerm[] = ['due_on_receipt', 'net_15', 'net_30', 'net_45', 'net_60'];

/** A known term with a fixed number of days ('custom' and unknown values are not). */
export function isFixedTerm(term: unknown): term is Exclude<PaymentTerm, 'custom'> {
  return typeof term === 'string' && (TERMS as readonly string[]).includes(term);
}

/**
 * Terms for a customer's new invoice (I-23): the customer's own, else the terms on their most
 * recent invoice, else none (the form keeps its default).
 */
export function termsForCustomer(
  customer: { id: string; paymentTerms?: string } | undefined,
  invoices: Array<{ customerId?: string; paymentTerms?: string; date?: string; status?: string }>,
): Exclude<PaymentTerm, 'custom'> | null {
  if (!customer) return null;
  if (isFixedTerm(customer.paymentTerms)) return customer.paymentTerms;
  const last = invoices
    .filter(i => i.customerId === customer.id && i.status !== 'void' && isFixedTerm(i.paymentTerms))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0];
  return last && isFixedTerm(last.paymentTerms) ? last.paymentTerms : null;
}
