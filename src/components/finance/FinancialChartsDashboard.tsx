import React, { useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { monthBrushPeriod } from '../../lib/chartDrillShapes';
import { reportStateToParams } from '../../lib/reportPermalink';
import { validCustomReportPeriod, type CustomReportPeriod } from '../../lib/reportCustomPeriod';
import { computeChartsData } from '../../lib/chartsData';
import { useBalanceEntries } from '../../hooks/useBalanceEntries';
import ChartExploration from '../charts/ChartExploration';
import FinancialChartPanels from '../charts/FinancialChartPanels';
import { useAuthStore } from '../../stores/useAuthStore';
import { TrendingUp, Flame, Clock } from 'lucide-react';
const AccountBalanceChart = React.lazy(() => import('../charts/AccountBalanceChart'));

export default function FinancialChartsDashboard() {
  const uid = useAuthStore(state => state.user?.uid), workspace = useAuthStore(state => state.currentWorkspaceId);
  return <ScopedChartsDashboard key={JSON.stringify([uid, workspace])} />;
}
function ScopedChartsDashboard() {
  const uid = useAuthStore(state => state.user?.uid), workspace = useAuthStore(state => state.currentWorkspaceId);
  const scope = JSON.stringify([uid, workspace]);
  const [selectedPeriod, setSelectedPeriod] = useState<CustomReportPeriod | undefined>(() => {
    const query = new URLSearchParams(window.location.search);
    const period = { startDate: query.get('start') || '', endDate: query.get('end') || '' };
    return (!query.has('chartScope') || query.get('chartScope') === scope) && validCustomReportPeriod(period) ? period : undefined;
  });
  const transactions = useLedgerStore(s => s.transactions);
  const accounts = useLedgerStore(s => s.accounts);
  const partial = useLedgerStore(s => !!s.truncatedCollections.accounts || !!s.truncatedCollections.transactions);
  const [timeRange, setTimeRange] = useState<'6m' | '12m'>('6m');

  // Compute monthly revenue, expenses, burn rate, and profit
  // all amounts in cents of the base currency (src/lib/chartsData.ts, tested; L-155)
  // L-123 step 3d: the cash balances read the server's sums through the oldest loaded day (the months stay the loaded entries)
  const { entries: balanceTx, serverAsOf } = useBalanceEntries(transactions, undefined, workspace || undefined);
  const data = useMemo(() => computeChartsData(transactions, accounts, timeRange === '6m' ? 6 : 12, serverAsOf ? balanceTx : undefined), [transactions, accounts, timeRange, balanceTx, serverAsOf]);
  const currency = useAuthStore(state => state.getCurrentWorkspace()?.currency);
  const months = data.months.map(month => month.month);
  const defaultPeriod = monthBrushPeriod(months, 0, months.length - 1);
  const today = getLocalDateISO();
  const period = selectedPeriod || defaultPeriod || { startDate: `${today.slice(0, 7)}-01`, endDate: today };
  const chosen = data.months.map((month, index) => ({ month: month.month, index })).filter(row => !selectedPeriod || (row.month >= selectedPeriod.startDate.slice(0, 7) && row.month <= selectedPeriod.endDate.slice(0, 7)));
  const selectionRange: [number, number] | undefined = selectedPeriod && chosen.length ? [chosen[0].index, chosen[chosen.length - 1].index] : undefined;
  const choosePeriod = (next: CustomReportPeriod | undefined) => {
    setSelectedPeriod(next);
    const url = new URL(window.location.href);
    if (next) { url.searchParams.set('start', next.startDate); url.searchParams.set('end', next.endDate); url.searchParams.set('chartScope', scope); }
    else { url.searchParams.delete('start'); url.searchParams.delete('end'); url.searchParams.delete('chartScope'); }
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  };
  const onRangeChange = ([start, end]: [number, number]) => { const next = monthBrushPeriod(months, start, end); if (next) choosePeriod(next); };
  const reportParams = reportStateToParams({ report: 'pnl', year: Number(period.endDate.slice(0, 4)), timeframe: 'month', quarter: 0, month: Number(period.endDate.slice(5, 7)) - 1, compare: 'none', ...period });

  return (
    <div className="w-full min-w-0 p-6 md:p-8 space-y-8 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Executive Financial Visualizer</h1>
          <p className="text-xs text-[var(--muted)] font-medium">Real-time burn rate, cash runway, income trends, and category distribution</p>
        </div>

        <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl">
          <button
            onClick={() => { setTimeRange('6m'); choosePeriod(undefined); }}
            className={`min-h-11 px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
              timeRange === '6m' ? 'bg-white text-slate-900 shadow-xs' : 'text-[var(--muted)] hover:text-slate-800'
            }`}
          >
            Last 6 Months
          </button>
          <button
            onClick={() => { setTimeRange('12m'); choosePeriod(undefined); }}
            className={`min-h-11 px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
              timeRange === '12m' ? 'bg-white text-slate-900 shadow-xs' : 'text-[var(--muted)] hover:text-slate-800'
            }`}
          >
            Last 12 Months
          </button>
        </div>
      </div>

      {/* Metric Callouts */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="p-6 bg-white border border-slate-200 rounded-2xl shadow-xs">
          <div className="flex items-center justify-between text-[var(--muted)] mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Cash Runway</span>
            <Clock size={18} className="text-emerald-600" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-900">{data.runwayMonths ?? '—'}</span>
            <span className="text-xs font-semibold text-[var(--muted)]">months remaining</span>
          </div>
          <p className="text-[11px] text-[var(--muted)] mt-2">{data.runwayMonths === null ? 'Needs a cash balance and some spending in the period' : `Based on a cash balance of ${formatCurrency(data.totalCashCents)}`}</p>
        </div>

        <div className="p-6 bg-white border border-slate-200 rounded-2xl shadow-xs">
          <div className="flex items-center justify-between text-[var(--muted)] mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Average Monthly Burn</span>
            <Flame size={18} className="text-rose-600" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-900">{formatCurrency(data.avgBurnCents)}</span>
            <span className="text-xs font-semibold text-[var(--muted)]">/ mo</span>
          </div>
          <p className="text-[11px] text-[var(--muted)] mt-2">Average operating expenses over selected period</p>
        </div>

        <div className="p-6 bg-white border border-slate-200 rounded-2xl shadow-xs">
          <div className="flex items-center justify-between text-[var(--muted)] mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Net Profit Trend</span>
            <TrendingUp size={18} className="text-indigo-600" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-900">
              {formatCurrency(data.months.reduce((sum, m) => sum + m.profitCents, 0))}
            </span>
            <span className="text-xs font-semibold text-emerald-600">net total</span>
          </div>
          <p className="text-[11px] text-[var(--muted)] mt-2">Cumulative net margin for period</p>
        </div>
      </div>

      <div className="space-y-2">
        <p role="status">{period ? `Report period: ${period.startDate} to ${period.endDate}` : 'No plotted months available for a report period.'}</p>
        <p className="text-sm">Time plots show loaded whole-month buckets; the report link and account chart use exact selected dates.</p>
        {partial && <p role="alert">Loaded ledger history is incomplete. Time plots and summary figures are provisional; the signed-in account chart reads its balances separately from the server.</p>}
        {serverAsOf && <p data-testid="charts-balances-source" className="text-xs text-[var(--muted)]">Cash and runway include every entry through {serverAsOf} as summed by the server, plus the loaded entries after it; the monthly figures read the loaded entries.</p>}
        <p className="text-sm">{!months.length && 'No time-series months are available to brush. '}The brush sets the report period and both time-series windows. Summary cards, cash allocation and expense mix retain their existing {timeRange === '6m' ? 'six' : 'twelve'}-month / loaded-history calculation scopes.</p>
        {period && <a className="inline-flex min-h-11 items-center underline" href={`?${reportParams}#reports`}>Open P&amp;L for selected period</a>}
        {selectedPeriod && <button type="button" className="min-h-11 px-3 border rounded ml-2" onClick={() => choosePeriod(undefined)}>Reset report period</button>}
      </div>
      <FinancialChartPanels key={timeRange} data={data} currency={currency} selectionRange={selectionRange} onRangeChange={onRangeChange} onRangeReset={() => choosePeriod(undefined)} emptyPeriod={!!selectedPeriod && !chosen.length} />
      {period && <React.Suspense fallback={<p role="status">Loading account balance chart…</p>}><AccountBalanceChart endDate={period.endDate} currency={currency} /></React.Suspense>}
      <ChartExploration months={chosen.map(row => row.month)} currency={currency} />
    </div>
  );
}
