import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { isDebitNatureType } from '../../lib/accountUtils';
import { ChartAccount } from '../../types';
import { format, subMonths, endOfMonth, endOfQuarter, subQuarters, subYears, endOfYear } from 'date-fns';
import { 
  Scale, CheckCircle2, AlertCircle, Activity, 
  ArrowUpDown, ArrowUp, ArrowDown, Download, 
  Calendar, FileSpreadsheet 
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { currentReportExportContext, exportToExcel, reportTitleRows } from '../../lib/excelExport';
import { motion } from 'motion/react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { isPostable, lineAmount, isTransactionInDateRange } from '../../lib/txFilters';
import { useFinancialReporting, ServerTrialBalanceData } from '../../hooks/useFinancialReporting';
import MonthNavigator from '../ui/MonthNavigator';
import { csvMoney, downloadCsv } from '../../lib/csvExport';
import { ACCOUNT_GROUP_INDENT_PX, accountGroupLayout, groupSubtotals, toggleAccountGroup, visibleGroupRows } from '../../lib/accountGroups';
import { AccountGroupToggle } from './AccountGroupControls';
import { ReportProvenanceNote } from '../reporting/ReportProvenanceNote';
import { STATEMENT_COLLECTIONS, useBrowserProvenance } from '../../hooks/useBrowserProvenance';
import { provenanceFromResponse } from '../../lib/reportProvenance';
import ReportEmptyState from '../reporting/ReportEmptyState';
import ReportPeriodHeading from '../reporting/ReportPeriodHeading';
import { useBalanceEntries } from '../../hooks/useBalanceEntries';
import { useScreenDataHealth } from '../../hooks/useScreenDataHealth';
import { ScreenDataNotice } from '../ui/ScreenDataNotice';

/** the trial balance worked out here also reads the journal entries */
const TB_COLLECTIONS = [...STATEMENT_COLLECTIONS, 'journalEntries'] as const;

interface TrialBalanceViewProps {
  accounts: ChartAccount[];
  formatCurrency: (val: number) => string;
  /**
   * N-12: with the account's figure, so the drill-down explains it from the server.
   * C-95: a total sends every account it adds up (`accountIds`) and a name; no expected figure,
   * because a balanced trial balance's lines net to zero while its debit and credit totals do not.
   */
  onDrillDown: (accountId: string, figure?: { asOfDate: string; expectedCents?: number; sign?: 1 | -1; accountIds?: string[]; label?: string }) => void;
}

type SortField = 'code' | 'name' | 'type' | 'debit' | 'credit';
type SortDir = 'asc' | 'desc';

export default function TrialBalanceView({ accounts, formatCurrency, onDrillDown }: TrialBalanceViewProps) {
  const transactions = useLedgerStore(s => s.transactions || []);
  const journalEntries = useLedgerStore(s => s.journalEntries || []);
  // A-235: the trial balance reads the chart of accounts, the entries and the journal entries
  const dataHealth = useScreenDataHealth(['accounts', 'transactions', 'journalEntries']);
  
  const [asOfDate, setAsOfDate] = useState<string>(() => format(new Date(), 'yyyy-MM-dd'));
  // L-123 step 3c: the browser-side sum reads the server's balances through the oldest loaded day
  const { entries: balanceTx, serverAsOf } = useBalanceEntries(transactions, asOfDate);
  const [sortField, setSortField] = useState<SortField>('code');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const { fetchTrialBalance, loadingStates } = useFinancialReporting();
  const [serverData, setServerData] = useState<ServerTrialBalanceData | null>(null);
  const [isServerAuthoritative, setIsServerAuthoritative] = useState(false);
  const [serverFailed, setServerFailed] = useState(false);
  const browserFigures = useBrowserProvenance(TB_COLLECTIONS, serverFailed);
  const reportGen = useRef(0);

  const loadServerReport = useCallback(async () => {
    try {
      const gen = ++reportGen.current;
      const res = await fetchTrialBalance(asOfDate);
      // BUG-02: a failed or late answer never leaves another period's figures on screen
      if (gen !== reportGen.current) return;
      setServerData(res || null);
      setIsServerAuthoritative(Boolean(res));
      setServerFailed(!res);
    } catch {
      setIsServerAuthoritative(false);
      setServerFailed(true);
    }
  }, [fetchTrialBalance, asOfDate]);

  useEffect(() => {
    void Promise.resolve().then(loadServerReport);
  }, [loadServerReport]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const setPresetDate = (preset: 'today' | 'last_month' | 'last_quarter' | 'last_year') => {
    const now = new Date();
    if (preset === 'today') {
      setAsOfDate(format(now, 'yyyy-MM-dd'));
    } else if (preset === 'last_month') {
      setAsOfDate(format(endOfMonth(subMonths(now, 1)), 'yyyy-MM-dd'));
    } else if (preset === 'last_quarter') {
      setAsOfDate(format(endOfQuarter(subQuarters(now, 1)), 'yyyy-MM-dd'));
    } else if (preset === 'last_year') {
      setAsOfDate(format(endOfYear(subYears(now, 1)), 'yyyy-MM-dd'));
    }
  };

  // Compute live, accurate balances as of the chosen asOfDate
  const localTrialBalance = useMemo(() => {
    // 1. Build map of accounts for O(1) lookups
    const accountById = new Map(accounts.map(a => [a.id, a]));
    const accountByName = new Map(accounts.map(a => [a.name, a]));

    // 2. Calculate running balances per account up to asOfDate
    const accountTotals: Record<string, { debitCents: number; creditCents: number; netSigned: number }> = {};
    
    // Initialize with opening balances
    accounts.forEach(acc => {
      const isDebitNature = ['asset', 'expense', 'cost_of_goods'].includes(acc.type);
      const opening = acc.openingBalanceCents || 0;
      accountTotals[acc.id] = {
        debitCents: isDebitNature && opening > 0 ? opening : (!isDebitNature && opening < 0 ? Math.abs(opening) : 0),
        creditCents: !isDebitNature && opening > 0 ? opening : (isDebitNature && opening < 0 ? Math.abs(opening) : 0),
        netSigned: opening
      };
    });

    // Accumulate standard transactions (with the server's sums through the oldest loaded day folded in)
    balanceTx.forEach(tx => {
      if (!isPostable(tx) || !isTransactionInDateRange(tx, undefined, asOfDate)) return;
      tx.lines?.forEach(line => {
        const acc = accountById.get(line.accountId) || accountByName.get(line.accountName || '');
        if (!acc) return;
        
        if (!accountTotals[acc.id]) {
          accountTotals[acc.id] = { debitCents: 0, creditCents: 0, netSigned: 0 };
        }
        
        const isDebitNature = ['asset', 'expense', 'cost_of_goods'].includes(acc.type);
        const amount = lineAmount(line, tx);
        
        // In standard double-entry journal/tx lines:
        // Positive is debit, negative is credit (or vice versa depending on nature)
        if (amount > 0) {
          accountTotals[acc.id].debitCents += amount;
        } else {
          accountTotals[acc.id].creditCents += Math.abs(amount);
        }
        accountTotals[acc.id].netSigned += (isDebitNature ? amount : -amount);
      });
    });

    // 4. Accumulate manual journal entries
    journalEntries.forEach(je => {
      if (je.deletedAt || !isTransactionInDateRange(je, undefined, asOfDate)) return;
      // Skip JEs that are auto-generated from transactions (already handled in step 3)
      if ((je as typeof je & { transactionId?: string; parentEventId?: string }).transactionId || (je as typeof je & { transactionId?: string; parentEventId?: string }).parentEventId) return;

      je.lines?.forEach(line => {
        const acc = accountById.get(line.accountId) || accountByName.get(line.accountName || '');
        if (!acc) return;
        
        if (!accountTotals[acc.id]) {
          accountTotals[acc.id] = { debitCents: 0, creditCents: 0, netSigned: 0 };
        }
        
        const isDebitNature = ['asset', 'expense', 'cost_of_goods'].includes(acc.type);
        const debit = line.debit || 0;
        const credit = line.credit || 0;
        
        accountTotals[acc.id].debitCents += debit;
        accountTotals[acc.id].creditCents += credit;
        accountTotals[acc.id].netSigned += (isDebitNature ? (debit - credit) : (credit - debit));
      });
    });

    const lines = accounts.map(acc => {
      const isDebitNature = ['asset', 'expense', 'cost_of_goods'].includes(acc.type);
      const totals = accountTotals[acc.id];
      
      let debit = 0;
      let credit = 0;

      if (totals) {
        // Compute net column placement
        const net = totals.debitCents - totals.creditCents;
        if (isDebitNature) {
          if (net >= 0) debit = net;
          else credit = Math.abs(net);
        } else {
          const netCredit = totals.creditCents - totals.debitCents;
          if (netCredit >= 0) credit = netCredit;
          else debit = Math.abs(netCredit);
        }
      } else {
        // Fallback to stored/computed balanceCents if no transaction lines matched
        const bal = acc.balanceCents || 0;
        if (isDebitNature) {
          if (bal >= 0) debit = bal;
          else credit = Math.abs(bal);
        } else {
          if (bal >= 0) credit = bal;
          else debit = Math.abs(bal);
        }
      }

      return {
        ...acc,
        debit,
        credit,
        netBalance: isDebitNature ? (debit - credit) : (credit - debit)
      };
    });

    const totalDebits = lines.reduce((sum, l) => sum + l.debit, 0);
    const totalCredits = lines.reduce((sum, l) => sum + l.credit, 0);

    // Apply Sorting
    lines.sort((a, b) => {
      let comp = 0;
      if (sortField === 'code') comp = (a.code || '').localeCompare(b.code || '');
      else if (sortField === 'name') comp = (a.name || '').localeCompare(b.name || '');
      else if (sortField === 'type') comp = (a.type || '').localeCompare(b.type || '');
      else if (sortField === 'debit') comp = a.debit - b.debit;
      else if (sortField === 'credit') comp = a.credit - b.credit;

      return sortDir === 'asc' ? comp : -comp;
    });

    const isBalanced = totalDebits === totalCredits;

    return { lines, totalDebits, totalCredits, isBalanced };
  }, [accounts, balanceTx, journalEntries, asOfDate, sortField, sortDir]);

  const trialBalance = useMemo(() => {
    if (isServerAuthoritative && serverData) {
      const lines = serverData.accounts.map(acc => ({
        id: acc.id,
        code: acc.code || '',
        name: acc.name,
        type: acc.type as string,
        debit: acc.debit,
        credit: acc.credit,
        netBalance: acc.netSigned
      }));

      lines.sort((a, b) => {
        let comp = 0;
        if (sortField === 'code') comp = (a.code || '').localeCompare(b.code || '');
        else if (sortField === 'name') comp = (a.name || '').localeCompare(b.name || '');
        else if (sortField === 'type') comp = (a.type || '').localeCompare(b.type || '');
        else if (sortField === 'debit') comp = a.debit - b.debit;
        else if (sortField === 'credit') comp = a.credit - b.credit;
        return sortDir === 'asc' ? comp : -comp;
      });

      return {
        lines,
        totalDebits: serverData.totalDebit,
        totalCredits: serverData.totalCredit,
        isBalanced: serverData.isBalanced
      };
    }
    return localTrialBalance;
  }, [isServerAuthoritative, serverData, localTrialBalance, sortField, sortDir]);

  // Account groups (K-14): the same lines, a group's children indented under their parent with a
  // subtotal under them. The footer total stays the trial balance's own; a subtotal is only the
  // lines inside it added up, so debits and credits still agree.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const chartById = useMemo(() => new Map(accounts.map(account => [account.id, account])), [accounts]);
  const groupedLines = useMemo(() => {
    const members = trialBalance.lines.map(line => ({
      ...line,
      // a server line carries no parent of its own, so it is read from the loaded chart
      parentId: (line as { parentId?: string }).parentId ?? chartById.get(line.id)?.parentId,
    }));
    const compare = (a: (typeof members)[number], b: (typeof members)[number]) => {
      let comp = 0;
      if (sortField === 'code') comp = (a.code || '').localeCompare(b.code || '');
      else if (sortField === 'name') comp = (a.name || '').localeCompare(b.name || '');
      else if (sortField === 'type') comp = (a.type || '').localeCompare(b.type || '');
      else if (sortField === 'debit') comp = a.debit - b.debit;
      else if (sortField === 'credit') comp = a.credit - b.credit;
      return sortDir === 'asc' ? comp : -comp;
    };
    return {
      rows: visibleGroupRows(accountGroupLayout(members, compare), collapsedGroups),
      subtotals: groupSubtotals(members, line => ({ debit: line.debit, credit: line.credit })),
    };
  }, [trialBalance.lines, chartById, sortField, sortDir, collapsedGroups]);

  // The export keeps the trial balance's own lines: a group's subtotal would count those lines twice,
  // and the file's debits and credits would no longer agree (K-14).
  const handleExportCSV = () => {
    downloadCsv(`trial_balance_as_of_${asOfDate}.csv`,
      ['Account Code', 'Account Name', 'Classification', 'Debit', 'Credit'],
      [
        ...trialBalance.lines.map(line => [line.code || '', line.name || '', line.type || '', csvMoney(line.debit), csvMoney(line.credit)]),
        ['TOTAL', '', '', csvMoney(trialBalance.totalDebits), csvMoney(trialBalance.totalCredits)],
      ]);
  };

  const handleExportExcel = async () => {
    const columns = [
      { header: 'Account Code', key: 'code', width: 15 },
      { header: 'Account Name', key: 'name', width: 35 },
      { header: 'Classification', key: 'type', width: 18 },
      { header: 'Debit ($)', key: 'debit', width: 16 },
      { header: 'Credit ($)', key: 'credit', width: 16 },
    ];

    const rows = trialBalance.lines.map(line => ({
      code: line.code || '',
      name: line.name || '',
      type: line.type || '',
      debit: line.debit / 100,
      credit: line.credit / 100
    }));

    rows.push({
      code: 'TOTAL',
      name: '',
      type: '',
      debit: trialBalance.totalDebits / 100,
      credit: trialBalance.totalCredits / 100
    });

    await exportToExcel(columns, rows, {
      sheetName: 'Trial Balance',
      fileName: `trial_balance_as_of_${asOfDate}.xlsx`,
      titleRows: reportTitleRows(currentReportExportContext('Trial Balance', `As of ${asOfDate}`, 'Accrual posted entries'))
    });
  };

  // AUD-10: the server's answer, or the figures worked out here
  const provenance = isServerAuthoritative && serverData ? provenanceFromResponse(serverData)
    : serverFailed || browserFigures.completeness !== 'complete' ? browserFigures : null;

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) return <ArrowUpDown aria-hidden="true" size={11} className="opacity-40" />;
    return sortDir === 'asc' ? <ArrowUp aria-hidden="true" size={11} className="text-emerald-400" /> : <ArrowDown aria-hidden="true" size={11} className="text-emerald-400" />;
  };

  return (
    <div className="space-y-4">
      <ScreenDataNotice failedKeys={dataHealth.failedKeys} message={dataHealth.message} onRetry={dataHealth.retry} what="this report" />
      {/* AUD-10: where these figures come from */}
      <ReportProvenanceNote id="tb-statement-provenance" provenance={provenance} onRefresh={loadServerReport} busy={loadingStates.trialBalance} />
      {!(isServerAuthoritative && serverData) && serverAsOf && (
        <p data-testid="tb-balances-source" className="text-xs text-[var(--muted)]">Balances include every entry through {serverAsOf} as summed by the server, plus the loaded entries after it.</p>
      )}


      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)]/80 shadow-3xs overflow-hidden relative group">
        <div className="absolute technical-grid inset-0 opacity-[0.015] pointer-events-none" />
        
        {/* Header & Controls */}
        <div className="p-5 border-b border-[var(--line)] flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-1.5 text-[9px] font-bold text-[var(--muted)] uppercase tracking-widest truncate mb-1">
               <Scale aria-hidden="true" size={12} className="shrink-0" />
               Double-Entry Stability Protocol
            </div>
            <h2 className="text-xl font-bold text-[var(--text)] tracking-tight">Trial Balance</h2>
            {/* A-220: the as-of date in the reader's own date style */}
            <ReportPeriodHeading
              asOf
              className="text-sm font-medium text-[var(--muted)] tabular-nums"
              startDate={asOfDate}
              endDate={asOfDate}
            />
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <MonthNavigator
                currentDate={asOfDate}
                onMonthChange={({ end }) => setAsOfDate(end)}
              />
              <div className="flex items-center gap-1.5 bg-[var(--ink)] px-2.5 py-1 rounded-lg border border-[var(--line)]">
                <Calendar aria-hidden="true" size={13} className="text-[var(--muted)]" />
                <span className="text-[10px] font-bold text-[var(--muted)] uppercase">As of:</span>
                <input aria-label="As of date"
                  type="date"
                  value={asOfDate}
                  onChange={(e) => setAsOfDate(e.target.value)}
                  className="bg-transparent text-xs font-mono font-bold text-[var(--text)] focus:outline-none cursor-pointer"
                />
              </div>
            
            {/* Quick Presets */}
            <div className="flex items-center gap-1 text-[9px] font-bold uppercase">
              <button 
                onClick={() => setPresetDate('today')}
                className="px-2 py-1 bg-[var(--ink)] hover:bg-[var(--line)] text-[var(--muted)] hover:text-[var(--text)] rounded border border-[var(--line)] transition-colors"
              >
                Today
              </button>
              <button 
                onClick={() => setPresetDate('last_month')}
                className="px-2 py-1 bg-[var(--ink)] hover:bg-[var(--line)] text-[var(--muted)] hover:text-[var(--text)] rounded border border-[var(--line)] transition-colors"
              >
                Last Month
              </button>
              <button 
                onClick={() => setPresetDate('last_quarter')}
                className="px-2 py-1 bg-[var(--ink)] hover:bg-[var(--line)] text-[var(--muted)] hover:text-[var(--text)] rounded border border-[var(--line)] transition-colors"
              >
                Last Qtr
              </button>
              <button 
                onClick={() => setPresetDate('last_year')}
                className="px-2 py-1 bg-[var(--ink)] hover:bg-[var(--line)] text-[var(--muted)] hover:text-[var(--text)] rounded border border-[var(--line)] transition-colors"
              >
                Last Year
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-6">
          <div className="text-left sm:text-right">
            <p className="text-[9px] font-bold text-[var(--muted)] uppercase tracking-wider mb-0.5">Total Debits</p>
            <p className="text-base font-bold font-mono text-[var(--text)] tabular-nums">{formatCurrency(trialBalance.totalDebits)}</p>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-[9px] font-bold text-[var(--muted)] uppercase tracking-wider mb-0.5">Total Credits</p>
            <p className="text-base font-bold font-mono text-[var(--text)] tabular-nums">{formatCurrency(trialBalance.totalCredits)}</p>
          </div>
          <motion.div 
            animate={trialBalance.isBalanced ? {} : { x: [0, -4, 4, -4, 4, 0] }}
            className={cn(
              "px-3 py-1.5 rounded-lg flex items-center gap-2 font-bold text-[9px] uppercase tracking-wider border shadow-3xs transition-all w-full sm:w-auto",
              trialBalance.isBalanced 
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30" 
                : "bg-rose-700 text-white border-rose-400"
            )}
          >
            {trialBalance.isBalanced ? <CheckCircle2 aria-hidden="true" size={12} className="shrink-0 text-emerald-500" /> : <AlertCircle aria-hidden="true" size={12} className="shrink-0" />}
            {trialBalance.isBalanced ? "Balanced Double-Entry" : "System Imbalance"}
          </motion.div>
        </div>
      </div>

      {/* Action Toolbar */}
      <div className="px-5 py-2.5 bg-[var(--ink)]/40 border-b border-[var(--line)] flex items-center justify-between gap-4">
        <span className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider">
          {trialBalance.lines.length} Active Ledger Accounts
        </span>
        <div className="flex items-center gap-2">
          <button 
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 px-3 py-1 bg-[var(--surface)] text-[var(--muted)] border border-[var(--line)] rounded-lg text-[9px] font-bold uppercase tracking-wider hover:text-[var(--text)] transition-all cursor-pointer"
           aria-label="CSV">
            <Download aria-hidden="true" size={11} /> CSV
          </button>
          <button 
            onClick={handleExportExcel}
            className="flex items-center gap-1.5 px-3 py-1 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 rounded-lg text-[9px] font-bold uppercase tracking-wider hover:bg-emerald-600/20 transition-all cursor-pointer"
           aria-label="Excel">
            <FileSpreadsheet aria-hidden="true" size={11} /> Excel
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto relative z-10 custom-scrollbar">
        <table className="w-full text-left min-w-[700px] text-xs">
          <caption className="sr-only">Trial Balance</caption>
          <thead>
            <tr className="bg-slate-900 text-white whitespace-nowrap select-none">
              <th scope="col"
                onClick={() => handleSort('code')}
                className="px-5 py-3 text-[10px] font-bold uppercase tracking-wider cursor-pointer hover:bg-slate-800 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span>Account Code</span>
                  {renderSortIcon('code')}
                </div>
              </th>
              <th scope="col"
                onClick={() => handleSort('name')}
                className="px-5 py-3 text-[10px] font-bold uppercase tracking-wider cursor-pointer hover:bg-slate-800 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span>Account Name & Classification</span>
                  {renderSortIcon('name')}
                </div>
              </th>
              <th scope="col"
                onClick={() => handleSort('debit')}
                className="px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-right cursor-pointer hover:bg-slate-800 transition-colors"
              >
                <div className="flex items-center justify-end gap-2">
                  <span>Debit Balance</span>
                  {renderSortIcon('debit')}
                </div>
              </th>
              <th scope="col"
                onClick={() => handleSort('credit')}
                className="px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-right cursor-pointer hover:bg-slate-800 transition-colors"
              >
                <div className="flex items-center justify-end gap-2">
                  <span>Credit Balance</span>
                  {renderSortIcon('credit')}
                </div>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {groupedLines.rows.map((row) => {
              // a subtotal row is not an account: nothing to drill into, and the footer total is unchanged
              if (row.kind === 'subtotal') {
                const subtotal = groupedLines.subtotals.get(row.member.id);
                const debit = subtotal?.debit || 0;
                const credit = subtotal?.credit || 0;
                return (
                  <tr key={row.key} className="bg-[var(--ink)]/40">
                    <td className="px-5 py-2" />
                    <th scope="row" className="px-5 py-2 text-left text-[9px] font-bold uppercase tracking-wider text-[var(--muted)]">
                      <span style={{ paddingLeft: `${row.depth * ACCOUNT_GROUP_INDENT_PX}px` }}>{row.label}</span>
                    </th>
                    <td className="px-5 py-2 text-right font-mono text-[10px] font-bold text-[var(--text)] tabular-nums">
                      {debit > 0 ? formatCurrency(debit) : '—'}
                    </td>
                    <td className="px-5 py-2 text-right font-mono text-[10px] font-bold text-[var(--text)] tabular-nums">
                      {credit > 0 ? formatCurrency(credit) : '—'}
                    </td>
                  </tr>
                );
              }
              return (
              <motion.tr 
                key={row.key} 
                whileHover={{ backgroundColor: "var(--ink)" }}
                onClick={() => onDrillDown(row.member.id, { asOfDate, expectedCents: row.member.netBalance, sign: isDebitNatureType(row.member.type) ? 1 : -1 })}
                className="group/row cursor-pointer transition-colors"
              >
                <td className="px-5 py-3 font-mono">
                  <span className="font-mono text-[9px] font-bold text-[var(--muted)] bg-[var(--ink)] px-2 py-0.5 rounded border border-[var(--line)]">
                    {row.member.code || '—'}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <div className="flex items-start gap-1" style={{ paddingLeft: `${row.depth * ACCOUNT_GROUP_INDENT_PX}px` }}>
                    {row.hasChildren && (
                      <AccountGroupToggle label={row.member.name} expanded={!collapsedGroups.has(row.member.id)}
                        onToggle={(event) => {
                          event.stopPropagation();
                          setCollapsedGroups(collapsed => toggleAccountGroup(collapsed, row.member.id));
                        }} />
                    )}
                    <div>
                      <p className="text-xs font-bold text-[var(--text)] group-hover/row:text-indigo-600 transition-colors uppercase">
                        {row.member.name}
                      </p>
                      <p className="text-[8px] font-bold text-[var(--muted)] uppercase tracking-wider">
                        {row.member.type} Classification • {((row.member as typeof row.member & { category?: string }).category) || 'Standard'}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-5 py-3 text-right font-mono text-[var(--text)] font-bold tabular-nums">
                  {row.member.debit > 0 ? formatCurrency(row.member.debit) : '—'}
                </td>
                <td className="px-5 py-3 text-right font-mono text-[var(--text)] font-bold tabular-nums">
                  {row.member.credit > 0 ? formatCurrency(row.member.credit) : '—'}
                </td>
              </motion.tr>
              );
            })}
            {trialBalance.lines.length === 0 && (
              <tr>
                <td colSpan={4} className="py-12 text-center text-[var(--muted)] text-xs">
                  <ReportEmptyState title="No accounts found" description="Set up the chart of accounts, then add an entry or choose another date." />
                </td>
              </tr>
            )}
          </tbody>
          <tfoot className="border-t border-slate-250">
            <tr className="bg-[var(--ink)]/50 whitespace-nowrap">
              <td colSpan={2} className="px-5 py-3.5">
                <div className="flex items-center gap-2">
                  <Activity aria-hidden="true" size={14} className="text-[var(--muted)] shrink-0" />
                  <span className="text-sm font-bold text-[var(--text)] uppercase">Total Trial Balance</span>
                </div>
              </td>
              <td className="px-5 py-3.5 text-right font-mono text-sm font-bold text-[var(--text)] tabular-nums">
                <button
                  type="button"
                  onClick={() => onDrillDown('Total trial balance', {
                    asOfDate,
                    accountIds: trialBalance.lines.map(line => line.id),
                    // the footer totals gross debits and gross credits; the lines behind them are the
                    // same posted lines, and they net to zero because every entry balances. No expected
                    // figure is sent, so the modal does not warn about a "mismatch" that is arithmetic.
                    label: `Total debit column at ${asOfDate} · every posted line. This column totals the period’s gross debits; the lines net to zero because each entry balances.`,
                  })}
                  title="Open every posted line behind the total debit column"
                  className="min-h-11 underline decoration-dotted underline-offset-2 hover:text-indigo-600 focus-visible:text-indigo-600"
                >{formatCurrency(trialBalance.totalDebits)}<span className="sr-only"> — see the posted lines behind the total debit column</span></button>
              </td>
              <td className="px-5 py-3.5 text-right font-mono text-sm font-bold text-[var(--text)] tabular-nums">
                <button
                  type="button"
                  onClick={() => onDrillDown('Total trial balance', {
                    asOfDate,
                    accountIds: trialBalance.lines.map(line => line.id),
                    label: `Total credit column at ${asOfDate} · every posted line. This column totals the period’s gross credits; the lines net to zero because each entry balances.`,
                  })}
                  title="Open every posted line behind the total credit column"
                  className="min-h-11 underline decoration-dotted underline-offset-2 hover:text-indigo-600 focus-visible:text-indigo-600"
                >{formatCurrency(trialBalance.totalCredits)}<span className="sr-only"> — see the posted lines behind the total credit column</span></button>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  </div>
);
}
