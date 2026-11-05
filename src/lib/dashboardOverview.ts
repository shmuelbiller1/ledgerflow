import type { ChartAccount, Transaction, Invoice, Bill } from '../types';
import { computeBalanceSheet, computeProfitAndLoss } from '../server/reports/computeReports';
import { resolveAccountRole } from './accountUtils';
import { computePartyAging } from './aging';
import { getFiscalYearBounds, getFiscalQuarter, getReportPeriod, getComparePeriod, addDaysYMD } from './fiscalCalendar';
import { addToDateISO } from './calendarDate';
import { validCustomReportPeriod } from './reportCustomPeriod';

export type DashboardRange = 'month' | 'quarter' | 'year' | 'custom';
export interface DashboardPeriod { startDate: string; endDate: string }
export function validDashboardPeriod(period: DashboardPeriod): boolean {
  return validCustomReportPeriod(period);
}
export function dashboardPeriod(range: Exclude<DashboardRange, 'custom'>, today: string, fiscalStart = 1): DashboardPeriod {
  const year = getFiscalYearBounds(today, fiscalStart).fiscalYear;
  return getReportPeriod(range, year, getFiscalQuarter(today, fiscalStart).quarter - 1, Number(today.slice(5, 7)) - 1, fiscalStart);
}
export function dashboardFigures(accounts: ChartAccount[], transactions: Transaction[], period: DashboardPeriod) {
  const pl = computeProfitAndLoss(accounts, transactions, period.startDate, period.endDate);
  const bs = computeBalanceSheet(accounts, transactions, period.endDate);
  const cashAccounts = accounts.filter(account => resolveAccountRole(account) === 'cash');
  const banks = cashAccounts.map(account => ({ id: account.id, name: account.name, cents: bs.assets[account.id] ?? 0 }));
  return { networth: bs.totalAssets - bs.totalLiabilities, revenue: pl.income.total, expenses: pl.cogs.total + pl.expense.total, profit: pl.netIncome, cash: banks.reduce((sum, bank) => sum + bank.cents, 0), banks, summary: [{ label: 'Assets', cents: bs.totalAssets, scope: 'As of date' }, { label: 'Liabilities', cents: bs.totalLiabilities, scope: 'As of date' }, { label: 'Equity accounts', cents: bs.totalEquity, scope: 'As of date' }, { label: 'Income', cents: pl.income.total, scope: 'Period activity' }, { label: 'Costs and expenses', cents: pl.cogs.total + pl.expense.total, scope: 'Period activity' }], balanced: bs.isBalanced, orphanCount: bs.orphanedLines.length };
}
export function dashboardComparison(accounts: ChartAccount[], transactions: Transaction[], period: DashboardPeriod) {
  const previousPeriod = getComparePeriod(period.startDate, period.endDate, 'previous')!;
  const endMonth = `${period.endDate.slice(0, 7)}-01`;
  const months = Array.from({ length: 12 }, (_, i) => {
    const startDate = addToDateISO(endMonth, { months: i - 11 });
    const endDate = i === 11 ? period.endDate : addDaysYMD(addToDateISO(startDate, { months: 1 }), -1);
    return { label: startDate.slice(0, 7), ...dashboardFigures(accounts, transactions, { startDate, endDate }) };
  });
  return { current: dashboardFigures(accounts, transactions, period), previous: dashboardFigures(accounts, transactions, previousPeriod), previousPeriod, months };
}
type Figures = ReturnType<typeof dashboardFigures>;
/**
 * L-123 step 3b: the dashboard with the server's balances folded in (src/lib/serverBalances.ts foldServerOpening).
 * Figures as of a date (net worth, cash, banks, assets/liabilities/equity) come from `server`; period figures
 * (revenue, expenses, profit) too when the period starts after the server's day, else from the loaded entries.
 */
export function withServerBalances(loaded: ReturnType<typeof dashboardComparison>, server: ReturnType<typeof dashboardComparison>, period: DashboardPeriod, asOf: string): ReturnType<typeof dashboardComparison> {
  const pick = (l: Figures, s: Figures, startDate: string): Figures => {
    const period = startDate > asOf ? s : l;
    return { ...s, revenue: period.revenue, expenses: period.expenses, profit: period.profit, summary: s.summary.map((row, i) => row.scope === 'Period activity' ? period.summary[i] : row) };
  };
  return {
    ...server,
    current: pick(loaded.current, server.current, period.startDate),
    previous: pick(loaded.previous, server.previous, server.previousPeriod.startDate),
    months: server.months.map((m, i) => ({ ...m, ...pick(loaded.months[i], m, `${m.label}-01`) })),
  };
}
/** Current unpaid amounts aged at the selected date, not historical payment reconstruction. */
export function dashboardAging(parties: Array<{ id: string; name: string }>, documents: Array<Invoice | Bill>, side: 'customer' | 'vendor', endDate: string) {
  const included = documents.filter(doc => !doc.date || doc.date.slice(0, 10) <= endDate);
  const names = new Map(parties.map(party => [party.id, party]));
  for (const doc of included) {
    const id = (side === 'customer' ? (doc as Invoice).customerId : (doc as Bill).vendorId) || '';
    if (!names.has(id)) names.set(id, { id, name: id || 'Unknown party' });
  }
  const rows = computePartyAging([...names.values()], included, side, endDate);
  const top = rows.map(row => ({ ...row, overdue: row.total - row.buckets.current })).filter(row => row.overdue > 0).sort((a, b) => b.overdue - a.overdue || a.partyId.localeCompare(b.partyId)).slice(0, 5);
  return { rows, top };
}

export const DASHBOARD_WIDGETS = ['networth', 'revenue', 'expenses', 'profit', 'cash', 'receivables', 'payables', 'banks', 'feeds', 'recent', 'integrity', 'summary', 'scenario'] as const;
export type DashboardWidget = typeof DASHBOARD_WIDGETS[number];
export interface DashboardLayout { order: DashboardWidget[]; hidden: DashboardWidget[] }
export function dashboardLayout(value?: unknown): DashboardLayout {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const allowed = (items: unknown): DashboardWidget[] => Array.isArray(items) ? [...new Set(items.slice(0, 100).filter((item): item is DashboardWidget => typeof item === 'string' && DASHBOARD_WIDGETS.includes(item as DashboardWidget)))] : [];
  const order = allowed(record.order);
  return { order: [...order, ...DASHBOARD_WIDGETS.filter(id => !order.includes(id))], hidden: allowed(record.hidden) };
}
/** BC-02: the roles an owner can give a starting layout. */
export const DASHBOARD_ROLES = ['owner', 'accountant', 'bookkeeper', 'viewer'] as const;
export type DashboardRole = typeof DASHBOARD_ROLES[number];
export type RoleDashboards = Partial<Record<DashboardRole, DashboardLayout>>;
/** What an owner sends for one role's starting layout (null takes it away); null when it is fine. */
export function roleDashboardProblem(role: unknown, layout: unknown): string | null {
  if (!DASHBOARD_ROLES.includes(role as DashboardRole)) return 'Choose one of the roles';
  if (layout === null) return null;
  const record = layout && typeof layout === 'object' ? layout as Record<string, unknown> : null;
  if (!record || !Array.isArray(record.order) || !Array.isArray(record.hidden)) return 'The layout needs the widgets in order and the hidden ones';
  const known = (items: unknown[]) => items.length <= DASHBOARD_WIDGETS.length && items.every(item => DASHBOARD_WIDGETS.includes(item as DashboardWidget));
  return known(record.order) && known(record.hidden) ? null : 'The layout names a widget that does not exist';
}
/** BC-02: the person's own arrangement when they made one, else their role's starting layout, else the default. */
export function startingLayout(own: unknown, roleLayouts: unknown, role: string | null | undefined): DashboardLayout {
  if (own) return dashboardLayout(own);
  const forRole = roleLayouts && typeof roleLayouts === 'object' ? (roleLayouts as Record<string, unknown>)[String(role)] : undefined;
  return dashboardLayout(forRole);
}
export function dashboardReportHref(report: string, startDate: string, endDate: string, fiscalStart: number): string {
  const query = new URLSearchParams({ report, start: startDate, end: endDate, y: String(getFiscalYearBounds(endDate, fiscalStart).fiscalYear), t: 'month', m: String(Number(endDate.slice(5, 7))) });
  return `?${query.toString()}#reports`;
}
