/**
 * A-143: customer lifetime value. Read-only figures per customer, from the documents the books
 * already hold, up to an "as of" date:
 *
 * - sales and cost come from the existing invoice-item margin calculation
 *   (`computeSalesByItem`, the same one behind Gross Profit by Customer and Sales by Item): issued
 *   invoices only, opening-balance documents left out, posted cost of goods sold used where it
 *   exists and the existing item-cost fallback marked as an estimate;
 * - credit notes issued to the customer are subtracted from the sales (a return is not lifetime
 *   value), converted at the note's own stored rate like every other base-currency figure;
 * - orders are the issued invoices in the window; the first and last order dates come from those;
 * - the average annual profit is the gross profit divided by the months of recorded history
 *   (first order month through the as-of month, at least one month), and the projected lifetime
 *   value is that average repeated for the lifespan the caller chooses (three years by default).
 *   That multiplication is an explicit assumption the screen shows and the caller can change: it is
 *   not a forecast of what the customer will do, and a customer with a single order carries a very
 *   thin history;
 * - everything is in the workspace base currency, using the stored exchange rates; a customer whose
 *   documents are in another currency is converted, exactly as the reports behind it do.
 *
 * Nothing here posts, changes an invoice or writes a customer.
 */
import type { ChartAccount, CreditNote, Customer, InventoryItem, Invoice, Transaction } from '../types';
import { computeSalesByItem } from '../server/reports/itemReports';
import { INVOICE_IS_ISSUED } from '../server/reports/computeReports';
import { toBaseCents } from '../server/reports/partyReports';
import { isOpeningBalanceDocument } from './partyOpeningBalance';
import { validCustomReportPeriod } from './reportCustomPeriod';
import { monthIndex, monthOf } from './subscriptionPlans';
import { byCodeUnit } from './codeUnitOrder';

export const DEFAULT_LIFESPAN_YEARS = 3;

export interface CustomerLifetimeValueRow {
  customerId: string;
  name: string;
  salesCents: number;
  creditCents: number;
  netRevenueCents: number;
  costCents: number;
  grossProfitCents: number;
  marginPct: number | null;
  /** true when any included cost line used the item-cost fallback rather than a posted cost */
  costIsEstimate: boolean;
  orders: number;
  firstOrder: string | null;
  lastOrder: string | null;
  monthsActive: number;
  monthsOfHistory: number;
  averageOrderCents: number;
  ordersPerYear: number;
  averageAnnualProfitCents: number;
  projectedProfitCents: number;
  /** ordered within the last twelve months of the as-of date */
  active: boolean;
}

export interface CustomerLifetimeValueInput {
  customers: Array<Pick<Customer, 'id' | 'name'>>;
  invoices: Invoice[];
  creditNotes: Array<Pick<CreditNote, 'customerId' | 'date' | 'status' | 'amountCents' | 'currency' | 'exchangeRate'>>;
  items: Array<Pick<InventoryItem, 'id' | 'name' | 'sku' | 'unitCostCents'>>;
  transactions: Transaction[];
  accounts: ChartAccount[];
  /** the day the lifetime is measured to; required */
  asOfDate: string;
  /** optional start of the recorded window; an omitted side means "all recorded history" */
  from?: string;
  /** years the average annual profit is repeated for; 1–20, default 3 */
  lifespanYears?: number;
  /** workspace currency used for invoice and credit-note conversion */
  baseCurrency?: string;
}

export interface CustomerLifetimeValueReport {
  rows: CustomerLifetimeValueRow[];
  lifespanYears: number;
  asOfDate: string;
  from: string;
}

/** Credit notes that count: issued (open, applied or partly applied), not drafts or void. */
const CREDIT_NOTE_COUNTS = new Set<CreditNote['status']>(['open', 'applied', 'partially_applied']);

export function customerLifetimeValue(input: CustomerLifetimeValueInput): CustomerLifetimeValueReport {
  if (!validCustomReportPeriod({ startDate: input.asOfDate, endDate: input.asOfDate }))
    throw new Error('Choose a valid report end date.');
  const lifespanYears = input.lifespanYears ?? DEFAULT_LIFESPAN_YEARS;
  const baseCurrency = input.baseCurrency || 'USD';
  if (!Number.isInteger(lifespanYears) || lifespanYears < 1 || lifespanYears > 20)
    throw new Error('The lifespan must be a whole number of years between 1 and 20.');
  const names = new Map(input.customers.map(customer => [customer.id, customer.name]));
  const from = input.from && validCustomReportPeriod({ startDate: input.from, endDate: input.asOfDate }) ? input.from : '';
  const inWindow = (date: string | undefined) => {
    const day = (date || '').slice(0, 10);
    return !!day && day <= input.asOfDate && (!from || day >= from);
  };
  const issued = input.invoices.filter(invoice => INVOICE_IS_ISSUED.has(invoice.status) && inWindow(invoice.date) && !isOpeningBalanceDocument(invoice));

  const ids = [...new Set(issued.map(invoice => invoice.customerId || '').filter(Boolean))].sort(byCodeUnit);
  const rows: CustomerLifetimeValueRow[] = [];

  for (const customerId of ids) {
    const own = issued.filter(invoice => invoice.customerId === customerId);
    const report = computeSalesByItem({
      invoices: own,
      items: input.items,
      transactions: input.transactions,
      accounts: input.accounts,
      baseCurrency,
      startDate: from || undefined,
      endDate: input.asOfDate,
    });
    const salesCents = report.totals.salesCents;
    const costCents = report.totals.costCents;
    const costIsEstimate = report.rows.some(row => row.costIsEstimate);
    const creditCents = input.creditNotes
      .filter(note => note.customerId === customerId && CREDIT_NOTE_COUNTS.has(note.status) && inWindow(note.date))
      .reduce((sum, note) => sum + toBaseCents(note.amountCents || 0, note.exchangeRate, note.currency, baseCurrency), 0);
    const netRevenueCents = salesCents - creditCents;
    const grossProfitCents = netRevenueCents - costCents;
    const dates = own.map(invoice => (invoice.date || '').slice(0, 10)).filter(Boolean).sort(byCodeUnit);
    const firstOrder = dates[0] ?? null;
    const lastOrder = dates.at(-1) ?? null;
    const months = new Set(dates.map(monthOf));
    const monthsOfHistory = firstOrder ? monthIndex(monthOf(input.asOfDate)) - monthIndex(monthOf(firstOrder)) + 1 : 1;
    const yearsOfHistory = Math.max(monthsOfHistory, 1) / 12;
    const averageAnnualProfitCents = Math.round(grossProfitCents / yearsOfHistory);
    const active = !!lastOrder && monthIndex(monthOf(input.asOfDate)) - monthIndex(monthOf(lastOrder)) <= 11;

    rows.push({
      customerId,
      name: names.get(customerId) || own[0]?.customerName || `Unknown customer (${customerId})`,
      salesCents,
      creditCents,
      netRevenueCents,
      costCents,
      grossProfitCents,
      marginPct: netRevenueCents > 0 ? Math.round((grossProfitCents / netRevenueCents) * 1000) / 10 : null,
      costIsEstimate,
      orders: own.length,
      firstOrder,
      lastOrder,
      monthsActive: months.size,
      monthsOfHistory,
      averageOrderCents: own.length ? Math.round(netRevenueCents / own.length) : 0,
      ordersPerYear: Math.round((own.length / yearsOfHistory) * 100) / 100,
      averageAnnualProfitCents,
      projectedProfitCents: Math.round(averageAnnualProfitCents * lifespanYears),
      active,
    });
  }

  rows.sort((a, b) => b.grossProfitCents - a.grossProfitCents || a.name.localeCompare(b.name));
  return { rows, lifespanYears, asOfDate: input.asOfDate, from };
}

export const CUSTOMER_LIFETIME_VALUE_CSV_HEADERS = [
  'Customer', 'Orders', 'Sales (base minor units)', 'Credit notes (base minor units)', 'Net revenue (base minor units)',
  'Cost (base minor units)', 'Gross profit (base minor units)', 'Margin (%)', 'Cost includes an estimate',
  'First order', 'Last order', 'Active in the last 12 months', 'Months active', 'Months of history',
  'Average order (base minor units)', 'Orders per year', 'Average annual profit (base minor units)',
  'Lifespan (years)', 'Projected lifetime profit (base minor units)',
];

export function customerLifetimeValueCsvRows(report: CustomerLifetimeValueReport): Array<Array<string | number>> {
  return report.rows.map(row => [
    row.name, row.orders, row.salesCents, row.creditCents, row.netRevenueCents, row.costCents, row.grossProfitCents,
    row.marginPct ?? '', row.costIsEstimate ? 'Yes' : 'No', row.firstOrder ?? '', row.lastOrder ?? '', row.active ? 'Yes' : 'No',
    row.monthsActive, row.monthsOfHistory, row.averageOrderCents, row.ordersPerYear, row.averageAnnualProfitCents,
    report.lifespanYears, row.projectedProfitCents,
  ]);
}
