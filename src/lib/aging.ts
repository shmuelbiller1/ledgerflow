import type { Bill, Invoice } from '../types';
import { calculateAmountDue, cashPostedWithDocumentCents, depositAppliedCents } from './documentMath';
import { isOpenBill, isOpenInvoice } from './txFilters';
import { toBaseCents } from '../server/reports/partyReports';

/**
 * Receivables / payables aging, one rule for the A/R and A/P aging screens and the /aging API
 * (L-159): open documents only, what is still owed (after deposits, payments and credits) in the
 * base currency, by days past the due date (the document date when there is none).
 */
export const AGING_BUCKETS = [
  { key: 'current', label: 'Current' },
  { key: 'd1_30', label: '1–30 days' },
  { key: 'd31_60', label: '31–60 days' },
  { key: 'd61_90', label: '61–90 days' },
  { key: 'd90plus', label: 'Over 90 days' },
] as const;
export type AgingBucketKey = (typeof AGING_BUCKETS)[number]['key'];
export type AgingTotals = Record<AgingBucketKey, number>;

/** Day count of a YYYY-MM-DD date (days from civil date, integer only: no time zone involved). */
function dayNumber(iso: string): number {
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  const y = Number(iso.slice(0, 4)) - (m <= 2 ? 1 : 0);
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  return era * 146097 + yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
}

/** Days past due on `today` (YYYY-MM-DD); 0 or less means not due yet. */
export function daysOverdue(doc: { dueDate?: string; date?: string }, today: string): number {
  const due = (doc.dueDate || doc.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return 0;
  return dayNumber(today) - dayNumber(due);
}

export function agingBucket(days: number): AgingBucketKey {
  if (days <= 0) return 'current';
  if (days <= 30) return 'd1_30';
  if (days <= 60) return 'd31_60';
  if (days <= 90) return 'd61_90';
  return 'd90plus';
}

/** What is still owed on an open document, in cents of the base currency (0 when closed). */
export function outstandingBaseCents(doc: Invoice | Bill, side: 'customer' | 'vendor', baseCurrency: string = 'USD'): number {
  if (!(side === 'customer' ? isOpenInvoice(doc) : isOpenBill(doc))) return 0;
  return Math.max(0, toBaseCents(calculateAmountDue(doc), doc.exchangeRate, doc.currency, baseCurrency));
}

/**
 * RP-01: one dated settlement event against a document, in cents of the base currency. The
 * `paymentAllocations` ledger records payments, credit applications, write-offs and their
 * reversals; a reversal row carries the negative amount dated with the reversal. Filtered to a
 * cutoff, these events reconstruct what had actually settled by that date, so a payment dated
 * after the report date does not shrink a historic snapshot (and a later void only unwinds it
 * from the void date onward).
 */
export interface SettlementEvent {
  documentId: string;
  documentType: 'invoice' | 'bill';
  /** YYYY-MM-DD or an ISO timestamp; compared on its day part. */
  date: string;
  /** Base-currency cents, signed: a reversal is negative. */
  amountCents: number;
  kind?: string;
}

/** Statuses that mean a document can never be owed, whatever its settlements. */
const NEVER_OUTSTANDING = new Set(['draft', 'rejected']);
/** Statuses that take a posted document off the books — from the date their reversal was posted. */
const UNPOSTED = new Set(['void', 'cancelled']);

/**
 * RP-01: what was still owed on a document at a cutoff, from dated settlement events:
 * the document's amount less its deposit, less every settlement event dated on or before the
 * cutoff (reversals net out; events after the cutoff are ignored, so later payments and voids
 * leave the snapshot alone). 0 when the document is draft/rejected, was issued after the cutoff,
 * or nothing is left.
 *
 * A void is applied from its effective date: `voidDates` maps a document id to the date its posting
 * was reversed (the void's reversal entry), so a January invoice voided in February is still owed
 * on January 31. A void with no known reversal date takes the document off every snapshot.
 *
 * A document marked paid in its own editor posts its cash without a `paymentAllocations` row
 * (cashPostedWithDocumentCents); that settlement counts from its payment date too, and never twice
 * (the amount already excludes what payment records settled).
 */
export function outstandingAsOfCents(
  doc: Invoice | Bill,
  settlements: SettlementEvent[],
  cutoff: string,
  baseCurrency: string = 'USD',
  voidDates?: ReadonlyMap<string, string>,
): number {
  const status = String(doc.status || '');
  const day = String(cutoff).slice(0, 10);
  if (NEVER_OUTSTANDING.has(status)) return 0;
  if (UNPOSTED.has(status)) {
    const voided = voidDates?.get(doc.id)?.slice(0, 10);
    if (!voided || voided <= day) return 0;
  }
  const issued = String(doc.date || '').slice(0, 10);
  if (issued && issued > day) return 0;
  const settled = settlements
    .filter(e => e.documentId === doc.id && e.documentType === (sideOf(doc) === 'customer' ? 'invoice' : 'bill')
      && String(e.date).slice(0, 10) <= day && e.kind !== 'deposit')
    .reduce((sum, e) => sum + (Number(e.amountCents) || 0), 0);
  // the settlement posted with the document itself ("Mark as paid"), dated with its payment
  const paidOn = String(doc.paymentDate || doc.paidAt || '').slice(0, 10);
  const postedWithDocument = UNPOSTED.has(status) ? 0 : cashPostedWithDocumentCents(doc);
  const documentSettled = postedWithDocument > 0 && (!paidOn || paidOn <= day)
    ? toBaseCents(postedWithDocument, doc.exchangeRate, doc.currency, baseCurrency)
    : 0;
  const due = Math.max(0, toBaseCents(doc.amountCents || 0, doc.exchangeRate, doc.currency, baseCurrency)
    - toBaseCents(depositAppliedCents(doc), doc.exchangeRate, doc.currency, baseCurrency));
  return Math.max(0, due - settled - documentSettled);
}

function sideOf(doc: Invoice | Bill): 'customer' | 'vendor' {
  return 'customerId' in doc ? 'customer' : 'vendor';
}

export const emptyAging = (): AgingTotals => ({ current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 });

export interface PartyAgingRow { partyId: string; partyName: string; buckets: AgingTotals; total: number }

/**
 * One row per customer (or vendor) that owes (or is owed) something, sorted by name.
 *
 * RP-01: `settlements` reconstructs what was owed at `today` from dated settlement events
 * (payments, credits, write-offs and their reversals). When it is passed, a document's
 * outstanding amount is what had settled by `today` — a payment made after the report date, or
 * a later void, cannot change the snapshot; documents issued after `today` are not in it. When
 * it is omitted (the current-state aging screens), behavior is unchanged.
 */
export function computePartyAging(
  parties: Array<{ id: string; name: string }>,
  documents: Array<Invoice | Bill>,
  side: 'customer' | 'vendor',
  today: string,
  baseCurrency: string = 'USD',
  settlements?: SettlementEvent[],
  voidDates?: ReadonlyMap<string, string>,
): PartyAgingRow[] {
  const partyOf = (d: Invoice | Bill) => (side === 'customer' ? (d as Invoice).customerId : (d as Bill).vendorId);
  const rows = new Map<string, PartyAgingRow>();
  for (const party of parties) rows.set(party.id, { partyId: party.id, partyName: party.name, buckets: emptyAging(), total: 0 });
  for (const doc of documents) {
    const row = rows.get(partyOf(doc) || '');
    const owed = settlements
      ? outstandingAsOfCents(doc, settlements, today, baseCurrency, voidDates)
      : outstandingBaseCents(doc, side, baseCurrency);
    if (!row || owed <= 0) continue;
    row.buckets[agingBucket(daysOverdue(doc, today))] += owed;
    row.total += owed;
  }
  return [...rows.values()].filter(r => r.total > 0).sort((a, b) => a.partyName.localeCompare(b.partyName));
}

export interface PartyStats { outstandingCents: number; overdueCents: number; lifetimeCents: number; paymentsCents: number }

/**
 * The money cards on a customer's or vendor's page (H-05, H-06), in cents of the base currency:
 * still owed and overdue (as the aging), everything ever invoiced/billed (issued documents), and
 * payments received/made.
 */
export function partyStats(
  documents: Array<Invoice | Bill>,
  payments: Array<{ direction?: string; status?: string; amountCents?: number; exchangeRate?: number; currency?: string }>,
  side: 'customer' | 'vendor',
  today: string,
  baseCurrency: string = 'USD',
): PartyStats {
  const stats: PartyStats = { outstandingCents: 0, overdueCents: 0, lifetimeCents: 0, paymentsCents: 0 };
  for (const doc of documents) {
    if (['draft', 'void', 'cancelled'].includes(doc.status || '')) continue;
    stats.lifetimeCents += toBaseCents(doc.amountCents || 0, doc.exchangeRate, doc.currency, baseCurrency);
    const owed = outstandingBaseCents(doc, side, baseCurrency);
    stats.outstandingCents += owed;
    if (owed > 0 && daysOverdue(doc, today) > 0) stats.overdueCents += owed;
  }
  const direction = side === 'customer' ? 'received' : 'made';
  for (const p of payments) {
    if (p.direction !== direction || p.status === 'void' || p.status === 'draft') continue;
    stats.paymentsCents += toBaseCents(p.amountCents || 0, p.exchangeRate, p.currency, baseCurrency);
  }
  return stats;
}
