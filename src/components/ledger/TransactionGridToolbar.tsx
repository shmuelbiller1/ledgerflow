

import { useState } from 'react';
import { Plus, Check, Layers, X, MoreHorizontal } from 'lucide-react';
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

 const [moreOpen, setMoreOpen] = useState(false);
 const btn = "h-9 px-3 inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] text-xs font-semibold text-[var(--text)] hover:border-[var(--brass-line)] shrink-0 cursor-pointer";
 const menuItem = "w-full text-left px-3 py-2 text-sm rounded-md hover:bg-[var(--ink)] flex items-center justify-between gap-3";
 const exportCsv = () => {
   downloadCsv(`ledgerflow_transactions_${getLocalDateISO()}.csv`,
     ['Date', 'Description', 'Amount', 'Currency', 'Account', 'Project', 'Notes'],
     transactionsWithBalance.map(t => [t.date, t.description, csvMoney(signedCents(t)), t.currency || 'USD', resolveAccountName(accounts, t.lines?.[0]?.accountId, t.lines?.[0]?.accountName), t.project || '', t.notes || '']));
   toast.success('Transactions exported to CSV.');
 };
 return (<div className="px-4 py-2.5 border-b border-[var(--line)] bg-[var(--surface)] space-y-2">
      {/* one row: title, search, totals, columns, more, new entry */}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-bold text-[var(--text)] leading-none mr-2 shrink-0">Journal Entries</h1>
        <div className="flex-1 min-w-[14rem]">
          <DeepSearchBar
            value={searchTerm}
            onChange={setSearchTerm}
            metrics={stats}
            placeholder={activeView?.filter?.searchTerm ? `Search within view... (default: ${activeView.filter.searchTerm})` : "Search entries… (e.g. > 500, this month, tag:tax)"}
          />
        </div>
        <div data-testid="filtered-totals-bar" className="hidden md:flex items-center gap-3 px-2 text-xs text-[var(--muted)] shrink-0">
          <span data-testid="filtered-inflow" className="whitespace-nowrap" title="Money in">In: <span className="font-semibold text-[var(--pos)] tabular-nums">+{formatCurrency(stats.inflowCents)}</span></span>
          <span data-testid="filtered-outflow" className="whitespace-nowrap" title="Money out">Out: <span className="font-semibold text-[var(--neg)] tabular-nums">-{formatCurrency(stats.outflowCents)}</span></span>
          <span data-testid="matching-records" className="whitespace-nowrap">Entries: <span className={cn("font-semibold tabular-nums", stats.discrepancies > 0 ? "text-rose-500" : "text-[var(--text)]")}>{stats.count.toLocaleString()}</span></span>
        </div>
        <div className="relative shrink-0">
          <button type="button" onClick={() => setActiveFilterColumn(activeFilterColumn === 'visibility' ? null : 'visibility')} aria-expanded={activeFilterColumn === 'visibility'} className={btn}>
            <Layers aria-hidden="true" size={14} /> Columns
          </button>
          {activeFilterColumn === 'visibility' && (
            <div className="absolute top-10 right-0 z-[150] w-[min(26rem,90vw)] max-h-[70vh] overflow-y-auto bg-[var(--surface)] border border-[var(--line)] rounded-xl shadow-lg p-3">
              <p className="text-xs font-semibold text-[var(--muted)] mb-2">Visible columns</p>
              <div className="space-y-1">
                {OPTIONAL_COLUMNS.map(([col, label]) => (
                  <label htmlFor={`${formId}-column-${col}`} key={col} className="flex items-center gap-2 p-1.5 hover:bg-[var(--ink)] rounded-lg cursor-pointer">
                    <input id={`${formId}-column-${col}`} type="checkbox" checked={!hiddenColumns.has(col)} onChange={() => toggleColumnVisibility(col)} className="w-3.5 h-3.5" />
                    <span className="text-xs text-[var(--text)]">{label}</span>
                  </label>
                ))}
              </div>
              <TransactionColumnLayoutControls layout={columnLayout} setWidth={setColumnWidth} move={moveColumn} reset={resetColumnLayout} />
            </div>
          )}
        </div>
        <div className="relative shrink-0">
          <button type="button" onClick={() => setMoreOpen(!moreOpen)} aria-expanded={moreOpen} aria-haspopup="menu" className={btn}>
            <MoreHorizontal aria-hidden="true" size={14} /> More
          </button>
          {moreOpen && (
            <div role="menu" tabIndex={-1} aria-label="More actions" className="absolute top-10 right-0 z-[150] w-60 bg-[var(--surface)] border border-[var(--line)] rounded-xl shadow-lg p-1.5"
              onKeyDown={e => { if (e.key === 'Escape') setMoreOpen(false); }}>
              <button type="button" role="menuitem" className={menuItem} onClick={() => { setMoreOpen(false); exportCsv(); }}>Export CSV</button>
              <button type="button" role="menuitem" className={menuItem} onClick={() => { setMoreOpen(false); handleExportCSV(); }}>Export with all columns</button>
              <button type="button" role="menuitem" className={menuItem} onClick={() => { setMoreOpen(false); handleBulkSweep(); }}>Suggest categories</button>
              <div className="my-1 border-t border-[var(--line)]" />
              <button type="button" role="menuitemcheckbox" aria-checked={viewMode === 'pivot'} className={menuItem} onClick={() => { setViewMode(viewMode === 'pivot' ? 'grid' : 'pivot'); setMoreOpen(false); }}>Pivot table {viewMode === 'pivot' && <Check aria-hidden="true" size={14} />}</button>
              <button type="button" role="menuitemcheckbox" aria-checked={isCompactMode} className={menuItem} onClick={() => setCompactMode(!isCompactMode)}>Compact rows {isCompactMode && <Check aria-hidden="true" size={14} />}</button>
              <button type="button" role="menuitemcheckbox" aria-checked={isProMode} className={menuItem} onClick={() => setProMode(!isProMode)}>More detail per row {isProMode && <Check aria-hidden="true" size={14} />}</button>
              <div className="my-1 border-t border-[var(--line)]" />
              <button type="button" role="menuitem" className={menuItem} onClick={() => { setMoreOpen(false); onAction?.('open-command-center'); }}>Command center <kbd className="text-[10px] text-[var(--muted)]">Ctrl K</kbd></button>
            </div>
          )}
        </div>
        <button type="button" onClick={onNewEntry} aria-label="Create new entry"
          className="h-9 px-4 inline-flex items-center gap-1.5 rounded-lg bg-[var(--brass)] text-[var(--ink)] text-xs font-bold hover:opacity-90 shrink-0 cursor-pointer">
          <Plus aria-hidden="true" size={14} className="stroke-[3px]" /> New Entry
        </button>
      </div>

      {/* saved views (second, thin line) */}
      <SavedViewsBar currentSearchTerm={searchTerm} compact />

      {/* only while rows are ticked */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 p-1.5 bg-[var(--ink)] border border-[var(--line)] rounded-lg">
          <span className="text-xs font-semibold text-[var(--text)] px-2">{selectedIds.size} selected</span>
          <button type="button" onClick={toggleSelectAll} className={btn}>{selectedIds.size === transactionsWithBalance.length ? 'Clear all' : 'Select all'}</button>
          <button type="button" onClick={() => handleBulkUpdate({ isLocked: true })} className={btn}>Lock</button>
          <button type="button" onClick={() => handleBulkUpdate({ isLocked: false })} className={btn}>Unlock</button>
          <button type="button" onClick={() => handleBulkUpdate({ status: 'approved' })} className={btn}>Approve</button>
          <button type="button" onClick={() => handleBulkUpdate({ status: 'flagged' })} className={btn}>Flag</button>
          <button type="button" onClick={() => handleBulkUpdate({ status: 'void' })} className={cn(btn, 'text-rose-600')}>Void</button>
          <div className="flex-1" />
          <button type="button" aria-label="Clear transaction selection" onClick={() => setSelectedIds(new Set())} className="p-1.5 rounded hover:bg-black/5 text-[var(--muted)]"><X aria-hidden="true" size={14} /></button>
        </div>
      )}
    </div>);
}
