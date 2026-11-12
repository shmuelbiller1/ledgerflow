import React from 'react';
import { Table as TableIcon, Search, Download, ChevronDown, ChevronRight, Calculator, Grid3X3, ListCollapse, ExternalLink, Calendar } from 'lucide-react';
import { toast } from 'sonner';
import { cn, formatCurrency, resolveAccountName, getLocalDateISO, formatSignedAmount } from '../../lib/utils';
import { lineAmount } from '../../lib/txFilters';
import DrillDownModal from '../layout/DrillDownModal';
import { csvMoney, downloadCsv } from '../../lib/csvExport';
import type { PivotSheetModel, PeriodFilter } from './PivotSheet';

export function PivotSheetView({ layouts, saveCurrentLayout, applyLayout, removeLayout, transactions, isEmbedded, accounts, activeDimensions, pivotMode, setPivotMode, rowDim, setRowDim, colDim, setColDim, groupBy, setGroupBy, searchTerm, setSearchTerm, period, setPeriod, customStartDate, setCustomStartDate, customEndDate, setCustomEndDate, expandedGroups, drillDownTarget, setDrillDownTarget, toggleGroup, scopedTransactions, formatDimensionDisplay, groupedData, matrixData }: PivotSheetModel) {
  return (
    <div className={cn(
      "flex flex-col h-full bg-[var(--surface)] animate-fadeIn text-left",
      isEmbedded ? "p-0 border-0 shadow-none rounded-[32px]" : "border border-[var(--line)] rounded-[32px] overflow-hidden shadow-2xl"
    )}>
      {/* Spreadsheet Controller Topbar */}
      <div className="border-b border-[var(--line)] bg-[var(--ink)]/70 p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
             <div className="p-2 bg-slate-900 text-white rounded-xl">
                <TableIcon aria-hidden="true" size={16} />
             </div>
             <div>
                <h2 className="text-sm font-bold text-[var(--text)] uppercase tracking-tight leading-none">Compare</h2>
                <p className="text-[9.5px] text-[var(--muted)] font-mono tracking-tight mt-1">Any label against any other, by month or payee</p>
             </div>
             <CompareLayouts layouts={layouts} onSave={saveCurrentLayout} onApply={applyLayout} onRemove={removeLayout} />
          </div>
          
          <div className="flex flex-wrap items-center gap-3">
              {/* Period Filter */}
              <div className="flex items-center gap-1.5 bg-[var(--panel)] border border-[var(--line)] rounded-xl px-2 py-1">
                 <Calendar aria-hidden="true" size={12} className="text-[var(--muted)]" />
                 <select
                   aria-label="Filter period"
                   value={period}
                   onChange={(e) => setPeriod(e.target.value as PeriodFilter)}
                   className="bg-transparent text-[9.5px] font-bold uppercase tracking-wider text-[var(--text)] outline-none cursor-pointer"
                 >
                   <option value="all">All Dates</option>
                   <option value="this_year">This Year</option>
                   <option value="last_year">Last Year</option>
                   <option value="this_quarter">This Quarter</option>
                   <option value="this_month">This Month</option>
                   <option value="custom">Custom Range</option>
                 </select>
                 {period === 'custom' && (
                   <div className="flex items-center gap-1 ml-1 border-l border-[var(--line)] pl-1.5">
                     <input
                       type="date"
                       aria-label="Start date"
                       value={customStartDate}
                       onChange={(e) => setCustomStartDate(e.target.value)}
                       className="bg-[var(--surface)] border border-[var(--line)] rounded px-1.5 py-0.5 text-[9px] font-mono outline-none"
                     />
                     <span className="text-[9px] text-[var(--muted)]">to</span>
                     <input
                       type="date"
                       aria-label="End date"
                       value={customEndDate}
                       onChange={(e) => setCustomEndDate(e.target.value)}
                       className="bg-[var(--surface)] border border-[var(--line)] rounded px-1.5 py-0.5 text-[9px] font-mono outline-none"
                     />
                   </div>
                 )}
              </div>

              {/* Mode Selector */}
              <div className="flex p-0.5 bg-[var(--panel)] border border-[var(--line)] rounded-xl shrink-0">
                 <button
                   type="button"
                   onClick={() => setPivotMode('flat')}
                   className={cn(
                     "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[9.5px] font-bold uppercase tracking-wider transition-all cursor-pointer",
                     pivotMode === 'flat' ? "bg-[var(--brass)] text-[var(--ink)] shadow-3xs" : "text-[var(--muted)] hover:text-[var(--text)]"
                   )}
                 >
                   <ListCollapse aria-hidden="true" size={11} />
                   <span>Flat View</span>
                 </button>
                 <button
                   type="button"
                   onClick={() => setPivotMode('matrix')}
                   className={cn(
                     "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[9.5px] font-bold uppercase tracking-wider transition-all cursor-pointer",
                     pivotMode === 'matrix' ? "bg-[var(--brass)] text-[var(--ink)] shadow-3xs" : "text-[var(--muted)] hover:text-[var(--text)]"
                   )}
                 >
                   <Grid3X3 aria-hidden="true" size={11} />
                   <span>Cross-Tab Matrix</span>
                 </button>
              </div>

              {/* Export Data Button */}
              <button 
                type="button"
                onClick={() => {
                  if (scopedTransactions.length === 0) {
                    toast.error("No transactions to export in this scope.");
                    return;
                  }
                  downloadCsv(`pivot_export_${getLocalDateISO()}.csv`,
                    ['Date', 'Transaction ID', 'Description', 'Payee', 'Account', 'Amount (base currency)'],
                    scopedTransactions.flatMap(t => {
                      const lines = (t.lines && t.lines.length > 0)
                        ? t.lines
                        : [{ accountId: '', accountName: '', amountCents: t.totalAmountCents }];
                      return lines.map(l => [t.date, t.id, t.description, t.payee || '', resolveAccountName(accounts, l.accountId, l.accountName), csvMoney(lineAmount(l, t) || 0)]);
                    }));
                }}
                className="h-9 px-3 border border-[var(--line)] hover:border-slate-350 bg-[var(--surface)] hover:bg-[var(--ink)] rounded-xl flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer shrink-0"
              >
                <Download aria-hidden="true" size={12} />
                <span>CSV</span>
              </button>
          </div>
        </div>

        {/* Filters and secondary dimension settings */}
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4 pt-1">
          <div className="flex flex-wrap items-center gap-4 text-left">
            {pivotMode === 'flat' ? (
              <div className="flex items-center gap-2">
                 <span className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider">Group Rows:</span>
                 <div className="flex flex-wrap gap-1">
                    {activeDimensions.map(dim => (
                      <button
                        key={dim.id}
                        type="button"
                        onClick={() => setGroupBy(dim.id)}
                        className={cn(
                          "px-3 py-1 bg-[var(--surface)] border rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer",
                          groupBy === dim.id 
                            ? "border-indigo-600 bg-indigo-50/50 text-indigo-750 font-bold" 
                            : "border-[var(--line)] hover:border-slate-350 text-slate-600"
                        )}
                      >
                        {dim.name}
                      </button>
                    ))}
                 </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                   <span className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider">Rows (R):</span>
                   <div className="flex flex-wrap gap-1">
                      {activeDimensions.map(dim => (
                        <button
                          key={dim.id}
                          type="button"
                          onClick={() => setRowDim(dim.id)}
                          className={cn(
                            "px-2.5 py-1 bg-[var(--surface)] border rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer",
                            rowDim === dim.id 
                              ? "border-indigo-600 bg-indigo-50/50 text-indigo-750 font-bold" 
                              : "border-[var(--line)] hover:border-slate-300 text-[var(--muted)]"
                          )}
                        >
                          {dim.name}
                        </button>
                      ))}
                   </div>
                </div>

                <div className="flex items-center gap-2">
                   <span className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider">Columns (C):</span>
                   <div className="flex flex-wrap gap-1">
                      {activeDimensions.map(dim => (
                        <button
                          key={dim.id}
                          type="button"
                          disabled={rowDim === dim.id}
                          onClick={() => setColDim(dim.id)}
                          className={cn(
                            "px-2.5 py-1 bg-[var(--surface)] border rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer",
                            colDim === dim.id 
                              ? "border-indigo-600 bg-indigo-50/50 text-indigo-750 font-bold" 
                              : "border-[var(--line)] hover:border-slate-300 text-[var(--muted)] disabled:opacity-40"
                          )}
                        >
                          {dim.name}
                        </button>
                      ))}
                   </div>
                </div>
              </div>
            )}
          </div>

          <div className="relative group">
             <Search aria-hidden="true" size={12} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted)] group-focus-within:text-[var(--text)] transition-colors" />
             <input aria-label="Search spreadsheet cells"
               value={searchTerm}
               onChange={(e) => setSearchTerm(e.target.value)}
               placeholder="Search spreadsheet cells ..." 
               className="h-9 w-full sm:w-64 pl-9 pr-3 bg-[var(--surface)] border border-[var(--line)] hover:border-slate-300 rounded-xl text-[10.5px] font-medium outline-none focus:border-indigo-600 transition-all shadow-3xs"
             />
          </div>
        </div>
      </div>

      {/* Spreadsheet Body Canvas */}
      <div className="flex-1 overflow-auto custom-scrollbar bg-[var(--surface)]">
        {pivotMode === 'flat' ? (
          // Standard Hierarchical List View
          <table className="w-full border-collapse">
            <caption className="sr-only">Pivot: totals by group</caption>
             <thead className="sticky top-0 z-20 bg-slate-55/90 backdrop-blur-md border-b border-[var(--line)] shadow-3xs">
                <tr className="text-left bg-[var(--ink)]">
                   <th scope="col" className="px-6 py-3.5 text-[9.5px] font-bold text-[var(--muted)] uppercase tracking-widest w-12 text-center">Collapse</th>
                   <th scope="col" className="px-4 py-3.5 text-[9.5px] font-bold text-[var(--muted)] uppercase tracking-widest min-w-[320px]">Dimension Name / Nodes</th>
                   <th scope="col" className="px-4 py-3.5 text-[9.5px] font-bold text-[var(--muted)] uppercase tracking-widest text-center">Count</th>
                   <th scope="col" className="px-4 py-3.5 text-[9.5px] font-bold text-[var(--muted)] uppercase tracking-widest">Type Category</th>
                   <th scope="col" className="px-6 py-3.5 text-[9.5px] font-bold text-[var(--muted)] uppercase tracking-widest text-right">Sum value</th>
                </tr>
             </thead>
             <tbody>
                {groupedData.map(([groupName, data], gIdx) => (
                  <React.Fragment key={groupName}>
                     <tr 
                       onClick={() => toggleGroup(groupName)}
                       className="group cursor-pointer hover:bg-[var(--ink)]/80 border-b border-[var(--line)] transition-colors bg-[var(--surface)] z-10 text-left"
                     >
                        <td className="px-6 py-3.5 text-center">
                           <div className="flex justify-center text-[var(--muted)] group-hover:text-slate-700">
                             {expandedGroups.has(groupName) ? <ChevronDown aria-hidden="true" size={14} /> : <ChevronRight aria-hidden="true" size={14} />}
                           </div>
                        </td>
                        <td className="px-4 py-3.5">
                           <div className="flex items-center gap-3">
                              <span className="text-[10px] font-mono font-bold text-[var(--muted)] w-5">{(gIdx + 1).toString().padStart(2, '0')}</span>
                              <span className="text-xs font-bold text-slate-850 uppercase tracking-tight">{groupName}</span>
                           </div>
                        </td>
                        <td className="px-4 py-3.5 text-center">
                           <button
                             onClick={(e) => {
                               e.stopPropagation();
                               setDrillDownTarget({
                                 title: `${groupName} (${data.items.length} transactions)`,
                                 transactions: data.items
                               });
                             }}
                             title="Drill down into transactions"
                             className="text-[9.5px] font-bold text-slate-600 hover:text-indigo-600 px-2.5 py-0.5 bg-slate-100 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 rounded-md transition-colors inline-flex items-center gap-1 cursor-pointer"
                           >
                             <span>{data.items.length} lines</span>
                             <ExternalLink aria-hidden="true" size={9} />
                           </button>
                        </td>
                        <td className="px-4 py-3.5">
                           <span className="text-[9px] font-mono font-bold text-[var(--muted)] uppercase">
                             Aggregate Row Node
                           </span>
                        </td>
                        <td className="px-6 py-3.5 text-right font-mono text-xs font-bold">
                           <span className={data.total >= 0 ? "text-emerald-600" : "text-rose-600"}>
                              {formatCurrency(data.total)}
                           </span>
                        </td>
                     </tr>
                     
                     {/* Items Row inside Expanded Accordion */}
                     {expandedGroups.has(groupName) && data.items.map((t, tIdx) => (
                       <tr 
                         key={t.id}
                         className="border-b border-[var(--line)] bg-[var(--ink)]/25 hover:bg-[var(--ink)]/50 transition-colors text-left"
                       >
                          <td className="px-6 py-2.5 text-[8.5px] font-mono text-slate-300 text-center">{gIdx + 1}.{tIdx + 1}</td>
                          <td className="px-4 py-2.5">
                             <div className="flex flex-col">
                                <span className="text-[11.5px] font-medium text-[var(--text)]">{t.description}</span>
                                <span className="text-[8.5px] font-bold text-[var(--muted)] uppercase tracking-widest mt-0.5">{t.payee || 'Direct Ledger Entry'}</span>
                             </div>
                          </td>
                          <td className="px-4 py-2.5" />
                          <td className="px-4 py-2.5">
                             <span className="px-2 py-0.5 bg-[var(--surface)] border border-[var(--line)] rounded text-[8.5px] font-bold uppercase text-[var(--muted)]">
                                {resolveAccountName(accounts, t.lines[0]?.accountId, t.lines[0]?.accountName)}
                             </span>
                          </td>
                          <td className="px-6 py-2.5 text-right font-mono text-[11px] font-medium">
                             <span className={((t.type as string) === 'income' || (t.type as string) === 'revenue') ? "text-emerald-500" : "text-rose-500"}>
                                {formatSignedAmount(t.totalAmountCents, ((t.type as string) === 'income' || (t.type as string) === 'revenue') ? 'in' : 'out')}
                             </span>
                          </td>
                       </tr>
                     ))}
                  </React.Fragment>
                ))}
             </tbody>
          </table>
        ) : (
          // Advanced Matrix View (Intersection crosstab tabulation)
          <div className="w-full min-w-max pb-4">
            <table className="w-full border-collapse">
              <caption className="sr-only">Pivot: cross-tab</caption>
              <thead>
                <tr className="bg-[var(--ink)] border-b border-[var(--line)]">
                  <th scope="col" className="sticky left-0 z-30 bg-[var(--ink)] text-left px-6 py-4 text-[9.5px] font-bold text-[var(--muted)] uppercase tracking-widest border-r border-[var(--line)] min-w-[200px]">
                    Row Dim / Column Dim
                  </th>
                  {matrixData.cols.map(cKey => (
                    <th scope="col" key={cKey} className="px-4 py-4 text-[9.5px] font-bold text-[var(--muted)] uppercase tracking-widest text-right font-mono border-r border-slate-150">
                      {formatDimensionDisplay(colDim, cKey)}
                    </th>
                  ))}
                  <th scope="col" className="px-6 py-4 text-[9.5px] font-bold text-slate-700 uppercase tracking-widest text-right bg-slate-100/70">
                    Row Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {matrixData.rows.map((rKey, rIdx) => {
                  const rowTotalVal = matrixData.rowTotals[rKey] || 0;
                  return (
                    <tr key={rKey} className="border-b border-slate-205 hover:bg-[var(--ink)]/40 text-left">
                      {/* Row Header - Sticky */}
                      <td className="sticky left-0 z-10 bg-[var(--surface)] group-hover:bg-[var(--ink)]/50 px-6 py-3 text-xs font-bold text-slate-850 uppercase tracking-tight border-r border-[var(--line)]">
                        <div className="flex items-center gap-2">
                           <span className="text-[8.5px] font-mono text-[var(--muted)]">R{(rIdx + 1).toString().padStart(2, '0')}</span>
                           <span className="truncate max-w-[170px]">{formatDimensionDisplay(rowDim, rKey)}</span>
                        </div>
                      </td>
                      
                      {/* Matrix cells intersections */}
                      {matrixData.cols.map(cKey => {
                        const cellVal = matrixData.cells[rKey]?.[cKey] || 0;
                        const cellItems = matrixData.cellItems[rKey]?.[cKey] || [];
                        return (
                          <td 
                            key={cKey} 
                            onClick={() => {
                              if (cellItems.length > 0) {
                                setDrillDownTarget({
                                  title: `${formatDimensionDisplay(rowDim, rKey)} × ${formatDimensionDisplay(colDim, cKey)}`,
                                  transactions: cellItems
                                });
                              }
                            }}
                            title={cellItems.length > 0 ? `Click to inspect ${cellItems.length} transactions` : undefined}
                            className={cn(
                              "px-4 py-3 text-right font-mono text-[11px] border-r border-[var(--line)] font-medium transition-colors",
                              cellItems.length > 0 ? "cursor-pointer hover:bg-indigo-50/80 dark:hover:bg-indigo-950/40 group/cell" : "cursor-default"
                            )}
                          >
                            {cellVal !== 0 ? (
                              <span className={cn(
                                "flex items-center justify-end gap-1",
                                cellVal >= 0 ? "text-emerald-500" : "text-rose-500"
                              , "tabular-nums")}>
                                 {formatCurrency(cellVal)}
                                 <ExternalLink aria-hidden="true" size={10} className="opacity-0 group-hover/cell:opacity-100 text-indigo-500 transition-opacity" />
                              </span>
                            ) : (
                              <span className="text-slate-300">-</span>
                            )}
                          </td>
                        );
                      })}

                      {/* Row Total Accumulator */}
                      <td 
                        onClick={() => {
                          const items = matrixData.rowItems[rKey] || [];
                          if (items.length > 0) {
                            setDrillDownTarget({
                              title: `Total: ${formatDimensionDisplay(rowDim, rKey)}`,
                              transactions: items
                            });
                          }
                        }}
                        title={`Click to inspect all ${matrixData.rowItems[rKey]?.length || 0} transactions for ${formatDimensionDisplay(rowDim, rKey)}`}
                        className="px-6 py-3 text-right font-mono text-xs font-bold bg-[var(--ink)]/30 hover:bg-indigo-50/70 dark:hover:bg-indigo-950/40 cursor-pointer transition-colors group/rowtot"
                      >
                        <span className={cn("flex items-center justify-end gap-1.5", rowTotalVal >= 0 ? "text-emerald-600" : "text-rose-600", "tabular-nums")}>
                           {formatCurrency(rowTotalVal)}
                           <ExternalLink aria-hidden="true" size={11} className="opacity-0 group-hover/rowtot:opacity-100 text-indigo-500 transition-opacity" />
                        </span>
                      </td>
                    </tr>
                  );
                })}

                {/* Columns Totals Aggregated Footer */}
                <tr className="bg-slate-100/60 border-t border-slate-250 text-left font-black">
                  <td className="sticky left-0 z-10 bg-slate-150/70 px-6 py-4 text-[9.5px] font-bold text-[var(--text)] uppercase tracking-widest border-r border-[var(--line)]">
                    Grand Totals (C)
                  </td>
                  {matrixData.cols.map(cKey => {
                    const colTotalVal = matrixData.colTotals[cKey] || 0;
                    const items = matrixData.colItems[cKey] || [];
                    return (
                      <td 
                        key={cKey} 
                        onClick={() => {
                          if (items.length > 0) {
                            setDrillDownTarget({
                              title: `Column Total: ${formatDimensionDisplay(colDim, cKey)}`,
                              transactions: items
                            });
                          }
                        }}
                        title={`Click to inspect all ${items.length} transactions for ${cKey}`}
                        className="px-4 py-4 text-right font-mono text-xs font-bold border-r border-slate-150 hover:bg-indigo-50/70 dark:hover:bg-indigo-950/40 cursor-pointer transition-colors group/coltot"
                      >
                        <span className={cn("flex items-center justify-end gap-1", colTotalVal >= 0 ? "text-emerald-600" : "text-rose-600", "tabular-nums")}>
                           {formatCurrency(colTotalVal)}
                           <ExternalLink aria-hidden="true" size={10} className="opacity-0 group-hover/coltot:opacity-100 text-indigo-500 transition-opacity" />
                        </span>
                      </td>
                    );
                  })}
                  
                  {/* Grand total intersection Cell */}
                  <td 
                    onClick={() => {
                      if (matrixData.allItems.length > 0) {
                        setDrillDownTarget({
                          title: `Matrix Grand Total (${matrixData.allItems.length} transactions)`,
                          transactions: matrixData.allItems
                        });
                      }
                    }}
                    title={`Click to inspect all ${matrixData.allItems.length} transactions`}
                    className="px-6 py-4 text-right font-mono text-xs font-black bg-slate-200/40 hover:bg-indigo-100/80 dark:hover:bg-indigo-900/40 cursor-pointer transition-colors group/gtot"
                  >
                    <span className={cn("flex items-center justify-end gap-1.5", matrixData.grandTotal >= 0 ? "text-emerald-700" : "text-rose-700", "tabular-nums")}>
                       {formatCurrency(matrixData.grandTotal)}
                       <ExternalLink aria-hidden="true" size={11} className="opacity-0 group-hover/gtot:opacity-100 text-indigo-600 transition-opacity" />
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Missing Elements Placeholders */}
        {((pivotMode === 'flat' && groupedData.length === 0) || (pivotMode === 'matrix' && matrixData.rows.length === 0)) && (
          <div className="p-24 text-center">
             <Calculator aria-hidden="true" size={44} className="mx-auto text-slate-300 mb-4 stroke-[1.5px]" />
             <p className="text-xs font-bold text-[var(--muted)] uppercase tracking-widest">No matching transaction intersections matched.</p>
          </div>
        )}
      </div>

      {/* Spreadsheet Status Footer */}
      <div className="h-11 bg-slate-900 border-t border-slate-800 px-6 sm:px-8 flex items-center justify-between text-slate-400 font-mono text-[9px] shrink-0">
         <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
               <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
               <span className="text-slate-300 font-bold uppercase tracking-wider">COMPUTATIONAL MATRIX ENGINE LIVE</span>
            </div>
            <span className="hidden sm:inline">ROWS: {transactions.length} items</span>
            <span className="hidden sm:inline">GROUPS: {pivotMode === 'flat' ? groupedData.length : matrixData.rows.length} modes</span>
         </div>
         <div className="flex items-center gap-4 text-[var(--muted)]">
            <span>ZOOM: 100%</span>
            <span>DOM: GRID-V3</span>
         </div>
      </div>

      {/* Interactive Drill-Down Modal */}
      {drillDownTarget && (
        <DrillDownModal
          isOpen={!!drillDownTarget}
          onClose={() => setDrillDownTarget(null)}
          accountName={drillDownTarget.title}
          from="Pivot sheet"
          transactions={drillDownTarget.transactions}
          formatCurrency={formatCurrency}
        />
      )}
    </div>
  );
}

/** EU-E8: save the current Compare layout under a name, or open one saved before. */
function CompareLayouts({ layouts, onSave, onApply, onRemove }: { layouts: PivotSheetModel['layouts']; onSave: (name: string) => boolean; onApply: (name: string) => void; onRemove: (name: string) => void }) {
  const [name, setName] = React.useState('');
  const [chosen, setChosen] = React.useState('');
  return (
    <div className="flex flex-wrap items-center gap-2 ml-2">
      {layouts.length > 0 && (
        <>
          <select aria-label="Saved layout" value={chosen} onChange={e => { setChosen(e.target.value); if (e.target.value) onApply(e.target.value); }}
            className="min-h-11 px-2 py-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] text-xs">
            <option value="">Saved layouts…</option>
            {layouts.map(l => <option key={l.name} value={l.name}>{l.name}</option>)}
          </select>
          {chosen && <button type="button" onClick={() => { onRemove(chosen); setChosen(''); }} className="min-h-11 min-w-11 px-2 text-xs underline text-[var(--muted)]">Forget</button>}
        </>
      )}
      <input aria-label="Layout name" value={name} onChange={e => setName(e.target.value)} placeholder="Name this layout"
        className="min-h-11 px-2 py-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] text-xs w-36" />
      <button type="button" disabled={!name.trim()} onClick={() => {
        if (onSave(name)) { toast.success(`Layout "${name.trim()}" saved`); setChosen(name.trim()); setName(''); }
        else toast.error('This browser could not keep the layout');
      }} className="min-h-11 px-2.5 py-1.5 rounded-lg border border-[var(--line)] text-xs font-semibold disabled:opacity-40">Save layout</button>
    </div>
  );
}
