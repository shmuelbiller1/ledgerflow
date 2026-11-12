/**
 * A-187: aged receivables by salesperson. Read-only: the same customer aging the A/R Aging screen
 * shows (src/lib/aging.ts `computePartyAging` — open issued invoices, what is still owed after
 * deposits, payments and credits, in the base currency at each document's own rate, bucketed by
 * days past the due date), grouped by the sales rep who looks after each customer
 * (src/lib/salesReps.ts: a customer has one rep at most). A customer no rep looks after is its own
 * "No sales rep" group — never silently dropped, never assigned to a rep by guessing. If a
 * customer is listed under two reps (a state the reps' own validation refuses), the first rep in
 * the list takes them, so no balance is counted twice.
 *
 * Nothing here posts, allocates a payment or changes how an invoice is calculated.
 */
import type { Invoice } from '../types';
import { computePartyAging, emptyAging, type AgingTotals, type PartyAgingRow } from './aging';
import type { SalesRep } from './salesReps';

export interface RepAgingRow {
  /** the rep's id, or '' for customers no rep looks after */
  repId: string;
  repName: string;
  buckets: AgingTotals;
  /** cents of the base currency still owed, all buckets together */
  totalCents: number;
  /** of the total, the part already past its due date (every bucket but Current) */
  overdueCents: number;
  customers: PartyAgingRow[];
}

export const NO_REP_NAME = 'No sales rep';

export function agedReceivablesByRep(input: {
  customers: Array<{ id: string; name: string }>;
  invoices: Invoice[];
  reps: SalesRep[];
  /** today, YYYY-MM-DD: the day the aging is read at */
  asOf: string;
  /** workspace base currency for document minor-unit conversion */
  baseCurrency?: string;
}): RepAgingRow[] {
  const { customers, invoices, reps, asOf, baseCurrency = 'USD' } = input;
  const byCustomer = computePartyAging(customers, invoices, 'customer', asOf, baseCurrency);

  // one rep per customer; the first rep listing a customer wins
  const repOf = new Map<string, SalesRep>();
  for (const rep of reps) {
    for (const customerId of rep.customerIds || []) {
      if (!repOf.has(customerId)) repOf.set(customerId, rep);
    }
  }

  const groups = new Map<string, RepAgingRow>();
  const groupFor = (rep: SalesRep | undefined): RepAgingRow => {
    const key = rep?.id || '';
    const found = groups.get(key);
    if (found) return found;
    const row: RepAgingRow = {
      repId: key,
      repName: (rep?.name || '').trim() || NO_REP_NAME,
      buckets: emptyAging(),
      totalCents: 0,
      overdueCents: 0,
      customers: [],
    };
    groups.set(key, row);
    return row;
  };

  for (const customer of byCustomer) {
    const group = groupFor(repOf.get(customer.partyId));
    group.customers.push(customer);
    group.totalCents += customer.total;
    for (const key of Object.keys(group.buckets) as Array<keyof AgingTotals>) {
      group.buckets[key] += customer.buckets[key];
    }
  }
  for (const group of groups.values()) {
    group.overdueCents = group.totalCents - group.buckets.current;
  }

  // most owed first; the no-rep group, when it ties, stays after the named reps
  const order = new Map(reps.map((rep, index) => [rep.id, index]));
  return [...groups.values()].sort((a, b) =>
    b.totalCents - a.totalCents
    || (order.get(a.repId) ?? reps.length) - (order.get(b.repId) ?? reps.length));
}

export const AGED_BY_REP_CSV_HEADERS = [
  'Sales rep', 'Customer', 'Current', '1-30 days', '31-60 days', '61-90 days', 'Over 90 days', 'Total owed',
] as const;

/** One row per group with its customers under it (same cents as the screen, unformatted minor units). */
export function agedByRepCsvRows(rows: readonly RepAgingRow[]): string[][] {
  const out: string[][] = [];
  for (const group of rows) {
    out.push([
      group.repName, `(${group.customers.length} customers)`,
      ...bucketValues(group.buckets), String(group.totalCents),
    ]);
    for (const customer of group.customers) {
      out.push([group.repName, customer.partyName, ...bucketValues(customer.buckets), String(customer.total)]);
    }
  }
  return out;
}

function bucketValues(buckets: AgingTotals): string[] {
  return [buckets.current, buckets.d1_30, buckets.d31_60, buckets.d61_90, buckets.d90plus].map(String);
}
