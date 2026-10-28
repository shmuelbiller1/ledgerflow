import { toast } from 'sonner';
import { useState } from 'react';
import { AlertCircle, Layers, HandCoins, ShieldCheck, Activity, FileSpreadsheet, ArrowUp, ArrowDown, ExternalLink } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { ChartAccount } from '../../types';
import { accountGroupLayout, groupSubtotals, toggleAccountGroup, visibleGroupRows } from '../../lib/accountGroups';
import { AccountGroupRow, AccountGroupSubtotal } from './AccountGroupControls';
import { isEarningsAccount, isPostable, isTransactionInDateRange } from '../../lib/txFilters';
import { motion } from 'motion/react';
import MonthNavigator from '../ui/MonthNavigator';
import DrillDownModal from '../layout/DrillDownModal';
import { statementTotalDrill, type StatementTotal } from '../../lib/statementDrill';
import type { BalanceSheetModel } from './BalanceSheetView';
import { StatementColumns } from './StatementColumns';
import { ReportProvenanceNote } from '../reporting/ReportProvenanceNote';
import ReportPeriodHeading from '../reporting/ReportPeriodHeading';
import ReportEmptyState from '../reporting/ReportEmptyState';

export function BalanceSheetReport({ serverAsOf, columnMode, setColumnMode, showPercent, setShowPercent, columnStartDate, columnCompareStartDate, accounts, formatCurrency, formId, transactions, asOfDate, setAsOfDate, isComparative, setIsComparative, priorDate, setPriorDate, sortBy, sortDir, drillDownTarget, setDrillDownTarget, basis, chooseBasis, cashReady, provenance, loadingStates, isServerAuthoritative, loadServerReport, toggleSort, labels, currentData, prevData, exportBalanceSheet, getVarianceAndPct }: BalanceSheetModel) {

  // C-95: the totals open the posted entries they are made of (the server explains the same figure).
  // On cash basis the server's totals carry cash adjustments the posted lines do not hold (unapplied
  // payments are added to liabilities), so the entries are not opened there and the button says why.
  const cashBasis = basis === 'cash';
  const drillTotal = (total: StatementTotal) => {
    if (cashBasis) { toast.info('On cash basis the totals include the server’s cash adjustments, so the entries behind them are not listed yet: switch to accrual to see them'); return; }
    const target = statementTotalDrill(total, transactions);
    if (target) setDrillDownTarget(target);
  };
  const totalIds = (section?: Record<string, number>) => Object.keys(section || {});
  /** the accounts whose balances make the earnings on this date (the same rule as calculateNetIncome) */
  const earningsAccountIds = accounts.filter(isEarningsAccount).map(account => account.id);
  const cashReason = 'Cash basis totals include the server’s cash adjustments; switch to accrual to open the entries.';
  const entriesLink = "min-h-11 px-1 text-[9px] font-bold uppercase tracking-wider text-[var(--muted)] underline decoration-dotted underline-offset-2 hover:text-indigo-500 focus-visible:text-indigo-500 disabled:no-underline disabled:opacity-60 self-end";
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
      {/* AUD-10: where these figures come from */}
      <ReportProvenanceNote id="bs-statement-provenance" provenance={provenance} onRefresh={loadServerReport} busy={loadingStates.balanceSheet} />
      {/* A-220: the as-of date in the reader's own date style */}
      <ReportPeriodHeading
        asOf
        className="text-sm font-medium text-[var(--muted)] tabular-nums"
        startDate={columnStartDate}
        endDate={asOfDate}
        compareEndDate={isComparative ? priorDate : undefined}
      />
      {serverAsOf && <p data-testid="bs-balances-source" className="text-xs text-[var(--muted)]">Balances include every entry through {serverAsOf} as summed by the server, plus the loaded entries after it.</p>}


      {/* Period navigation/actions and aligned report filters. */}
      <div data-testid="report-controls" role="region" aria-label="Report filters" className="p-4 sm:p-5 bg-[var(--surface)] border border-[var(--line)]/80 rounded-xl shadow-3xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <MonthNavigator
            className="[&_button]:min-h-11 [&_button]:min-w-11 [&_button]:text-[var(--text)]"
            currentDate={asOfDate}
            onMonthChange={({ end }) => setAsOfDate(end)}
          />
          {(basis === 'cash' || (columnMode === 'total' && !showPercent && !isComparative)) && <button data-report-primary-action
            onClick={exportBalanceSheet}
            className="flex min-h-11 items-center justify-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-bold uppercase text-[10px] tracking-wider transition-all shadow-sm active:scale-95 group/btn w-full sm:w-auto cursor-pointer"
           aria-label="Export to Excel">
            <FileSpreadsheet aria-hidden="true" size={13} className="text-emerald-400 group-hover/btn:text-emerald-300 transition-colors shrink-0" />
            <span>Export to Excel</span>
          </button>}
        </div>
        <div data-testid="report-filter-grid" className={cn("grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(130px,1fr)_minmax(146px,1.2fr)_minmax(128px,1fr)_minmax(210px,1.3fr)] gap-2 items-start", isComparative && "xl:grid-cols-[minmax(130px,1fr)_minmax(130px,1fr)_minmax(146px,1.2fr)_minmax(128px,1fr)_minmax(210px,1.3fr)]")}>
          <label data-filter-group className="flex min-w-0 flex-col gap-1 text-[9px] font-bold text-[var(--text)]" htmlFor={`${formId}-as-of`}>As Of Reporting Date
            <input id={`${formId}-as-of`} type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="bg-[var(--ink)] min-h-11 min-w-0 w-full border border-[var(--line)] text-xs font-semibold px-2 py-1 rounded-md focus-visible:ring-2 focus-visible:ring-[var(--brass)] outline-none text-[var(--text)] normal-case tracking-normal" />
          </label>
          {isComparative && <label data-filter-group className="flex min-w-0 flex-col gap-1 text-[9px] font-bold text-[var(--text)]" htmlFor={`${formId}-prior-as-of`}>Prior As Of Reference
            <input id={`${formId}-prior-as-of`} type="date" value={priorDate} onChange={(e) => setPriorDate(e.target.value)} className="bg-[var(--ink)] min-h-11 min-w-0 w-full border border-[var(--line)] text-xs font-semibold px-2 py-1 rounded-md focus-visible:ring-2 focus-visible:ring-[var(--brass)] outline-none text-[var(--text)] normal-case tracking-normal" />
          </label>}
          <label data-filter-group className="flex min-w-0 flex-col gap-1 text-[9px] font-bold text-[var(--text)]">Basis
            <select aria-label="Basis" value={basis} onChange={e => chooseBasis(e.target.value === 'cash' ? 'cash' : 'accrual')} className="bg-[var(--ink)] min-h-11 min-w-0 w-full border border-[var(--line)] text-xs font-semibold px-2 py-1 rounded-md focus-visible:ring-2 focus-visible:ring-[var(--brass)] outline-none text-[var(--text)] normal-case tracking-normal">
              <option value="accrual">Accrual (as posted)</option><option value="cash">Cash (when paid)</option>
            </select>
          </label>
          <div data-filter-group className="flex min-w-0 flex-col gap-1 text-[9px] font-bold text-[var(--text)]">
            <span>Comparison</span>
            <label htmlFor={`${formId}-comparative`} aria-label="Comparative Year-on-Year" className="flex min-h-11 items-center gap-2 cursor-pointer rounded focus-within:outline focus-within:outline-2 focus-within:outline-[var(--brass)]">
              <input id={`${formId}-comparative`} type="checkbox" className="sr-only" checked={isComparative} disabled={basis === 'cash'} onChange={(e) => setIsComparative(e.target.checked)} />
              <span aria-hidden="true" className={cn("w-8 h-4 shrink-0 rounded-full flex items-center p-0.5", isComparative ? "bg-indigo-500" : "bg-slate-300")}>
                <span className={cn("w-3 h-3 bg-[var(--surface)] rounded-full shadow-sm", isComparative ? "translate-x-4" : "translate-x-0")} />
              </span>
              <span className="text-[10px] text-[var(--text)]">Previous year</span>
            </label>
          </div>
          <div data-filter-group className="flex min-w-0 flex-col gap-1 text-[9px] font-bold text-[var(--text)]"><span>Sort</span>
            <div className="flex items-center gap-1 bg-[var(--ink)] rounded-lg">
            {(['code', 'name', 'balance'] as const).map(field => (
              <button
                key={field}
                aria-pressed={sortBy === field}
                onClick={() => toggleSort(field)}
                className={cn(
                  "min-h-11 min-w-11 flex-1 justify-center px-2 py-1 text-[9px] font-bold tracking-normal rounded transition-colors flex items-center gap-1 cursor-pointer",
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
          </div>
        </div>
      </div>

      {accounts.length === 0 && (
        <ReportEmptyState title="No accounts yet" description="Set up the chart of accounts, then add an entry or choose another date." />
      )}

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
              <span className="block text-xs font-mono font-medium text-[var(--muted)] tabular-nums whitespace-nowrap">
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
          initial={{ y: 10 }}
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
                          <span className="truncate" title={acc.name}>{acc.name}</span>
                          <ExternalLink aria-hidden="true" size={10} className="opacity-0 group-hover/row:opacity-100 text-indigo-500 transition-opacity" />
                        </p>
                        <p className="text-[9px] font-bold text-[var(--muted)] uppercase tracking-wider truncate">{acc.category || 'Direct Asset'}</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end shrink-0 ml-2">
                      <span className="font-mono font-bold text-[var(--text)] text-xs tabular-nums whitespace-nowrap"><bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(curVal)}</bdi></span>
                      {isComparative && (
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="font-mono text-[8px] text-[var(--muted)] tabular-nums whitespace-nowrap">prev: <bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(prVal)}</bdi></span>
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
                <span className="text-lg font-mono font-bold text-[var(--text)] tracking-tight block leading-none tabular-nums whitespace-nowrap"><bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(currentData.totalAssets)}</bdi></span>
                {isComparative && prevData.totalAssets !== 0 && (
                  <span className={cn("text-[9px] font-bold block mt-1", currentData.totalAssets >= prevData.totalAssets ? "text-emerald-500" : "text-rose-500")}>
                    {(((currentData.totalAssets - prevData.totalAssets) / Math.abs(prevData.totalAssets)) * 100).toFixed(1)}% vs Prior
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => drillTotal({ name: `Total ${labels.assetsLabel}`, accountIds: totalIds(currentData.assets), expectedCents: currentData.totalAssets, sign: 1, endDate: asOfDate || undefined })}
                aria-label={`See the entries behind total ${labels.assetsLabel}`}
                disabled={cashBasis}
                title={cashBasis ? cashReason : undefined}
                className={entriesLink}
              >Entries</button>
            </div>
          </div>
        </motion.div>

        {/* Liabilities & Equity Column */}
        <motion.div 
          initial={{ y: 10 }}
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
                            <span className="truncate" title={acc.name}>{acc.name}</span>
                            <ExternalLink aria-hidden="true" size={10} className="opacity-0 group-hover/row:opacity-100 text-indigo-500 transition-opacity" />
                          </p>
                          <p className="text-[9px] font-bold text-[var(--muted)] uppercase tracking-wider truncate">{acc.category || 'Current Liability'}</p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end shrink-0 ml-2">
                        <span className="font-mono font-bold text-[var(--text)] text-xs tabular-nums whitespace-nowrap"><bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(curVal)}</bdi></span>
                        {isComparative && (
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="font-mono text-[8px] text-[var(--muted)] tabular-nums whitespace-nowrap">prev: <bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(prVal)}</bdi></span>
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
                    <span className="font-mono tabular-nums whitespace-nowrap"><bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(currentData.notApplied || 0)}</bdi></span>
                  </div>
                )}
                <div className="flex flex-wrap justify-between items-center pt-2 text-[var(--muted)] text-[8px] font-bold uppercase tracking-wider">
                  <span>Sub-Total Liabilities</span>
                  <span className="font-mono font-semibold tabular-nums whitespace-nowrap"><bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(currentData.totalLiabilities)}</bdi></span>
                  <button
                    type="button"
                    onClick={() => drillTotal({ name: `Sub-total ${labels.liabilitiesLabel}`, accountIds: totalIds(currentData.liabilities), expectedCents: currentData.totalLiabilities, sign: -1, endDate: asOfDate || undefined })}
                    aria-label={`See the entries behind sub-total ${labels.liabilitiesLabel}`}
                    disabled={cashBasis}
                    title={cashBasis ? cashReason : undefined}
                    className={entriesLink}
                  >Entries</button>
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
                            <span className="truncate" title={acc.name}>{acc.name}</span>
                            <ExternalLink aria-hidden="true" size={10} className="opacity-0 group-hover/row:opacity-100 text-indigo-500 transition-opacity" />
                          </p>
                          <p className="text-[9px] font-bold text-[var(--muted)] uppercase tracking-wider truncate">{acc.category || 'Owner Equity'}</p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end shrink-0 ml-2">
                        <span className="font-mono font-bold text-[var(--text)] text-xs tabular-nums whitespace-nowrap"><bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(curVal)}</bdi></span>
                        {isComparative && (
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="font-mono text-[8px] text-[var(--muted)] tabular-nums whitespace-nowrap">prev: <bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(prVal)}</bdi></span>
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
                  className="w-full text-left flex justify-between items-center bg-[var(--brass-soft)] hover:bg-[var(--surface)] text-[var(--text)] p-2 rounded-lg transition-all border border-[var(--brass-line)] hover:border-[var(--brass)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brass)] min-h-11 min-w-0 cursor-pointer group/row"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 bg-[var(--panel)] text-[var(--text)] rounded-md flex items-center justify-center text-[9px] font-bold font-mono border border-[var(--line)] shrink-0">
                      INC
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-[var(--text)] uppercase tracking-tight truncate flex items-center gap-1.5">
                        {labels.retainedEarningsLabel}
                        <ExternalLink aria-hidden="true" size={10} className="opacity-0 group-hover/row:opacity-100 text-[var(--text)] transition-opacity" />
                      </p>
                      <p className="text-[8px] font-bold text-[var(--text)] uppercase tracking-wider truncate">{labels.retainedEarningsSub}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end shrink-0 ml-2">
                    <span className="font-mono font-bold text-xs text-[var(--text)] tabular-nums whitespace-nowrap">
                      <bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(currentData.netIncome)}</bdi>
                    </span>
                    {isComparative && (
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="font-mono text-[8.5px] text-[var(--text)] tabular-nums whitespace-nowrap">prev: <bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(prevData.netIncome)}</bdi></span>
                        {prevData.netIncome !== 0 && (
                          <span className="text-[8.5px] font-bold text-[var(--text)]">
                            {(((currentData.netIncome - prevData.netIncome) / Math.abs(prevData.netIncome)) * 100).toFixed(1)}%
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </button>

                <div className="flex flex-wrap justify-between items-center pt-2 text-[var(--muted)] text-[8px] font-bold uppercase tracking-wider">
                  <span>Sub-Total Equity</span>
                  <span className="font-mono font-semibold tabular-nums whitespace-nowrap"><bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(currentData.totalEquity + currentData.netIncome)}</bdi></span>
                  <button
                    type="button"
                    onClick={() => drillTotal({
                      name: `Sub-total ${labels.equityLabel}`,
                      // the subtotal printed beside this button is the equity accounts plus the earnings
                      accountIds: [...totalIds(currentData.equity), ...earningsAccountIds],
                      expectedCents: currentData.totalEquity + currentData.netIncome,
                      sign: -1,
                      endDate: asOfDate || undefined,
                    })}
                    aria-label={`See the entries behind sub-total ${labels.equityLabel}`}
                    disabled={cashBasis}
                    title={cashBasis ? cashReason : undefined}
                    className={entriesLink}
                  >Entries</button>
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
                <span className="text-lg font-mono font-bold text-[var(--text)] tracking-tight block leading-none tabular-nums whitespace-nowrap">
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
