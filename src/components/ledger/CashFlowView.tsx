import { usePageSyncedState } from '../../hooks/usePageSyncedState';
import React, { useId, useState, useMemo, useCallback, useEffect } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { getComparePeriod } from '../../lib/fiscalCalendar';
import { formatCurrency, cn, getLocalDateISO, monthBoundsISO } from '../../lib/utils';
import { exportToExcel } from '../../lib/excelExport';
import { computeCashFlow } from '../../server/reports/computeReports';
import { Calendar, FileSpreadsheet, Waves, SplitSquareHorizontal, AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useFinancialReporting, ServerCashFlowData } from '../../hooks/useFinancialReporting';
import MonthNavigator from '../ui/MonthNavigator';

interface CashFlowViewProps {
  /** Period and comparison chosen on the Reports page; the view follows them when given. */
  startDate?: string;
  endDate?: string;
  compareStartDate?: string;
  compareEndDate?: string;
}

export default function CashFlowView({ startDate, endDate, compareStartDate, compareEndDate }: CashFlowViewProps = {}) {
  const formId = useId();
  const transactions = useLedgerStore(s => s.transactions);
  const rawAccounts = useLedgerStore(s => s.accounts);
  const computedAccounts = useLedgerStore(s => s.computedAccounts);
  const accounts = useMemo(() => {
    return computedAccounts && computedAccounts.length > 0 ? computedAccounts : rawAccounts;
  }, [computedAccounts, rawAccounts]);

  const [dateRange, setDateRange] = usePageSyncedState(
    JSON.stringify([startDate, endDate]),
    startDate && endDate ? { start: startDate, end: endDate } : undefined,
    () => ({
    start: monthBoundsISO(getLocalDateISO()).start,
    end: getLocalDateISO()
  }));
  const [isComparative, setIsComparative] = usePageSyncedState(
    JSON.stringify([startDate, compareStartDate]), startDate ? Boolean(compareStartDate) : undefined, false);

  const isDataTruncated = useLedgerStore(s => s.isDataTruncated);
  const { fetchCashFlow, loadingStates } = useFinancialReporting();
  const [serverData, setServerData] = useState<ServerCashFlowData | null>(null);
  const [serverPrevData, setServerPrevData] = useState<ServerCashFlowData | null>(null);
  const [isServerAuthoritative, setIsServerAuthoritative] = useState(false);

  // The page's comparison period, else the calendar period just before
  const getPrevPeriod = useCallback((start: string, end: string) => {
    if (compareStartDate && compareEndDate) return { start: compareStartDate, end: compareEndDate };
    const prev = getComparePeriod(start, end, 'previous');
    return { start: prev?.startDate || start, end: prev?.endDate || end };
  }, [compareStartDate, compareEndDate]);

  const loadServerReport = useCallback(async () => {
    try {
      const res = await fetchCashFlow(dateRange.start, dateRange.end);
      if (res) {
        setServerData(res);
        setIsServerAuthoritative(true);
      }
      if (isComparative) {
        const prev = getPrevPeriod(dateRange.start, dateRange.end);
        const prevRes = await fetchCashFlow(prev.start, prev.end);
        if (prevRes) {
          setServerPrevData(prevRes);
        }
      }
    } catch {
      setIsServerAuthoritative(false);
    }
  }, [fetchCashFlow, dateRange.start, dateRange.end, isComparative, getPrevPeriod]);

  useEffect(() => {
    loadServerReport();
  }, [loadServerReport]);

  const workspaces = useAuthStore(s => s.workspaces);
  const currentWorkspaceId = useAuthStore(s => s.currentWorkspaceId);
  const currentWorkspace = workspaces.find(w => w.id === currentWorkspaceId);
  const businessType = currentWorkspace?.businessType || 'generic';

  const labels = useMemo(() => {
    if (businessType === 'personal') {
      return {
        title: "Statement of Cash Flows (Household)",
        operating: "Living & Household Cash Flow",
        operatingSub: "Daily living inflows & standard expenses",
        investing: "Asset Portfolio & Savings Flows",
        investingSub: "Acquisition or sale of financial assets",
        financing: "Debt & Capital Transfers",
        financingSub: "Lending, credit card repayments & mortgage servicing",
        netChange: "Household Net Cash Position Shift",
        netChangeSub: "Liquidity delta synthesis position",
        netSectionLabel: (sec: string) => `Net Household Cash from ${sec}`
      };
    } else if (businessType === 'nonprofit') {
      return {
        title: "Statement of Cash Flows (Fund)",
        operating: "Operating & Public Program Cash Flow",
        operatingSub: "Charitable grant receipts & program spending outflows",
        investing: "Charitable Capital & Program Outlays",
        investingSub: "Development of program infrastructure",
        financing: "Endowments & Borrowing",
        financingSub: "Restricted endowment funds & borrowing",
        netChange: "Net Shift in Reserve Liquidity",
        netChangeSub: "Liquidity delta synthesis position",
        netSectionLabel: (sec: string) => `Net Fund Flow from ${sec}`
      };
    } else {
      return {
        title: "Statement of Cash Flows",
        operating: "Operating Activities",
        operatingSub: "Core operational receipts & vendor disbursements",
        investing: "Investing Activities",
        investingSub: "Capital expenditure & direct asset asset acquisition",
        financing: "Financing Activities",
        financingSub: "Long-term liabilities, debt servicing & equity transactions",
        netChange: "Net Increase / Decrease in Cash",
        netChangeSub: "Liquidity delta synthesis position",
        netSectionLabel: (sec: string) => `Net Cash from ${sec}`
      };
    }
  }, [businessType]);

  const localCalculation = useMemo(() => {
    // the same statement the server builds (src/server/reports/computeReports.ts, tested)
    const calcPeriod = (start: string, end: string) => {
      const { operating, investing, financing, netChange } = computeCashFlow(accounts, transactions, start, end);
      const section = (s: typeof operating) => ({ total: s.total, inflow: s.inflow, outflow: s.outflow });
      return { operating: section(operating), investing: section(investing), financing: section(financing), netChange };
    };

    const currentData = calcPeriod(dateRange.start, dateRange.end);
    let prevData = {
        operating: { total: 0, inflow: 0, outflow: 0 },
        investing: { total: 0, inflow: 0, outflow: 0 },
        financing: { total: 0, inflow: 0, outflow: 0 },
        netChange: 0,
    };

    if (isComparative) {
      const prev = getPrevPeriod(dateRange.start, dateRange.end);
      prevData = calcPeriod(prev.start, prev.end);
    }

    return { currentData, prevData };
  }, [transactions, accounts, dateRange, isComparative, getPrevPeriod]);

  const currentData = useMemo(() => {
    if (isServerAuthoritative && serverData) {
      return {
        operating: { total: serverData.operating.total, inflow: serverData.operating.inflow, outflow: serverData.operating.outflow },
        investing: { total: serverData.investing.total, inflow: serverData.investing.inflow, outflow: serverData.investing.outflow },
        financing: { total: serverData.financing.total, inflow: serverData.financing.inflow, outflow: serverData.financing.outflow },
        netChange: serverData.netChange,
      };
    }
    return localCalculation.currentData;
  }, [isServerAuthoritative, serverData, localCalculation]);

  const prevData = useMemo(() => {
    if (isServerAuthoritative && serverPrevData) {
      return {
        operating: { total: serverPrevData.operating.total, inflow: serverPrevData.operating.inflow, outflow: serverPrevData.operating.outflow },
        investing: { total: serverPrevData.investing.total, inflow: serverPrevData.investing.inflow, outflow: serverPrevData.investing.outflow },
        financing: { total: serverPrevData.financing.total, inflow: serverPrevData.financing.inflow, outflow: serverPrevData.financing.outflow },
        netChange: serverPrevData.netChange,
      };
    }
    return localCalculation.prevData;
  }, [isServerAuthoritative, serverPrevData, localCalculation]);

  const exportCashFlow = async () => {
    const isComp = isComparative;
    const columns = [
      { header: 'Metric', key: 'metric', width: 40 },
      { header: 'Amount ($)', key: 'amount', width: 20 },
      { header: isComp ? 'Prior Period ($)' : '', key: 'prior', width: 20 },
      { header: isComp ? 'Variance %' : '', key: 'variance', width: 15 },
    ];

    const titleRows = [
      [labels.title],
      [`Period: ${dateRange.start} to ${dateRange.end}`]
    ];

    const rows = [
      {
        metric: `CASH FLOWS FROM ${labels.operating.toUpperCase()}`,
        amount: currentData.operating.total / 100,
        prior: isComp ? prevData.operating.total / 100 : null
      },
      {
        metric: `CASH FLOWS FROM ${labels.investing.toUpperCase()}`,
        amount: currentData.investing.total / 100,
        prior: isComp ? prevData.investing.total / 100 : null
      },
      {
        metric: `CASH FLOWS FROM ${labels.financing.toUpperCase()}`,
        amount: currentData.financing.total / 100,
        prior: isComp ? prevData.financing.total / 100 : null
      },
      [],
      {
        metric: labels.netChange.toUpperCase(),
        amount: currentData.netChange / 100,
        prior: isComp ? prevData.netChange / 100 : null
      }
    ];

    await exportToExcel(columns, rows, {
      sheetName: 'Cash Flows',
      fileName: `Cash_Flow_Statement_${dateRange.start}_${dateRange.end}.xlsx`,
      titleRows
    });
  };

  return (
    <div className="space-y-6">
      {/* Authoritative / Truncation Status Banner */}
      {!isServerAuthoritative && isDataTruncated ? (
        <div id="cf-statement-truncation-banner" className="p-3 bg-amber-500/10 border border-amber-500/30 text-amber-300 rounded-xl flex items-center justify-between gap-3 text-xs sm:text-sm font-medium">
          <div className="flex items-center gap-2">
            <AlertCircle aria-hidden="true" className="w-4 h-4 text-amber-400 shrink-0" />
            <span>Showing 2,000 of N transactions — totals are incomplete without server sync</span>
          </div>
          <button
            onClick={() => loadServerReport()}
            className="flex items-center gap-1.5 px-3 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 rounded-lg text-xs transition-colors shrink-0 cursor-pointer"
          >
            {loadingStates.cf ? <RefreshCw aria-hidden="true" className="w-3.5 h-3.5 animate-spin" /> : null}
            <span>{loadingStates.cf ? "Loading Server..." : "Load Full Server Report"}</span>
          </button>
        </div>
      ) : isServerAuthoritative ? (
        <div id="cf-statement-authoritative-badge" className="px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg flex items-center justify-between text-xs font-semibold">
          <div className="flex items-center gap-2">
            <CheckCircle2 aria-hidden="true" className="w-3.5 h-3.5 text-emerald-400" />
            <span>Server-Authoritative Statement (Full Streaming History Verified)</span>
          </div>
          <button
            onClick={() => loadServerReport()}
            className="flex items-center gap-1 text-[11px] hover:underline cursor-pointer"
          >
            {loadingStates.cf ? <RefreshCw aria-hidden="true" className="w-3 h-3 animate-spin" /> : null}
            <span>Refresh</span>
          </button>
        </div>
      ) : null}

      {/* Date Range & Controls */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between p-5 bg-[var(--surface)] border border-[var(--line)]/80 rounded-xl shadow-3xs relative overflow-hidden group gap-4">
        <div className="absolute technical-grid inset-0 opacity-[0.015] pointer-events-none" />
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 relative z-10 w-full lg:w-auto">
          <MonthNavigator
            currentDate={dateRange.start}
            onMonthChange={({ start, end }) => setDateRange({ start, end })}
          />
          <div className="flex items-center gap-3 w-full">
            <div className="w-8 h-8 bg-[var(--ink)] border border-[var(--line)] rounded-lg flex items-center justify-center text-[var(--muted)] shrink-0">
               <Calendar aria-hidden="true" size={13} />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-[9px] font-bold text-[var(--muted)] uppercase tracking-wider mb-0.5">Period</span>
              <div className="flex flex-wrap items-center gap-2">
                <input 
                  aria-label="Reporting period start date"
                  type="date" 
                  value={dateRange.start}
                  onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                  className="bg-slate-55 bg-slate-100 border-none text-xs font-semibold px-2 py-1 rounded-md focus:ring-1 focus:ring-slate-300 outline-none text-[var(--text)]"
                />
                <span className="text-slate-300 font-mono text-sm leading-none">/</span>
                <input 
                  aria-label="Reporting period end date"
                  type="date" 
                  value={dateRange.end}
                  onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                  className="bg-slate-55 bg-slate-100 border-none text-xs font-semibold px-2 py-1 rounded-md focus:ring-1 focus:ring-slate-300 outline-none text-[var(--text)]"
                />
              </div>
            </div>
          </div>
          <div className="hidden sm:block w-px h-8 bg-slate-200" />
          <label htmlFor={`${formId}-comparative`} aria-label="Comparative Mode" className="flex items-center gap-2 cursor-pointer group/toggle">
            <input 
               id={`${formId}-comparative`}
               type="checkbox" 
               className="hidden" 
               checked={isComparative} 
               onChange={(e) => setIsComparative(e.target.checked)} 
            />
            <div className={cn(
              "w-8 h-4 rounded-full flex items-center p-0.5 transition-colors duration-300",
              isComparative ? "bg-indigo-500" : "bg-slate-300"
            )}>
              <div className={cn(
                "w-3 h-3 bg-[var(--surface)] rounded-full shadow-sm transition-transform duration-300",
                isComparative ? "translate-x-4" : "translate-x-0"
              )} />
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold text-slate-700 uppercase tracking-wider group-hover/toggle:text-[var(--text)] transition-colors flex items-center gap-1">
                Comparative Mode <SplitSquareHorizontal aria-hidden="true" size={10} className={cn(isComparative ? "text-indigo-500" : "text-[var(--muted)]")} />
              </span>
              <span className="text-[8px] font-bold text-[var(--muted)] uppercase tracking-widest">Compare to Prior Prev</span>
            </div>
          </label>
        </div>
        <button 
          onClick={exportCashFlow}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg font-bold uppercase text-[10px] tracking-wider hover:bg-slate-800 transition-all shadow-sm active:scale-95 group/btn w-full lg:w-auto cursor-pointer"
        >
          <FileSpreadsheet aria-hidden="true" size={13} className="text-emerald-400 group-hover/btn:text-emerald-300 transition-colors shrink-0" />
          <span>Export to Excel</span>
        </button>
      </div>

      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)]/80 shadow-3xs overflow-hidden relative p-4 md:p-8">
        <div className="absolute top-0 right-0 p-4 md:p-8 opacity-[0.02] pointer-events-none">
          <Waves aria-hidden="true" size={160} />
        </div>
        
        <div className="relative z-10 max-w-4xl mx-auto space-y-12">
           <div className="border-b border-slate-900 pb-4 flex items-end justify-between">
              <div>
                <h2 className="text-xl font-bold text-[var(--text)] tracking-tight uppercase italic">{labels.title}</h2>
                <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest">For period ending {dateRange.end}</p>
              </div>
              <Waves aria-hidden="true" size={24} className="text-slate-200" />
           </div>

           <div className="space-y-8">
              {[
                  { id: 'operating', label: labels.operating, desc: labels.operatingSub, data: currentData.operating, prev: prevData.operating },
                  { id: 'investing', label: labels.investing, desc: labels.investingSub, data: currentData.investing, prev: prevData.investing },
                  { id: 'financing', label: labels.financing, desc: labels.financingSub, data: currentData.financing, prev: prevData.financing }
              ].map(section => (
                  <div key={section.id} className="space-y-4">
                     <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[var(--line)] pb-2">
                        <h3 className="text-[11px] font-bold bg-slate-900 text-white px-3 py-1 rounded inline-flex uppercase tracking-wider">{section.label}</h3>
                        <span className="text-[9px] font-semibold text-slate-450 uppercase tracking-wider text-[var(--muted)]">{section.desc}</span>
                     </div>
                     
                     <div className="pl-4 space-y-3">
                        <div className="flex justify-between items-center text-sm">
                           <span className="text-slate-600 font-medium">Cash Inflows</span>
                           <span className="font-mono tabular-nums">{formatCurrency(section.data.inflow)}</span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                           <span className="text-slate-600 font-medium">Cash Outflows</span>
                           <span className="font-mono tabular-nums text-rose-600/80">({formatCurrency(section.data.outflow)})</span>
                        </div>
                        <div className="flex justify-between items-center border-t border-[var(--line)] pt-2 font-bold cursor-default hover:bg-[var(--ink)] p-1 -mx-1 px-1 rounded transition-colors group">
                           <span className="text-[var(--text)] text-sm">{labels.netSectionLabel(section.label)}</span>
                           <div className="flex items-center gap-4">
                             {isComparative && section.prev.total !== 0 && (
                                <span className={cn("text-[10px] opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity", section.data.total >= section.prev.total ? "text-emerald-500" : "text-rose-500")}>
                                   {(((section.data.total - section.prev.total) / Math.abs(section.prev.total)) * 100).toFixed(1)}% vs Prior
                                </span>
                             )}
                             <span className="font-mono tabular-nums text-[var(--text)]">{formatCurrency(section.data.total)}</span>
                           </div>
                        </div>
                     </div>
                  </div>
              ))}
           </div>

           <div className="mt-12 p-6 bg-slate-900 text-white rounded-xl border border-slate-950 flex justify-between items-center shadow-lg">
               <div>
                 <span className="text-[12px] font-bold text-white/40 uppercase tracking-widest block mb-1">{labels.netChange}</span>
                 <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-widest block">{labels.netChangeSub}</span>
               </div>
               <div className="flex items-center gap-6 tabular-nums">
                 {isComparative && prevData.netChange !== 0 && (
                    <div className="text-right">
                       <span className="block text-[8px] font-bold text-[var(--muted)] uppercase tracking-widest">Prior Delta</span>
                       <span className="font-mono text-sm text-[var(--muted)]">{formatCurrency(prevData.netChange)}</span>
                    </div>
                 )}
                 <span className={cn("text-3xl font-black font-mono tracking-tighter", currentData.netChange >= 0 ? "text-emerald-400" : "text-rose-400", "tabular-nums")}>
                    {formatCurrency(currentData.netChange)}
                 </span>
               </div>
           </div>
        </div>
      </div>
    </div>
  );
}
