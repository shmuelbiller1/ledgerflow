/**
 * A-190: the top 20 customers and vendors, with the trend behind each one. Read-only: the ranking
 * figures are the customer/supplier period summary's own (`partyPeriodSummary`, which differences
 * the balance summaries the other screens use — the same document statuses, exchange rates and
 * credit handling, no new money maths). Customers rank by what was invoiced to them in the period,
 * vendors by what was billed by them, both in the base currency. The trend is that same invoiced /
 * billed figure per month for the twelve months ending with the period's last month, so the
 * sparkline and the ranking can never disagree about what a sale or a purchase is.
 *
 * A party with nothing invoiced or billed in the period (or in the trend year) is not listed; the
 * list is capped at 20 and says how many more there were.
 */
import { partyPeriodSummary, type PartyPeriodInput } from './partyPeriodSummary';
import { validCustomReportPeriod, type CustomReportPeriod } from './reportCustomPeriod';
import { monthsBetween, monthRange } from './grossMarginByGroup';

export interface TopPartyRow {
  id: string;
  name: string;
  /** invoiced (customers) or billed (vendors) in the chosen period, base-currency cents */
  invoicedCents: number;
  paidCents: number;
  creditedCents: number;
  /** what they owed / were owed at the period's end */
  closingCents: number;
  /** invoiced/billed per trend month, aligned with `months` */
  monthlyCents: number[];
}

export interface TopPartiesReport {
  rows: TopPartyRow[];
  /** parties with activity that did not fit in the top list */
  moreCount: number;
  /** the twelve trend months, YYYY-MM, oldest first */
  months: string[];
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The 12 calendar months ending with the month of `endDate` (YYYY-MM-DD). */
export function trendMonths(endDate: string): string[] {
  const end = (endDate || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(end)) return [];
  const [year, month] = end.split('-').map(Number);
  const startMonth = month - 11;
  const first = `${startMonth <= 0 ? year - 1 : year}-${String(((startMonth + 11) % 12) + 1).padStart(2, '0')}`;
  return monthsBetween(first, end);
}

export function topParties(input: {
  kind: 'customer' | 'vendor';
  parties: PartyPeriodInput;
  period: CustomReportPeriod;
  limit?: number;
}): TopPartiesReport {
  const { kind, parties, period } = input;
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const months = DAY.test(period.endDate) ? trendMonths(period.endDate) : [];
  if (!validCustomReportPeriod(period) || months.length !== 12) return { rows: [], moreCount: 0, months };

  const ranked = partyPeriodSummary(kind, parties, period)
    .filter(row => row.invoicedCents !== 0)
    .sort((a, b) => b.invoicedCents - a.invoicedCents || a.name.localeCompare(b.name));

  const shown = ranked.slice(0, limit);
  if (!shown.length) return { rows: [], moreCount: 0, months };
  // The trend shows only gross issued amounts for the displayed parties. Payments and credits
  // cannot affect that field, and the same summary still determines status, date and FX.
  const ids = new Set(shown.map(row => row.id));
  const trendParties: PartyPeriodInput = {
    customers: parties.customers.filter(c => ids.has(c.id)), vendors: parties.vendors.filter(v => ids.has(v.id)),
    invoices: parties.invoices.filter(i => ids.has(i.customerId)), bills: parties.bills.filter(b => ids.has(b.vendorId)),
    creditNotes: [], vendorCredits: [], payments: [], baseCurrency: parties.baseCurrency,
  };
  // one summary per trend month, each clipped to the reported end date
  const monthlyById = new Map<string, number[]>();
  months.forEach((month, index) => {
    const { startDate, endDate } = monthRange(month);
    const clipped: CustomReportPeriod = { startDate, endDate: endDate < period.endDate ? endDate : period.endDate };
    if (!validCustomReportPeriod(clipped)) return;
    for (const row of partyPeriodSummary(kind, trendParties, clipped)) {
      if (!row.invoicedCents) continue;
      const series = monthlyById.get(row.id) || new Array(12).fill(0);
      series[index] = row.invoicedCents;
      monthlyById.set(row.id, series);
    }
  });

  const rows = shown.map(row => ({
    id: row.id,
    name: row.name,
    invoicedCents: row.invoicedCents,
    paidCents: row.paidCents,
    creditedCents: row.creditedCents,
    closingCents: row.closingCents,
    monthlyCents: monthlyById.get(row.id) || new Array(12).fill(0),
  }));
  return { rows, moreCount: ranked.length - shown.length, months };
}

export function topPartiesCsvHeaders(kind: 'customer' | 'vendor', months: string[]): string[] {
  const who = kind === 'customer' ? 'Customer' : 'Vendor';
  const verb = kind === 'customer' ? 'Invoiced' : 'Billed';
  return [who, `${verb} in period (minor units)`, 'Paid in period (minor units)', 'Credited in period (minor units)',
    'Balance at period end (minor units)', ...months.map(m => `${verb} ${m} (minor units)`)];
}

export function topPartiesCsvRows(rows: readonly TopPartyRow[]): Array<Array<string | number>> {
  return rows.map(row => [row.name, row.invoicedCents, row.paidCents, row.creditedCents, row.closingCents, ...row.monthlyCents]);
}
