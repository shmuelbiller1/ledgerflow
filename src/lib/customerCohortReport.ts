/**
 * E-2: Read-only cohort report. The first issued invoice in the supplied history
 * assigns the customer to a cohort; later issued invoices measure repeat activity.
 * The caller must flag capped/failed history: this helper cannot prove completeness.
 */
import type { Invoice } from '../types';
import { INVOICE_IS_ISSUED } from '../server/reports/computeReports';
import { toBaseCents } from '../server/reports/partyReports';
import { isOpeningBalanceDocument } from './partyOpeningBalance';
import { validCustomReportPeriod } from './reportCustomPeriod';

const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
const monthName = (index: number) =>
  `${Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}`;

export interface CohortMonth {
  month: string;
  age: number;
  /** Null means the month is in the future; zero means observed, with no activity. */
  activeCustomers: number | null;
  activePercent: number | null;
  invoicedCents: number | null;
}
export interface CustomerCohortRow {
  cohort: string;
  customers: number;
  months: CohortMonth[];
}
export interface CustomerCohortReport {
  rows: CustomerCohortRow[];
  excluded: number;
  observedCustomers: number;
}

/** All money uses the existing invoice/base-currency conversion (invoice total including taxes). */
export function customerCohortReport(
  invoices: readonly Invoice[],
  asOfDate: string,
  cohortWindowMonths = 12,
  ageMonths = 12,
  baseCurrency = 'USD',
): CustomerCohortReport {
  if (!validCustomReportPeriod({ startDate: asOfDate, endDate: asOfDate }))
    throw new Error('Choose a valid report end date.');
  if (!Number.isInteger(cohortWindowMonths) || cohortWindowMonths < 1 || cohortWindowMonths > 36 ||
      !Number.isInteger(ageMonths) || ageMonths < 1 || ageMonths > 36)
    throw new Error('Choose a valid number of months.');

  const customers = new Map<string, { first: number; activity: Map<number, number> }>();
  let excluded = 0;
  for (const invoice of invoices) {
    if (!INVOICE_IS_ISSUED.has(invoice.status) || isOpeningBalanceDocument(invoice) ||
        ('deletedAt' in invoice && Boolean(invoice.deletedAt))) continue;
    const date = invoice.date?.slice(0, 10) || '';
    if (!invoice.customerId || !validCustomReportPeriod({ startDate: date, endDate: date })) {
      excluded++;
      continue;
    }
    if (date > asOfDate) continue;
    const index = monthIndex(date);
    const cents = toBaseCents(invoice.amountCents, invoice.exchangeRate, invoice.currency, baseCurrency);
    if (!Number.isSafeInteger(cents)) {
      excluded++;
      continue;
    }
    const customer = customers.get(invoice.customerId) || { first: index, activity: new Map<number, number>() };
    customer.first = Math.min(customer.first, index);
    customer.activity.set(index, (customer.activity.get(index) || 0) + cents);
    customers.set(invoice.customerId, customer);
  }

  const asOfMonth = monthIndex(asOfDate);
  const cohorts = new Map<number, Array<{ activity: Map<number, number> }>>();
  for (const customer of customers.values()) {
    if (customer.first < asOfMonth - cohortWindowMonths + 1) continue;
    const entries = cohorts.get(customer.first) || [];
    entries.push(customer);
    cohorts.set(customer.first, entries);
  }

  const rows = [...cohorts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([first, members]): CustomerCohortRow => ({
      cohort: monthName(first),
      customers: members.length,
      months: Array.from({ length: ageMonths }, (_, age): CohortMonth => {
        const month = first + age;
        if (month > asOfMonth) {
          return { month: monthName(month), age, activeCustomers: null, activePercent: null, invoicedCents: null };
        }
        const active = members.filter(member => member.activity.has(month));
        const cents = active.reduce((sum, member) => sum + (member.activity.get(month) || 0), 0);
        return {
          month: monthName(month),
          age,
          activeCustomers: active.length,
          activePercent: Math.round(active.length * 1000 / members.length) / 10,
          invoicedCents: cents,
        };
      }),
    }));
  return { rows, excluded, observedCustomers: customers.size };
}
