import { useMemo } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { useLedgerCollections } from './useLedgerCollections';
import { expenseChartLeaves, invoicePaymentPoints, type ExpenseChartLeaf } from '../lib/chartExploration';
import { monthBoundsISO } from '../lib/calendarDate';
import { useServerRangeReport, type RangeReportSource } from './useServerRangeReport';

export interface ChartExplorationData { leaves: ExpenseChartLeaf[]; points: ReturnType<typeof invoicePaymentPoints> }
const parseData = (body: Record<string, unknown>) => (Array.isArray(body.leaves) && Array.isArray(body.points) ? body as unknown as ChartExplorationData : null);

/**
 * L-123 step 4p: the dashboard's chart exploration for the selected (consecutive) months — expense leaves
 * (expenseChartLeaves) and invoice payment points (invoicePaymentPoints). When the loaded entries are capped and the
 * months reach the oldest loaded day, or the accounts or invoices are capped or failed to load, the data comes from the
 * server (GET /api/v1/balances/chart-exploration). A change to the accounts or the months' invoices asks again.
 */
export function useServerChartExploration(months: string[], enabled: boolean): { data: ChartExplorationData; source: RangeReportSource } {
  useLedgerCollections('invoices');
  const workspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  const accounts = useLedgerStore(s => s.accounts);
  const transactions = useLedgerStore(s => s.transactions);
  const invoices = useLedgerStore(s => s.invoices);
  const capped = useLedgerStore(s => Boolean(s.truncatedCollections?.chartAccounts || s.truncatedCollections?.invoices));
  const failed = useDataNeedsStore(s => Boolean(s.failed.accounts || s.failed.transactions || s.failed.invoices));
  const from = enabled && months.length ? `${months[0]}-01` : undefined;
  const to = enabled && months.length ? monthBoundsISO(`${months[months.length - 1]}-01`).end : undefined;
  const monthInvoices = useMemo(() => (invoices || []).filter(i => (!workspaceId || i.workspaceId === workspaceId) && months.includes((i.date || '').slice(0, 7))), [invoices, workspaceId, months]);
  const loaded = useMemo<ChartExplorationData>(() => ({
    leaves: from && to ? expenseChartLeaves(accounts, (transactions || []).filter(tx => months.includes((tx.date || '').slice(0, 7))), from, to) : [],
    points: invoicePaymentPoints(monthInvoices),
  }), [accounts, transactions, months, from, to, monthInvoices]);
  const extraKey = useMemo(() => JSON.stringify([accounts, monthInvoices]), [accounts, monthInvoices]);
  const { report, source } = useServerRangeReport({ path: 'chart-exploration', from, to, extraKey, alsoIncomplete: capped || failed, parse: parseData, loaded });
  return { data: report, source };
}
