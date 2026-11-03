import { useMemo } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useLedgerCollections } from './useLedgerCollections';
import { customerGrossProfit } from '../lib/customerGrossProfit';
import { grossMarginByItemGroup, monthsBetween } from '../lib/grossMarginByGroup';
import { profitabilityLines, type ProfitabilityBy, type ProfitabilityInput, type ProfitabilityLine } from '../lib/profitabilityLines';
import { useServerRangeReport, type RangeReportSource } from './useServerRangeReport';

/**
 * The loaded inputs of the invoice-based reports (profitability, customer gross profit), the workspace's own records
 * only, whether any of their lists is capped, and a request key that changes with any of them: the invoices of the
 * range and the small, fully loaded lists (names, unit costs, account classes, budgets) are all report inputs.
 */
function useInvoiceReportInputs(from: string | undefined) {
  useLedgerCollections('customers', 'inventory', 'invoices');
  const workspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  const customers = useLedgerStore(s => s.customers);
  const invoices = useLedgerStore(s => s.invoices);
  const items = useLedgerStore(s => s.inventory);
  const transactions = useLedgerStore(s => s.transactions);
  const accounts = useLedgerStore(s => s.accounts);
  const projects = useLedgerStore(s => s.projects);
  const listsCapped = useLedgerStore(s => Boolean(['invoices', 'inventory', 'chartAccounts', 'customers', 'projects'].some(k => s.truncatedCollections?.[k])));
  const input = useMemo(() => {
    const own = <T extends { workspaceId?: string }>(rows: T[] | undefined) => (rows || []).filter(r => !workspaceId || !r.workspaceId || r.workspaceId === workspaceId);
    return { customers: own(customers), invoices: own(invoices), items: own(items), transactions: own(transactions), accounts: own(accounts), projects: own(projects) };
  }, [workspaceId, customers, invoices, items, transactions, accounts, projects]);
  const extraKey = useMemo(() => JSON.stringify([input.invoices.filter(i => !from || (i.date || '') >= from), input.items, input.accounts, input.customers, input.projects]),
    [input, from]);
  return { input: input as Omit<ProfitabilityInput, 'startDate' | 'endDate'>, listsCapped, extraKey };
}

const parseLines = (body: Record<string, unknown>) => (Array.isArray(body.lines) ? body.lines as ProfitabilityLine[] : null);

/**
 * L-123 step 4i: profitability by customer, item or project over `from`…`to` (src/lib/profitabilityLines.ts). When the
 * loaded entries are capped and the range reaches the oldest loaded day, or the loaded invoices, items, accounts,
 * customers or projects are capped, invoices or their cost of goods sold may be missing, so the lines come from the
 * server (GET /api/v1/balances/profitability). A change to any loaded input asks again. No dates (all time) stays on
 * the loaded lists, as the server reads at most three years.
 */
export function useServerProfitability(by: ProfitabilityBy, from: string | undefined, to: string | undefined): { lines: ProfitabilityLine[]; source: RangeReportSource } {
  const { input, listsCapped, extraKey } = useInvoiceReportInputs(from);
  const loaded = useMemo(() => profitabilityLines(by, { ...input, startDate: from, endDate: to }), [by, input, from, to]);
  const query = useMemo(() => ({ by }), [by]);
  const { report, source } = useServerRangeReport({ path: 'profitability', from, to, query, extraKey, alsoIncomplete: listsCapped, parse: parseLines, loaded });
  return { lines: report, source };
}

export type CustomerGrossProfitRow = ReturnType<typeof customerGrossProfit>[number];
const parseRows = (body: Record<string, unknown>) => (Array.isArray(body.rows) ? body.rows as CustomerGrossProfitRow[] : null);

/**
 * L-123 step 4j: gross profit by customer over `from`…`to` (customerGrossProfit, rows keyed by customer id so a
 * comparison period can be matched), from the server (GET /api/v1/balances/customer-gross-profit) on the same terms
 * as profitability. `enabled` false (an invalid period, loading) keeps the loaded rows and asks nothing.
 */
export function useServerCustomerGrossProfit(from: string, to: string, enabled: boolean): { rows: CustomerGrossProfitRow[]; source: RangeReportSource } {
  const { input, listsCapped, extraKey } = useInvoiceReportInputs(from);
  const loaded = useMemo(() => (enabled ? customerGrossProfit({ ...input, startDate: from, endDate: to }) : []), [enabled, input, from, to]);
  const { report, source } = useServerRangeReport({
    path: 'customer-gross-profit', from: enabled ? from : undefined, to: enabled ? to : undefined, extraKey, alsoIncomplete: listsCapped, parse: parseRows, loaded,
  });
  return { rows: report, source };
}

export type ItemGroupMargin = ReturnType<typeof grossMarginByItemGroup>;
const parseGroups = (body: Record<string, unknown>) => (Array.isArray(body.rows) && Array.isArray(body.months) && Array.isArray(body.totals) ? body as unknown as ItemGroupMargin : null);

/**
 * L-123 step 4k: gross margin by item group for each month of `year` (grossMarginByItemGroup), from the server
 * (GET /api/v1/balances/item-group-margin) on the same terms as profitability.
 */
export function useServerItemGroupMargin(year: number): { report: ItemGroupMargin; source: RangeReportSource } {
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const { input, listsCapped, extraKey } = useInvoiceReportInputs(from);
  const loaded = useMemo(() => grossMarginByItemGroup({ ...input, months: monthsBetween(`${year}-01`, `${year}-12`) }), [input, year]);
  return useServerRangeReport({ path: 'item-group-margin', from, to, extraKey, alsoIncomplete: listsCapped, parse: parseGroups, loaded });
}
