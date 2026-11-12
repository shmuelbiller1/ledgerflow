import type { ChartAccount, Invoice, Transaction } from '../types';
import { computeProfitAndLoss } from '../server/reports/computeReports';
import { toBaseCents } from '../server/reports/partyReports';
import { validCustomReportPeriod } from './reportCustomPeriod';
import { daysOverdue } from './aging';
export interface ExpenseChartLeaf { id: string; label: string; cents: number; path: string[] }
export function expenseChartLeaves(accounts: ChartAccount[], transactions: Transaction[], startDate: string, endDate: string): ExpenseChartLeaf[] {
  const report = computeProfitAndLoss(accounts, transactions, startDate, endDate);
  const byId = new Map(accounts.map(account => [account.id, account]));
  return [...Object.entries(report.cogs.accounts), ...Object.entries(report.expense.accounts)].map(([id, figure]) => {
    const account = byId.get(id); const path = [account?.category || 'Uncategorized'];
    const parents: string[] = [], seen = new Set([id]); let parent = account?.parentId;
    while (parent && !seen.has(parent)) { seen.add(parent); const found = byId.get(parent); if (!found) break; parents.unshift(`${found.name} [${found.id}]`); parent = found.parentId; }
    return { id, label: figure.name, cents: figure.balance, path: [...path, ...parents] };
  });
}
export function invoicePaymentPoints(invoices: Invoice[], baseCurrency = 'USD') {
  return invoices.flatMap(invoice => {
    const issued = (invoice.date || '').slice(0, 10), paid = (invoice.paymentDate || invoice.paidAt || '').slice(0, 10);
    if (invoice.status !== 'paid' || !validCustomReportPeriod({ startDate: issued, endDate: paid })) return [];
    return [{ id: invoice.id, label: `${invoice.number || invoice.id} · ${issued} → ${paid}`, days: daysOverdue({ dueDate: issued }, paid), cents: toBaseCents(invoice.amountCents, invoice.exchangeRate, invoice.currency, baseCurrency) }];
  });
}
