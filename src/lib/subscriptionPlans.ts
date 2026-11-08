/**
 * A-68: subscription plans. Read-only: the customers' recurring invoices, seen as plans, with the
 * money they bring each month (MRR) and year (ARR) and what moved in each month of the window.
 *
 * Definitions, so a figure can be trusted or argued with:
 * - a plan is a recurring rule that carries an invoice template (`invoiceTemplate`) and names a
 *   customer; ordinary recurring journals are not subscriptions and are left out;
 * - the monthly value is the plan's own amount normalised to a month: monthly as it is, quarterly
 *   ÷ 3, yearly ÷ 12, weekly × 52 ÷ 12, daily × 365.25 ÷ 12. Weekly and daily plans are flagged
 *   `approximate` — a month is not a whole number of weeks;
 * - amounts are integer minor units in the plan's own currency (`invoiceTemplate.currency`, or the
 *   workspace currency when the plan names none). Currencies are NEVER added together: every total
 *   is per currency;
 * - "started" is the month of `createdAt`; "stopped" is the month of the plan's last occurrence when
 *   the plan is not active now. The books record when a plan last ran, not a cancellation date, so
 *   the report says so instead of pretending to know the day it was cancelled. A stopped plan with
 *   no recorded occurrence cannot be dated and is counted separately as `undatedStops`;
 * - MRR by month counts the plans that were running in that month: started on or before its end and
 *   (still active, or with a last occurrence in it or later). It is a reconstruction from the dates
 *   the plans carry, not a posted balance.
 *
 * Nothing here posts, sends or changes a recurring rule.
 */
import type { Customer, RecurringTransaction } from '../types';
import { getLocalDateISO } from './calendarDate';
import { byCodeUnit } from './codeUnitOrder';

export type PlanStatus = 'active' | 'paused' | 'completed';

export interface SubscriptionPlanRow {
  planId: string;
  customerId: string;
  customerName: string;
  description: string;
  frequency: RecurringTransaction['frequency'];
  status: PlanStatus;
  currency: string;
  amountCents: number;
  monthlyCents: number;
  annualCents: number;
  /** weekly and daily plans: a month is not a whole number of weeks */
  approximate: boolean;
  createdAt: string;
  startedMonth: string;
  lastOccurrence?: string;
  nextOccurrence: string;
  generatedCount: number;
}

export interface SubscriptionMonthRow {
  month: string;
  activePlans: number;
  monthlyCents: number;
  startedPlans: number;
  newMonthlyCents: number;
  stoppedPlans: number;
  stoppedMonthlyCents: number;
}

export interface SubscriptionCurrencyTotal {
  currency: string;
  activePlans: number;
  monthlyCents: number;
  annualCents: number;
  startedPlans: number;
  newMonthlyCents: number;
  stoppedPlans: number;
  stoppedMonthlyCents: number;
  approximatePlans: number;
}

export interface SubscriptionCustomerRow {
  customerId: string;
  customerName: string;
  currency: string;
  plans: number;
  activePlans: number;
  monthlyCents: number;
}

export interface SubscriptionPlansReport {
  rows: SubscriptionPlanRow[];
  months: SubscriptionMonthRow[];
  byCurrency: SubscriptionCurrencyTotal[];
  byCustomer: SubscriptionCustomerRow[];
  /** plans that are not active now and carry no occurrence, so their stop month cannot be shown */
  undatedStops: number;
  window: { from: string; to: string };
}

export interface SubscriptionPlansInput {
  plans: Array<Pick<RecurringTransaction, 'id' | 'description' | 'amountCents' | 'frequency' | 'nextOccurrence' | 'isActive' | 'status' | 'lastOccurrence' | 'createdAt' | 'generatedCount' | 'invoiceTemplate'>>;
  customers: Array<Pick<Customer, 'id' | 'name'>>;
  homeCurrency?: string;
  /** inclusive month window, 'YYYY-MM'; omitted sides default to the twelve months ending at `to` */
  from?: string;
  to?: string;
}

const MONTH = /^\d{4}-\d{2}$/;

/** Months are counted as whole numbers: no clock, no time zone, no UTC date arithmetic. */
export function monthIndex(month: string): number {
  return Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
}
export function monthOf(date: string | undefined): string {
  return (date || '').slice(0, 7);
}
export function monthFromIndex(index: number): string {
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}
export function addMonths(month: string, count: number): string {
  return monthFromIndex(monthIndex(month) + count);
}

/** The plan's own amount as a month. `approximate` marks the units a month cannot hold exactly. */
export function monthlyValueCents(amountCents: number, frequency: RecurringTransaction['frequency']): { monthlyCents: number; approximate: boolean } {
  if (!Number.isFinite(amountCents)) return { monthlyCents: 0, approximate: false };
  switch (frequency) {
    case 'monthly': return { monthlyCents: Math.round(amountCents), approximate: false };
    case 'quarterly': return { monthlyCents: Math.round(amountCents / 3), approximate: false };
    case 'yearly': return { monthlyCents: Math.round(amountCents / 12), approximate: false };
    case 'weekly': return { monthlyCents: Math.round((amountCents * 52) / 12), approximate: true };
    case 'daily': return { monthlyCents: Math.round((amountCents * 365.25) / 12), approximate: true };
    default: return { monthlyCents: Math.round(amountCents), approximate: false };
  }
}

function planStatus(plan: SubscriptionPlansInput['plans'][number]): PlanStatus {
  if (plan.status === 'paused') return 'paused';
  if (plan.status === 'completed') return 'completed';
  return plan.isActive ? 'active' : 'completed';
}

/** The window is the caller's, or the twelve months that end with `to`. */
function windowFor(input: SubscriptionPlansInput): { from: string; to: string } | null {
  const to = input.to && MONTH.test(input.to) ? input.to : monthOf(input.plans.map(plan => plan.nextOccurrence).sort(byCodeUnit).at(-1)) || monthOf(getLocalDateISO());
  if (!MONTH.test(to)) return null;
  const from = input.from && MONTH.test(input.from) ? input.from : addMonths(to, -11);
  if (monthIndex(from) > monthIndex(to)) return null;
  return { from, to };
}

export function subscriptionPlans(input: SubscriptionPlansInput): SubscriptionPlansReport {
  const home = input.homeCurrency || 'USD';
  const window = windowFor(input);
  if (!window) return { rows: [], months: [], byCurrency: [], byCustomer: [], undatedStops: 0, window: { from: '', to: '' } };
  const names = new Map(input.customers.map(customer => [customer.id, customer.name]));
  const rows: SubscriptionPlanRow[] = [];
  const undated: SubscriptionPlanRow[] = [];
  let undatedStops = 0;

  for (const plan of input.plans) {
    const template = plan.invoiceTemplate;
    const customerId = template?.customerId || '';
    if (!template || !customerId) continue;
    const currency = template.currency || home;
    const { monthlyCents, approximate } = monthlyValueCents(plan.amountCents || 0, plan.frequency);
    const status = planStatus(plan);
    const startedMonth = monthOf(plan.createdAt);
    const row: SubscriptionPlanRow = {
      planId: plan.id,
      customerId,
      customerName: names.get(customerId) || template.customerName || `Unknown customer (${customerId})`,
      description: plan.description || template.number || 'Recurring invoice',
      frequency: plan.frequency,
      status,
      currency,
      amountCents: plan.amountCents || 0,
      monthlyCents,
      annualCents: monthlyCents * 12,
      approximate,
      createdAt: plan.createdAt,
      startedMonth: MONTH.test(startedMonth) ? startedMonth : '',
      lastOccurrence: plan.lastOccurrence,
      nextOccurrence: plan.nextOccurrence,
      generatedCount: plan.generatedCount || 0,
    };
    rows.push(row);
    if (status !== 'active' && !monthOf(plan.lastOccurrence)) { undatedStops += 1; undated.push(row); }
  }

  rows.sort((a, b) => a.customerName.localeCompare(b.customerName) || a.description.localeCompare(b.description));
  undated.sort((a, b) => a.customerName.localeCompare(b.customerName));

  const inWindow = (month: string) => !!month && monthIndex(month) >= monthIndex(window.from) && monthIndex(month) <= monthIndex(window.to);
  const months: SubscriptionMonthRow[] = [];
  for (let index = monthIndex(window.from); index <= monthIndex(window.to); index += 1) {
    const month = monthFromIndex(index);
    const startedByNow = (row: SubscriptionPlanRow) => !row.startedMonth || monthIndex(row.startedMonth) <= index;
    const running = rows.filter(row => startedByNow(row) && (row.status === 'active'
      || (monthOf(row.lastOccurrence) && monthIndex(monthOf(row.lastOccurrence)) >= index)));
    const started = rows.filter(row => inWindow(row.startedMonth) && row.startedMonth === month);
    const stopped = rows.filter(row => row.status !== 'active' && inWindow(monthOf(row.lastOccurrence)) && monthOf(row.lastOccurrence) === month);
    const monthly = running.reduce((sum, row) => sum + row.monthlyCents, 0);
    months.push({
      month,
      activePlans: running.length,
      monthlyCents: monthly,
      startedPlans: started.length,
      newMonthlyCents: started.reduce((sum, row) => sum + row.monthlyCents, 0),
      stoppedPlans: stopped.length,
      stoppedMonthlyCents: stopped.reduce((sum, row) => sum + row.monthlyCents, 0),
    });
  }

  const byCurrency: SubscriptionCurrencyTotal[] = [];
  for (const currency of [...new Set(rows.map(row => row.currency))].sort(byCodeUnit)) {
    const own = rows.filter(row => row.currency === currency);
    const active = own.filter(row => row.status === 'active');
    byCurrency.push({
      currency,
      activePlans: active.length,
      monthlyCents: active.reduce((sum, row) => sum + row.monthlyCents, 0),
      annualCents: active.reduce((sum, row) => sum + row.annualCents, 0),
      startedPlans: own.filter(row => inWindow(row.startedMonth)).length,
      newMonthlyCents: own.filter(row => inWindow(row.startedMonth)).reduce((sum, row) => sum + row.monthlyCents, 0),
      stoppedPlans: own.filter(row => row.status !== 'active' && inWindow(monthOf(row.lastOccurrence))).length,
      stoppedMonthlyCents: own.filter(row => row.status !== 'active' && inWindow(monthOf(row.lastOccurrence))).reduce((sum, row) => sum + row.monthlyCents, 0),
      approximatePlans: own.filter(row => row.approximate).length,
    });
  }

  const byCustomer: SubscriptionCustomerRow[] = [];
  for (const key of [...new Set(rows.map(row => `${row.customerId}\u0000${row.currency}`))].sort(byCodeUnit)) {
    const [customerId, currency] = key.split('\u0000');
    const own = rows.filter(row => row.customerId === customerId && row.currency === currency);
    byCustomer.push({
      customerId,
      customerName: names.get(customerId) || own[0]?.customerName || `Unknown customer (${customerId})`,
      currency,
      plans: own.length,
      activePlans: own.filter(row => row.status === 'active').length,
      monthlyCents: own.filter(row => row.status === 'active').reduce((sum, row) => sum + row.monthlyCents, 0),
    });
  }
  byCustomer.sort((a, b) => b.monthlyCents - a.monthlyCents || a.customerName.localeCompare(b.customerName));

  return { rows, months, byCurrency, byCustomer, undatedStops, window };
}

export const SUBSCRIPTION_PLANS_CSV_HEADERS = [
  'Customer', 'Plan', 'Frequency', 'Status', 'Currency', 'Amount (minor units)', 'Monthly value (minor units)',
  'Annual value (minor units)', 'Monthly value is approximate', 'Started', 'Last occurrence', 'Next occurrence', 'Drafts generated',
];

export function subscriptionPlansCsvRows(report: SubscriptionPlansReport): Array<Array<string | number>> {
  return report.rows.map(row => [
    row.customerName, row.description, row.frequency, row.status, row.currency, row.amountCents,
    row.monthlyCents, row.annualCents, row.approximate ? 'Yes (a month is not a whole number of weeks)' : 'No',
    row.createdAt.slice(0, 10), row.lastOccurrence?.slice(0, 10) || '', row.nextOccurrence?.slice(0, 10) || '', row.generatedCount,
  ]);
}
