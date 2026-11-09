

import { Plus, Table as TableIcon, Sparkles, Check, Layers, ArrowDownRight, X } from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';

import { TransactionColumnLayoutControls } from './TransactionColumnLayoutControls';
import { OPTIONAL_COLUMNS } from '../../lib/transactionColumns';

import { cn, resolveAccountName, formatCurrency, getLocalDateISO } from '../../lib/utils';
import { csvMoney, downloadCsv } from '../../lib/csvExport';

import SavedViewsBar from '../ui/SavedViewsBar';
import DeepSearchBar from '../ui/DeepSearchBar';

import type { TransactionGridModel } from './TransactionGrid';
export function TransactionGridToolbar({ model }: { model: TransactionGridModel }) {
 const { columnLayout, setColumnWidth, moveColumn, resetColumnLayout, formId, onAction, onNewEntry, isProMode, isCompactMode, setProMode, setCompactMode, searchTerm, setSearchTerm, viewMode, setViewMode, selectedIds, setSelectedIds, toggleSelectAll, accounts, activeView, transactionsWithBalance, stats, activeFilterColumn, setActiveFilterColumn, hiddenColumns, toggleColumnVisibility, signedCents, handleExportCSV, handleBulkUpdate, handleBulkSweep } = model;
 return (<div className="p-5 border-b border-[var(--line)] space-y-4 bg-[var(--surface)]/95 backdrop-blur-md sticky top-0 z-30 shadow-xs">
        <div className="flex flex-col 2xl:flex-row 2xl:items-center justify-between gap-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="flex flex-col">
              <h1 className="text-xl md:text-2xl font-black text-[var(--text)] tracking-tight leading-none">
                Journal Entries
              </h1>
            </div>
            <div className="hidden sm:block h-10 w-px bg-slate-200 mx-2" />
            <div className="flex bg-[var(--panel)] p-1 rounded-xl border border-[var(--line)] self-stretch sm:self-auto shadow-3xs">
              <button
                onClick={() => setViewMode('grid')}
                className={cn("flex-1 sm:flex-none h-8 px-3 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer", viewMode === 'grid' ? "bg-[var(--brass)] text-[var(--ink)] shadow-xs scale-[1.02]" : "text-[var(--muted)] hover:text-[var(--text)]")}
              >
                Grid
              </button>
              <button
                onClick={() => setViewMode('pivot')}
                className={cn("flex-1 sm:flex-none h-8 px-3 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer", viewMode === 'pivot' ? "bg-[var(--brass)] text-[var(--ink)] shadow-xs scale-[1.02]" : "text-[var(--muted)] hover:text-[var(--text)]")}
              >
                Pivot
              </button>
              <div className="w-px h-4 bg-slate-300 self-center mx-1" />
              <button
                onClick={() => setProMode(!isProMode)}
                title="Toggle Pro Density Mode"
                className={cn("flex-1 sm:flex-none h-8 px-2.5 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer", isProMode ? "bg-indigo-600 text-white shadow-xs" : "text-[var(--muted)] hover:text-[var(--text)]")}
              >
                Pro
              </button>
              <button
                onClick={() => setCompactMode(!isCompactMode)}
                title="Toggle Ultra Compact Mode"
                className={cn("flex-1 sm:flex-none h-8 px-2.5 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer", isCompactMode ? "bg-slate-900 text-white shadow-xs" : "text-[var(--muted)] hover:text-[var(--text)]")}
              >
                Compact
              </button>
            </div>
          </div>

          <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-3 flex-1 min-w-0 max-w-[900px] mt-2 2xl:mt-0">
             <button
                onClick={toggleSelectAll}
                aria-label={selectedIds.size > 0 ? `Selected ${selectedIds.size} transactions` : 'Select all transactions'}
                className={cn(
                  "hidden xl:flex h-10 px-4 items-center gap-3 rounded-xl border transition-all text-[9px] font-bold uppercase tracking-wider shrink-0 cursor-pointer",
                  selectedIds.size > 0
                  ? "bg-[var(--brass)] text-[var(--ink)] border-[var(--brass-line)] shadow-xs"
                  : "bg-[var(--surface)] text-[var(--muted)] border-[var(--line)] hover:border-[var(--brass-line)] hover:text-[var(--text)] shadow-3xs"
                )}
              >
                <div className={cn(
                  "w-4 h-4 rounded border flex items-center justify-center transition-all",
                  selectedIds.size === transactionsWithBalance.length && transactionsWithBalance.length > 0
                  ? "bg-black border-black text-white"
                  : "border-[var(--line)] bg-[var(--surface)]"
                )}>
                  {selectedIds.size === transactionsWithBalance.length && transactionsWithBalance.length > 0 && <Check aria-hidden="true" size={10} className="stroke-[3px]" />}
                  {selectedIds.size > 0 && selectedIds.size < transactionsWithBalance.length && <div className="w-2 h-0.5 bg-black" />}
                </div>
                <span>{selectedIds.size > 0 ? `${selectedIds.size} Selected` : 'Select All'}</span>
              </button>

            <div className="flex flex-col gap-2 flex-1 min-w-0">
              {selectedIds.size > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 p-2 bg-slate-900/10 border border-indigo-600/20 rounded-xl"
                >
                  <span className="text-xs font-bold text-indigo-700 dark:text-indigo-300 px-2">{selectedIds.size} Selected</span>
                  <div className="h-4 w-px bg-slate-900/20" />

                  {/* State Machine Actions */}
                  <button onClick={() => handleBulkUpdate({ isLocked: true })} className="flex items-center gap-1.5 px-3 py-1 bg-[var(--surface)] hover:bg-[var(--ink)] text-slate-700 text-[10px] font-bold uppercase tracking-wider rounded-lg border border-[var(--line)] transition-colors">
                    Lock
                  </button>
                  <button onClick={() => handleBulkUpdate({ isLocked: false })} className="flex items-center gap-1.5 px-3 py-1 bg-[var(--surface)] hover:bg-[var(--ink)] text-slate-700 text-[10px] font-bold uppercase tracking-wider rounded-lg border border-[var(--line)] transition-colors">
                    Unlock
                  </button>
                  <button onClick={() => handleBulkUpdate({ status: 'approved' })} className="flex items-center gap-1.5 px-3 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase tracking-wider rounded-lg border border-emerald-200 transition-colors">
                    Approve
                  </button>
                  <button onClick={() => handleBulkUpdate({ status: 'flagged' })} className="flex items-center gap-1.5 px-3 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 text-[10px] font-bold uppercase tracking-wider rounded-lg border border-amber-200 transition-colors">
                    Flag
                  </button>
                  <button onClick={() => handleBulkUpdate({ status: 'void' })} className="flex items-center gap-1.5 px-3 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 text-[10px] font-bold uppercase tracking-wider rounded-lg border border-rose-200 transition-colors">
                    Void
                  </button>

                  <div className="flex-1" />
                  <button aria-label="Clear transaction selection" onClick={() => setSelectedIds(new Set())} className="p-1 hover:bg-black/5 rounded text-[var(--muted)]">
                    <X aria-hidden="true" size={14} />
                  </button>
                </motion.div>
              )}

              {/* Saved Views Bar */}
              <SavedViewsBar currentSearchTerm={searchTerm} className="mb-2" />

              <div className="flex flex-col lg:flex-row lg:flex-wrap items-center gap-2 flex-1 min-w-0">
                <div className="flex-1 w-full min-w-0">
                  <DeepSearchBar
                    value={searchTerm}
                    onChange={setSearchTerm}
                    metrics={stats}
                    placeholder={activeView?.filter?.searchTerm ? `Search within view... (default: ${activeView.filter.searchTerm})` : "Search entries… (e.g. > 500, this month, tag:tax)"}
                  />
                </div>

                <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                  <button
                    onClick={() => setActiveFilterColumn(activeFilterColumn === 'visibility' ? null : 'visibility')}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all border shrink-0 cursor-pointer",
                      activeFilterColumn === 'visibility' ? "bg-[var(--brass)] text-[var(--ink)] border-[var(--brass-line)] font-bold" : "bg-[var(--surface)] text-[var(--muted)] border-[var(--line)] hover:text-[var(--text)] shadow-3xs"
                    )}
                  >
                    <Layers aria-hidden="true" size={13} className="shrink-0" />
                    Columns
                  </button>

                  {activeFilterColumn === 'visibility' && (
                    <div className="absolute top-10 right-0 z-[150] w-[min(26rem,90vw)] max-h-[70vh] overflow-y-auto bg-[var(--surface)] border border-[var(--line)] rounded-xl shadow-lg p-3 normal-case font-medium text-[var(--text)]">
                      <p className="text-[9px] font-bold text-[var(--muted)] uppercase tracking-widest mb-2">Visible Columns</p>
                      <div className="space-y-1">
                        {OPTIONAL_COLUMNS.map(([col, label]) => (
                          <label htmlFor={`${formId}-column-${col}`} key={col} className="flex items-center gap-2 p-1.5 hover:bg-[var(--ink)] rounded-lg cursor-pointer transition-colors">
                            <input
                              id={`${formId}-column-${col}`}
                              type="checkbox"
                              checked={!hiddenColumns.has(col)}
                              onChange={() => toggleColumnVisibility(col)}
                              className="w-3.5 h-3.5 rounded border-[var(--line)] text-[var(--brass)] focus:ring-[var(--brass)]"
                            />
                            <span className="text-xs text-[var(--text)]">{label}</span>
                          </label>
                        ))}
                      </div>
                      <TransactionColumnLayoutControls layout={columnLayout} setWidth={setColumnWidth} move={moveColumn} reset={resetColumnLayout} />
                    </div>
                  )}

                  <button
                    onClick={handleExportCSV}
                    className="flex items-center gap-1.5 px-3 py-2 bg-[var(--surface)] text-[var(--muted)] border border-[var(--line)] rounded-xl text-[10px] font-bold uppercase tracking-wider hover:text-[var(--text)] transition-all shrink-0 shadow-3xs cursor-pointer"
                    aria-label="Export CSV"
                  >
                    <ArrowDownRight aria-hidden="true" size={13} className="rotate-90 shrink-0" />
                    Export
                  </button>

                  <button
                    onClick={() => onAction?.('open-command-center')}
                    className="w-9 h-9 bg-[var(--brass)] text-[var(--ink)] rounded-xl flex items-center justify-center hover:opacity-90 transition-all shadow-sm shrink-0 cursor-pointer"
                    title="Open Command Center"
                    aria-label="Open Command Center"
                  >
                    <Sparkles aria-hidden="true" size={15} className="shrink-0 text-black" />
                  </button>
                </div>
              </div>
            </div>

            <button
              onClick={onNewEntry}
              className="h-10 px-5 bg-[var(--brass)] text-[var(--ink)] hover:opacity-90 rounded-xl text-xs font-bold transition-all active:scale-95 whitespace-nowrap flex items-center gap-2 shadow-xs cursor-pointer"
              aria-label="Create new entry"
            >
              <Plus aria-hidden="true" size={14} className="stroke-[3px]" />
              New Entry
            </button>
          </div>
        </div>

        {/* Three-Cell Filtered Totals Summary Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 lg:gap-6 pt-3 border-t border-[var(--line)]/30">
          <div className="flex flex-wrap items-center gap-3 sm:gap-4 md:gap-6">
             <div
               data-testid="filtered-totals-bar"
               className="flex flex-wrap items-center divide-x divide-[var(--line)]/50 bg-[var(--surface)] border border-[var(--line)] rounded-xl shadow-xs overflow-hidden"
             >
               {/* Filtered Inflow */}
               <div data-testid="filtered-inflow" className="flex items-center gap-2 px-3 py-2">
                 <span className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider">Money in:</span>
                 <span className="text-xs font-black text-[var(--pos)] tabular-nums">
                   +{formatCurrency(stats.inflowCents)}
                 </span>
               </div>

               {/* Filtered Outflow */}
               <div data-testid="filtered-outflow" className="flex items-center gap-2 px-3 py-2">
                 <span className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider">Money out:</span>
                 <span className="text-xs font-black text-[var(--neg)] tabular-nums">
                   -{formatCurrency(stats.outflowCents)}
                 </span>
               </div>

               {/* Matching Records */}
               <div data-testid="matching-records" className="flex items-center gap-2 px-3 py-2">
                 <div className={cn("w-2 h-2 rounded-full shrink-0", stats.discrepancies > 0 ? "bg-rose-500 animate-pulse" : "bg-emerald-500")} />
                 <span className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider">Entries:</span>
                 <span className="text-xs font-black text-[var(--text)] tabular-nums">
                   {stats.count.toLocaleString()}
                 </span>
               </div>
             </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 md:gap-4 bg-[var(--ink)]/20 p-1.5 rounded-[32px] border border-[var(--line)]/40 w-full sm:w-auto">
            <button
              onClick={() => {
                downloadCsv(`ledgerflow_transactions_${getLocalDateISO()}.csv`,
                  ['Date', 'Description', 'Amount', 'Currency', 'Account', 'Project', 'Notes'],
                  transactionsWithBalance.map(t => [t.date, t.description, csvMoney(signedCents(t)), t.currency || 'USD', resolveAccountName(accounts, t.lines?.[0]?.accountId, t.lines?.[0]?.accountName), t.project || '', t.notes || '']));
                toast.success('Transactions exported to CSV.');
              }}
              className="flex-1 sm:flex-none flex justify-center items-center gap-2 md:gap-3 px-4 md:px-6 py-3 text-[9px] md:text-[10px] font-black text-[var(--muted)] uppercase tracking-widest hover:text-[var(--text)] hover:bg-[var(--surface)] rounded-xl transition-all"
            >
              <TableIcon aria-hidden="true" size={16} />
              <span className="hidden sm:inline">Export CSV</span>
              <span className="sm:hidden">Export</span>
            </button>
            <div className="w-px h-6 bg-slate-200 opacity-50" />
            <button
              onClick={handleBulkSweep}
              className="flex-1 sm:flex-none flex justify-center items-center gap-2 md:gap-3 px-4 md:px-6 py-3 text-[9px] md:text-[10px] font-black text-indigo-700 dark:text-indigo-300 uppercase tracking-widest bg-[var(--surface)] border border-indigo-600/20 hover:border-indigo-600 rounded-xl transition-all shadow-sm shrink-0 cursor-pointer"
              aria-label="Suggest categories for uncategorized entries"
            >
              <Sparkles aria-hidden="true" size={16} className="shrink-0" />
              <span className="hidden sm:inline">Suggest categories</span>
              <span className="sm:hidden">Categorize</span>
            </button>
          </div>
        </div>
      </div>);
}
