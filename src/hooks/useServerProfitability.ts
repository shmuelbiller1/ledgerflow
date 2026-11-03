import { useMemo } from 'react';
import { useLedgerStore } from '../stores/useLedgerStore';
import { profitabilityLines, type ProfitabilityBy, type ProfitabilityLine } from '../lib/profitabilityLines';
import { useServerRangeReport, type RangeReportSource } from './useServerRangeReport';

const parseLines = (body: Record<string, unknown>) => (Array.isArray(body.lines) ? body.lines as ProfitabilityLine[] : null);

/**
 * L-123 step 4i: profitability by customer, item or project over `from`…`to` (src/lib/profitabilityLines.ts). When the
 * loaded entries are capped and the range reaches the oldest loaded day, or the loaded invoices, items, accounts,
 * customers or projects are capped, invoices or their cost of goods sold may be missing, so the lines come from the
 * server (GET /api/v1/balances/profitability). A change to any loaded input asks again. No dates (all time) stays on
 * the loaded lists, as the server reads at most three years.
 */
export function useServerProfitability(by: ProfitabilityBy, from: string | undefined, to: string | undefined): { lines: ProfitabilityLine[]; source: RangeReportSource } {
  const customers = useLedgerStore(s => s.customers);
  const invoices = useLedgerStore(s => s.invoices);
  const items = useLedgerStore(s => s.inventory);
  const transactions = useLedgerStore(s => s.transactions);
  const accounts = useLedgerStore(s => s.accounts);
  const projects = useLedgerStore(s => s.projects);
  const listsCapped = useLedgerStore(s => Boolean(['invoices', 'inventory', 'chartAccounts', 'customers', 'projects'].some(k => s.truncatedCollections?.[k])));
  const loaded = useMemo(() => profitabilityLines(by, {
    customers: customers || [], invoices: invoices || [], items: items || [], transactions: transactions || [],
    accounts: accounts || [], projects: projects || [], startDate: from, endDate: to,
  }), [by, customers, invoices, items, transactions, accounts, projects, from, to]);
  // invoices of the range and the small, fully loaded lists (names, unit costs, account classes, budgets) are all inputs
  const extraKey = useMemo(() => JSON.stringify([(invoices || []).filter(i => !from || (i.date || '') >= from), items, accounts, customers, projects]),
    [invoices, items, accounts, customers, projects, from]);
  const query = useMemo(() => ({ by }), [by]);
  const { report, source } = useServerRangeReport({ path: 'profitability', from, to, query, extraKey, alsoIncomplete: listsCapped, parse: parseLines, loaded });
  return { lines: report, source };
}
