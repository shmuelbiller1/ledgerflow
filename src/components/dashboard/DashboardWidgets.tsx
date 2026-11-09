import React, { useMemo, useState } from 'react';
import { collection, getDocs, limit, orderBy, query, where } from '../../lib/db/firestore';
import { db } from '../../firebase';
import { LEDGER_COLLECTIONS } from '../../lib/ledgerCollections';
import type { LedgerKey, LedgerCollectionSpec } from '../../lib/ledgerCollections';
import type { ChartAccount, Transaction, Invoice, Bill, Customer, Vendor } from '../../types';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { foldServerOpening, openingCutoff, periodBeforeOpening } from '../../lib/serverBalances';
import { useAuthStore } from '../../stores/useAuthStore';
import { useUIStore } from '../../stores/useUIStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { dashboardReportHref, dashboardComparison, withServerBalances, dashboardPeriod, dashboardAging, validDashboardPeriod, startingLayout, DASHBOARD_ROLES, DASHBOARD_WIDGETS } from '../../lib/dashboardOverview';
import type { DashboardRange, DashboardRole, DashboardWidget, DashboardLayout } from '../../lib/dashboardOverview';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { getIdToken } from '../../firebase';
import { AGING_BUCKETS, partyStats } from '../../lib/aging';
import { reportVariance, reportPercent } from '../../lib/reportColumns';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { isPostable, isTransactionInDateRange } from '../../lib/txFilters';
import { useScenarioStore } from '../../lib/scenarioStore';
import BankFeedHealth from './BankFeedHealth';
import DashboardTrendChart from './DashboardTrendChart';

const LABELS: Record<DashboardWidget, string> = { revenue: 'Revenue', expenses: 'Expenses', profit: 'Net income', networth: 'Net worth', scenario: 'Scenario preview', summary: 'Account summary', cash: 'Cash balance', receivables: 'Receivables', payables: 'Payables', banks: 'Bank and cash accounts', feeds: 'Bank feed health', recent: 'Recent transactions', integrity: 'Books balance' };
const KPIS = ['networth', 'revenue', 'expenses', 'profit', 'cash'] as const;
/** Each refresh reads only the collections feeding its own widget; no global cache is overwritten. */
const WIDGET_SOURCES: Record<DashboardWidget, readonly LedgerKey[]> = {
  revenue: ['accounts', 'transactions'], expenses: ['accounts', 'transactions'], profit: ['accounts', 'transactions'],
  networth: ['accounts', 'transactions'], cash: ['accounts', 'transactions'],
  banks: ['accounts', 'transactions'], summary: ['accounts', 'transactions'], recent: ['transactions'],
  integrity: ['accounts', 'transactions'], receivables: ['customers', 'invoices'],
  payables: ['vendors', 'bills'], scenario: ['scenarios'], feeds: [],
};
interface WidgetSnapshot {
  accounts?: ChartAccount[]; transactions?: Transaction[]; invoices?: Invoice[];
  bills?: Bill[]; customers?: Customer[]; vendors?: Vendor[];
  scenarios?: ReturnType<typeof useScenarioStore.getState>['scenarios'];
}
interface WidgetRefreshState { workspaceId: string; at: number; values: WidgetSnapshot; truncated: string[] }

/** The person's own arrangement in this browser, or null (BC-02: then their role's starting layout). */
function readOwn(key: string): unknown { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } }
export default function DashboardWidgets({ children }: { children?: React.ReactNode }) {
  const uid = useAuthStore(state => state.user?.uid), workspaceId = useAuthStore(state => state.currentWorkspaceId);
  return <ScopedDashboardWidgets key={`${uid || 'guest'}:${workspaceId}`}>{children}</ScopedDashboardWidgets>;
}
function ScopedDashboardWidgets({ children }: { children?: React.ReactNode }) {
  const uid = useAuthStore(state => state.user?.uid), workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  const isGuest = useAuthStore(state => state.isGuest && !state.user);
  const accounts = useLedgerStore(state => state.accounts), transactions = useLedgerStore(state => state.transactions);
  const invoices = useLedgerStore(state => state.invoices), bills = useLedgerStore(state => state.bills);
  const customers = useLedgerStore(state => state.customers), vendors = useLedgerStore(state => state.vendors);
  const truncated = useLedgerStore(state => state.truncatedCollections), failed = useDataNeedsStore(state => state.failed);
  const loaded = useDataNeedsStore(state => state.loaded);
  const { loading } = useLedgerCollections('transactions', 'accounts', 'invoices', 'bills', 'customers', 'vendors');
  const scenarios = useScenarioStore(state => state.scenarios), activeScenarioId = useScenarioStore(state => state.activeScenarioId);
  const { loading: scenarioLoading } = useLedgerCollections('scenarios');
  const fiscalStart = workspace?.fiscalYearStartMonth || 1, currency = workspace?.currency;
  const today = getLocalDateISO();
  const [range, setRange] = useState<DashboardRange>('month');
  const [custom, setCustom] = useState(() => dashboardPeriod('month', today, fiscalStart));
  const period = useMemo(() => range === 'custom' ? custom : dashboardPeriod(range, today, fiscalStart), [range, custom, today, fiscalStart]);
  const valid = validDashboardPeriod(period);
  const preferenceKey = `lf_dashboard_layout_v1:${uid || 'guest'}:${workspaceId || 'none'}`;
  const role = useCurrentRole();
  const [layout, setLayout] = useState(() => startingLayout(readOwn(preferenceKey), workspace?.roleDashboards, role));
  const [storageError, setStorageError] = useState(false);
  const [widgetSnapshots, setWidgetSnapshots] = useState<Partial<Record<DashboardWidget, WidgetRefreshState>>>({});
  const [refreshErrors, setRefreshErrors] = useState<Partial<Record<DashboardWidget, { workspaceId: string; message: string }>>>({});
  const [refreshing, setRefreshing] = useState<DashboardWidget | null>(null);
  const refreshWidget = async (id: DashboardWidget) => {
    if (isGuest || !workspaceId || refreshing !== null) return;
    setRefreshing(id);
    setRefreshErrors(state => ({ ...state, [id]: undefined }));
    try {
      const values: WidgetSnapshot = {}, truncated: string[] = [];
      // These are workspace-scoped client reads with the existing RLS enforcement.
      for (const key of WIDGET_SOURCES[id]) {
        const spec: LedgerCollectionSpec = LEDGER_COLLECTIONS[key];
        const clauses = [where('workspaceId', '==', workspaceId)];
        if (spec.newestFirstBy) clauses.push(orderBy(spec.newestFirstBy, 'desc'));
        clauses.push(limit(spec.cap));
        const snap = await getDocs(query(collection(db, spec.collection), ...clauses));
        if (snap.docs.length >= spec.cap) truncated.push(key);
        (values as Record<string, unknown>)[key] = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      }
      if (useAuthStore.getState().currentWorkspaceId !== workspaceId) return;
      setWidgetSnapshots(state => ({ ...state, [id]: { workspaceId, values, truncated, at: Date.now() } }));
      // A failed global live listener stays failed; this widget can show its verified one-shot read.
    } catch (error) {
      if (useAuthStore.getState().currentWorkspaceId === workspaceId)
        setRefreshErrors(state => ({ ...state, [id]: { workspaceId, message: error instanceof Error ? error.message : 'Refresh failed' } }));
    } finally {
      if (useAuthStore.getState().currentWorkspaceId === workspaceId) setRefreshing(null);
    }
  };
  const changeLayout = (next: DashboardLayout) => { setLayout(next); try { localStorage.setItem(preferenceKey, JSON.stringify(next)); setStorageError(false); } catch { setStorageError(true); } };
  const resetLayout = () => { setLayout(startingLayout(null, workspace?.roleDashboards, role)); try { localStorage.removeItem(preferenceKey); } catch { /* nothing kept to remove */ } };
  // BC-02: an owner gives a role this arrangement as its starting dashboard
  const [forRole, setForRole] = useState<DashboardRole>('bookkeeper');
  const [roleNote, setRoleNote] = useState('');
  const giveToRole = async () => {
    if (!workspace) return;
    const res = await fetch(`/api/v1/workspaces/${encodeURIComponent(workspace.id)}/role-dashboards`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getIdToken()}` }, body: JSON.stringify({ role: forRole, layout }) }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok) { setRoleNote(body.message || 'The starting dashboard was not saved'); return; }
    useAuthStore.setState(state => ({ workspaces: state.workspaces.map(w => (w.id === workspace.id ? { ...w, roleDashboards: body.roleDashboards } : w)) }));
    setRoleNote(`Saved: ${forRole === 'owner' ? 'owners' : `${forRole}s`} who have not arranged their own start from this layout.`);
  };
  const move = (id: DashboardWidget, direction: number) => {
    const order = [...layout.order], index = order.indexOf(id), target = index + direction;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]]; changeLayout({ ...layout, order });
  };
  const scoped = useMemo(() => {
    const belongs = (record: { workspaceId?: string }) => !workspaceId || record.workspaceId === workspaceId;
    return { accounts: accounts.filter(belongs), transactions: transactions.filter(belongs), invoices: invoices.filter(belongs), bills: bills.filter(belongs), customers: customers.filter(belongs), vendors: vendors.filter(belongs) };
  }, [workspaceId, accounts, transactions, invoices, bills, customers, vendors]);
  // L-123 step 3b: the server's balances through the oldest loaded day, folded in (src/lib/serverBalances.ts)
  const serverOpening = useLedgerStore(state => state.serverOpening);
  const cutoff = useMemo(() => openingCutoff(scoped.transactions), [scoped.transactions]);
  const opening = serverOpening && (!workspaceId || serverOpening.workspaceId === workspaceId) && serverOpening.asOf === cutoff ? serverOpening : null;
  const data = useMemo(() => {
    if (!valid) return null;
    const loadedOnly = dashboardComparison(scoped.accounts, scoped.transactions, period);
    return opening ? withServerBalances(loadedOnly, dashboardComparison(scoped.accounts, foldServerOpening(scoped.transactions, opening), period), period, opening.asOf) : loadedOnly;
  }, [valid, scoped, period, opening]);
  const ar = useMemo(() => valid ? dashboardAging(scoped.customers, scoped.invoices, 'customer', period.endDate) : { rows: [], top: [] }, [scoped, valid, period.endDate]);
  const ap = useMemo(() => valid ? dashboardAging(scoped.vendors, scoped.bills, 'vendor', period.endDate) : { rows: [], top: [] }, [scoped, valid, period.endDate]);
  const recent = useMemo(() => scoped.transactions.filter(tx => isPostable(tx) && isTransactionInDateRange(tx, period.startDate, period.endDate)).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)).slice(0, 5), [scoped, period.startDate, period.endDate]);
  // with the server's balances folded in, entries past the loading cap no longer change the totals (only a period
  // that starts on or before the server's day still reads the loaded entries alone, and says so)
  const capCovered = !!opening && !periodBeforeOpening(period.startDate, opening);
  const partial = (['transactions', 'accounts', 'invoices', 'bills', 'customers', 'vendors'] as const).filter(key => failed[key] || (truncated[key] && !(key === 'transactions' && capCovered)));
  const owedToYou = useMemo(() => partyStats(scoped.invoices.filter(doc => !doc.date || doc.date.slice(0, 10) <= period.endDate), [], 'customer', period.endDate).outstandingCents, [scoped.invoices, period.endDate]);
  const youOwe = useMemo(() => partyStats(scoped.bills.filter(doc => !doc.date || doc.date.slice(0, 10) <= period.endDate), [], 'vendor', period.endDate).outstandingCents, [scoped.bills, period.endDate]);
  const summaryReady = valid && data && !loading && !partial.length && (isGuest || ['transactions', 'accounts', 'invoices', 'bills', 'customers', 'vendors'].every(key => loaded[key as LedgerKey]));
  const reportLink = (report: string) => dashboardReportHref(report, period.startDate, period.endDate, fiscalStart);
  const aging = (value: typeof ar, side: 'customer' | 'vendor') => <>
    <p className="text-sm text-[var(--muted)]">Current unpaid amounts aged at {period.endDate}; documents dated later are excluded. Past payments are not rewound.</p>
    <dl className="space-y-1 mt-3">{AGING_BUCKETS.map(bucket => <div key={bucket.key} className="flex justify-between gap-2"><dt>{bucket.label}</dt><dd>{formatCurrency(value.rows.reduce((sum, row) => sum + row.buckets[bucket.key], 0), currency)}</dd></div>)}</dl>
    <h3 className="font-semibold mt-4">Top 5 overdue {side === 'customer' ? 'customers' : 'vendors'}</h3>
    {value.top.length === 0 ? <p>No overdue balances in the loaded documents.</p> : <ul>{value.top.map(row => <li key={row.partyId} className="flex justify-between gap-2 py-1"><bdi className="min-w-0 break-words">{row.partyName}</bdi><span className="tabular-nums shrink-0">{formatCurrency(row.overdue, currency)}</span></li>)}</ul>}
    <a className="inline-flex min-h-11 items-center underline" href={reportLink(side === 'customer' ? 'ar-aging' : 'ap-aging')}>Open aging report</a>
  </>;
  const renderWidget = (id: DashboardWidget) => {
    const snapshot = widgetSnapshots[id]?.workspaceId === workspaceId ? widgetSnapshots[id]?.values : undefined;
    const currentAccounts = snapshot?.accounts || scoped.accounts, currentTransactions = snapshot?.transactions || scoped.transactions;
    const currentInvoices = snapshot?.invoices || scoped.invoices, currentCustomers = snapshot?.customers || scoped.customers;
    const currentBills = snapshot?.bills || scoped.bills, currentVendors = snapshot?.vendors || scoped.vendors;
    const widgetData = snapshot?.accounts || snapshot?.transactions ? dashboardComparison(currentAccounts, currentTransactions, period) : data;
    const widgetAr = snapshot?.customers || snapshot?.invoices ? dashboardAging(currentCustomers, currentInvoices, 'customer', period.endDate) : ar;
    const widgetAp = snapshot?.vendors || snapshot?.bills ? dashboardAging(currentVendors, currentBills, 'vendor', period.endDate) : ap;
    const widgetRecent = snapshot?.transactions ? currentTransactions.filter(tx => isPostable(tx) && isTransactionInDateRange(tx, period.startDate, period.endDate)).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)).slice(0, 5) : recent;
    const widgetScenarios = snapshot?.scenarios || scenarios;
    if (!widgetData) return null;
    if (KPIS.includes(id as typeof KPIS[number])) {
      const metric = id as typeof KPIS[number], delta = reportVariance(widgetData.current[metric], widgetData.previous[metric]);
      return <><a href={reportLink(['cash', 'networth'].includes(metric) ? 'balance-sheet' : 'pnl')} className="min-h-11 flex items-center text-2xl font-bold tabular-nums">{formatCurrency(widgetData.current[metric], currency)}<span className="sr-only"> Open {LABELS[id]} report</span></a>
        <p className="text-sm">{['cash', 'networth'].includes(metric) ? `As of ${period.endDate}` : 'Selected period activity'}</p><p className="text-sm">Vs previous period: {formatCurrency(delta.amount, currency)} ({reportPercent(delta.percent)})</p>
        <DashboardTrendChart chartId={`dashboard-${metric}`} rows={widgetData.months.map(month => ({ label: month.label, cents: month[metric] }))} label={LABELS[id]} currency={currency} /><details><summary className="cursor-pointer min-h-11 flex items-center">Monthly values</summary><table className="w-full text-sm"><caption className="sr-only">{LABELS[id]} last 12 months, last month through {period.endDate}</caption><thead><tr><th scope="col" className="text-left">Month</th><th scope="col" className="text-right">Amount</th></tr></thead><tbody>{widgetData.months.map(month => <tr key={month.label}><th scope="row" className="text-left font-normal">{month.label}</th><td className="text-right tabular-nums">{formatCurrency(month[metric], currency)}</td></tr>)}</tbody></table></details></>;
    }
    if (id === 'receivables') return aging(widgetAr, 'customer');
    if (id === 'payables') return aging(widgetAp, 'vendor');
    if (id === 'scenario') {
      if (scenarioLoading) return <p role="status">Loading scenario preview…</p>;
      const scenario = widgetScenarios.find(item => item.id === activeScenarioId);
      const ghosts = scenario?.ghosts.filter(ghost => ghost.isActive && ghost.date >= period.startDate && ghost.date <= period.endDate) || [];
      return <><p className="text-sm">Forecast preview only; excluded from posted figures. {scenario?.name}</p><ul>{ghosts.map(ghost => <li key={ghost.id} className="py-2"><bdi>{ghost.description}</bdi><span className="block text-sm">{ghost.date} · {ghost.type} · {formatCurrency(Math.abs(ghost.amountCents), 'USD')}</span></li>)}</ul>{ghosts.length === 0 && <p>No active scenario entries in this range.</p>}</>;
    }
    if (id === 'feeds') return <BankFeedHealth key={widgetSnapshots[id]?.workspaceId === workspaceId ? widgetSnapshots[id]?.at || 0 : 0} />;
    if (id === 'banks') return <><p className="text-sm">Posted ledger balances including opening balances, as of {period.endDate}, in base currency.</p><ul>{widgetData.current.banks.map(bank => <li key={bank.id}><button type="button" onClick={() => useUIStore.getState().openRecord({ type: 'account', id: bank.id })} className="min-h-11 flex justify-between gap-3 w-full text-start"><bdi className="min-w-0 break-words">{bank.name}</bdi><span className="shrink-0 tabular-nums">{formatCurrency(bank.cents, currency)}</span></button></li>)}</ul>{widgetData.current.banks.length === 0 && <p>No cash-role accounts.</p>}</>;
    if (id === 'summary') return <dl>{widgetData.current.summary.map(row => <div key={row.label} className="flex justify-between gap-2 py-2"><dt>{row.label}<span className="block text-xs text-[var(--muted)]">{row.scope}</span></dt><dd className="tabular-nums">{formatCurrency(row.cents, currency)}</dd></div>)}</dl>;
    if (id === 'recent') return <ul>{widgetRecent.map(tx => <li key={tx.id}><button type="button" onClick={() => useUIStore.getState().openRecord({ type: 'transaction', id: tx.id })} className="min-h-11 w-full text-start py-2"><bdi className="break-words">{tx.description || 'Transaction'}</bdi><span className="block text-sm text-[var(--muted)]">{tx.date} · {formatCurrency(tx.totalAmountCents, tx.currency)}</span></button></li>)}{widgetRecent.length === 0 && <li>No posted transactions in this range.</li>}</ul>;
    return <><p>{widgetData.current.balanced && !widgetData.current.orphanCount ? 'Balanced' : 'Review needed'}</p><p className="text-sm">Statement balance at {period.endDate}. {widgetData.current.orphanCount} orphaned account lines.</p><a href={reportLink('trial-balance')} className="min-h-11 inline-flex items-center underline">Open trial balance</a></>;
  };
  return <section aria-label="Dashboard widgets" className="space-y-4">
    <div className="flex flex-wrap gap-3 items-end"><label>Dashboard date range<select aria-label="Dashboard date range" value={range} onChange={event => setRange(event.target.value as DashboardRange)} className="block min-h-11 border border-[var(--line)] bg-[var(--panel)] rounded-lg px-3"><option value="month">This month</option><option value="quarter">This fiscal quarter</option><option value="year">This fiscal year</option><option value="custom">Custom range</option></select></label>
      {range === 'custom' && <><label>From<input aria-label="Dashboard from" type="date" value={custom.startDate} onChange={event => setCustom({ ...custom, startDate: event.target.value })} className="block min-h-11 bg-[var(--panel)] border rounded px-2" /></label><label>To<input aria-label="Dashboard to" type="date" value={custom.endDate} onChange={event => setCustom({ ...custom, endDate: event.target.value })} className="block min-h-11 bg-[var(--panel)] border rounded px-2" /></label></>}
    </div>
    {!valid && <p role="alert">Choose valid dates with From on or before To.</p>}
    {valid && <p className="text-sm text-[var(--muted)]">{period.startDate} to {period.endDate}</p>}
    {loading && <p role="status">Loading dashboard collections…</p>}
    {partial && partial.length > 0 && <p role="alert">Incomplete data: {partial.join(', ')}. These loaded-data figures may omit history; use authoritative reports before relying on totals.</p>}
    <section aria-label="Dashboard at a glance" className="space-y-2">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {[
          { label: 'Cash', cents: data?.current.cash, report: 'balance-sheet' },
          { label: 'Owed to you', cents: owedToYou, report: 'ar-aging' },
          { label: 'You owe', cents: youOwe, report: 'ap-aging' },
          { label: range === 'month' ? 'Profit this month' : 'Profit for period', cents: data?.current.profit, report: 'pnl' },
         ].map(item => {
          const amount = summaryReady ? formatCurrency(item.cents ?? 0, currency) : !valid ? 'Choose dates' : partial.length ? 'Unavailable' : 'Loading…';
          return <a key={item.report} role={valid ? undefined : 'link'} tabIndex={valid ? undefined : -1} href={valid ? reportLink(item.report) : undefined} aria-disabled={!valid} data-summary-report={item.report} className="min-w-0 rounded-xl border border-[var(--line)] bg-[var(--panel)] px-3 py-2 min-h-11">
          {/* the name comes from what is shown (label + amount), so it always includes the visible text */}
          <span className="block text-sm text-[var(--muted)]">{item.label}</span>{' '}
          <span id={`dashboard-summary-${item.report}`} className="block text-right text-lg font-semibold tabular-nums break-all">{amount}</span><span className="sr-only"> report</span>
        </a>; })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-[var(--muted)]" data-testid="dashboard-balances-source">{isGuest ? 'Demo data' : opening ? `Balances through ${opening.asOf} as summed by the server, plus the loaded entries` : 'Loaded data'} · Cash at end date; profit for selected period{opening && periodBeforeOpening(period.startDate, opening) ? ` (from the loaded entries: the period starts on or before ${opening.asOf}, so it may omit older entries; open the P&L report for the server's figures)` : ''}.</span>
        <a href="#tasks" className="min-h-11 inline-flex items-center px-3 border border-[var(--line)] rounded-lg font-semibold text-sm">Open tasks</a>
      </div>
      <p className="text-xs text-[var(--muted)]">Current unpaid amounts; later documents excluded. Past payments are not reconstructed.</p>
    </section>
    {children}
    {valid && <p className="text-sm text-[var(--muted)]">Previous period: {data?.previousPeriod.startDate} to {data?.previousPeriod.endDate}. Sparklines show 12 calendar months ending at the selected date.</p>}
    <details><summary className="cursor-pointer min-h-11 flex items-center">Customize widgets</summary><div className="space-y-1">{layout.order.map((id, index) => <div key={id} className="flex flex-wrap items-center gap-2"><label className="min-h-11 flex items-center gap-2 flex-1"><input type="checkbox" checked={!layout.hidden.includes(id)} onChange={event => changeLayout({ ...layout, hidden: event.target.checked ? layout.hidden.filter(key => key !== id) : [...layout.hidden, id] })} />{LABELS[id]}</label><button type="button" aria-label={`Move ${LABELS[id]} up`} disabled={index === 0} onClick={() => move(id, -1)} className="min-h-11 min-w-11 underline disabled:opacity-40">Up</button><button type="button" aria-label={`Move ${LABELS[id]} down`} disabled={index === layout.order.length - 1} onClick={() => move(id, 1)} className="min-h-11 min-w-11 underline disabled:opacity-40">Down</button></div>)}</div><button type="button" onClick={resetLayout} className="min-h-11 underline">Reset layout</button>
      {role === 'owner' && <div className="flex flex-wrap items-center gap-2"><label className="min-h-11 flex items-center gap-2">Starting dashboard for<select value={forRole} onChange={event => setForRole(event.target.value as DashboardRole)} className="border border-[var(--line)] rounded bg-[var(--panel)] px-2 py-1">{DASHBOARD_ROLES.map(r => <option key={r} value={r}>{r === 'owner' ? 'owners' : `${r}s`}</option>)}</select></label><button type="button" onClick={() => void giveToRole()} className="min-h-11 underline">Give them this layout</button>{roleNote && <p role="status">{roleNote}</p>}</div>}</details>
    {storageError && <p role="status">Layout changed for this visit; this browser could not save it.</p>}
    {valid && <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">{layout.order.filter(id => !layout.hidden.includes(id)).map(id => {
      const widget = widgetSnapshots[id]?.workspaceId === workspaceId ? widgetSnapshots[id] : undefined;
      const sources = WIDGET_SOURCES[id];
      const sourceFailures = sources.filter(key => failed[key] && !widget?.values[key as keyof WidgetSnapshot]);
      const pending = isGuest ? [] : sources.filter(key => !loaded[key] && !widget?.values[key as keyof WidgetSnapshot]);
      const refreshFailure = refreshErrors[id]?.workspaceId === workspaceId ? refreshErrors[id]?.message : '';
      return <article key={id} aria-label={LABELS[id]} className="min-w-0 border border-[var(--line)] rounded-xl bg-[var(--panel)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3"><h2 className="font-semibold">{LABELS[id]}</h2>
          <button type="button" className="min-h-11 px-2 underline text-xs" disabled={isGuest || refreshing !== null}
            aria-label={`Refresh ${LABELS[id]}`} onClick={() => void refreshWidget(id)}>{refreshing === id ? 'Refreshing…' : sourceFailures.length || refreshFailure ? 'Retry' : 'Refresh'}</button>
        </div>
        <p className="text-xs text-[var(--muted)] mb-2">{isGuest ? 'Demo data — no live refresh' : widget ? `Refreshed at ${new Date(widget.at).toLocaleTimeString()}` : id === 'feeds' ? 'Latest server response; sync date shown below' : 'Live data; update time not tracked'}</p>
        {(sourceFailures.length > 0 || refreshFailure) ? <p role="alert">Could not load {sourceFailures.join(', ') || LABELS[id]}. {refreshFailure || 'Use Retry to load only this widget.'}</p> : <>
          {pending.length ? <p role="status">Loading {pending.join(', ')}…</p> : <>
          {widget?.truncated.length ? <p role="status">Partial history: {widget.truncated.join(', ')}</p> : null}
          {renderWidget(id)}</>}
        </>}
      </article>;
    })}</div>}
    {layout.hidden.length === DASHBOARD_WIDGETS.length && <p>All widgets are hidden. Use Customize widgets or Reset layout to show them.</p>}
  </section>;
}
