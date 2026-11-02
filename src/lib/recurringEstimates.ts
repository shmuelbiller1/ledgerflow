/**
 * A-18 (tracker CC-04): recurring estimates. An estimate can be set to repeat monthly, quarterly or
 * yearly; the daily job copies it as a **new draft estimate** with the next number and the next
 * date, and nothing is sent and nothing is posted — a person reviews the draft and sends it.
 *
 * The same schedule shape as recurring bills (`recurringBills.ts`) so the job reads every repeating
 * document the same way; the invoice/estimate numbering itself stays with the calling service
 * (src/services/documentNumbers.ts). Pure.
 */
import type { Estimate, RecurringTransaction } from '../types';
import { calculateNextOccurrence } from './recurringEngine';
import { getLocalDateISO } from './calendarDate';

const DAY_MS = 86_400_000;
/** An estimate may repeat monthly, quarterly or yearly (not daily or weekly). */
export const ESTIMATE_FREQUENCIES: Array<RecurringTransaction['frequency']> = ['monthly', 'quarterly', 'yearly'];

/** The days an estimate stays valid; when it has none, 30. */
export function estimateValidityDays(estimate: Partial<Estimate>): number {
  if (!estimate.date || !estimate.expiryDate) return 30;
  const days = Math.round((Date.parse(`${String(estimate.expiryDate).slice(0, 10)}T00:00:00Z`) - Date.parse(`${String(estimate.date).slice(0, 10)}T00:00:00Z`)) / DAY_MS);
  return days > 0 ? days : 30;
}

/** Why an estimate cannot repeat, in plain words, or null when it can. */
export function recurringEstimateProblem(schedule: { frequency?: string; customerId?: string }): string | null {
  if (!schedule.customerId) return 'A recurring estimate needs a customer.';
  if (!ESTIMATE_FREQUENCIES.includes(schedule.frequency as RecurringTransaction['frequency'])) {
    return 'An estimate can repeat monthly, quarterly or yearly.';
  }
  return null;
}

/**
 * The schedule saved when an estimate is set to repeat: like a recurring bill, everything the next
 * draft needs is copied here (the customer, lines and currency), and the number, dates, status and
 * any signing are left out — each copy gets its own when it is made.
 */
export function recurringEstimateSchedule(estimate: Partial<Estimate>, frequency: RecurringTransaction['frequency']) {
  const start = (estimate.date || getLocalDateISO()).slice(0, 10);
  const anchorDay = Number(start.split('-')[2]) || 1;
  const validityDays = estimateValidityDays(estimate);
  const { id: _id, number: _number, status: _status, date: _date, expiryDate: _expiry, signToken: _token, signTokenAt: _tokenAt,
    signature: _signature, convertedInvoiceId: _converted, orderedAt: _orderedAt, orderedBy: _orderedBy,
    createdAt: _created, updatedAt: _updated, ...estimateTemplate } = estimate as Estimate;
  return {
    description: `Recurring estimate: ${estimate.customerName || 'Customer'}`,
    amountCents: estimate.amountCents || 0,
    frequency,
    nextOccurrence: calculateNextOccurrence(start, frequency, anchorDay),
    anchorDay,
    isActive: true,
    status: 'active',
    type: 'estimate' as const,
    payee: estimate.customerName || '',
    estimateTemplate: { ...estimateTemplate, validityDays },
  };
}

/** One occurrence a schedule owes: the date to make the draft for and where the schedule goes next. */
export interface EstimateOccurrence {
  scheduleId: string;
  dueDate: string;
  nextOccurrence: string;
}

/**
 * The drafts a set of schedules owes as of `today`, oldest first. A schedule that was not run for a
 * while owes one draft per missed occurrence (never more than 60 at a time), and every returned
 * occurrence carries the schedule's next date after it.
 */
export function estimateDraftsDue(
  schedules: Array<Pick<RecurringTransaction, 'id' | 'isActive' | 'nextOccurrence' | 'frequency' | 'anchorDay' | 'status'>>,
  today: string,
): EstimateOccurrence[] {
  const due: EstimateOccurrence[] = [];
  const day = String(today).slice(0, 10);
  for (const schedule of schedules) {
    if (schedule.status !== 'active' || schedule.isActive === false) continue;
    let next = String(schedule.nextOccurrence || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) continue;
    for (let steps = 0; steps < 60 && next <= day; steps += 1) {
      const following = calculateNextOccurrence(next, schedule.frequency, schedule.anchorDay || Number(next.split('-')[2]) || 1);
      due.push({ scheduleId: schedule.id, dueDate: next, nextOccurrence: following });
      next = following;
    }
  }
  return due.sort((a, b) => (a.dueDate === b.dueDate ? a.scheduleId.localeCompare(b.scheduleId) : a.dueDate.localeCompare(b.dueDate)));
}

/**
 * The new draft: a fresh id and number, the due date, the customer's lines and prices, and nothing
 * that could send it or link it to a signature — it is a draft a person reviews.
 */
export function nextEstimateDraft(
  estimate: Partial<Estimate>,
  copy: { id: string; number: string; date: string },
): Estimate {
  const validityDays = (estimate as { validityDays?: number }).validityDays || estimateValidityDays(estimate);
  const date = String(copy.date).slice(0, 10);
  const expiry = new Date(Date.parse(`${date}T00:00:00Z`) + validityDays * DAY_MS).toISOString().slice(0, 10);
  return {
    ...estimate,
    id: copy.id,
    number: copy.number,
    date,
    expiryDate: expiry,
    status: 'draft',
    // each copy bills its own milestones: none is invoiced yet
    ...(Array.isArray(estimate.milestones) ? { milestones: estimate.milestones.map(({ invoicedAt: _done, ...m }) => m) } : {}),
    signToken: undefined,
    signTokenAt: undefined,
    signature: undefined,
    convertedInvoiceId: undefined,
    orderedAt: undefined,
    orderedBy: undefined,
  } as Estimate;
}
