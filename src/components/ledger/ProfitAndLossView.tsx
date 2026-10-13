import { usePageSyncedState } from '../../hooks/usePageSyncedState';
import type { Transaction } from '../../types';
import React, { useId, useState, useMemo, useEffect, useCallback } from 'react';
import { TrendingUp, TrendingDown, Calendar, FileSpreadsheet, Activity, Target, Zap, SplitSquareHorizontal, ArrowUp, ArrowDown, ExternalLink, AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import { motion } from 'motion/react';
import { cn, getLocalDateISO, monthBoundsISO, formatCurrency } from '../../lib/utils';
import { toast } from 'sonner';
import { exportPlToExcel } from '../../lib/plExport';
import { isPostable, lineAmount, calculateNetIncome, isTransactionInDateRange } from '../../lib/txFilters';
import { resolveAccountRole } from '../../lib/accountUtils';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useFinancialReporting } from '../../hooks/useFinancialReporting';
import { getComparePeriod } from '../../lib/fiscalCalendar';
import MonthNavigator from '../ui/MonthNavigator';
import { StatementColumns } from './StatementColumns';
import type { ReportColumnMode } from '../../lib/reportColumns';
import DrillDownModal, { type ExplainRequest } from '../layout/DrillDownModal';
import { accountGroupLayout, groupSubtotals, hasAccountGroups, toggleAccountGroup, visibleGroupRows } from '../../lib/accountGroups';
import { AccountGroupRow, AccountGroupSubtotal } from './AccountGroupControls';

/** A P&L line as the report holds it; `parentId` is only for account groups (K-14). */
interface PLAccount { name: string; code?: string; balance: number; parentId?: string }

/** A P&L line with its own id, the shape the account-group helpers want. */
interface PLRow { id: string; name: string; code?: string; type: string; parentId?: string; balance: number }

interface PLData {
  income: { total: number; accounts: Record<string, PLAccount> };
  cogs: { total: number; accounts: Record<string, PLAccount> };
  expense: { total: number; accounts: Record<string, PLAccount> };
  grossProfit: number;
  netIncome: number;
  orphanedLines?: Array<{ accountId: string; transactionId?: string; date?: string; amountCents: number }>;
  /** N-08: present on the server's cash-basis answer */
  basis?: 'cash';
  /** entries on receivables or payables without cash, left out on cash basis */
  leftOut?: number;
}

interface ProfitAndLossViewProps {
  workspaceId?: string;
  /** Period and comparison chosen on the Reports page; the view follows them when given. */
  startDate?: string;
  endDate?: string;
  compareStartDate?: string;
  compareEndDate?: string;
}

const ProfitAndLossView: React.FC<ProfitAndLossViewProps> = ({ startDate, endDate, compareStartDate, compareEndDate }) => {
  const formId = useId();
  const [columnMode, setColumnMode] = useState<ReportColumnMode>('total');
  const [showPercent, setShowPercent] = useState(false);
  const transactions = useLedgerStore(s => s.transactions);
  const accounts = useLedgerStore(s => s.accounts);
  const [dateRange, setDateRange] = usePageSyncedState(
    JSON.stringify([startDate, endDate]),
    startDate && endDate ? { start: startDate, end: endDate } : undefined,
    () => ({
    start: monthBoundsISO(getLocalDateISO()).start,
    end: getLocalDateISO()
  }));
  const [isComparative, setIsComparative] = usePageSyncedState(
    JSON.stringify([startDate, compareStartDate]), startDate ? Boolean(compareStartDate) : undefined, false);
  const columnsActive = columnMode !== 'total' || showPercent || isComparative;
  const [sortBy, setSortBy] = useState<'code' | 'name' | 'balance'>('balance');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [drillDownTarget, setDrillDownTarget] = useState<{ accountName: string; transactions: Transaction[]; explain?: ExplainRequest } | null>(null);
  // N-08: accrual (as posted) or cash (invoices and bills when paid, from the server only)
  const [basis, setBasis] = useState<'accrual' | 'cash'>('accrual');

  const isDataTruncated = useLedgerStore(s => s.isDataTruncated);
  const { fetchPL, loadingStates } = useFinancialReporting();
  const [serverData, setServerData] = useState<PLData | null>(null);
  const [serverPrevData, setServerPrevData] = useState<PLData | null>(null);
  const [isServerAuthoritative, setIsServerAuthoritative] = useState(false);

  // Follow the Reports page period and comparison

  // Comparison period: the page's choice, else the calendar period just before (the month before
  // March is February, not the same number of days)
  const prevRange = useMemo(() => {
    if (compareStartDate && compareEndDate) return { start: compareStartDate, end: compareEndDate };
    const prev = getComparePeriod(dateRange.start, dateRange.end, 'previous');
    return { start: prev?.startDate || dateRange.start, end: prev?.endDate || dateRange.end };
  }, [compareStartDate, compareEndDate, dateRange.start, dateRange.end]);

  const loadServerReport = useCallback(async () => {
    try {
      const cashBasis = basis === 'cash' ? 'cash' as const : undefined;
      const res = await fetchPL(dateRange.start, dateRange.end, cashBasis);
      if (res) {
        setServerData(res);
        setIsServerAuthoritative(true);
      }
      if (isComparative) {
        const prevRes = await fetchPL(prevRange.start, prevRange.end, cashBasis);
        if (prevRes) {
          setServerPrevData(prevRes);
        }
      }
    } catch {
      setIsServerAuthoritative(false);
    }
  }, [fetchPL, dateRange.start, dateRange.end, isComparative, prevRange, basis]);

  useEffect(() => {
    loadServerReport();
  }, [loadServerReport]);

  const toggleSort = (field: 'code' | 'name' | 'balance') => {
    if (sortBy === field) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortDir('desc');
    }
  };

  const workspaces = useAuthStore(s => s.workspaces);
  const currentWorkspaceId = useAuthStore(s => s.currentWorkspaceId);
  const currentWorkspace = workspaces.find(w => w.id === currentWorkspaceId);
  const businessType = currentWorkspace?.businessType || 'generic';

  const labels = useMemo(() => {
    if (businessType === 'personal') {
      return {
        title: "Income & Expenditures (Household)",
        inflowLabel: "Household Inflows",
        inflowSub: "Generating Income",
        outflowLabel: "Living Expenditures",
        outflowSub: "Household Cost Absorption",
        netLabel: "Household Net Savings",
        netSub: "Net Performance Summary",
        revenueStreams: "Inflow Categories",
        expenseClusters: "Outflow Categories",
        netChangeTitle: "Household Savings Potential",
        exportName: "Household_Income_Statement"
      };
    } else if (businessType === 'nonprofit') {
      return {
        title: "Statement of Activities",
        inflowLabel: "Fundraising & Program Revenues",
        inflowSub: "Public Contribution Inflows",
        outflowLabel: "Operating Expenditures",
        outflowSub: "Program Services Absorption",
        netLabel: "Change in Net Assets",
        netSub: "Net Surplus Summary",
        revenueStreams: "Public Revenues & Grants",
        expenseClusters: "Functional Program Expenditures",
        netChangeTitle: "Net Reserve Surplus",
        exportName: "Statement_of_Activities"
      };
    } else {
      return {
        title: "Profit & Loss Statement",
        inflowLabel: "Income",
        inflowSub: "Total income",
        outflowLabel: "Expenses",
        outflowSub: "Total expenses",
        netLabel: "Net profit",
        netSub: "Income less expenses",
        revenueStreams: "Income",
        expenseClusters: "Expenses",
        netChangeTitle: "Net profit",
        exportName: "Profit_and_Loss_Statement"
      };
    }
  }, [businessType]);

  const localCalculation = useMemo(() => {
    const defaultData: PLData = {
      income: { total: 0, accounts: {} },
      cogs: { total: 0, accounts: {} },
      expense: { total: 0, accounts: {} },
      grossProfit: 0,
      netIncome: 0
    };
    if (!Array.isArray(transactions) || !Array.isArray(accounts)) return { data: defaultData, prevData: defaultData };

    const calculatePeriod = (start: string, end: string) => {
      const pl: PLData = {
        income: { total: 0, accounts: {} },
        cogs: { total: 0, accounts: {} },
        expense: { total: 0, accounts: {} },
        grossProfit: 0,
        netIncome: 0
      };

      const accountMap = new Map();
      for (let i = 0; i < accounts.length; i++) accountMap.set(accounts[i].id, accounts[i]);

      const filtered = transactions.filter(t => isPostable(t) && isTransactionInDateRange(t, start, end));

      for (let i = 0; i < filtered.length; i++) {
        const t = filtered[i];
        const lines = t.lines || [];
        for (let j = 0; j < lines.length; j++) {
          const l = lines[j];
          const amt = lineAmount(l, t);
          const acc = accountMap.get(l.accountId);
          if (!acc) {
            pl.orphanedLines = pl.orphanedLines || [];
            pl.orphanedLines.push({ accountId: l.accountId, transactionId: t.id, date: t.date, amountCents: amt });
            continue;
          }

          const isCogs = acc.type === 'cost_of_goods' || acc.category === 'COGS' || acc.category === 'Direct Costs' || resolveAccountRole(acc) === 'cogs';

          if (acc.type === 'income' || acc.type === 'revenue') {
            const amount = -amt;
            pl.income.total += amount;
            if (!pl.income.accounts[acc.id]) {
              pl.income.accounts[acc.id] = { name: acc.name, code: acc.code, balance: 0, parentId: acc.parentId };
            }
            pl.income.accounts[acc.id].balance += amount;
          } else if (isCogs) {
            const amount = amt;
            pl.cogs.total += amount;
            if (!pl.cogs.accounts[acc.id]) {
              pl.cogs.accounts[acc.id] = { name: acc.name, code: acc.code, balance: 0, parentId: acc.parentId };
            }
            pl.cogs.accounts[acc.id].balance += amount;
          } else if (acc.type === 'expense') {
            const amount = amt;
            pl.expense.total += amount;
            if (!pl.expense.accounts[acc.id]) {
              pl.expense.accounts[acc.id] = { name: acc.name, code: acc.code, balance: 0, parentId: acc.parentId };
            }
            pl.expense.accounts[acc.id].balance += amount;
          }
        }
      }

      const totals = calculateNetIncome(transactions, accounts, start, end);
      pl.grossProfit = totals.grossProfit;
      pl.netIncome = totals.netIncome;
      pl.income.total = totals.income;
      pl.cogs.total = totals.cogs;
      pl.expense.total = totals.expense;
      return pl;
    };

    const currentPl = calculatePeriod(dateRange.start, dateRange.end);
    let prevPl = defaultData;
    
    if (isComparative) {
      prevPl = calculatePeriod(prevRange.start, prevRange.end);
    }

    return { data: currentPl, prevData: prevPl };
  }, [transactions, accounts, dateRange, isComparative, prevRange]);

  // on cash basis only the server's figures are shown (never the accrual figures computed here)
  const cashReady = basis === 'cash' && isServerAuthoritative && serverData?.basis === 'cash';
  const emptyPl: PLData = { income: { total: 0, accounts: {} }, cogs: { total: 0, accounts: {} }, expense: { total: 0, accounts: {} }, grossProfit: 0, netIncome: 0 };
  const data = basis === 'cash' ? (cashReady ? serverData! : emptyPl) : isServerAuthoritative && serverData ? serverData : localCalculation.data;
  const prevData = basis === 'cash' ? (cashReady && serverPrevData?.basis === 'cash' ? serverPrevData : emptyPl) : isServerAuthoritative && serverPrevData ? serverPrevData : localCalculation.prevData;
  const chooseBasis = (next: 'accrual' | 'cash') => {
    setBasis(next);
    setServerData(null);
    setServerPrevData(null);
    setIsServerAuthoritative(false);
    // the period columns are read from the entries as posted: on cash basis the one total is shown
    if (next === 'cash') { setColumnMode('total'); setShowPercent(false); setIsComparative(false); }
  };
  /** the entries behind a figure are those as posted, so on cash basis they are not listed */
  const drill = (target: { accountName: string; transactions: Transaction[]; explain?: ExplainRequest }) => {
    if (basis === 'cash') { toast.info('On cash basis the entries behind a figure are not listed yet: switch to accrual to see them'); return; }
    setDrillDownTarget(target);
  };

  // Account groups (K-14): the same P&L lines, a group's children indented under their parent with
  // a subtotal under them. A group starts open and no figure here is the report's own total.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const groupedSection = (entries: Record<string, PLAccount> | undefined, type: string) => {
    const members: PLRow[] = Object.entries(entries || {}).map(([id, account]) => ({
      id, name: account.name, code: account.code, type, parentId: account.parentId, balance: account.balance || 0,
    }));
    const compare = (a: PLRow, b: PLRow) => {
      const comp = sortBy === 'code' ? (a.code || '').localeCompare(b.code || '')
        : sortBy === 'name' ? (a.name || '').localeCompare(b.name || '')
        : (a.balance || 0) - (b.balance || 0);
      return sortDir === 'asc' ? comp : -comp;
    };
    return {
      rows: visibleGroupRows(accountGroupLayout(members, compare), collapsedGroups),
      subtotals: groupSubtotals(members, member => ({ amount: member.balance })),
      // a hierarchy needs one column, so the two-column cards stay for a chart without groups
      grouped: hasAccountGroups(members),
    };
  };
  const incomeGroups = groupedSection(data?.income?.accounts, 'income');
  const expenseGroups = groupedSection(data?.expense?.accounts, 'expense');

  const exportToExcel = () => exportPlToExcel({ data, prevData, isComparative, labels, start: dateRange.start, end: dateRange.end, cash: basis === 'cash' });

  if (!data) return null;

  return (
    <div className="space-y-6">
      {/* Authoritative / Truncation Status Banner */}
      {!isServerAuthoritative && isDataTruncated ? (
        <div id="pl-statement-truncation-banner" className="p-3 bg-amber-500/10 border border-amber-500/30 text-amber-300 rounded-xl flex items-center justify-between gap-3 text-xs sm:text-sm font-medium">
          <div className="flex items-center gap-2">
            <AlertCircle aria-hidden="true" className="w-4 h-4 text-amber-400 shrink-0" />
            <span>Showing 2,000 of N transactions — totals are incomplete</span>
          </div>
          <button
            onClick={loadServerReport}
            disabled={loadingStates.pl}
            className="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded text-xs transition flex items-center gap-1.5"
          >
            {loadingStates.pl ? <RefreshCw aria-hidden="true" className="w-3.5 h-3.5 animate-spin" /> : null}
            <span>{loadingStates.pl ? "Loading Server..." : "Load Full Server Report"}</span>
          </button>
        </div>
      ) : isServerAuthoritative ? (
        <div className="px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg flex items-center justify-between text-xs font-semibold">
          <div className="flex items-center gap-2">
            <CheckCircle2 aria-hidden="true" className="w-3.5 h-3.5 text-emerald-400" />
            <span>Server-Authoritative Report (Full Streaming History Verified)</span>
          </div>
          <button 
            onClick={loadServerReport} 
            title="Refresh server report"
            aria-label="Refresh server report"
            className="text-emerald-400/80 hover:text-emerald-300 p-0.5 rounded transition"
          >
            <RefreshCw aria-hidden="true" className={cn("w-3 h-3", loadingStates.pl && "animate-spin")} />
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
          <div className="flex items-center gap-3">
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
          <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-700">Basis
            <select value={basis} onChange={e => chooseBasis(e.target.value === 'cash' ? 'cash' : 'accrual')} className="bg-slate-100 border-none text-xs font-semibold px-2 py-1 rounded-md text-[var(--text)] normal-case tracking-normal">
              <option value="accrual">Accrual (as posted)</option>
              <option value="cash">Cash (when paid)</option>
            </select>
          </label>
          <label htmlFor={`${formId}-comparative`} aria-label="Comparative Mode" className="flex min-h-11 items-center gap-2 cursor-pointer group/toggle rounded focus-within:outline focus-within:outline-2 focus-within:outline-indigo-500">
            <input 
               id={`${formId}-comparative`}
               type="checkbox" 
               className="sr-only"
               checked={isComparative} 
               disabled={basis === 'cash'}
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
        {(basis === 'cash' || !columnsActive) && <button
          onClick={exportToExcel}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg font-bold uppercase text-[10px] tracking-wider hover:bg-slate-800 transition-all shadow-sm active:scale-95 group/btn w-full lg:w-auto cursor-pointer"
         aria-label="Export to Excel">
          <FileSpreadsheet aria-hidden="true" size={13} className="text-emerald-400 group-hover/btn:text-emerald-300 transition-colors shrink-0" />
          <span>Export to Excel</span>
        </button>}
      </div>

      {/* KPI Matrix */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-[var(--surface)] p-5 rounded-xl border border-[var(--line)]/80 shadow-3xs relative overflow-hidden group hover:border-slate-300 transition-all flex flex-col justify-between"
        >
           <div className="absolute -top-3 -right-3 p-3 opacity-[0.015] group-hover:rotate-6 transition-transform text-[var(--text)]">
             <TrendingUp aria-hidden="true" size={80} />
           </div>
          <div>
            <p className="text-[9px] font-bold text-[var(--muted)] mb-2 uppercase tracking-wider">{labels.inflowLabel}</p>
            <p className="text-xl font-black text-[var(--text)] leading-none mb-3 tabular-nums font-mono"><bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(data.income?.total || 0)}</bdi></p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center gap-1 text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded-lg text-[8px] font-bold uppercase tracking-wider w-fit">
              <Activity aria-hidden="true" size={10} className="animate-pulse" />
              {labels.inflowSub}
            </div>
            {isComparative && prevData.income?.total !== 0 && (
               <span className={cn(
                 "text-[9px] font-bold", 
                 (data.income?.total || 0) >= prevData.income?.total ? "text-emerald-500" : "text-rose-500"
               )}>
                 {(((data.income?.total || 0) - prevData.income.total) / Math.abs(prevData.income.total) * 100).toFixed(1)}% vs Prior
               </span>
            )}
          </div>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="bg-[var(--surface)] p-5 rounded-xl border border-[var(--line)]/80 shadow-3xs relative overflow-hidden group hover:border-slate-300 transition-all flex flex-col justify-between"
        >
          <div className="absolute -top-3 -right-3 p-3 opacity-[0.015] group-hover:-rotate-6 transition-transform text-[var(--text)]">
              <TrendingDown aria-hidden="true" size={80} />
           </div>
          <div>
            <p className="text-[9px] font-bold text-[var(--muted)] mb-2 uppercase tracking-wider">{labels.outflowLabel}</p>
            <p className="text-xl font-black text-[var(--text)] leading-none mb-3 tabular-nums font-mono"><bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(data.expense?.total || 0)}</bdi></p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center gap-1 text-rose-800 bg-rose-50 px-2.5 py-0.5 rounded-lg text-[8px] font-bold uppercase tracking-wider w-fit">
              <Zap aria-hidden="true" size={10} />
              {labels.outflowSub}
            </div>
            {isComparative && prevData.expense?.total !== 0 && (
               <span className={cn(
                 "text-[9px] font-bold", 
                 (data.expense?.total || 0) <= prevData.expense?.total ? "text-emerald-500" : "text-rose-500"
               )}>
                 {(((data.expense?.total || 0) - prevData.expense.total) / Math.abs(prevData.expense.total) * 100).toFixed(1)}% vs Prior
               </span>
            )}
          </div>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className={cn(
            "p-5 rounded-xl border shadow-3xs relative overflow-hidden transition-all flex flex-col justify-between",
            (data.netIncome || 0) >= 0 ? "bg-slate-900 text-white border-slate-950" : "bg-rose-950 text-white border-rose-950"
          )}
        >
          <div className="absolute -top-3 -right-3 p-3 opacity-[0.05] group-hover:scale-105 transition-transform text-white">
              <Target aria-hidden="true" size={80} />
           </div>
          <div>
            <p className="text-[9px] font-bold text-white/40 mb-2 uppercase tracking-wider">{labels.netLabel}</p>
            <p className="text-xl font-black italic tracking-tight font-mono leading-none mb-3 tabular-nums">
              <bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(data.netIncome || 0)}</bdi>
            </p>
          </div>
          <div className="flex items-center gap-2 mt-auto">
            <p className="text-[8px] font-bold uppercase tracking-wider text-white/60">
              {(data.netIncome || 0) >= 0 ? "Profit" : "Loss"}
            </p>
            {isComparative && prevData.netIncome !== 0 && (
               <span className={cn(
                 "text-[9px] font-bold ml-auto", 
                 (data.netIncome || 0) >= prevData.netIncome ? "text-emerald-400" : "text-rose-400"
               )}>
                 {(((data.netIncome || 0) - prevData.netIncome) / Math.abs(prevData.netIncome) * 100).toFixed(1)}%
               </span>
            )}
          </div>
        </motion.div>
      </div>

      {basis === 'cash' && (
        <p role="status" className="text-xs text-[var(--muted)]">
          {cashReady
            ? <>Cash basis: invoices count when they are paid and bills when they are paid, in proportion to what was paid, on the payment's date; other entries count as posted.{serverData?.leftOut ? ` ${serverData.leftOut} ${serverData.leftOut === 1 ? 'entry' : 'entries'} on receivables or payables without cash (credit notes, write-offs) ${serverData.leftOut === 1 ? 'is' : 'are'} left out.` : ''} Payments not yet applied to an invoice or bill are not counted.</>
            : loadingStates.pl ? 'Calculating on cash basis…' : 'Cash basis is calculated by the server, and it could not be reached: try again in a moment.'}
        </p>
      )}
      {basis === 'accrual' && <StatementColumns kind="pl" title={labels.title} accounts={accounts} transactions={transactions}
        startDate={dateRange.start} endDate={dateRange.end} compare={isComparative}
        compareStartDate={prevRange.start} compareEndDate={prevRange.end}
        mode={columnMode} onModeChange={setColumnMode} showPercent={showPercent} onPercentChange={setShowPercent}
        totalData={data} previousTotalData={prevData} totalAuthoritative={isServerAuthoritative}
        formatMoney={formatCurrency} sortBy={sortBy} sortDir={sortDir} onSort={toggleSort}
        onDrillDown={(accountName, selectedTransactions) => drill({ accountName, transactions: selectedTransactions })} />}
      {/* Detail Core */}
      {(!columnsActive || basis === 'cash') && (
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)]/80 shadow-3xs overflow-hidden relative">
        <div className="absolute technical-grid inset-0 opacity-[0.01] pointer-events-none" />
        <div className="p-4 border-b border-slate-150 bg-[var(--ink)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-xs font-bold text-[var(--text)] uppercase tracking-wider">{labels.title}</h2>
            <p className="text-[9px] font-bold text-[var(--muted)] uppercase tracking-wider mt-0.5">Income and expenses for the period</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-bold text-[var(--muted)] uppercase tracking-wider">Sort By:</span>
            <div className="flex items-center gap-1 bg-[var(--surface)] border border-[var(--line)] rounded-lg p-0.5">
              {(['balance', 'name', 'code'] as const).map(field => (
                <button
                  key={field}
                  onClick={() => toggleSort(field)}
                  className={cn(
                    "px-2 py-1 text-[9px] font-bold uppercase tracking-wider rounded transition-colors flex items-center gap-1 cursor-pointer",
                    sortBy === field ? "bg-slate-900 text-white" : "text-slate-500 hover:text-[var(--text)]"
                  )}
                >
                  <span>{field}</span>
                  {sortBy === field && (
                    sortDir === 'asc' ? <ArrowUp aria-hidden="true" size={9} /> : <ArrowDown aria-hidden="true" size={9} />
                  )}
                </button>
              ))}
            </div>
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0 ml-2" />
          </div>
        </div>
        
        <div className="p-5 space-y-8">
          {/* Income Section */}
          <section className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-900">
              <div className="flex items-center gap-2">
                 <div className="w-1 h-3.5 bg-emerald-500 rounded-full shrink-0" />
                 <h3 className="font-bold text-[var(--text)] uppercase tracking-wider text-xs">{labels.revenueStreams}</h3>
              </div>
              <div className="flex flex-col items-end">
                <span className="font-mono text-base font-black text-emerald-700 tabular-nums"><bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(data.income?.total || 0)}</bdi></span>
                {isComparative && prevData.income?.total !== 0 && (
                  <div className="flex items-center gap-1.5 mt-0.5">
                     <span className="font-mono text-[9px] text-[var(--muted)] font-medium tabular-nums">prev: <bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(prevData.income?.total)}</bdi></span>
                     <span className={cn(
                       "text-[10px] font-bold", 
                       (data.income?.total || 0) >= prevData.income?.total ? "text-emerald-500" : "text-rose-500"
                     )}>
                       {(((data.income?.total || 0) - prevData.income.total) / Math.abs(prevData.income.total) * 100).toFixed(1)}%
                     </span>
                  </div>
                )}
              </div>
            </div>
            <div className={cn("grid gap-4", incomeGroups.grouped ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2")}>
              {incomeGroups.rows.map(row => {
                if (row.kind === 'subtotal') return (
                  <AccountGroupSubtotal key={row.key} label={row.label} depth={row.depth}
                    amount={incomeGroups.subtotals.get(row.member.id)?.amount || 0} formatMoney={formatCurrency} />
                );
                const id = row.member.id;
                const acc = row.member;
                const prevAcc = (prevData.income?.accounts as Record<string, PLAccount>)[id];
                const prevBalance = prevAcc ? prevAcc.balance : 0;
                const balance = acc.balance || 0;
                const variance = isComparative && prevBalance !== 0 ? ((balance - prevBalance) / Math.abs(prevBalance)) * 100 : null;

                return (
                  <AccountGroupRow key={row.key} depth={row.depth} hasChildren={row.hasChildren} label={acc.name}
                    expanded={!collapsedGroups.has(id)}
                    onToggle={() => setCollapsedGroups(collapsed => toggleAccountGroup(collapsed, id))}>
                  <button
                    type="button" onClick={() => {
                      const matchedTxs = transactions.filter(t => 
                        isTransactionInDateRange(t, dateRange.start, dateRange.end) && 
                        t.lines?.some(l => l.accountId === id || l.accountName === acc.name)
                      );
                      drill({
                        accountName: acc.name,
                        transactions: matchedTxs,
                        // N-12: explained from the server, adding up to this figure
                        explain: { accountIds: [id], startDate: dateRange.start || undefined, endDate: dateRange.end || undefined, expectedCents: balance, sign: -1 }
                      });
                    }}
                    title={`Click to drill down into ${acc.name}`}
                    className="w-full text-left flex items-center justify-between p-3 bg-[var(--ink)]/50 rounded-lg border border-transparent hover:border-indigo-300 dark:hover:border-indigo-800 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20 transition-all group gap-4 min-w-0 cursor-pointer"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-[8px] font-bold text-[var(--muted)] bg-[var(--ink)] px-1.5 py-0.5 rounded border border-[var(--line)] uppercase shrink-0">{acc.code}</span>
                      <span className="text-[var(--text)] font-bold group-hover:text-indigo-600 transition-colors uppercase tracking-tight text-xs truncate flex items-center gap-1.5">
                        {acc.name}
                        <ExternalLink aria-hidden="true" size={10} className="opacity-0 group-hover:opacity-100 text-indigo-500 transition-opacity" />
                      </span>
                    </div>
                    <div className="flex flex-col items-end shrink-0">
                      <span className="font-mono text-[var(--text)] text-xs font-semibold tabular-nums"><bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(balance)}</bdi></span>
                      {isComparative && (
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="font-mono text-[8px] text-[var(--muted)] tabular-nums">prev: <bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(prevBalance)}</bdi></span>
                          {variance !== null && (
                            <span className={cn("text-[9px] font-bold", variance >= 0 ? "text-emerald-500" : "text-rose-500")}>
                              {variance >= 0 ? '+' : ''}{variance.toFixed(1)}%
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </button>
                  </AccountGroupRow>
                );
              })}
            </div>
          </section>

          {/* Expense Section */}
          <section className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--line)]">
               <div className="flex items-center gap-2">
                  <div className="w-1 h-3.5 bg-rose-500 rounded-full shrink-0" />
                  <h3 className="font-bold text-[var(--text)] uppercase tracking-wider text-xs">{labels.expenseClusters}</h3>
               </div>
               <div className="flex flex-col items-end">
                 <span className="font-mono text-base font-black text-rose-700 tabular-nums"><bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(data.expense?.total || 0)}</bdi></span>
                 {isComparative && prevData.expense?.total !== 0 && (
                   <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="font-mono text-[9px] text-[var(--muted)] font-medium tabular-nums">prev: <bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(prevData.expense?.total)}</bdi></span>
                      <span className={cn(
                        "text-[10px] font-bold", 
                        (data.expense?.total || 0) <= prevData.expense?.total ? "text-emerald-500" : "text-rose-500"
                      )}>
                        {(((data.expense?.total || 0) - prevData.expense.total) / Math.abs(prevData.expense.total) * 100).toFixed(1)}%
                      </span>
                   </div>
                 )}
               </div>
            </div>
            <div className={cn("grid gap-4", expenseGroups.grouped ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2")}>
              {expenseGroups.rows.map(row => {
                if (row.kind === 'subtotal') return (
                  <AccountGroupSubtotal key={row.key} label={row.label} depth={row.depth}
                    amount={expenseGroups.subtotals.get(row.member.id)?.amount || 0} formatMoney={formatCurrency} />
                );
                const id = row.member.id;
                const acc = row.member;
                const prevAcc = (prevData.expense?.accounts as Record<string, PLAccount>)[id];
                const prevBalance = prevAcc ? prevAcc.balance : 0;
                const balance = acc.balance || 0;
                const variance = isComparative && prevBalance !== 0 ? ((balance - prevBalance) / Math.abs(prevBalance)) * 100 : null;

                return (
                  <AccountGroupRow key={row.key} depth={row.depth} hasChildren={row.hasChildren} label={acc.name}
                    expanded={!collapsedGroups.has(id)}
                    onToggle={() => setCollapsedGroups(collapsed => toggleAccountGroup(collapsed, id))}>
                  <button
                    type="button" onClick={() => {
                      const matchedTxs = transactions.filter(t => 
                        isTransactionInDateRange(t, dateRange.start, dateRange.end) && 
                        t.lines?.some(l => l.accountId === id || l.accountName === acc.name)
                      );
                      drill({
                        accountName: acc.name,
                        transactions: matchedTxs,
                        // N-12: explained from the server, adding up to this figure
                        explain: { accountIds: [id], startDate: dateRange.start || undefined, endDate: dateRange.end || undefined, expectedCents: balance, sign: 1 }
                      });
                    }}
                    title={`Click to drill down into ${acc.name}`}
                    className="w-full text-left flex items-center justify-between p-3 bg-[var(--ink)]/50 rounded-lg border border-transparent hover:border-indigo-300 dark:hover:border-indigo-800 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20 transition-all group gap-4 min-w-0 cursor-pointer"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-[8px] font-bold text-[var(--muted)] bg-[var(--ink)] px-1.5 py-0.5 rounded border border-[var(--line)] uppercase shrink-0">{acc.code}</span>
                      <span className="text-[var(--text)] font-bold group-hover:text-indigo-600 transition-colors uppercase tracking-tight text-xs truncate flex items-center gap-1.5">
                        {acc.name}
                        <ExternalLink aria-hidden="true" size={10} className="opacity-0 group-hover:opacity-100 text-indigo-500 transition-opacity" />
                      </span>
                    </div>
                    <div className="flex flex-col items-end shrink-0">
                      <span className="font-mono text-[var(--text)] text-xs font-semibold tabular-nums"><bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(balance)}</bdi></span>
                      {isComparative && (
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="font-mono text-[8px] text-[var(--muted)] tabular-nums">prev: <bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(prevBalance)}</bdi></span>
                          {variance !== null && (
                            <span className={cn("text-[9px] font-bold", variance <= 0 ? "text-emerald-500" : "text-rose-500")}>
                              {variance >= 0 ? '+' : ''}{variance.toFixed(1)}%
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </button>
                  </AccountGroupRow>
                );
              })}
            </div>
          </section>

          {/* Net Income Cluster */}
          <div className="mt-6 p-4 bg-slate-900 text-white rounded-lg border border-slate-950 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex flex-col self-start sm:self-auto">
              <h3 className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider">{labels.netChangeTitle}</h3>
              <p className="text-[8px] font-bold text-[var(--muted)] uppercase tracking-wider">{labels.netSub}</p>
            </div>
            <div className="flex flex-col items-end sm:items-center sm:flex-row gap-4 text-right tabular-nums">
              {isComparative && prevData.netIncome !== 0 && (
                <div className="flex flex-col sm:items-end items-end mr-4">
                  <span className="text-[9px] font-bold text-[var(--muted)] font-medium tracking-wider mb-1">PRIOR PERIOD</span>
                  <span className="font-mono text-sm text-slate-300 line-through opacity-70">
                    <bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(prevData.netIncome)}</bdi>
                  </span>
                  <span className={cn(
                    "text-[10px] font-bold mt-0.5 px-1.5 py-0.5 rounded", 
                    (data.netIncome || 0) >= prevData.netIncome ? "bg-emerald-950 text-emerald-400" : "bg-rose-950 text-rose-400"
                  )}>
                    {(((data.netIncome || 0) - prevData.netIncome) / Math.abs(prevData.netIncome) * 100).toFixed(1)}% vs Prior
                  </span>
                </div>
              )}
              <span className={cn(
                "text-lg font-mono font-bold tracking-tight",
                (data.netIncome || 0) >= 0 ? "text-white" : "text-rose-400"
              )}>
                <bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(data.netIncome || 0)}</bdi>
              </span>
            </div>
          </div>
        </div>
      </div>

      )}

      {/* Drill-Down Modal */}

      {drillDownTarget && (
        <DrillDownModal
          isOpen={!!drillDownTarget}
          onClose={() => setDrillDownTarget(null)}
          accountName={drillDownTarget.accountName}
          from="Profit & Loss"
          transactions={drillDownTarget.transactions}
          formatCurrency={formatCurrency}
          explain={drillDownTarget.explain}
        />
      )}
    </div>
  );
};

export default ProfitAndLossView;
