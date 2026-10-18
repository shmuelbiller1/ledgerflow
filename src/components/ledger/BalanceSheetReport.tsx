import { useState } from 'react';
import { AlertCircle, Layers, HandCoins, ShieldCheck, Activity, Calendar, FileSpreadsheet, SplitSquareHorizontal, ArrowUp, ArrowDown, ExternalLink, CheckCircle2, RefreshCw } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { ChartAccount } from '../../types';
import { accountGroupLayout, groupSubtotals, toggleAccountGroup, visibleGroupRows } from '../../lib/accountGroups';
import { AccountGroupRow, AccountGroupSubtotal } from './AccountGroupControls';
import { isPostable, isTransactionInDateRange } from '../../lib/txFilters';
import { motion } from 'motion/react';
import MonthNavigator from '../ui/MonthNavigator';
import DrillDownModal from '../layout/DrillDownModal';
import type { BalanceSheetModel } from './BalanceSheetView';
import { StatementColumns } from './StatementColumns';

export function BalanceSheetReport({ columnMode, setColumnMode, showPercent, setShowPercent, columnStartDate, columnCompareStartDate, accounts, formatCurrency, formId, transactions, asOfDate, setAsOfDate, isComparative, setIsComparative, priorDate, setPriorDate, sortBy, sortDir, drillDownTarget, setDrillDownTarget, basis, chooseBasis, cashReady, isDataTruncated, loadingStates, isServerAuthoritative, loadServerReport, toggleSort, labels, currentData, prevData, exportBalanceSheet, getVarianceAndPct }: BalanceSheetModel) {
  // Account groups (K-14): the same accounts, a group's children indented under their parent with a
  // subtotal under them. A group starts open, and the section totals below are the report's own.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const groupedSection = (type: ChartAccount['type'], balances: Record<string, number>) => {
    const members = accounts.filter(account => account.type === type);
    const compare = (a: ChartAccount, b: ChartAccount) => {
      const comp = sortBy === 'code' ? (a.code || '').localeCompare(b.code || '')
        : sortBy === 'name' ? (a.name || '').localeCompare(b.name || '')
        : (balances[a.id] || 0) - (balances[b.id] || 0);
      return sortDir === 'asc' ? comp : -comp;
    };
    return {
      rows: visibleGroupRows(accountGroupLayout(members, compare), collapsedGroups),
      subtotals: groupSubtotals(members, account => ({ amount: balances[account.id] || 0 })),
    };
  };
  const assetGroups = groupedSection('asset', currentData.assets);
  const liabilityGroups = groupedSection('liability', currentData.liabilities);
  const equityGroups = groupedSection('equity', currentData.equity);

  return (
    <div className="space-y-6">
      {/* Authoritative / Truncation Status Banner */}
      {!isServerAuthoritative && isDataTruncated ? (
        <div id="bs-statement-truncation-banner" className="p-3 bg-amber-500/10 border border-amber-500/30 text-amber-300 rounded-xl flex items-center justify-between gap-3 text-xs sm:text-sm font-medium">
          <div className="flex items-center gap-2">
            <AlertCircle aria-hidden="true" className="w-4 h-4 text-amber-400 shrink-0" />
            <span>Showing 2,000 of N transactions — totals are incomplete</span>
          </div>
          <button
            onClick={loadServerReport}
            disabled={loadingStates.balanceSheet}
            className="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded text-xs transition flex items-center gap-1.5"
          >
            {loadingStates.balanceSheet ? <RefreshCw aria-hidden="true" className="w-3.5 h-3.5 animate-spin" /> : null}
            <span>{loadingStates.balanceSheet ? "Loading Server..." : "Load Full Server Report"}</span>
          </button>
        </div>
      ) : isServerAuthoritative ? (
        <div className="px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg flex items-center justify-between text-xs font-semibold">
          <div className="flex items-center gap-2">
            <CheckCircle2 aria-hidden="true" className="w-3.5 h-3.5 text-emerald-400" />
            <span>Server-Authoritative Balance Sheet (Full History Verified)</span>
          </div>
          <button 
            onClick={loadServerReport} 
            title="Refresh server report"
            aria-label="Refresh server report"
            className="text-emerald-400/80 hover:text-emerald-300 p-0.5 rounded transition"
          >
            <RefreshCw aria-hidden="true" className={cn("w-3 h-3", loadingStates.balanceSheet && "animate-spin")} />
          </button>
        </div>
      ) : null}

      {/* Date controls and configuration header */}
      <div data-testid="report-controls" role="region" aria-label="Report filters" className="flex flex-wrap items-end justify-between p-5 bg-[var(--surface)] border border-[var(--line)]/80 rounded-xl shadow-3xs relative group gap-4">
        <div className="absolute technical-grid inset-0 opacity-[0.015] pointer-events-none" />
        <div className="contents">
          <MonthNavigator
            className="[&_button]:min-h-11 [&_button]:min-w-11 [&_button]:text-[var(--text)]"
            currentDate={asOfDate}
            onMonthChange={({ end }) => setAsOfDate(end)}
          />
          <div className="flex flex-wrap items-center gap-3 min-w-0">
            <div className="w-8 h-8 bg-[var(--ink)] border border-[var(--line)] rounded-lg hidden sm:flex items-center justify-center text-[var(--muted)] shrink-0">
               <Calendar aria-hidden="true" size={13} />
            </div>
            <div className="flex flex-col">
              <label htmlFor={`${formId}-as-of`} className="text-[9px] font-bold text-[var(--muted)] uppercase tracking-wider mb-0.5">As Of Reporting Date</label>
              <input 
                id={`${formId}-as-of`}
                type="date" 
                value={asOfDate}
                onChange={(e) => setAsOfDate(e.target.value)}
                className="bg-[var(--ink)] min-h-11 max-w-full border border-[var(--line)] text-xs font-semibold px-2.5 py-1 rounded-md focus-visible:ring-2 focus-visible:ring-[var(--brass)] outline-none text-[var(--text)]"
              />
            </div>
          </div>

          <div className="hidden sm:block w-px h-8 bg-slate-200" />

          {/* N-08: accrual or cash basis */}
          <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text)]">Basis
            <select aria-label="Basis" value={basis} onChange={e => chooseBasis(e.target.value === 'cash' ? 'cash' : 'accrual')} className="bg-[var(--ink)] min-h-11 max-w-full border border-[var(--line)] text-xs font-semibold px-2 py-1 rounded-md text-[var(--text)] normal-case tracking-normal">
              <option value="accrual">Accrual (as posted)</option>
              <option value="cash">Cash (when paid)</option>
            </select>
          </label>
          {/* Comparative mode selector */}
          <label htmlFor={`${formId}-comparative`} aria-label="Comparative Year-on-Year" className="flex min-h-11 items-center gap-2 cursor-pointer group/toggle rounded focus-within:outline focus-within:outline-2 focus-within:outline-indigo-500">
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
                isComparative ? "translate-x-4" : "translate-[0px]"
              )} />
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold text-[var(--text)] uppercase tracking-wider group-hover/toggle:text-[var(--text)] transition-colors flex items-center gap-1">
                Comparative Year-on-Year <SplitSquareHorizontal aria-hidden="true" size={10} className={cn(isComparative ? "text-indigo-500" : "text-[var(--muted)]")} />
              </span>
              <span className="text-[8px] font-bold text-[var(--muted)] uppercase tracking-widest">Compare historical snapshot balances</span>
            </div>
          </label>

          {isComparative && (
            <>
              <div className="hidden sm:block w-px h-8 bg-[var(--ink)]" />
              <div className="flex flex-col">
                <label htmlFor={`${formId}-prior-as-of`} className="text-[9px] font-bold text-[var(--muted)] uppercase tracking-wider mb-0.5">Prior As Of Reference</label>
                <input 
                  id={`${formId}-prior-as-of`}
                  type="date" 
                  value={priorDate}
                  onChange={(e) => setPriorDate(e.target.value)}
                  className="bg-[var(--ink)] min-h-11 max-w-full border border-[var(--line)] text-xs font-semibold px-2.5 py-1 rounded-md focus-visible:ring-2 focus-visible:ring-[var(--brass)] outline-none text-[var(--text)]"
                />
              </div>
            </>
          )}
        </div>

        <div className="contents">
          <div className="flex flex-wrap items-center gap-1.5 bg-[var(--ink)] p-1 rounded-lg">
            <span className="text-[9px] font-bold text-[var(--muted)] uppercase tracking-wider px-1">Sort:</span>
            {(['code', 'name', 'balance'] as const).map(field => (
              <button
                key={field}
                aria-pressed={sortBy === field}
                onClick={() => toggleSort(field)}
                className={cn(
                  "min-h-11 min-w-11 px-2 py-1 text-[9px] font-bold uppercase tracking-wider rounded transition-colors flex items-center gap-1 cursor-pointer",
                  sortBy === field ? "bg-slate-900 text-white shadow-xs" : "text-[var(--text)] hover:text-[var(--text)]"
                )}
              >
                <span>{field}</span>
                {sortBy === field && (
                  sortDir === 'asc' ? <ArrowUp aria-hidden="true" size={9} /> : <ArrowDown aria-hidden="true" size={9} />
                )}
              </button>
            ))}
          </div>

          {(basis === 'cash' || (columnMode === 'total' && !showPercent && !isComparative)) && <button
            onClick={exportBalanceSheet}
            className="flex min-h-11 items-center justify-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-bold uppercase text-[10px] tracking-wider transition-all shadow-sm active:scale-95 group/btn w-full lg:w-auto cursor-pointer"
           aria-label="Export to Excel">
            <FileSpreadsheet aria-hidden="true" size={13} className="text-emerald-400 group-hover/btn:text-emerald-300 transition-colors shrink-0" />
            <span>Export to Excel</span>
          </button>}
        </div>
      </div>

      {/* Balance check Card */}
      <div className="flex flex-col md:flex-row md:items-center justify-between p-5 bg-slate-900 rounded-xl text-white shadow-sm relative overflow-hidden border border-slate-950 gap-4">
        <div className="absolute technical-grid inset-0 opacity-[0.03] pointer-events-none" />
        <div className="flex flex-col relative z-10">
          <span className="text-[9px] font-bold text-[var(--muted)] uppercase tracking-wider mb-1">Balance check</span>
          <div className="flex items-baseline gap-3">
             <span className="text-xl font-black text-white tracking-tight">
               {currentData.isBalanced ? labels.isBalancedSuccess : 'Drift Alert'}
             </span>
             <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider">
               • {currentData.isBalanced ? 'Stable' : labels.isBalancedDrift}
             </p>
          </div>
        </div>

        <div className="flex items-center gap-6 relative z-10">
          {isComparative && (
            <div className="text-right">
              <span className="block text-[8px] font-bold text-[var(--muted)] uppercase tracking-widest leading-none mb-1">As Of {priorDate}</span>
              <span className="block text-xs font-mono font-medium text-[var(--muted)] tabular-nums">
                <bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(prevData.totalAssets)}</bdi> Assets / <bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(prevData.totalClaims)}</bdi> Claims
              </span>
            </div>
          )}
          <motion.div 
            animate={currentData.isBalanced ? { scale: [1, 1.02, 1] } : { x: [0, -3, 3, -3, 3, 0] }}
            transition={{ duration: 3, repeat: Infinity }}
            className={cn(
              "w-8 h-8 rounded-lg flex items-center justify-center border font-bold text-xs relative z-10 shadow-sm shrink-0",
              currentData.isBalanced 
                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" 
                : "bg-rose-500/10 border-rose-500/20 text-rose-400"
            )}
          >
            {currentData.isBalanced ? <ShieldCheck aria-hidden="true" size={16} /> : <AlertCircle aria-hidden="true" size={16} />}
          </motion.div>
        </div>
      </div>

      {currentData.orphanedLines && currentData.orphanedLines.length > 0 && (
        <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-start gap-3 text-amber-800 dark:text-amber-200">
          <AlertCircle aria-hidden="true" className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1 text-xs">
            <p className="font-bold uppercase tracking-wider text-amber-900 dark:text-amber-100">
              Orphaned Account References Detected ({currentData.orphanedLines.length} line{currentData.orphanedLines.length > 1 ? 's' : ''})
            </p>
            <p className="mt-1 text-slate-600 dark:text-slate-300">
              Transactions reference accounts not found in the current Chart of Accounts. This unbalances assets and claims.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {Array.from(new Set(currentData.orphanedLines.map(l => l.accountId))).map(accId => (
                <span key={accId} className="px-2 py-0.5 bg-amber-200/50 dark:bg-amber-900/40 rounded text-[10px] font-mono font-medium">
                  Missing ID: {accId}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {basis === 'cash' && (
        <p role="status" className="text-xs text-[var(--muted)]">
          {cashReady
            ? <>Cash basis: what customers owe and what is owed to vendors is not on it, and the profit to date is the cash-basis profit (invoices and bills count when paid).{currentData.leftOut ? ` ${currentData.leftOut} ${currentData.leftOut === 1 ? 'entry' : 'entries'} on receivables or payables without cash (credit notes, write-offs) ${currentData.leftOut === 1 ? 'is' : 'are'} left out.` : ''}</>
            : loadingStates.bs ? 'Calculating on cash basis…' : 'Cash basis is calculated by the server, and it could not be reached: try again in a moment.'}
        </p>
      )}
      {basis === 'accrual' && <StatementColumns kind="bs" title="Balance Sheet" accounts={accounts} transactions={transactions}
        startDate={columnStartDate} endDate={asOfDate} compare={isComparative}
        compareStartDate={columnCompareStartDate} compareEndDate={priorDate}
        mode={columnMode} onModeChange={setColumnMode} showPercent={showPercent} onPercentChange={setShowPercent}
        totalData={currentData} previousTotalData={prevData} totalAuthoritative={isServerAuthoritative}
        formatMoney={formatCurrency} sortBy={sortBy} sortDir={sortDir} onSort={toggleSort}
        onDrillDown={(accountName, selectedTransactions) => setDrillDownTarget({ accountName, transactions: selectedTransactions })} />}
      {(basis === 'cash' || (columnMode === 'total' && !showPercent && !isComparative)) && (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Assets Column */}
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-[var(--surface)] rounded-xl border border-[var(--line)]/80 shadow-3xs overflow-hidden group hover:border-slate-300 transition-all flex flex-col"
        >
          <div className="p-4 border-b border-[var(--line)] bg-[var(--ink)]/50 flex justify-between items-center relative overflow-hidden shrink-0">
            <div className="absolute top-0 right-0 p-2 opacity-[0.015] pointer-events-none group-hover:rotate-6 transition-transform duration-700">
              <Layers aria-hidden="true" size={80} className="text-[var(--text)]" />
            </div>
            <div className="relative z-10">
              <h2 className="text-xs font-bold text-[var(--text)] uppercase tracking-wider leading-none">{labels.assetsLabel}</h2>
              <span className="text-[9px] font-bold text-[var(--muted)] uppercase tracking-wider mt-1 block">{labels.assetsSub}</span>
            </div>
          </div>
          <div className="p-4 flex-1 flex flex-col justify-between">
            <div className="space-y-2">
              {assetGroups.rows.map(row => {
                if (row.kind === 'subtotal') return (
                  <AccountGroupSubtotal key={row.key} label={row.label} depth={row.depth}
                    amount={assetGroups.subtotals.get(row.member.id)?.amount || 0} formatMoney={formatCurrency} />
                );
                const acc = row.member;
                const curVal = currentData.assets[acc.id] || 0;
                const prVal = isComparative ? prevData.assets[acc.id] || 0 : curVal;
                const variance = getVarianceAndPct(curVal, prVal);

                return (
                  <AccountGroupRow key={row.key} depth={row.depth} hasChildren={row.hasChildren} label={acc.name}
                    expanded={!collapsedGroups.has(acc.id)}
                    onToggle={() => setCollapsedGroups(collapsed => toggleAccountGroup(collapsed, acc.id))}>
                  <button
                    type="button" onClick={() => {
                      const matchedTxs = transactions.filter(t => isPostable(t) && isTransactionInDateRange(t, undefined, asOfDate) && t.lines?.some(l => l.accountId === acc.id || l.accountName === acc.name));
                      setDrillDownTarget({ accountName: acc.name, transactions: matchedTxs, explain: { accountIds: [acc.id], endDate: asOfDate || undefined, expectedCents: curVal, sign: 1 } });
                    }}
                    title={`Click to drill down into ${acc.name}`}
                    className="w-full text-left flex justify-between items-center hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20 p-2 rounded-lg transition-all border border-transparent hover:border-indigo-300 dark:hover:border-indigo-800 min-w-0 cursor-pointer group/row"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 bg-[var(--ink)] text-[var(--muted)] rounded-md flex items-center justify-center text-[9px] font-bold font-mono border border-[var(--line)] shrink-0">
                        {acc.code}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-[var(--text)] group-hover/row:text-indigo-600 transition-colors uppercase tracking-tight truncate flex items-center gap-1.5">
                          {acc.name}
                          <ExternalLink aria-hidden="true" size={10} className="opacity-0 group-hover/row:opacity-100 text-indigo-500 transition-opacity" />
                        </p>
                        <p className="text-[9px] font-bold text-[var(--muted)] uppercase tracking-wider truncate">{acc.category || 'Direct Asset'}</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end shrink-0 ml-2">
                      <span className="font-mono font-bold text-[var(--text)] text-xs tabular-nums"><bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(curVal)}</bdi></span>
                      {isComparative && (
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="font-mono text-[8px] text-[var(--muted)] tabular-nums">prev: <bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(prVal)}</bdi></span>
                          {variance.pct !== null && prVal !== 0 && (
                            <span className={cn("text-[8px] font-bold", variance.pct >= 0 ? "text-emerald-500" : "text-rose-500")}>
                              {variance.pct >= 0 ? '+' : ''}{variance.pct.toFixed(1)}%
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
            <div className="mt-6 pt-4 border-t border-slate-900 flex justify-between items-center relative overflow-hidden gap-4">
              <div className="flex items-center gap-1.5">
                 <Activity aria-hidden="true" size={14} className="text-slate-600 shrink-0" />
                 <span className="text-[var(--text)] font-bold uppercase tracking-wider text-[9px]">Total {labels.assetsLabel}</span>
              </div>
              <div className="text-right">
                <span className="text-lg font-mono font-bold text-[var(--text)] tracking-tight block leading-none tabular-nums"><bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(currentData.totalAssets)}</bdi></span>
                {isComparative && prevData.totalAssets !== 0 && (
                  <span className={cn("text-[9px] font-bold block mt-1", currentData.totalAssets >= prevData.totalAssets ? "text-emerald-500" : "text-rose-500")}>
                    {(((currentData.totalAssets - prevData.totalAssets) / Math.abs(prevData.totalAssets)) * 100).toFixed(1)}% vs Prior
                  </span>
                )}
              </div>
            </div>
          </div>
        </motion.div>

        {/* Liabilities & Equity Column */}
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-[var(--surface)] rounded-xl border border-[var(--line)]/80 shadow-3xs overflow-hidden group hover:border-slate-300 transition-all flex flex-col"
        >
          <div className="p-4 border-b border-[var(--line)] bg-[var(--ink)]/50 flex justify-between items-center relative overflow-hidden shrink-0">
            <div className="absolute top-0 right-0 p-2 opacity-[0.015] pointer-events-none group-hover:-rotate-6 transition-transform duration-700">
               <HandCoins aria-hidden="true" size={80} className="text-[var(--text)]" />
            </div>
            <div className="relative z-10">
              <h2 className="text-xs font-bold text-[var(--text)] uppercase tracking-wider leading-none">{labels.liabilitiesLabel} & {labels.equityLabel}</h2>
              <span className="text-[9px] font-bold text-[var(--muted)] uppercase tracking-wider mt-1 block">{labels.liabilitiesSub} / {labels.equitySub}</span>
            </div>
          </div>
          <div className="p-4 flex-1 flex flex-col justify-between">
            <div className="space-y-6">
              {/* Liabilities Section */}
              <div className="space-y-2">
                <p className="text-[8px] font-bold text-[var(--muted)] uppercase tracking-wider truncate border-b border-[var(--line)] pb-2">{labels.liabilitiesLabel}</p>
                {liabilityGroups.rows.map(row => {
                  if (row.kind === 'subtotal') return (
                    <AccountGroupSubtotal key={row.key} label={row.label} depth={row.depth}
                      amount={liabilityGroups.subtotals.get(row.member.id)?.amount || 0} formatMoney={formatCurrency} />
                  );
                  const acc = row.member;
                  const curVal = currentData.liabilities[acc.id] || 0;
                  const prVal = isComparative ? prevData.liabilities[acc.id] || 0 : curVal;
                  const variance = getVarianceAndPct(curVal, prVal);

                  return (
                    <AccountGroupRow key={row.key} depth={row.depth} hasChildren={row.hasChildren} label={acc.name}
                      expanded={!collapsedGroups.has(acc.id)}
                      onToggle={() => setCollapsedGroups(collapsed => toggleAccountGroup(collapsed, acc.id))}>
                    <button
                      type="button" onClick={() => {
                        const matchedTxs = transactions.filter(t => isPostable(t) && isTransactionInDateRange(t, undefined, asOfDate) && t.lines?.some(l => l.accountId === acc.id || l.accountName === acc.name));
                        setDrillDownTarget({ accountName: acc.name, transactions: matchedTxs, explain: { accountIds: [acc.id], endDate: asOfDate || undefined, expectedCents: curVal, sign: -1 } });
                      }}
                      title={`Click to drill down into ${acc.name}`}
                      className="w-full text-left flex justify-between items-center hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20 p-2 rounded-lg transition-all border border-transparent hover:border-indigo-300 dark:hover:border-indigo-800 min-w-0 cursor-pointer group/row"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 bg-[var(--ink)] text-[var(--muted)] rounded-md flex items-center justify-center text-[9px] font-bold font-mono border border-[var(--line)] shrink-0">
                          {acc.code}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-[var(--text)] group-hover/row:text-indigo-600 transition-colors uppercase tracking-tight truncate flex items-center gap-1.5">
                            {acc.name}
                            <ExternalLink aria-hidden="true" size={10} className="opacity-0 group-hover/row:opacity-100 text-indigo-500 transition-opacity" />
                          </p>
                          <p className="text-[9px] font-bold text-[var(--muted)] uppercase tracking-wider truncate">{acc.category || 'Current Liability'}</p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end shrink-0 ml-2">
                        <span className="font-mono font-bold text-[var(--text)] text-xs tabular-nums"><bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(curVal)}</bdi></span>
                        {isComparative && (
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="font-mono text-[8px] text-[var(--muted)] tabular-nums">prev: <bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(prVal)}</bdi></span>
                            {variance.pct !== null && prVal !== 0 && (
                              <span className={cn("text-[8px] font-bold", variance.pct <= 0 ? "text-emerald-500" : "text-rose-500")}>
                                {variance.pct >= 0 ? '+' : ''}{variance.pct.toFixed(1)}%
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </button>
                    </AccountGroupRow>
                  );
                })}
                {Boolean(currentData.notApplied) && (
                  <div className="flex justify-between items-center p-3 text-xs text-[var(--text)]">
                    <span>Paid, not yet applied to an invoice or bill</span>
                    <span className="font-mono tabular-nums"><bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(currentData.notApplied || 0)}</bdi></span>
                  </div>
                )}
                <div className="flex justify-between items-center pt-2 text-[var(--muted)] text-[8px] font-bold uppercase tracking-wider">
                  <span>Sub-Total Liabilities</span>
                  <span className="font-mono font-semibold tabular-nums"><bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(currentData.totalLiabilities)}</bdi></span>
                </div>
              </div>

              {/* Equity Section */}
              <div className="space-y-2">
                <p className="text-[8px] font-bold text-[var(--muted)] uppercase tracking-wider truncate border-b border-[var(--line)] pb-2">{labels.equityLabel}</p>
                {equityGroups.rows.map(row => {
                  if (row.kind === 'subtotal') return (
                    <AccountGroupSubtotal key={row.key} label={row.label} depth={row.depth}
                      amount={equityGroups.subtotals.get(row.member.id)?.amount || 0} formatMoney={formatCurrency} />
                  );
                  const acc = row.member;
                  const curVal = currentData.equity[acc.id] || 0;
                  const prVal = isComparative ? prevData.equity[acc.id] || 0 : curVal;
                  const variance = getVarianceAndPct(curVal, prVal);

                  return (
                    <AccountGroupRow key={row.key} depth={row.depth} hasChildren={row.hasChildren} label={acc.name}
                      expanded={!collapsedGroups.has(acc.id)}
                      onToggle={() => setCollapsedGroups(collapsed => toggleAccountGroup(collapsed, acc.id))}>
                    <button
                      type="button" onClick={() => {
                        const matchedTxs = transactions.filter(t => isPostable(t) && isTransactionInDateRange(t, undefined, asOfDate) && t.lines?.some(l => l.accountId === acc.id || l.accountName === acc.name));
                        setDrillDownTarget({ accountName: acc.name, transactions: matchedTxs, explain: { accountIds: [acc.id], endDate: asOfDate || undefined, expectedCents: curVal, sign: -1 } });
                      }}
                      title={`Click to drill down into ${acc.name}`}
                      className="w-full text-left flex justify-between items-center hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20 p-2 rounded-lg transition-all border border-transparent hover:border-indigo-300 dark:hover:border-indigo-800 min-w-0 cursor-pointer group/row"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 bg-[var(--ink)] text-[var(--muted)] rounded-md flex items-center justify-center text-[9px] font-bold font-mono border border-[var(--line)] shrink-0">
                          {acc.code}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-[var(--text)] group-hover/row:text-indigo-600 transition-colors uppercase tracking-tight truncate flex items-center gap-1.5">
                            {acc.name}
                            <ExternalLink aria-hidden="true" size={10} className="opacity-0 group-hover/row:opacity-100 text-indigo-500 transition-opacity" />
                          </p>
                          <p className="text-[9px] font-bold text-[var(--muted)] uppercase tracking-wider truncate">{acc.category || 'Owner Equity'}</p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end shrink-0 ml-2">
                        <span className="font-mono font-bold text-[var(--text)] text-xs tabular-nums"><bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(curVal)}</bdi></span>
                        {isComparative && (
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="font-mono text-[8px] text-[var(--muted)] tabular-nums">prev: <bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(prVal)}</bdi></span>
                            {variance.pct !== null && prVal !== 0 && (
                              <span className={cn("text-[8px] font-bold", variance.pct <= 0 ? "text-emerald-500" : "text-rose-500")}>
                                {variance.pct >= 0 ? '+' : ''}{variance.pct.toFixed(1)}%
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </button>
                    </AccountGroupRow>
                  );
                })}

                {/* Retained Earnings Line Item */}
                <button
                  type="button" onClick={() => {
                    const matchedTxs = transactions.filter(t => isPostable(t) && isTransactionInDateRange(t, undefined, asOfDate) && t.lines?.some(l => {
                      const account = accounts.find(a => a.id === l.accountId);
                      return account && (account.type === 'income' || account.type === 'revenue' || account.type === 'expense' || account.type === 'cost_of_goods');
                    }));
                    setDrillDownTarget({ accountName: 'Retained Earnings (Income & Expenses)', transactions: matchedTxs });
                  }}
                  title="Click to drill down into Retained Earnings transaction activity"
                  className="w-full text-left flex justify-between items-center bg-emerald-50/20 hover:bg-emerald-50/50 p-2 rounded-lg transition-all border border-emerald-100/40 hover:border-emerald-300 min-w-0 cursor-pointer group/row"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 bg-emerald-50 text-emerald-600 rounded-md flex items-center justify-center text-[9px] font-bold font-mono border border-emerald-100 shrink-0">
                      INC
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-emerald-800 group-hover/row:text-emerald-950 uppercase tracking-tight truncate flex items-center gap-1.5">
                        {labels.retainedEarningsLabel}
                        <ExternalLink aria-hidden="true" size={10} className="opacity-0 group-hover/row:opacity-100 text-emerald-600 transition-opacity" />
                      </p>
                      <p className="text-[8px] font-bold text-emerald-600/60 uppercase tracking-wider truncate">{labels.retainedEarningsSub}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end shrink-0 ml-2">
                    <span className={cn("font-mono font-bold text-xs", currentData.netIncome >= 0 ? "text-emerald-700" : "text-rose-700", "tabular-nums")}>
                      <bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(currentData.netIncome)}</bdi>
                    </span>
                    {isComparative && (
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="font-mono text-[8.5px] text-[var(--muted)] tabular-nums">prev: <bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(prevData.netIncome)}</bdi></span>
                        {prevData.netIncome !== 0 && (
                          <span className={cn("text-[8.5px] font-bold", (currentData.netIncome >= prevData.netIncome) ? "text-emerald-500" : "text-rose-500")}>
                            {(((currentData.netIncome - prevData.netIncome) / Math.abs(prevData.netIncome)) * 100).toFixed(1)}%
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </button>

                <div className="flex justify-between items-center pt-2 text-[var(--muted)] text-[8px] font-bold uppercase tracking-wider">
                  <span>Sub-Total Equity</span>
                  <span className="font-mono font-semibold tabular-nums"><bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(currentData.totalEquity + currentData.netIncome)}</bdi></span>
                </div>
              </div>
            </div>

            {/* Combined Total Liabilities & Equity */}
            <div className="mt-6 pt-4 border-t border-slate-900 flex justify-between items-center relative overflow-hidden gap-4">
              <div className="space-y-0.5 min-w-0">
                <span className="text-[var(--text)] font-bold uppercase tracking-wider text-[9px] block">{labels.totalClaimsLabel}</span>
                {!currentData.isBalanced && (
                  <motion.span 
                    animate={{ opacity: [1, 0.4, 1] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                    className="text-[8px] text-rose-600 font-bold uppercase tracking-wider flex items-center gap-1 truncate"
                  >
                    <AlertCircle aria-hidden="true" size={10} className="shrink-0" /> Balance Drift Detected
                  </motion.span>
                )}
              </div>
              <div className="text-right shrink-0">
                <span className="text-lg font-mono font-bold text-[var(--text)] tracking-tight block leading-none tabular-nums">
                  <bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(currentData.totalClaims)}</bdi>
                </span>
                {isComparative && prevData.totalClaims !== 0 && (
                  <span className={cn("text-[9px] font-bold block mt-1", currentData.totalClaims >= prevData.totalClaims ? "text-emerald-500" : "text-rose-500")}>
                    {(((currentData.totalClaims - prevData.totalClaims) / Math.abs(prevData.totalClaims)) * 100).toFixed(1)}% vs Prior
                  </span>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      )}

      {/* Drill-Down Modal */}

      {drillDownTarget && (
        <DrillDownModal
          isOpen={!!drillDownTarget}
          onClose={() => setDrillDownTarget(null)}
          accountName={drillDownTarget.accountName}
          from="Balance Sheet"
          transactions={drillDownTarget.transactions}
          formatCurrency={formatCurrency}
          explain={drillDownTarget.explain}
        />
      )}
    </div>
  );
}
