import React, { useState, useMemo, useEffect, useRef } from 'react';
import ReportSkeleton from './ReportSkeleton';
import { usePerformanceTrace } from '../../hooks/usePerformanceTrace';
import { Transaction } from '../../types';
import { 
  Download,
  Link2,
  Printer
} from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { cn, formatCurrency, workspaceYearMonth } from '../../lib/utils';
const ReportPackDialog = React.lazy(() => import('./reportPack/ReportPackDialog'));
const DrillDownModal = React.lazy(() => import('../layout/DrillDownModal'));
type ExplainRequest = import('../layout/DrillDownModal').ExplainRequest;

import { REPORT_TABS_REGISTRY, REPORT_COMPONENTS } from '../../config/registry';
import { useUIStore } from '../../stores/useUIStore';
import { getCachedReport, setCachedReport } from '../../lib/reportCache';
import { ViewErrorBoundary } from '../common/ViewErrorBoundary';
import ReportTotalExplainer from './ReportTotalExplainer';
import ReportPicker from './ReportPicker';
import PrintLayoutControl from './PrintLayoutControl';
import ReportPeriodHeading from './ReportPeriodHeading';
import { countPrintedColumns } from '../../lib/printLayout';



import { useLedgerStore } from '../../stores/useLedgerStore';
import { useCommandDispatcher } from '../../hooks/useSystemContext';
import { useAuthStore } from '../../stores/useAuthStore';
import { getComparePeriod, getReportPeriod } from '../../lib/fiscalCalendar';
import type { CompareMode } from '../../lib/fiscalCalendar';
import { reportStateFromParams, reportStateToParams } from '../../lib/reportPermalink';
import type { ReportUrlState } from '../../lib/reportPermalink';
import { copyReportLink } from '../../lib/reportViews';
import ReportViewsControls from './ReportViewsControls';
import { isTransactionInDateRange } from '../../lib/txFilters';
import { entriesForAccounts } from '../../lib/statementDrill';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';

/** The report settings in the address bar when the page opened (a shared link), if any. */
function linkedReportParams(): URLSearchParams {
  return new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
}

const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const quarterNames = ["Q1", "Q2", "Q3", "Q4"];

const Reports = React.memo(() => {
  const transactions = useLedgerStore(s => s.transactions);
  const accounts = useLedgerStore(s => s.accounts);
  const projects = useLedgerStore(s => s.projects);
  const budgets = useLedgerStore(s => s.budgets);
  useLedgerCollections('budgets');
  const { handleAction: onAction } = useCommandDispatcher();
  usePerformanceTrace("Reports");
  const activeTab = useUIStore(state => state.activeReportTab || 'pnl');
  const setActiveTab = useUIStore(state => state.setActiveReportTab);
  const fiscalYearStartMonth = useAuthStore(s => s.getCurrentWorkspace()?.fiscalYearStartMonth) || 1;
  /** An applied saved view becomes the new explicit link state, so auto-defaults cannot replace it. */
  const [linked, setLinked] = useState<ReportUrlState>(() => {
    return reportStateFromParams(linkedReportParams(), {
      report: activeTab, year: 0, timeframe: 'month', quarter: -1, month: -1, compare: 'none',
    });
  });
  const [timeframe, setTimeframe] = useState<'month' | 'quarter' | 'year'>(linked.timeframe);
  const [customPeriod, setCustomPeriod] = useState(() => linked.startDate && linked.endDate ? { startDate: linked.startDate, endDate: linked.endDate } : undefined);
  const [compareMode, setCompareMode] = useState<CompareMode>(linked.compare);
  const [packPeriod, setPackPeriod] = useState<{ startDate: string; endDate: string }>();
  /**
   * A-218: the columns the report on screen actually has, measured when Print is pressed, so a wide
   * table (balance sheet with comparison, trial balance with many accounts) turns the sheet instead
   * of printing its last columns off the paper.
   */
  const [printColumns, setPrintColumns] = useState(0);
  const printReport = React.useCallback(() => {
    const root = typeof document === 'undefined' ? null : document.querySelector('[data-print-root]');
    setPrintColumns(countPrintedColumns(root));
    // let the paper rule (portrait → landscape) reach the DOM before the print dialog opens
    requestAnimationFrame(() => window.print());
  }, []);
  const [drillDownAccount, setDrillDownAccount] = useState<string | null>(null);
  // N-12: a report that knows the figure's filter gets it explained from the server
  const [drillDownExplain, setDrillDownExplain] = useState<ExplainRequest | undefined>(undefined);
  const [linkNotice, setLinkNotice] = useState('');
  const availableYears = useMemo(() => {
    if (!transactions || transactions.length === 0) return [...new Set([workspaceYearMonth().year, ...(linked.year ? [linked.year] : [])])].sort((a, b) => b - a);
    const yearsSet = new Set<number>(linked.year ? [linked.year] : []);
    for (let i = 0; i < transactions.length; i++) {
      const d = transactions[i].date;
      if (d && d.length >= 4) {
        yearsSet.add(Number.parseInt(d.slice(0, 4), 10));
      }
    }
    return Array.from(yearsSet).sort((a, b) => b - a);
  }, [transactions, linked.year]);

  const [selectedYear, setSelectedYear] = useState<number>(() => {
    if (linked.year) return linked.year;
    if (!transactions || transactions.length === 0) return workspaceYearMonth().year;
    let maxYear = 0;
    for (let i = 0; i < transactions.length; i++) {
      const d = transactions[i].date;
      if (d && d.length >= 4) {
        const y = Number.parseInt(d.slice(0, 4), 10);
        if (y > maxYear) maxYear = y;
      }
    }
    return maxYear || workspaceYearMonth().year;
  });



  useMemo(() => {
    if (!transactions || transactions.length === 0) return [workspaceYearMonth().month];
    const monthsSet = new Set<number>();
    for (let i = 0; i < transactions.length; i++) {
      const t = transactions[i];
      if (t.date && t.date.length >= 10 && Number.parseInt(t.date.slice(0, 4), 10) === selectedYear) {
        monthsSet.add(Number.parseInt(t.date.slice(5, 7), 10) - 1);
      }
    }
    if (monthsSet.size === 0) return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    return Array.from(monthsSet).sort((a, b) => a - b);
  }, [transactions, selectedYear]);

  const [selectedMonth, setSelectedMonth] = useState<number>(() => {
    if (linked.month >= 0) return linked.month;
    if (!transactions || transactions.length === 0) return workspaceYearMonth().month;
    let maxMonth = -1;
    for (let i = 0; i < transactions.length; i++) {
      const t = transactions[i];
      if (t.date && t.date.length >= 7 && Number.parseInt(t.date.slice(0, 4), 10) === selectedYear) {
        const m = Number.parseInt(t.date.slice(5, 7), 10) - 1;
        if (m > maxMonth) maxMonth = m;
      }
    }
    return maxMonth === -1 ? workspaceYearMonth().month : maxMonth;
  });

  const [selectedQuarter, setSelectedQuarter] = useState<number>(() => (linked.quarter >= 0 ? linked.quarter : 0));
  /** C-85/C-96: one state object backs the named views and the exact share link. */
  const reportState = useMemo<ReportUrlState>(() => ({
    report: activeTab,
    year: selectedYear,
    timeframe,
    quarter: selectedQuarter,
    month: selectedMonth,
    compare: compareMode,
    ...(customPeriod || {}),
  }), [activeTab, selectedYear, timeframe, selectedQuarter, selectedMonth, compareMode, customPeriod]);

  // The dates every report uses (fiscal-year aware) and the comparison period
  const period = useMemo(
    () => customPeriod || getReportPeriod(timeframe, selectedYear, selectedQuarter, selectedMonth, fiscalYearStartMonth),
    [customPeriod, timeframe, selectedYear, selectedQuarter, selectedMonth, fiscalYearStartMonth]
  );
  const comparePeriod = useMemo(() => getComparePeriod(period.startDate, period.endDate, compareMode), [period, compareMode]);

  // Open the report named in a shared link, then keep the address bar in step with the settings
  const linkOpened = useRef(false);
  useEffect(() => {
    if (linkOpened.current) return;
    linkOpened.current = true;
    if (linked.report !== activeTab && REPORT_TABS_REGISTRY.some(t => t.id === linked.report)) setActiveTab(linked.report);
  }, [linked.report, activeTab, setActiveTab]);
  useEffect(() => {
    const url = new URL(window.location.href);
    const params = reportStateToParams({ report: activeTab, year: selectedYear, timeframe, quarter: selectedQuarter, month: selectedMonth, compare: compareMode, ...customPeriod }, url.searchParams);
    const next = `${url.pathname}?${params.toString()}${url.hash}`;
    if (next !== `${url.pathname}${url.search}${url.hash}`) window.history.replaceState(window.history.state, '', next);
  }, [activeTab, selectedYear, timeframe, selectedQuarter, selectedMonth, compareMode, customPeriod]);

  // Keep state synchronized when transactions stream in from Firestore
  useEffect(() => {
    if (transactions && transactions.length > 0) {
      let maxYear = 0;
      const yearsSet = new Set<number>();
      for (let i = 0; i < transactions.length; i++) {
        const d = transactions[i].date;
        if (d && d.length >= 4) {
          const y = Number.parseInt(d.slice(0, 4), 10);
          yearsSet.add(y);
          if (y > maxYear) maxYear = y;
        }
      }
      if (maxYear > 0 && !yearsSet.has(selectedYear) && !linked.year) {
        setSelectedYear(maxYear);
      }
    }
  }, [transactions, selectedYear, linked.year]);

  useEffect(() => {
    if (transactions && transactions.length > 0) {
      let maxMonth = -1;
      const monthsSet = new Set<number>();
      for (let i = 0; i < transactions.length; i++) {
        const t = transactions[i];
        if (t.date && t.date.length >= 7 && Number.parseInt(t.date.slice(0, 4), 10) === selectedYear) {
          const m = Number.parseInt(t.date.slice(5, 7), 10) - 1;
          monthsSet.add(m);
          if (m > maxMonth) maxMonth = m;
        }
      }
      if (maxMonth !== -1 && !monthsSet.has(selectedMonth) && linked.month < 0) {
        setSelectedMonth(maxMonth);
      }
    }
  }, [transactions, selectedYear, selectedMonth, linked.month]);

  const filteredReportTransactions = useMemo(() => {
    if (!transactions) return [];
    const cacheKey = `report_tx_${period.startDate}_${period.endDate}_${transactions.length}`;
    const cached = getCachedReport<Transaction[]>(cacheKey);
    if (cached) return cached;
    const filtered = transactions.filter(t => isTransactionInDateRange(t, period.startDate, period.endDate));
    setCachedReport(cacheKey, filtered);
    return filtered;
  }, [transactions, period]);

  const periodLabel = useMemo(() => {
    // A-220: the dates themselves come from ReportPeriodHeading below, in the reader's own date
    // style, so this line does not repeat them in the storage format.
    if (customPeriod) return 'Custom range';
    const fy = fiscalYearStartMonth === 1 ? String(selectedYear) : `FY${selectedYear}`;
    if (timeframe === 'month') return `${monthNames[selectedMonth]} ${period.startDate.slice(0, 4)}`;
    if (timeframe === 'quarter') return `${quarterNames[selectedQuarter]} ${fy}`;
    return fiscalYearStartMonth === 1 ? `FY ${selectedYear}` : fy;
  }, [customPeriod, timeframe, selectedMonth, selectedYear, selectedQuarter, fiscalYearStartMonth, period.startDate]);

  /**
   * The fallback list when the server cannot explain a figure. A statement total is made of several
   * accounts and is named after none of them ("Total debits"), so the list is built from the figure's
   * own accounts and period — never from the label on the button, which matches no account.
   */
  const drillDownTransactions = useMemo(() => {
    if (!drillDownAccount || !transactions) return [];
    if (drillDownExplain?.accountIds?.length) {
      return entriesForAccounts(transactions, drillDownExplain.accountIds, drillDownExplain.startDate, drillDownExplain.endDate);
    }
    return transactions.filter(t => t.lines?.some(l => l.accountName === drillDownAccount));
  }, [transactions, drillDownAccount, drillDownExplain]);

  const accountTypeMap = useMemo(() => {
    const map = new Map<string, string>();
    accounts.forEach(a => {
      if (a.name) map.set(a.name.toLowerCase(), a.type);
      map.set(a.id, a.type);
    });
    return map;
  }, [accounts]);

  return (
    <div className="sentence-case-controls w-full max-w-[1400px] mx-auto px-4 sm:px-6 py-6 space-y-6" data-print-root>
      {/* Printed / PDF heading: the report and its period */}
      <div className="hidden print:block">
        <h1 className="text-xl font-bold">{(REPORT_TABS_REGISTRY.find(t => t.id === activeTab)?.label as Record<string, string> | undefined)?.en || 'Report'}</h1>
        <p className="text-sm">{customPeriod ? "Custom range" : periodLabel}</p>
        {/* A-220: the printed period in the reader's own date format, with the comparison when there is one */}
        <ReportPeriodHeading
          className="text-sm"
          startDate={period.startDate}
          endDate={period.endDate}
          compareStartDate={comparePeriod?.startDate}
          compareEndDate={comparePeriod?.endDate}
        />
      </div>
      <section data-print-hide data-testid="reports-heading" aria-label="Reports heading" className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] pb-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-[var(--text)]">Reports</h1>
          {/* A-220: the period in the workspace's own date style, on the line the page already had
              (a second line would grow the heading past the 120 px the UI guide allows) */}
          <p className="text-sm text-[var(--muted)]">
            {periodLabel}{' · '}
            <ReportPeriodHeading
              as="span"
              className="tabular-nums"
              startDate={period.startDate}
              endDate={period.endDate}
              compareStartDate={comparePeriod?.startDate}
              compareEndDate={comparePeriod?.endDate}
            />
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => onAction('export')} className="min-h-11 px-3 flex items-center gap-2 text-sm text-[var(--text)] bg-[var(--surface)] border border-[var(--line)] rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brass)]">
            <Download size={16} aria-hidden="true" /> Export
          </button>
          <button onClick={printReport} className="min-h-11 px-3 flex items-center gap-2 text-sm text-[var(--text)] bg-[var(--surface)] border border-[var(--line)] rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brass)]">
            <Printer size={16} aria-hidden="true" /> Print / PDF
          </button>
          <button type="button" onClick={() => {
            const writeText = (text: string) => {
              if (!navigator.clipboard?.writeText) return Promise.reject(new Error('Clipboard unavailable'));
              return navigator.clipboard.writeText(text);
            };
            void copyReportLink(reportState, window.location.href, writeText).then(result => {
              setLinkNotice(result.ok
                ? 'Report link copied. Paste it to open this report with the same period and comparison.'
                : 'Could not copy automatically. The address bar already contains this report link; copy it from there.');
            });
          }} className="min-h-11 px-3 flex items-center gap-2 text-sm text-[var(--text)] bg-[var(--surface)] border border-[var(--line)] rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brass)]">
            <Link2 size={16} aria-hidden="true" /> Copy link
          </button>
        </div>
        {linkNotice && <p role="status" className="w-full text-xs text-[var(--muted)]">{linkNotice}</p>}
      </section>
      <div data-print-hide role="region" aria-label="Report period" className="flex flex-wrap items-center gap-2 [&_button]:min-h-11 [&_select]:min-h-11 [&_button]:min-w-11">
            {/* A-218: which paper this report prints on, beside the period controls so the page
                heading stays within the 120 px the UI guide allows on a phone */}
            <PrintLayoutControl columnCount={printColumns} />
            <button onClick={() => onAction('generate')} className="px-3.5 py-1.5 rounded-lg text-sm font-medium bg-[var(--surface)] text-[var(--text)] border border-[var(--line)] hover:border-[var(--brass)] transition-all shadow-xs cursor-pointer">
              Generate
            </button>
            
            <div className="flex items-center gap-1 bg-[var(--panel)] border border-[var(--line)] p-0.5 rounded-lg">
              {(['month', 'quarter', 'year'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => { setCustomPeriod(undefined); setTimeframe(t); }}
                  className={cn(
                    "px-3 py-1 rounded-md text-sm font-medium transition-all cursor-pointer",
                    timeframe === t 
                      ? "bg-[var(--brass)] text-[var(--ink)] shadow-xs font-bold" 
                      : "text-[var(--muted)] hover:text-[var(--text)]"
                  )}
                >
                  {t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>

            <div className="h-4 w-px bg-[var(--line)]" />

            {/* Dynamic Year Selector */}
            <select
              value={selectedYear}
              onChange={(e) => { setCustomPeriod(undefined); setSelectedYear(Number(e.target.value)); }}
              aria-label="Select Year"
              className="px-2.5 py-1 bg-[var(--surface)] border border-[var(--line)] rounded-lg text-[10px] font-bold text-[var(--text)] hover:border-[var(--brass-line)] focus:outline-none focus:ring-1 focus:ring-[var(--brass)] cursor-pointer"
            >
              {availableYears.map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>

            {/* Dynamic Month/Quarter Selector */}
            {timeframe === 'month' && (
              <select
                value={selectedMonth}
                onChange={(e) => { setCustomPeriod(undefined); setSelectedMonth(Number(e.target.value)); }}
                aria-label="Select Month"
                className="px-2.5 py-1 bg-[var(--surface)] border border-[var(--line)] rounded-lg text-[10px] font-bold text-[var(--text)] hover:border-[var(--brass-line)] focus:outline-none focus:ring-1 focus:ring-[var(--brass)] cursor-pointer animate-fade-in"
              >
                {monthNames.map((name, idx) => (
                  <option key={name} value={idx}>{name}</option>
                ))}
              </select>
            )}

            {timeframe === 'quarter' && (
              <select
                value={selectedQuarter}
                onChange={(e) => { setCustomPeriod(undefined); setSelectedQuarter(Number(e.target.value)); }}
                aria-label="Select Quarter"
                className="px-2.5 py-1 bg-[var(--surface)] border border-[var(--line)] rounded-lg text-[10px] font-bold text-[var(--text)] hover:border-[var(--brass-line)] focus:outline-none focus:ring-1 focus:ring-[var(--brass)] cursor-pointer animate-fade-in"
              >
                {quarterNames.map((name, idx) => (
                  <option key={name} value={idx}>{name}</option>
                ))}
              </select>
            )}

            <select
              value={compareMode}
              onChange={(e) => setCompareMode(e.target.value as CompareMode)}
              aria-label="Compare to"
              className="px-2.5 py-1 bg-[var(--surface)] border border-[var(--line)] rounded-lg text-[10px] font-bold text-[var(--text)] hover:border-[var(--brass-line)] focus:outline-none focus:ring-1 focus:ring-[var(--brass)] cursor-pointer"
            >
              <option value="none">No comparison</option>
              <option value="previous">vs previous period</option>
              <option value="lastYear">vs same period last year</option>
            </select>

            <div className="h-4 w-px bg-[var(--line)]" />
            
            <button className="min-h-11 px-3 border border-[var(--line)] rounded-md text-xs" onClick={() => setPackPeriod({ startDate: period.startDate, endDate: period.endDate })}>Report pack</button>
            <ReportViewsControls state={reportState} onUse={next => {
              setLinked(next);
              setActiveTab(next.report);
              setSelectedYear(next.year);
              setTimeframe(next.timeframe);
              setSelectedQuarter(next.quarter);
              setSelectedMonth(next.month);
              setCompareMode(next.compare);
              setCustomPeriod(next.startDate && next.endDate ? { startDate: next.startDate, endDate: next.endDate } : undefined);
            }} />
      </div>

      {packPeriod && <React.Suspense fallback={<p role="status">Loading report pack…</p>}><ReportPackDialog {...packPeriod} onClose={() => setPackPeriod(undefined)} /></React.Suspense>}

      <nav role="navigation" data-print-hide data-testid="report-tabs" aria-label="Report pages">
        <ReportPicker activeTab={activeTab} onSelect={setActiveTab} />
      </nav>

      {/* Content */}
      <div className="min-h-[600px]">
        <React.Suspense fallback={<ReportSkeleton rows={9} columns={4} label="Loading report…" className="p-2 min-h-[600px]" />}>
          <AnimatePresence mode="wait">
            {REPORT_TABS_REGISTRY.map(tab => {
              if (tab.id !== activeTab) return null;
              const Component = REPORT_COMPONENTS[tab.componentName];
              
              // We pass all possible props to the dynamic component. 
              // React ignores extra props, and components grab what they need.
              const standardProps = {
                // Embedded reports keep the page's single h1; standalone registry views still own their h1.
                embedded: true,
                transactions: filteredReportTransactions,
                allTransactions: transactions,
                accounts,
                projects,
                budgets,
                selectedYear,
                periodLabel,
                startDate: period.startDate,
                endDate: period.endDate,
                asOfDate: period.endDate,
                compareStartDate: comparePeriod?.startDate,
                compareEndDate: comparePeriod?.endDate,
                formatCurrency,
                accountTypeMap,
                onDrillDown: (nameOrId: string, figure?: { asOfDate?: string; expectedCents?: number; sign?: 1 | -1; accountIds?: string[]; label?: string }) => {
                  // the trial balance sends the account id and its figure; other reports send the account name
                  const byId = figure && !figure.accountIds ? accounts.find(a => a.id === nameOrId) : undefined;
                  setDrillDownAccount(byId ? byId.name : (figure?.label || nameOrId));
                  // C-95: a statement total sends every account it adds up, so the server explains the same figure
                  const ids = figure?.accountIds?.length ? figure.accountIds : byId ? [byId.id] : undefined;
                  setDrillDownExplain(ids && figure ? {
                    accountIds: ids,
                    ...(figure.asOfDate ? { endDate: figure.asOfDate } : {}),
                    ...(figure.expectedCents === undefined ? {} : { expectedCents: figure.expectedCents }),
                    sign: figure.sign || 1,
                    ...(figure.label ? { label: figure.label } : {}),
                  } : undefined);
                }
              };

              const reportTitle = typeof tab.label === 'string' ? tab.label : (tab.label?.en || tab.id);

              return (
                <ViewErrorBoundary key={tab.id} viewName={reportTitle}>
                  <Component {...standardProps} />
                </ViewErrorBoundary>
              );
            })}
          </AnimatePresence>
        </React.Suspense>
      </div>

      {/* A-202: what the report's main totals mean, in the reader's language */}
      <ReportTotalExplainer reportId={activeTab} />

      {/* Footer Actions */}
      <div data-print-hide className="flex justify-center pt-12">
        <button 
          onClick={() => onAction('export')}
          className="flex items-center gap-3 px-10 py-5 bg-[var(--surface)] border-2 border-zinc-900 rounded-full text-[var(--text)] font-medium uppercase tracking-wider text-xs hover:bg-zinc-900 hover:text-white transition-all group"
        >
          <Download size={16} className="group-hover:translate-y-0.5 transition-transform" />
          Workspace exports
        </button>
      </div>
      <React.Suspense fallback={null}>
        <DrillDownModal
          key={drillDownAccount || 'closed'}
          isOpen={!!drillDownAccount}
          onClose={() => { setDrillDownAccount(null); setDrillDownExplain(undefined); }}
          accountName={drillDownAccount || ''}
          explain={drillDownExplain}
          from="Reports"
          transactions={drillDownTransactions}
          formatCurrency={formatCurrency}
        />
      </React.Suspense>
    </div>
  );
});

export default Reports;
