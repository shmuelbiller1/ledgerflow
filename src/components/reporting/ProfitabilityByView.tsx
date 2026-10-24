import React, { useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { customerGrossProfit } from '../../lib/customerGrossProfit';
import { computeProjectProfitability } from '../../lib/projectProfitability';
import { computeSalesByItem, yearRange } from '../../server/reports/itemReports';
import { formatCurrency } from '../../lib/utils';
import { csvMoney, downloadCsv } from '../../lib/csvExport';

type By = 'customer' | 'item' | 'project';
interface Line {
  label: string;
  revenueCents: number;
  costCents: number;
  marginCents: number;
  marginPct: number | null;
  estimate: boolean;
  budgetCents?: number | null;
  budgetRemainingCents?: number | null;
  budgetUsedPct?: number | null;
}

const field = 'px-2 py-1.5 border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]';

/**
 * Profitability (A-13, A-178, CB-08): revenue, cost, gross margin and margin % by customer, by item
 * or by project, for the period — plus allocated project cost budget vs actual cost, remaining
 * variance and usage % when grouped by Project (src/lib/projectProfitability.ts). Read-only, whole cents.
 */
export const ProfitabilityByView: React.FC<{ selectedYear?: number }> = ({ selectedYear }) => {
  const { loading } = useLedgerCollections('customers', 'invoices', 'inventory', 'transactions', 'accounts', 'projects');
  const customers = useLedgerStore(s => s.customers);
  const invoices = useLedgerStore(s => s.invoices);
  const inventory = useLedgerStore(s => s.inventory);
  const transactions = useLedgerStore(s => s.transactions);
  const accounts = useLedgerStore(s => s.accounts);
  const projects = useLedgerStore(s => s.projects);
  const [by, setBy] = useState<By>('customer');
  const initial = yearRange(selectedYear ?? new Date().getFullYear());
  const [startDate, setStartDate] = useState(initial.startDate || '');
  const [endDate, setEndDate] = useState(initial.endDate || '');
  const validPeriod = !startDate || !endDate || startDate <= endDate;

  const lines: Line[] = useMemo(() => {
    if (loading || !validPeriod) return [];
    const range = { startDate: startDate || undefined, endDate: endDate || undefined };
    if (by === 'customer') {
      return customerGrossProfit({ customers: customers || [], invoices: invoices || [], items: inventory || [], transactions: transactions || [], accounts: accounts || [], ...range })
        .map(r => ({ label: r.name, revenueCents: r.salesCents, costCents: r.costCents, marginCents: r.marginCents, marginPct: r.marginPct, estimate: r.costIsEstimate }));
    }
    if (by === 'item') {
      return computeSalesByItem({ invoices: invoices || [], items: inventory || [], transactions: transactions || [], accounts: accounts || [], ...range }).rows
        .map(r => ({ label: r.name, revenueCents: r.salesCents, costCents: r.costCents, marginCents: r.marginCents, marginPct: r.marginPct, estimate: r.costIsEstimate }));
    }
    return computeProjectProfitability({
      invoices: invoices || [], transactions: transactions || [], accounts: accounts || [],
      items: inventory || [], projects: projects || [], ...range,
    }).map(r => ({
      label: r.project,
      revenueCents: r.revenueCents,
      costCents: r.costCents,
      marginCents: r.marginCents,
      marginPct: r.marginPct,
      estimate: r.costIsEstimate,
      budgetCents: r.budgetCents,
      budgetRemainingCents: r.budgetRemainingCents,
      budgetUsedPct: r.budgetUsedPct,
    }));
  }, [by, loading, validPeriod, startDate, endDate, customers, invoices, inventory, transactions, accounts, projects]);

  const total = useMemo(() => {
    const revenue = lines.reduce((s, l) => s + l.revenueCents, 0);
    const cost = lines.reduce((s, l) => s + l.costCents, 0);
    const margin = revenue - cost;
    const budgetedLines = lines.filter(l => typeof l.budgetCents === 'number' && l.budgetCents > 0);
    const budget = budgetedLines.reduce((s, l) => s + (l.budgetCents || 0), 0);
    const budgetedActualCost = budgetedLines.reduce((s, l) => s + l.costCents, 0);
    return {
      revenue,
      cost,
      margin,
      pct: revenue === 0 ? null : Math.round((margin / revenue) * 10000) / 100,
      hasBudget: budgetedLines.length > 0,
      budget,
      budgetRemaining: budget - budgetedActualCost,
      budgetUsedPct: budget > 0 ? Math.round((budgetedActualCost / budget) * 10000) / 100 : null,
    };
  }, [lines]);

  const exportCsv = () => {
    const headers = by === 'project'
      ? ['Project', 'Revenue', 'Cost', 'Cost budget', 'Budget left / (over)', 'Budget used %', 'Margin', 'Margin %', 'Cost is an estimate']
      : [by === 'customer' ? 'Customer' : 'Item', 'Revenue', 'Cost', 'Margin', 'Margin %', 'Cost is an estimate'];
    downloadCsv(`profitability_by_${by}_${startDate || 'all'}_${endDate || 'all'}.csv`,
      headers,
      lines.map(l => by === 'project'
        ? [
            l.label,
            csvMoney(l.revenueCents),
            csvMoney(l.costCents),
            l.budgetCents == null ? '' : csvMoney(l.budgetCents),
            l.budgetRemainingCents == null ? '' : csvMoney(l.budgetRemainingCents),
            l.budgetUsedPct ?? '',
            csvMoney(l.marginCents),
            l.marginPct ?? '',
            l.estimate ? 'yes' : 'no',
          ]
        : [l.label, csvMoney(l.revenueCents), csvMoney(l.costCents), csvMoney(l.marginCents), l.marginPct ?? '', l.estimate ? 'yes' : 'no']));
  };

  return (
    <section aria-labelledby="profitability-by-title" className="space-y-4">
      <div className="flex items-center gap-2">
        <BarChart3 aria-hidden="true" size={20} className="text-[var(--muted)]" />
        <h2 id="profitability-by-title" className="text-lg font-bold text-[var(--text)]">Profitability</h2>
      </div>
      <div className="flex flex-wrap gap-4 items-end">
        <label className="flex flex-col gap-1 text-sm text-[var(--muted)] w-fit">By
          <select value={by} onChange={e => setBy(e.target.value as By)} className={field}>
            <option value="customer">Customer</option>
            <option value="item">Item</option>
            <option value="project">Project</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-[var(--muted)] w-fit">From<input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={field} /></label>
        <label className="flex flex-col gap-1 text-sm text-[var(--muted)] w-fit">To<input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={field} /></label>
        <button type="button" onClick={exportCsv} disabled={lines.length === 0} className="min-h-[44px] px-4 py-2 rounded border border-[var(--line)] text-sm text-[var(--text)] disabled:opacity-50">Export CSV</button>
      </div>
      <p className="text-xs text-[var(--muted)]">
        Revenue is the issued invoice lines in the period, in the base currency. Cost is the cost of goods sold posted for each line (or quantity × unit cost while none is posted; marked as an estimate){by === 'project' ? ', plus the expense lines carrying the project label, set against each project\'s allocated cost budget when one is configured' : ''}. Margin % = margin ÷ revenue.
      </p>
      {!validPeriod && <p role="alert" className="text-sm text-rose-600">The start date is after the end date.</p>}
      {loading && <p className="text-sm text-[var(--muted)]">Loading…</p>}
      {!loading && validPeriod && lines.length === 0 && <p className="text-sm text-[var(--muted)]">Nothing sold or spent in this period.</p>}
      {lines.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
          <table className="w-full text-sm">
            <caption className="sr-only">Profitability by {by}</caption>
            <thead>
              <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                <th scope="col" className="text-left font-semibold py-1 px-2">{by === 'customer' ? 'Customer' : by === 'item' ? 'Item' : 'Project'}</th>
                <th scope="col" className="text-right font-semibold py-1 px-2">Revenue</th>
                <th scope="col" className="text-right font-semibold py-1 px-2">Cost</th>
                {by === 'project' && (
                  <>
                    <th scope="col" className="text-right font-semibold py-1 px-2">Cost budget</th>
                    <th scope="col" className="text-right font-semibold py-1 px-2">Budget left</th>
                    <th scope="col" className="text-right font-semibold py-1 px-2">Used %</th>
                  </>
                )}
                <th scope="col" className="text-right font-semibold py-1 px-2">Margin</th>
                <th scope="col" className="text-right font-semibold py-1 px-2">Margin %</th>
              </tr>
            </thead>
            <tbody>
              {lines.map(l => (
                <tr key={l.label} className="border-b border-[var(--line)]/50">
                  <th scope="row" className="text-left font-normal py-1 px-2"><bdi>{l.label}</bdi>{l.estimate && <span className="text-xs text-[var(--muted)]"> (cost estimated)</span>}</th>
                  <td className="text-right font-mono py-1 px-2">{formatCurrency(l.revenueCents)}</td>
                  <td className="text-right font-mono py-1 px-2">{formatCurrency(l.costCents)}</td>
                  {by === 'project' && (
                    <>
                      <td className="text-right font-mono py-1 px-2">{l.budgetCents == null ? '—' : formatCurrency(l.budgetCents)}</td>
                      <td className={`text-right font-mono py-1 px-2 ${typeof l.budgetRemainingCents === 'number' && l.budgetRemainingCents < 0 ? 'text-rose-600' : ''}`}>
                        {l.budgetRemainingCents == null ? '—' : formatCurrency(l.budgetRemainingCents)}
                      </td>
                      <td className="text-right font-mono py-1 px-2">{l.budgetUsedPct == null ? '—' : `${l.budgetUsedPct}%`}</td>
                    </>
                  )}
                  <td className="text-right font-mono py-1 px-2">{formatCurrency(l.marginCents)}</td>
                  <td className="text-right font-mono py-1 px-2">{l.marginPct === null ? '—' : `${l.marginPct}%`}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <th scope="row" className="text-left py-1 px-2">Total</th>
                <td className="text-right font-mono py-1 px-2">{formatCurrency(total.revenue)}</td>
                <td className="text-right font-mono py-1 px-2">{formatCurrency(total.cost)}</td>
                {by === 'project' && (
                  <>
                    <td className="text-right font-mono py-1 px-2">{total.hasBudget ? formatCurrency(total.budget) : '—'}</td>
                    <td className={`text-right font-mono py-1 px-2 ${total.hasBudget && total.budgetRemaining < 0 ? 'text-rose-600' : ''}`}>
                      {total.hasBudget ? formatCurrency(total.budgetRemaining) : '—'}
                    </td>
                    <td className="text-right font-mono py-1 px-2">{total.budgetUsedPct == null ? '—' : `${total.budgetUsedPct}%`}</td>
                  </>
                )}
                <td className="text-right font-mono py-1 px-2">{formatCurrency(total.margin)}</td>
                <td className="text-right font-mono py-1 px-2">{total.pct === null ? '—' : `${total.pct}%`}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
};

export default ProfitabilityByView;
