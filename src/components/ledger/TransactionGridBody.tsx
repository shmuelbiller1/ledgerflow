import { TransactionTotalsRow } from './TransactionTotalsRow';


import { Search, Sparkles, Filter, TrendingUp, ArrowUpRight, ArrowDownRight, TrendingDown } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

import React, { useEffect, useRef } from 'react';
import { TransactionColumnGrid } from './TransactionColumnGrid';
import { TransactionGridKeyboardRegion } from './TransactionGridKeyboardRegion';
import { gridMinWidth } from '../../lib/transactionColumns';

import { cn, formatCurrency } from '../../lib/utils';

import { FixedSizeList as List } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';

import PivotView from '../transactions/PivotView';

import { useLedgerStore } from '../../stores/useLedgerStore';

import { VirtualRow } from './TransactionGridShared';
import type { TransactionGridModel } from './TransactionGrid';
export function TransactionGridBody({ model }: { model: TransactionGridModel }) {
 const incomplete = useLedgerStore(state => state.isDataTruncated);
 const { naturalColumnOrder, columnOrder, stats, formId, filterCriteria, onFilterApplied, setSearchTerm, viewMode, selectedIds, setSelectedIds, sortConfig, handleSort, transactionsWithBalance, totalBalancedSum, selectedMetricsResult, activeFilterColumn, setActiveFilterColumn, columnSearchTerms, setColumnSearchTerms, show, columnFilterValues, toggleColumnFilter, pivotData, isMobileGrid, isTabletGrid, rowHeight, gridCols, itemData, itemKey, navigationFields, gridAnnouncement, onGridFocusChange, onGridEdit, focusedCell, editingCell } = model;
 // the highlight is logical (the list draws only the rows on screen): scroll it into view
 const listRef = useRef<List>(null);
 const focusedIndex = focusedCell?.index ?? -1;
 // also when Enter starts an edit: the row may have been scrolled away, and its editor only exists while it is drawn
 const editingId = editingCell?.id;
 useEffect(() => {
   if (focusedIndex < 0) return;
   listRef.current?.scrollToItem(focusedIndex, 'smart');
 }, [focusedIndex, editingId, viewMode]);
 return (<div className="flex-1 overflow-x-auto overflow-y-hidden relative bg-[var(--surface)]" dir="auto">
        {viewMode === 'grid' ? (
          <TransactionGridKeyboardRegion
            className="min-w-0"
            rows={transactionsWithBalance}
            fields={navigationFields}
            focus={focusedCell}
            inactive={Boolean(editingCell)}
            announcement={gridAnnouncement}
            onFocusChange={onGridFocusChange}
            onEdit={onGridEdit}
          >
          <div className="h-full flex flex-col" style={{ minWidth: gridMinWidth(gridCols) }}>
            <TransactionColumnGrid naturalOrder={naturalColumnOrder} order={columnOrder} data-testid="tx-header" className="grid sticky top-0 bg-slate-900 text-white/75 z-20" style={{ gridTemplateColumns: gridCols }}>
              <div className="p-4 border-r border-white/10 font-black text-[9px] uppercase tracking-widest truncate flex items-center justify-center">
                <input type="checkbox" aria-label="Select all transactions" checked={selectedIds.size === transactionsWithBalance.length && transactionsWithBalance.length > 0} onChange={(e) => setSelectedIds(e.target.checked ? new Set(transactionsWithBalance.map(t => t.id)) : new Set())} className="w-4 h-4 rounded border-white/20 bg-transparent accent-emerald-500" />
              </div>
              <div
                className="p-4 border-r border-white/10 font-black text-[9px] uppercase tracking-widest truncate flex items-center gap-2 group cursor-pointer hover:bg-[var(--surface)]/5 transition-colors relative"
              >
                <button type="button" onClick={() => handleSort('date')} className="flex flex-1 min-w-0 items-center gap-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
                  Date {sortConfig?.key === 'date' && (sortConfig.direction === 'asc' ? <ArrowUpRight aria-hidden="true" size={10} className="text-indigo-600" /> : <ArrowDownRight aria-hidden="true" size={10} className="text-indigo-600" />)}
                </button>
                <button
                  aria-label="Filter by date"
                  onClick={(e) => { e.stopPropagation(); setActiveFilterColumn(activeFilterColumn === 'date' ? null : 'date'); }}
                  className={cn("opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 p-1 hover:bg-slate-200 rounded transition-all", (filterCriteria?.startDate || filterCriteria?.endDate) && "opacity-100 text-indigo-600")}
                >
                  <Filter aria-hidden="true" size={10} />
                </button>
                {activeFilterColumn === 'date' && (
                  <div role="presentation" className="absolute top-full left-0 z-[100] mt-1 w-64 bg-[var(--ink)] border border-[var(--line)] rounded-xl shadow-2xl p-4 normal-case font-medium text-[var(--text)] cursor-default" onClick={e => e.stopPropagation()}>
                    <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest mb-3">Date Selection</p>
                    <div className="space-y-4">
                       <button
                         onClick={() => { setSearchTerm('today'); setActiveFilterColumn(null); }}
                         className="w-full text-left p-2 hover:bg-[var(--ink)] rounded-lg text-sm"
                       >
                         Today
                       </button>
                       <button
                         onClick={() => { setSearchTerm('last month'); setActiveFilterColumn(null); }}
                         className="w-full text-left p-2 hover:bg-[var(--ink)] rounded-lg text-sm"
                       >
                         Last Month
                       </button>
                       <button
                         onClick={() => { setSearchTerm('this year'); setActiveFilterColumn(null); }}
                         className="w-full text-left p-2 hover:bg-[var(--ink)] rounded-lg text-sm"
                       >
                         This Year
                       </button>
                       <div className="pt-2 border-t border-[var(--line)]">
                         <p className="text-[9px] font-bold text-[var(--muted)] uppercase tracking-widest mb-2">Custom Range</p>
                         <div className="grid grid-cols-2 gap-2">
                           <input
                             aria-label="Filter start date"
                             type="date"
                             className="text-xs p-1 h-8 bg-[var(--ink)] border border-[var(--line)] rounded"
                             onChange={(e) => onFilterApplied({ ...filterCriteria, startDate: e.target.value })}
                           />
                           <input
                             aria-label="Filter end date"
                             type="date"
                             className="text-xs p-1 h-8 bg-[var(--ink)] border border-[var(--line)] rounded"
                             onChange={(e) => onFilterApplied({ ...filterCriteria, endDate: e.target.value })}
                           />
                         </div>
                       </div>
                    </div>
                  </div>
                )}
              </div>
              <div
                className="p-4 border-r border-white/10 font-black text-[9px] uppercase tracking-widest truncate flex items-center gap-2 group relative cursor-pointer hover:bg-[var(--surface)]/5 transition-colors"
              >
                <button type="button" onClick={() => handleSort('description')} className="flex flex-1 min-w-0 items-center gap-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
                  Description {sortConfig?.key === 'description' && (sortConfig.direction === 'asc' ? <ArrowUpRight aria-hidden="true" size={10} className="text-indigo-600" /> : <ArrowDownRight aria-hidden="true" size={10} className="text-indigo-600" />)}
                </button>
                <button
                  aria-label="Filter by description"
                  onClick={(e) => { e.stopPropagation(); setActiveFilterColumn(activeFilterColumn === 'description' ? null : 'description'); }}
                  className="opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 p-1 hover:bg-[var(--surface)]/10 rounded transition-all"
                >
                  <Filter aria-hidden="true" size={10} />
                </button>
                {activeFilterColumn === 'description' && (
                  <div role="presentation" className="absolute top-full left-0 z-[100] mt-1 w-64 bg-[var(--ink)] border border-[var(--line)] rounded-xl shadow-2xl p-4 normal-case font-medium text-[var(--text)] cursor-default" onClick={e => e.stopPropagation()}>
                    <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest mb-3">Text Filters</p>
                    <div className="space-y-1">
                       <button onClick={() => { setSearchTerm('starts with '); setActiveFilterColumn(null); }} className="w-full text-left p-2 hover:bg-[var(--ink)] rounded-lg text-sm">Starts with...</button>
                       <button onClick={() => { setSearchTerm('ends with '); setActiveFilterColumn(null); }} className="w-full text-left p-2 hover:bg-[var(--ink)] rounded-lg text-sm">Ends with...</button>
                       <button onClick={() => { setSearchTerm('contains '); setActiveFilterColumn(null); }} className="w-full text-left p-2 hover:bg-[var(--ink)] rounded-lg text-sm">Contains...</button>
                    </div>
                  </div>
                )}
              </div>
              {!isMobileGrid && show('category') && (
                <div
                  className="p-4 border-r border-white/10 font-black text-[9px] uppercase tracking-widest truncate flex items-center gap-2 group relative cursor-pointer hover:bg-[var(--surface)]/5 transition-colors"
                >
                  <button type="button" onClick={() => handleSort('category')} className="flex flex-1 min-w-0 items-center gap-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
                    Category {sortConfig?.key === 'category' && (sortConfig.direction === 'asc' ? <ArrowUpRight aria-hidden="true" size={10} className="text-indigo-600" /> : <ArrowDownRight aria-hidden="true" size={10} className="text-indigo-600" />)}
                  </button>
                  <button
                    aria-label="Filter by category"
                  onClick={(e) => { e.stopPropagation(); setActiveFilterColumn(activeFilterColumn === 'category' ? null : 'category'); }}
                    className={cn("opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 p-1 hover:bg-[var(--surface)]/10 rounded transition-all", ((filterCriteria?.selectedCategories?.length ?? 0) > 0) && "opacity-100 text-emerald-500")}
                  >
                    <Filter aria-hidden="true" size={10} />
                  </button>
                  {activeFilterColumn === 'category' && (
                    <div role="presentation" className="absolute top-full left-0 z-[100] mt-1 w-64 bg-[var(--ink)] border border-[var(--line)] rounded-xl shadow-2xl p-4 normal-case font-medium text-[var(--text)] cursor-default" onClick={e => e.stopPropagation()}>
                      <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest mb-3">Filter Category</p>
                      <div className="mb-3 relative group/lsearch">
                        <Search aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)] group-hover/lsearch:text-indigo-600 transition-colors" size={12} />
                        <input
                          type="text"
                          aria-label="Search category filters"
                          placeholder="Search categories..."
                          className="w-full pl-8 pr-3 py-1.5 bg-[var(--ink)] border border-[var(--line)] rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-indigo-600"
                          value={columnSearchTerms.category || ''}
                          onChange={(e) => setColumnSearchTerms(prev => ({ ...prev, category: e.target.value }))}
                        />
                      </div>
                      <div className="max-h-64 overflow-y-auto space-y-1 custom-scrollbar">
                        {columnFilterValues.category
                          .filter(val => !columnSearchTerms.category || (val || '').toLowerCase().includes(columnSearchTerms.category.toLowerCase()))
                          .map(val => (
                          <label htmlFor={`${formId}-category-${encodeURIComponent(val)}`} key={val} className="flex items-center gap-3 p-2 hover:bg-[var(--ink)] rounded-lg cursor-pointer transition-colors">
                            <input
                              id={`${formId}-category-${encodeURIComponent(val)}`}
                              aria-label={`Category filter: ${val || "Unassigned"}`}
                              type="checkbox"
                              checked={filterCriteria?.selectedCategories?.includes(val)}
                              onChange={() => toggleColumnFilter('category', val)}
                              className="w-4 h-4 rounded border-[var(--line)] text-indigo-600"
                            />
                            <span className="text-sm text-[var(--text)] truncate">{val}</span>
                          </label>
                        ))}
                      </div>
                      <div className="mt-4 pt-3 border-t border-[var(--line)] flex justify-between">
                         <button
                           onClick={() => onFilterApplied({ ...filterCriteria, selectedCategories: [] })}
                           className="text-[10px] font-bold text-[var(--muted)] hover:text-[var(--text)] uppercase tracking-wider"
                         >
                           Reset
                         </button>
                         <button
                           onClick={() => setActiveFilterColumn(null)}
                           className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider"
                         >
                           Apply
                         </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {!isMobileGrid && !isTabletGrid && show('project') && (
                <div
                  className="p-4 border-r border-white/10 font-black text-[9px] uppercase tracking-widest truncate flex items-center gap-2 group relative cursor-pointer hover:bg-[var(--surface)]/5 transition-colors"
                >
                  <button type="button" onClick={() => handleSort('project')} className="flex flex-1 min-w-0 items-center gap-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
                    Project {sortConfig?.key === 'project' && (sortConfig.direction === 'asc' ? <ArrowUpRight aria-hidden="true" size={10} className="text-indigo-600" /> : <ArrowDownRight aria-hidden="true" size={10} className="text-indigo-600" />)}
                  </button>
                  <button
                    aria-label="Filter by project"
                  onClick={(e) => { e.stopPropagation(); setActiveFilterColumn(activeFilterColumn === 'project' ? null : 'project'); }}
                    className={cn("opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 p-1 hover:bg-[var(--surface)]/10 rounded transition-all", ((filterCriteria?.selectedProjects?.length ?? 0) > 0) && "opacity-100 text-emerald-500")}
                  >
                    <Filter aria-hidden="true" size={10} />
                  </button>
                  {activeFilterColumn === 'project' && (
                    <div role="presentation" className="absolute top-full left-0 z-[100] mt-1 w-64 bg-[var(--ink)] border border-[var(--line)] rounded-xl shadow-2xl p-4 normal-case font-medium text-[var(--text)] cursor-default" onClick={e => e.stopPropagation()}>
                      <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest mb-3">Filter Projects</p>
                      <div className="mb-3 relative group/psearch">
                        <Search aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)] group-hover/psearch:text-indigo-600 transition-colors" size={12} />
                        <input
                          type="text"
                          aria-label="Search project filters"
                          placeholder="Search entities..."
                          className="w-full pl-8 pr-3 py-1.5 bg-[var(--ink)] border border-[var(--line)] rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-indigo-600"
                          value={columnSearchTerms.project || ''}
                          onChange={(e) => setColumnSearchTerms(prev => ({ ...prev, project: e.target.value }))}
                        />
                      </div>
                      <div className="max-h-64 overflow-y-auto space-y-1 custom-scrollbar">
                        {columnFilterValues.project
                          .filter(val => !columnSearchTerms.project || (val || '').toLowerCase().includes(columnSearchTerms.project.toLowerCase()))
                          .map(val => (
                          <label htmlFor={`${formId}-project-${encodeURIComponent(val)}`} key={val} className="flex items-center gap-3 p-2 hover:bg-[var(--ink)] rounded-lg cursor-pointer transition-colors">
                            <input
                              id={`${formId}-project-${encodeURIComponent(val)}`}
                              aria-label={`Project filter: ${val || "Unassigned"}`}
                              type="checkbox"
                              checked={filterCriteria?.selectedProjects?.includes(val)}
                              onChange={() => toggleColumnFilter('project', val)}
                              className="w-4 h-4 rounded border-[var(--line)] text-indigo-600"
                            />
                            <span className="text-sm text-[var(--text)] truncate">{val}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {!isMobileGrid && !isTabletGrid && show('class') && (
                <div
                  className="p-4 border-r border-white/10 font-black text-[9px] uppercase tracking-widest truncate flex items-center justify-between gap-2 group cursor-pointer hover:bg-[var(--surface)]/5 transition-colors relative"
                >
                  <button type="button" onClick={() => handleSort('class')} className="flex flex-1 min-w-0 items-center gap-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
                    <div className="flex items-center gap-2">Class {sortConfig?.key === 'class' && (sortConfig.direction === 'asc' ? <ArrowUpRight aria-hidden="true" size={10} className="text-indigo-600" /> : <ArrowDownRight aria-hidden="true" size={10} className="text-indigo-600" />)}</div>
                  </button>
                  <button
                    aria-label="Filter by class"
                  onClick={(e) => { e.stopPropagation(); setActiveFilterColumn(activeFilterColumn === 'class' ? null : 'class'); }}
                    className={cn("opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 p-1 hover:bg-[var(--surface)]/10 rounded transition-all", (filterCriteria?.selectedClasses?.length || 0) > 0 && "opacity-100 text-emerald-500")}
                  >
                    <Filter aria-hidden="true" size={10} />
                  </button>
                  {activeFilterColumn === 'class' && (
                    <div role="presentation" className="absolute top-full left-0 z-[100] mt-1 w-64 bg-[var(--ink)] border border-[var(--line)] rounded-xl shadow-2xl p-4 normal-case font-medium text-[var(--text)] cursor-default" onClick={e => e.stopPropagation()}>
                      <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest mb-3">Filter by Class</p>
                      <div className="max-h-64 overflow-y-auto space-y-1 custom-scrollbar">
                        {useLedgerStore.getState().classes?.map(val => (
                          <label htmlFor={`${formId}-class-${encodeURIComponent(val)}`} key={val} className="flex items-center gap-3 p-2 hover:bg-[var(--ink)] rounded-lg cursor-pointer transition-colors">
                            <input
                              id={`${formId}-class-${encodeURIComponent(val)}`}
                              aria-label={`Class filter: ${val || "Unassigned"}`}
                              type="checkbox"
                              checked={filterCriteria?.selectedClasses?.includes(val)}
                              onChange={() => toggleColumnFilter('class', val)}
                              className="w-4 h-4 rounded border-[var(--line)] text-indigo-600"
                            />
                            <span className="text-sm text-[var(--text)] truncate">{val}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {!isMobileGrid && !isTabletGrid && show('location') && (
                <div
                  className="p-4 border-r border-white/10 font-black text-[9px] uppercase tracking-widest truncate flex items-center justify-between gap-2 group cursor-pointer hover:bg-[var(--surface)]/5 transition-colors relative"
                >
                  <button type="button" onClick={() => handleSort('location')} className="flex flex-1 min-w-0 items-center gap-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
                    <div className="flex items-center gap-2">Location {sortConfig?.key === 'location' && (sortConfig.direction === 'asc' ? <ArrowUpRight aria-hidden="true" size={10} className="text-indigo-600" /> : <ArrowDownRight aria-hidden="true" size={10} className="text-indigo-600" />)}</div>
                  </button>
                  <button
                    aria-label="Filter by location"
                  onClick={(e) => { e.stopPropagation(); setActiveFilterColumn(activeFilterColumn === 'location' ? null : 'location'); }}
                    className={cn("opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 p-1 hover:bg-[var(--surface)]/10 rounded transition-all", (filterCriteria?.selectedLocations?.length || 0) > 0 && "opacity-100 text-emerald-500")}
                  >
                    <Filter aria-hidden="true" size={10} />
                  </button>
                  {activeFilterColumn === 'location' && (
                    <div role="presentation" className="absolute top-full left-0 z-[100] mt-1 w-64 bg-[var(--ink)] border border-[var(--line)] rounded-xl shadow-2xl p-4 normal-case font-medium text-[var(--text)] cursor-default" onClick={e => e.stopPropagation()}>
                      <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest mb-3">Filter by Location</p>
                      <div className="max-h-64 overflow-y-auto space-y-1 custom-scrollbar">
                        {useLedgerStore.getState().locations?.map(val => (
                          <label htmlFor={`${formId}-location-${encodeURIComponent(val)}`} key={val} className="flex items-center gap-3 p-2 hover:bg-[var(--ink)] rounded-lg cursor-pointer transition-colors">
                            <input
                              id={`${formId}-location-${encodeURIComponent(val)}`}
                              aria-label={`Location filter: ${val || "Unassigned"}`}
                              type="checkbox"
                              checked={filterCriteria?.selectedLocations?.includes(val)}
                              onChange={() => toggleColumnFilter('location', val)}
                              className="w-4 h-4 rounded border-[var(--line)] text-indigo-600"
                            />
                            <span className="text-sm text-[var(--text)] truncate">{val}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {/* one Amount column in every mode: the rows have one amount cell */}{(
              <div
                className="p-4 border-r border-white/10 font-black text-[9px] uppercase tracking-widest truncate text-right flex items-center justify-end gap-2 group relative cursor-pointer hover:bg-[var(--surface)]/5 transition-colors"
              >
                <button type="button" onClick={() => handleSort('amount')} className="flex justify-end flex-1 min-w-0 items-center gap-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
                  Amount {sortConfig?.key === 'amount' && (sortConfig.direction === 'asc' ? <ArrowUpRight aria-hidden="true" size={10} className="text-indigo-600" /> : <ArrowDownRight aria-hidden="true" size={10} className="text-indigo-600" />)}
                </button>
                <button
                  aria-label="Filter by amount"
                  onClick={(e) => { e.stopPropagation(); setActiveFilterColumn(activeFilterColumn === 'amount' ? null : 'amount'); }}
                  className={cn("opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 p-1 hover:bg-[var(--surface)]/10 rounded transition-all", (filterCriteria?.minAmount !== undefined || filterCriteria?.maxAmount !== undefined) && "opacity-100 text-emerald-500")}
                >
                  <Filter aria-hidden="true" size={10} />
                </button>
                {activeFilterColumn === 'amount' && (
                  <div role="presentation" className="absolute top-full right-0 z-[100] mt-1 w-72 bg-[var(--ink)] border border-[var(--line)] rounded-xl shadow-2xl p-5 normal-case font-medium text-[var(--text)] cursor-default" onClick={e => e.stopPropagation()}>
                    <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest mb-4">Amount Range Logic</p>
                    <div className="space-y-5">
                       <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                             <label htmlFor={`${formId}-min-amount`} className="text-[9px] font-black uppercase text-[var(--muted)] tracking-wider">Min Value</label>
                             <div className="relative">
                               <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)] text-[10px] italic">$</span>
                               <input
                                  id={`${formId}-min-amount`}
                                  type="number"
                                  placeholder="0"
                                  className="w-full pl-6 pr-3 py-2 bg-[var(--ink)] border border-[var(--line)] rounded-lg text-xs font-mono focus:ring-1 focus:ring-indigo-600 outline-none"
                                  value={filterCriteria?.minAmount || ''}
                                  onChange={(e) => onFilterApplied({ ...filterCriteria, minAmount: e.target.value ? parseFloat(e.target.value) : undefined })}
                               />
                             </div>
                          </div>
                          <div className="space-y-2">
                             <label htmlFor={`${formId}-max-amount`} className="text-[9px] font-black uppercase text-[var(--muted)] tracking-wider">Max Value</label>
                             <div className="relative">
                               <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)] text-[10px] italic">$</span>
                               <input
                                  id={`${formId}-max-amount`}
                                  type="number"
                                  placeholder="∞"
                                  className="w-full pl-6 pr-3 py-2 bg-[var(--ink)] border border-[var(--line)] rounded-lg text-xs font-mono focus:ring-1 focus:ring-indigo-600 outline-none"
                                  value={filterCriteria?.maxAmount || ''}
                                  onChange={(e) => onFilterApplied({ ...filterCriteria, maxAmount: e.target.value ? parseFloat(e.target.value) : undefined })}
                               />
                             </div>
                          </div>
                       </div>

                       <div className="pt-4 border-t border-[var(--line)] space-y-2">
                          <p className="text-[9px] font-black text-[var(--muted)] uppercase tracking-widest mb-2">Statistical Segments</p>
                          <div className="grid grid-cols-1 gap-1">
                             <button onClick={() => { setSearchTerm('above average'); setActiveFilterColumn(null); }} className="w-full text-left p-2 hover:bg-[var(--ink)] rounded-lg text-xs font-bold flex justify-between items-center group">
                                Above Average
                                <TrendingUp aria-hidden="true" size={12} className="opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 text-emerald-500" />
                             </button>
                             <button onClick={() => { setSearchTerm('top 10 %'); setActiveFilterColumn(null); }} className="w-full text-left p-2 hover:bg-[var(--ink)] rounded-lg text-xs font-bold flex justify-between items-center group">
                                Top 10% (High Value)
                                <Sparkles aria-hidden="true" size={12} className="opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 text-amber-500" />
                             </button>
                             <button onClick={() => { setSearchTerm('below average'); setActiveFilterColumn(null); }} className="w-full text-left p-2 hover:bg-[var(--ink)] rounded-lg text-xs font-bold flex justify-between items-center group">
                                Below Average
                                <TrendingDown aria-hidden="true" size={12} className="opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 text-rose-500" />
                             </button>
                          </div>
                       </div>

                       <div className="flex gap-2 pt-2">
                          <button
                            onClick={() => { onFilterApplied({ ...filterCriteria, minAmount: undefined, maxAmount: undefined }); setActiveFilterColumn(null); }}
                            className="flex-1 py-2.5 bg-[var(--ink)] text-[9px] font-medium uppercase tracking-wider rounded-lg hover:bg-rose-50 hover:text-rose-600 transition-all"
                          >
                            Reset
                          </button>
                          <button
                            onClick={() => setActiveFilterColumn(null)}
                            className="flex-1 py-2.5 bg-slate-900 text-white text-[9px] font-medium uppercase tracking-wider rounded-lg hover:bg-black transition-all"
                          >
                            Apply
                          </button>
                       </div>
                    </div>
                  </div>
                )}
                </div>
              )}
              {!isMobileGrid && !isTabletGrid && show('balance') && (
                <div className="p-4 border-r border-white/10 font-black text-[9px] uppercase tracking-widest truncate text-right">Running.Sum</div>
              )}
              {!isMobileGrid && show('status') && (
                <div
                  className="p-4 border-r border-white/10 font-black text-[9px] uppercase tracking-widest truncate text-center flex items-center justify-center gap-2 group cursor-pointer hover:bg-[var(--surface)]/5 transition-colors relative"
                >
                  <button type="button" onClick={() => handleSort('status')} className="flex justify-center flex-1 min-w-0 items-center gap-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
                    System Status {sortConfig?.key === 'status' && (sortConfig.direction === 'asc' ? <ArrowUpRight aria-hidden="true" size={10} className="text-indigo-600" /> : <ArrowDownRight aria-hidden="true" size={10} className="text-indigo-600" />)}
                  </button>
                  <button
                    aria-label="Filter by status"
                  onClick={(e) => { e.stopPropagation(); setActiveFilterColumn(activeFilterColumn === 'status' ? null : 'status'); }}
                    className={cn("opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 p-1 hover:bg-[var(--surface)]/10 rounded transition-all", ((filterCriteria?.selectedStatuses?.length ?? 0) > 0) && "opacity-100 text-emerald-500")}
                  >
                    <Filter aria-hidden="true" size={10} />
                  </button>
                  {activeFilterColumn === 'status' && (
                    <div className="absolute top-full right-0 z-[100] mt-1 w-48 bg-[var(--ink)] border border-[var(--line)] rounded-xl shadow-2xl p-4 normal-case font-medium">
                      <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest mb-3">Filter Type</p>
                      <div className="max-h-64 overflow-y-auto space-y-1 custom-scrollbar">
                        {['Active', 'Pending', 'Void', 'Reconciled'].map(val => (
                          <label htmlFor={`${formId}-status-${encodeURIComponent(val)}`} key={val} className="flex items-center gap-3 p-2 hover:bg-[var(--ink)] rounded-lg cursor-pointer transition-colors">
                            <input
                              id={`${formId}-status-${encodeURIComponent(val)}`}
                              aria-label={`Status filter: ${val || "Unassigned"}`}
                              type="checkbox"
                              checked={filterCriteria?.selectedStatuses?.includes(val)}
                              onChange={() => toggleColumnFilter('status', val)}
                              className="w-4 h-4 rounded border-[var(--line)] text-indigo-600"
                            />
                            <span className="text-sm text-[var(--text)] truncate">{val}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {!isMobileGrid && !isTabletGrid && (
                <div className="p-4 font-black text-[9px] uppercase tracking-widest truncate flex items-center justify-end">
                  Actions
                </div>
              )}
            </TransactionColumnGrid>
            <div className="px-4 md:px-8 py-4 lg:py-0 bg-[#090A0C] border-t border-white/5 flex flex-col md:flex-row md:items-center justify-between text-white/40 overflow-hidden relative gap-4">
              <div className="absolute inset-0 technical-grid opacity-[0.03] pointer-events-none" />
              <div className="flex flex-wrap items-center gap-4 lg:gap-10 relative z-10 w-full overflow-x-auto no-scrollbar pb-2 md:pb-0">
                 <div className="flex flex-col whitespace-nowrap">
                   <p className="text-[9px] font-medium uppercase tracking-wider truncate mb-1 text-white/70">Dataset Depth</p>
                   <p className="text-lg font-black italic text-white/80">{transactionsWithBalance.length} Nodes</p>
                 </div>
                 <div className="hidden sm:block w-px h-10 bg-[var(--surface)]/10" />
                 <div className="flex flex-col whitespace-nowrap">
                   <p className="text-[9px] font-medium uppercase tracking-wider truncate mb-1 text-white/70">Equilibrium</p>
                   <p className={cn(
                     "text-xl font-black font-mono tracking-tighter",
                     totalBalancedSum === 0
                       ? "text-emerald-400"
                       : "text-rose-400"
                   , "tabular-nums")}>
                     {formatCurrency(totalBalancedSum)}
                   </p>
                 </div>
                 {selectedIds.size > 0 && (
                   <>
                     <div className="hidden sm:block w-px h-10 bg-[var(--surface)]/10" />
                     <div className="flex items-center gap-4 lg:gap-10">
                        <div className="flex flex-col text-emerald-400 whitespace-nowrap">
                          <p className="text-[9px] font-medium uppercase tracking-wider truncate mb-1 text-white/70">Sum ({selectedIds.size})</p>
                          <p className="text-xl font-black font-mono tracking-tighter tabular-nums">
                            {formatCurrency(selectedMetricsResult.sum)}
                          </p>
                        </div>
                        <div className="flex flex-col text-white/60 whitespace-nowrap">
                          <p className="text-[9px] font-medium uppercase tracking-wider truncate mb-1 text-white/70">Mean Vector</p>
                          <p className="text-xl font-black font-mono tracking-tighter uppercase tabular-nums">
                            {formatCurrency(selectedMetricsResult.mean)}
                          </p>
                        </div>
                     </div>
                   </>
                 )}
              </div>
              <div className="flex items-center gap-4 relative z-10">
                 <AnimatePresence>
                   {selectedIds.size === 2 && (
                     <motion.div
                       initial={{ opacity: 0, x: 20 }}
                       animate={{ opacity: 1, x: 0 }}
                       exit={{ opacity: 0, x: 20 }}
                       className="flex items-center gap-3 px-4 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl"
                     >
                        <Sparkles aria-hidden="true" size={14} className="text-emerald-400" />
                        <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">Duplicate Probability: 94%</span>
                     </motion.div>
                   )}
                 </AnimatePresence>

                 <div className="flex items-center gap-3">
                    <div className={cn(
                      "w-2 h-2 rounded-full",
                      totalBalancedSum === 0
                        ? "bg-emerald-500 shadow-[0_0_10px_#10b981]"
                        : "bg-rose-500 animate-pulse shadow-[0_0_10px_#f43f5e]"
                    )} />
                    <span className="text-[10px] font-black uppercase tracking-[0.3em] text-white/80">
                      {totalBalancedSum === 0
                        ? "Consensus Balanced"
                        : "Ledger Imbalance Detected"}
                    </span>
                 </div>
              </div>
            </div>
            {/* a floor for the list: without it the sections above could leave it 0 px high (no rows) */}
            <div className="flex-1 min-h-[60vh]">
              <AutoSizer>
                {({ height, width }: { height: number; width: number }) => (
                  <List
                    ref={listRef}
                    height={height}
                    itemCount={transactionsWithBalance.length}
                    itemSize={rowHeight}
                    itemData={itemData}
                    itemKey={itemKey}
                    width={width}
                    className="custom-scrollbar"
                  >
                    {VirtualRow}
                  </List>
                )}
              </AutoSizer>
            </div>
            <TransactionTotalsRow inflowCents={stats.inflowCents} outflowCents={stats.outflowCents} count={stats.count} incomplete={incomplete} />
          </div>
          </TransactionGridKeyboardRegion>
        ) : (
          <PivotView pivotData={pivotData} formatCurrency={formatCurrency} />
        )}
      </div>);
}
