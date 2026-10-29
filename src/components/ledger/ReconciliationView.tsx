

import { useState, useMemo } from 'react';
import { CreateFromBankLine } from './CreateFromBankLine';
import { ArrowLeftRight, Sparkles, Search, AlertCircle, ArrowRight, ShieldCheck, Zap, RefreshCw, Link as LinkIcon, X, Check, Loader2, Lock, History, Info, Layers, Maximize2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { parseLocalDate, cn, formatCurrency, resolveAccountName, formatDate } from '../../lib/utils';

import { format } from 'date-fns';

import AsyncButton from '../ui/AsyncButton';
import BankLineActionDialog from './BankLineActionDialog';
import BankLineName from '../ui/BankLineName';
import { useDialog } from '../../hooks/useDialog';
import { useUIStore } from '../../stores/useUIStore';

import type { useReconciliationModel } from './useReconciliationModel';

export function ReconciliationView(model: ReturnType<typeof useReconciliationModel>) {
 const { accounts, onMatch, onIgnore, onAddFromBank, selectedBankId, setSelectedBankId, selectedLedgerId, setSelectedLedgerId, showAutoConfirm, setShowAutoConfirm, isProcessing, isAutoReconciling, viewMode, setViewMode, searchQuery, setSearchQuery, bankLineAction, setBankLineAction, selectedAccountId, setSelectedAccountId, selectedBatchIds, setSelectedBatchIds, safeTransactions, cashAccounts, unmatchedBankLines, matchedBankLines, reconciledPercent, unclearedLedgerTransactions, optimizedMatches, executeSelectedBatchMatches, handleAutoReconcile, handleUndoAlignment, selectedBankLine, selectedLedgerTx, checkSimilarity, filteredBankFeed, filteredLedgerEntries } = model;
 // Dialog contract (src/components/AGENTS.md): named title, initial focus, trapped Tab,
 // Escape to close, focus restored to the trigger.
 const batchDialog = useDialog<HTMLDivElement>(() => setShowAutoConfirm(false), showAutoConfirm);
 const [bankLimit, setBankLimit] = useState(100);
 const [ledgerLimit, setLedgerLimit] = useState(100);
 const visibleBankFeed = useMemo(() => {
   if (filteredBankFeed.length <= bankLimit) return filteredBankFeed;
   const sliced = filteredBankFeed.slice(0, bankLimit);
   if (selectedBankId && !sliced.some(b => b.id === selectedBankId)) {
     const selected = filteredBankFeed.find(b => b.id === selectedBankId);
     if (selected) sliced.push(selected);
   }
   return sliced;
 }, [filteredBankFeed, bankLimit, selectedBankId]);
 const visibleLedgerEntries = useMemo(() => {
   if (filteredLedgerEntries.length <= ledgerLimit) return filteredLedgerEntries;
   const sliced = filteredLedgerEntries.slice(0, ledgerLimit);
   const possibleMatchId = selectedBankId ? optimizedMatches.get(selectedBankId) : undefined;
   for (const id of [selectedLedgerId, possibleMatchId]) {
     if (id && !sliced.some(l => l.id === id)) {
       const found = filteredLedgerEntries.find(l => l.id === id);
       if (found) sliced.push(found);
     }
   }
   return sliced;
 }, [filteredLedgerEntries, ledgerLimit, selectedLedgerId, selectedBankId, optimizedMatches]);
 return (
    <div className="flex flex-col h-full bg-[var(--surface)] overflow-hidden min-h-0 flex-1 rounded-2xl border border-[var(--line)] shadow-sm">

      {/* Workspace Header Dashboard */}
      <div className="bg-[var(--surface)] p-6 md:p-8 border-b border-[var(--line)] flex flex-col md:flex-row items-stretch md:items-center justify-between gap-6 relative overflow-hidden">

        <div className="relative z-10 flex items-center gap-4">
          <div className="w-12 h-12 bg-[var(--brass-soft)] border border-[var(--brass-line)] rounded-xl flex items-center justify-center text-[var(--brass)] shrink-0">
             <ArrowLeftRight aria-hidden="true" size={22} />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-black text-[var(--text)] tracking-tight uppercase leading-none">Smart Matching & Bank Reconciliation</h1>
            <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider mt-1.5 flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-[var(--pos)] animate-ping" />
              Live • Reconciled: {reconciledPercent}%
            </p>
          </div>
        </div>

        {/* Dynamic Controls Shell */}
        <div className="relative z-10 flex flex-wrap items-center gap-3">

           {/* Segment Selector View */}
           <div className="flex bg-[var(--ink)] p-1 border border-[var(--line)] rounded-xl mr-2">
             <button
               onClick={() => { setViewMode('pending'); setSelectedBankId(null); setSelectedLedgerId(null); }}
               className={cn(
                 "px-4 py-2 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all cursor-pointer flex items-center gap-1.5",
                 viewMode === 'pending' ? "bg-[var(--surface)] text-[var(--text)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--text)]"
               )}
             >
               <Layers aria-hidden="true" size={11} />
               To review ({unmatchedBankLines.length})
             </button>
             <button
               onClick={() => { setViewMode('history'); setSelectedBankId(null); setSelectedLedgerId(null); }}
               className={cn(
                 "px-4 py-2 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all cursor-pointer flex items-center gap-1.5",
                 viewMode === 'history' ? "bg-[var(--surface)] text-[var(--text)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--text)]"
               )}
             >
               <History aria-hidden="true" size={11} />
               Matched ({matchedBankLines.length})
             </button>
           </div>

           {viewMode === 'pending' && Array.from(optimizedMatches.values()).length > 0 && (
             <button
                onClick={() => setShowAutoConfirm(true)}
                className="flex items-center gap-2 px-4 h-10 bg-[var(--brass-soft)] text-[var(--brass)] font-bold rounded-xl text-[10px] uppercase tracking-wider hover:opacity-90 transition-all border border-[var(--brass-line)] cursor-pointer shadow-sm"
             >
                <Zap aria-hidden="true" size={14} className="fill-[var(--brass)]" />
                Review {Array.from(optimizedMatches.values()).length} suggested matches
             </button>
           )}

           {viewMode === 'pending' && (
             <button
               onClick={handleAutoReconcile}
               disabled={isAutoReconciling}
               className="flex items-center gap-2 px-5 h-10 bg-[var(--brass)] text-[var(--ink)] font-bold rounded-xl text-[10px] uppercase tracking-wider hover:opacity-90 transition-all shadow-md disabled:opacity-50 cursor-pointer"
              aria-label="Auto-match all">
               {isAutoReconciling ? <Loader2 aria-hidden="true" size={14} className="animate-spin" /> : <Sparkles aria-hidden="true" size={14} />}
               Auto-match all
             </button>
           )}

           <button aria-label="Reload reconciliation" onClick={() => window.location.reload()} className="w-11 h-11 flex items-center justify-center bg-[var(--surface)]/5 border border-white/10 rounded-xl text-white/40 hover:text-white hover:bg-[var(--surface)]/10 transition-all cursor-pointer">
             <RefreshCw aria-hidden="true" size={18} className={cn(isProcessing && "animate-spin text-emerald-400")} />
           </button>
        </div>
      </div>

      {/* Verification Filter & Info Stripe */}
      <div className="bg-[var(--ink)] border-b border-[var(--line)] px-6 py-3 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3 text-xs text-[var(--muted)] font-medium">
          <Info aria-hidden="true" size={14} className="text-[var(--brass)] shrink-0" />
          <span>
            {viewMode === 'pending'
              ? "Pick a bank statement line, then pick the ledger entry that matches it."
              : "Review completed matches. Click a row to see the linked entries or undo a wrong match."}
          </span>
        </div>
        <div className="flex items-center gap-3 w-full md:w-auto shrink-0">
          {cashAccounts.length > 0 && (
            <select aria-label="Reconciliation account"
              value={selectedAccountId}
              onChange={e => setSelectedAccountId(e.target.value)}
              className="h-9 px-3 bg-[var(--surface)] border border-[var(--line)] rounded-xl text-xs font-semibold text-[var(--text)] outline-none focus:border-[var(--brass)] transition-all cursor-pointer"
            >
              <option value="all">All Cash Accounts ({cashAccounts.length})</option>
              {cashAccounts.map(acc => (
                <option key={acc.id} value={acc.id}>
                  {acc.code ? `${acc.code} - ${acc.name}` : acc.name}
                </option>
              ))}
            </select>
          )}
          <div className="relative w-full md:w-64">
            <Search aria-hidden="true" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" size={14} />
            <input aria-label="Search reconciliation amounts or descriptions"
              type="text"
              placeholder="Quick search amounts or labels..."
              className="w-full h-9 pl-9 pr-4 bg-[var(--surface)] border border-[var(--line)] rounded-xl text-xs font-semibold text-[var(--text)] outline-none focus:border-[var(--brass)] transition-all"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* MAIN LAYOUT */}
      {viewMode === 'pending' ? (
        /* PENDING ALIGNMENT COLUMN MATRIX */
        <div className="flex-1 grid grid-cols-1 xl:grid-cols-2 overflow-hidden gap-6 p-6 md:p-8 relative">

          {/* Connector Graphic in Gap spacing */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none hidden xl:flex">
             <div className="w-14 h-14 bg-slate-900 rounded-full border-4 border-white shadow-xl flex items-center justify-center text-emerald-500 ring-2 ring-slate-100">
                <LinkIcon aria-hidden="true" size={20} className={cn(selectedBankId && selectedLedgerId && "animate-pulse text-indigo-500")} />
             </div>
          </div>

          {/* Left Column: Input Stream Feed */}
          <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] overflow-hidden flex flex-col shadow-sm">
             <div className="px-5 py-4 border-b border-[var(--line)] flex items-center justify-between bg-[var(--ink)]/50">
                <span className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider">Bank statement lines</span>
                <span className="text-[10px] font-mono font-bold bg-[var(--brass-soft)] text-[var(--brass)] px-2 py-0.5 rounded border border-[var(--brass-line)]">{filteredBankFeed.length} to review</span>
             </div>
             <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-3">
                {visibleBankFeed.map(btx => {
                  const matchedLedgerId = optimizedMatches.get(btx.id);
                  const isSelected = selectedBankId === btx.id;

                  return (
                    <motion.div role="presentation"
                      key={btx.id}
                      layout
                      onClick={() => setSelectedBankId(btx.id)}
                      className={cn(
                        "p-4 rounded-xl transition-all cursor-pointer border flex items-center justify-between group relative overflow-hidden",
                        isSelected
                          ? "bg-[var(--brass-soft)] text-[var(--text)] border-[var(--brass-line)] shadow-md"
                          : "bg-[var(--surface)] border-[var(--line)] hover:bg-[var(--ink)]/50 hover:border-[var(--line)]"
                      )}
                    >
                      {/* Interactive Match indicator side mark */}
                      {matchedLedgerId && (
                        <div className="absolute top-0 left-0 w-1.5 h-full bg-[var(--pos)]" />
                      )}

                      <button type="button" aria-pressed={isSelected} className="text-left flex flex-col gap-1 overflow-hidden pl-1">
                        <span className={cn("text-[8px] font-bold uppercase tracking-wider font-mono", isSelected ? "text-[var(--brass)]" : "text-[var(--muted)]")}>
                          {formatDate(btx.date)}
                        </span>
                        <BankLineName text={btx.description} className="text-sm font-bold tracking-tight max-w-[220px] md:max-w-xs" />
                        {matchedLedgerId && !isSelected && (
                          <div className="flex items-center gap-1.5 mt-2 text-[8px] font-bold uppercase tracking-wider text-[var(--pos)] bg-[var(--pos)]/10 px-2 py-1 rounded border border-[var(--pos)]/20 w-fit">
                            <Zap aria-hidden="true" size={9} fill="currentColor" />
                            Match found
                          </div>
                        )}
                      </button>
                      <div className="flex flex-col items-end shrink-0 ml-4">
                         <span className="text-md font-mono font-bold tabular-nums tracking-tight">
                          {formatCurrency(btx.amountCents, btx.currency)}
                        </span>
                        <div className="flex gap-1 mt-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity">
                           <button type="button" onClick={(e) => { e.stopPropagation(); setBankLineAction({ mode: 'pay', line: btx }); }} className="p-1 px-2 text-[9px] font-bold text-[var(--muted)] hover:text-[var(--text)] bg-[var(--surface)] border border-[var(--line)] rounded cursor-pointer uppercase tracking-wider" title={btx.amountCents > 0 ? 'This deposit pays invoices' : 'This payment pays bills'}>
                             {btx.amountCents > 0 ? 'Invoices' : 'Bills'}
                           </button>
                           <button type="button" onClick={(e) => { e.stopPropagation(); setBankLineAction({ mode: 'split', line: btx }); }} className="p-1 px-2 text-[9px] font-bold text-[var(--muted)] hover:text-[var(--text)] bg-[var(--surface)] border border-[var(--line)] rounded cursor-pointer uppercase tracking-wider" title="Split over several accounts">
                             Split
                           </button>
                           <button
                             onClick={(e) => { e.stopPropagation(); onIgnore(btx.id); }}
                             className="p-1 px-2 text-[9px] font-bold text-[var(--muted)] hover:text-rose-500 bg-[var(--surface)] border border-[var(--line)] rounded cursor-pointer uppercase tracking-wider"
                             title="Ignore statement item"
                           >
                             Omit
                           </button>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
                {filteredBankFeed.length > visibleBankFeed.length && (
                  <button
                    type="button"
                    onClick={() => setBankLimit(n => n + 200)}
                    className="w-full min-h-11 py-2 text-xs font-bold text-[var(--text)] bg-[var(--surface)] border border-[var(--line)] rounded-xl hover:bg-[var(--ink)]/50 transition-all"
                  >
                    Show more bank lines ({visibleBankFeed.length} of {filteredBankFeed.length})
                  </button>
                )}
                {filteredBankFeed.length === 0 && (
                  <div className="h-full py-20 flex flex-col items-center justify-center p-10 text-center opacity-70">
                     <ShieldCheck aria-hidden="true" size={40} className="text-[var(--pos)] mb-3" />
                     <h2 className="font-bold text-sm text-[var(--text)] uppercase tracking-tight">Nothing to review</h2>
                     <p className="text-[10px] font-bold text-[var(--muted)] dark:text-[#8bc19e] uppercase tracking-wider mt-1">{searchQuery ? 'No bank lines match this search; clear it to see the others' : 'Import a statement from Bank Connections, or review the matched history'}</p>
                     {!searchQuery && <button type="button" onClick={() => useUIStore.getState().setActiveTab('banking')} className="mt-4 min-h-11 rounded-xl border border-[var(--line)] px-4 py-2 text-xs font-bold text-[var(--text)]">Open Bank Connections</button>}
                  </div>
                )}
             </div>
          </div>

          {/* Right Column: Internal Registry Validation */}
          <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] overflow-hidden flex flex-col shadow-sm">
             <div className="px-5 py-4 border-b border-[var(--line)] flex items-center justify-between bg-[var(--ink)]/50">
                <span className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider">Ledger entries</span>
                <span className="text-[10px] font-mono font-bold bg-[var(--brass-soft)] text-[var(--brass)] px-2 py-0.5 rounded border border-[var(--brass-line)]">{filteredLedgerEntries.length} uncleared items</span>
             </div>
             <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-3">
                {visibleLedgerEntries.map(ltx => {
                  const isSelected = selectedLedgerId === ltx.id;
                  const isPossibleMatch = selectedBankId && optimizedMatches.get(selectedBankId) === ltx.id;

                  return (
                    <motion.button type="button" aria-pressed={isSelected}
                      key={ltx.id}
                      layout
                      onClick={() => setSelectedLedgerId(ltx.id)}
                      className={cn(
                        "w-full text-left p-5 rounded-xl transition-all cursor-pointer border flex items-center justify-between group relative overflow-hidden",
                        isSelected
                          ? "bg-emerald-600 text-white border-emerald-600 shadow-lg ring-1 ring-white/10"
                          : isPossibleMatch
                            ? "bg-emerald-50/70 border-emerald-200 ring-2 ring-emerald-500/10 hover:bg-emerald-50"
                            : "bg-[var(--ink)] border-[var(--line)] hover:border-slate-350 hover:bg-slate-100/50"
                      )}
                    >
                      {isPossibleMatch && (
                        <div className="absolute top-0 left-0 w-1.5 h-full bg-indigo-500" />
                      )}

                      <div className="text-left flex flex-col gap-1 overflow-hidden pl-1">
                        <div className="flex items-center gap-2">
                          <span className={cn("text-[8px] font-semibold uppercase tracking-wider font-mono", isSelected ? "text-emerald-200" : "text-[var(--muted)]")}>
                            {format(parseLocalDate(ltx.date), 'MMM dd')} • {resolveAccountName(accounts, ltx.lines?.[0]?.accountId, ltx.lines?.[0]?.accountName)}
                          </span>
                          {isPossibleMatch && !isSelected && <Zap aria-hidden="true" size={10} className="text-emerald-500 animate-pulse" />}
                        </div>
                        <span className={cn("text-sm font-extrabold tracking-tight truncate max-w-[220px] md:max-w-xs", isSelected ? "text-white" : "text-[var(--text)]")}>
                          {ltx.description}
                        </span>
                      </div>
                      <span className={cn("text-md font-mono font-black tabular-nums tracking-tighter shrink-0 ml-4", isSelected ? "text-white" : "text-[var(--text)]")}>
                        {formatCurrency(ltx.totalAmountCents)}
                      </span>
                    </motion.button>
                  );
                })}
                {filteredLedgerEntries.length > visibleLedgerEntries.length && (
                  <button
                    type="button"
                    onClick={() => setLedgerLimit(n => n + 200)}
                    className="w-full min-h-11 py-2 text-xs font-bold text-[var(--text)] bg-[var(--surface)] border border-[var(--line)] rounded-xl hover:bg-[var(--ink)]/50 transition-all"
                  >
                    Show more ledger entries ({visibleLedgerEntries.length} of {filteredLedgerEntries.length})
                  </button>
                )}
                {filteredLedgerEntries.length === 0 && (
                  <div className="h-full py-20 flex flex-col items-center justify-center p-10 text-center opacity-70">
                     <ShieldCheck aria-hidden="true" size={40} className="text-indigo-500 mb-3" />
                     <h2 className="font-extrabold text-sm text-[var(--text)] uppercase tracking-tight">No ledger entries to match</h2>
                     <p className="text-[10px] font-medium text-[var(--muted)] dark:text-[#8bc19e] uppercase tracking-widest mt-1">{searchQuery ? 'Clear the search to see uncleared entries' : 'All posted entries are cleared; add a new entry from Overview when there is more work'}</p>
                  </div>
                )}
             </div>
          </div>
        </div>
      ) : (
        /* HISTORY CLEAR VERIFICATION VIEW */
        <div className="flex-1 p-6 md:p-8">
          <div className="bg-[var(--surface)] rounded-[32px] border border-[var(--line)] shadow-xs overflow-hidden flex flex-col h-full flex-1 min-h-0">
            <div className="px-5 py-4 border-b border-[var(--line)] bg-[var(--ink)]/50 flex items-center justify-between">
              <div>
                <span className="text-xs font-black text-[var(--text)] uppercase tracking-wider">Matched history</span>
                <p className="text-[10px] text-[var(--muted)] uppercase tracking-widest font-semibold mt-0.5">Bank lines matched to ledger entries and cleared</p>
              </div>
              <div className="flex items-center gap-2 text-xs font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-1">
                 <Lock aria-hidden="true" size={12} />
                 <span>Cleared items are locked</span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
               {filteredBankFeed.length === 0 ? (
                 <div className="py-24 text-center text-[var(--muted)] flex flex-col items-center justify-center space-y-3">
                   <History aria-hidden="true" size={36} className="text-slate-300" />
                   <h3 className="font-extrabold text-[11px] uppercase tracking-widest">No matched items yet</h3>
                   <p className="text-[10px] font-medium uppercase tracking-tight text-[var(--muted)] max-w-xs leading-normal">
                     Use the To review tab to match bank lines with ledger entries.
                   </p>
                 </div>
               ) : (
                 <div className="border border-slate-150 rounded-xl overflow-hidden divide-y divide-slate-100">
                    {filteredBankFeed.map(line => {
                      const linkedTx = safeTransactions.find(t => t.id === line.matchedTransactionId);
                      const isSelected = selectedBankId === line.id;

                      return (
                        <div key={line.id} className="hover:bg-[var(--ink)] transition-all">
                          <div role="presentation"
                             onClick={() => setSelectedBankId(isSelected ? null : line.id)}
                             className="flex flex-col lg:flex-row items-start lg:items-center justify-between p-5 gap-4 cursor-pointer"
                          >
                             {/* Statement Info */}
                             <button type="button" aria-expanded={isSelected} className="w-full text-left flex-1 min-w-0">
                               <div className="flex items-center gap-2 flex-wrap mb-1">
                                 <span className="text-[8px] font-black uppercase text-[var(--muted)] font-mono tracking-wider">{line.date}</span>
                                 <span className="px-2 py-0.2 bg-emerald-100 text-emerald-700 border border-emerald-200 rounded text-[7px] font-black uppercase tracking-wider">Cleared</span>
                                 {line.bankChange && (
                                   <span role="status" className="px-2 py-0.2 bg-amber-100 text-amber-800 border border-amber-300 rounded text-[7px] font-black uppercase tracking-wider">
                                     {line.bankChange === 'removed' ? 'Bank withdrew this line: review' : 'Bank changed this line: review'}
                                   </span>
                                 )}
                               </div>
                               <h4 className="font-extrabold text-sm text-[var(--text)] min-w-0"><BankLineName text={line.description} /></h4>
                               <p className="text-[10px] text-[var(--muted)] font-mono mt-0.5 tabular-nums">Statement amount: {formatCurrency(line.amountCents, line.currency)}</p>
                               {line.bankCorrection && (
                                 <p className="text-[10px] text-amber-800 font-mono mt-0.5 tabular-nums">Bank now says: {line.bankCorrection.date} · {line.bankCorrection.description} · {formatCurrency(line.bankCorrection.amountCents, line.bankCorrection.currency || line.currency)}</p>
                               )}
                             </button>

                             {/* Connector Node */}
                             <div className="flex shrink-0 items-center gap-2 text-emerald-500 lg:px-4">
                               <ArrowRight aria-hidden="true" size={14} className="hidden lg:block animate-pulse" />
                               <LinkIcon aria-hidden="true" size={12} />
                             </div>

                             {/* Internal Ledger Match Info */}
                             <div className="flex-1 min-w-0">
                               <span className="text-[8px] font-black uppercase text-indigo-400 font-mono tracking-wider">Matched ledger entry</span>
                               <h4 className="font-bold text-sm text-slate-700 truncate">{linkedTx?.description || 'Linked entry no longer found'}</h4>
                               <p className="text-[10px] text-[var(--muted)] font-mono mt-0.5 mt-0.5 tabular-nums">Ledger amount: {linkedTx ? formatCurrency(linkedTx.totalAmountCents) : 'N/A'}</p>
                             </div>

                             {/* Revert controls directly */}
                             <div className="shrink-0 flex items-center gap-3 w-full lg:w-auto justify-end border-t lg:border-t-0 pt-3 lg:pt-0">
                               <AsyncButton
                                 onClick={(e) => {
                                   e.stopPropagation();
                                   return handleUndoAlignment(line.id, line.matchedTransactionId);
                                 }}
                                 loadingText="Undoing..."
                                 className="px-4 py-2 bg-rose-50 border border-rose-100 text-rose-600 hover:bg-rose-100 hover:text-rose-700 text-[9px] font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer flex items-center gap-1 leading-none shadow-xs"
                               >
                                 <X aria-hidden="true" size={10} strokeWidth={2.5} /> Undo match
                               </AsyncButton>
                             </div>
                          </div>
                        </div>
                      );
                    })}
                 </div>
               )}
            </div>
          </div>
        </div>
      )}

      {bankLineAction && <BankLineActionDialog target={bankLineAction} onClose={() => setBankLineAction(null)} />}

      {/* DUAL-VERIFIER ALIGNMENT DIALOG BAR */}
      <AnimatePresence mode="wait">
        {selectedBankLine && (viewMode === 'pending' ? selectedLedgerTx : true) && (
          <motion.div
            initial={{ y: 50, opacity: 0, x: '-50%' }}
            animate={{ y: 0, opacity: 1, x: '-50%' }}
            exit={{ y: 50, opacity: 0, x: '-50%' }}
            className="fixed bottom-20 lg:bottom-10 left-1/2 -translate-x-1/2 w-full max-w-6xl z-[80] px-4 md:px-6"
          >
            <div className="bg-[var(--surface)] text-[var(--text)] p-5 md:p-6 rounded-2xl border border-[var(--line)] shadow-2xl flex flex-col gap-5 relative overflow-hidden">
              {/* Top row - Side-by-side nodes comparison matrix */}
              <div className="grid grid-cols-1 md:grid-cols-5 gap-6 items-center">

                {/* Node A */}
                <div className="md:col-span-2 flex flex-col bg-[var(--ink)]/50 p-4 rounded-xl border border-[var(--line)] relative overflow-hidden group">
                  <div className="absolute top-0 right-0 p-2 opacity-10"><Layers aria-hidden="true" size={36} /></div>
                  <span className="text-[8px] font-bold text-[var(--pos)] uppercase tracking-wider font-mono">Bank statement</span>
                  <BankLineName text={selectedBankLine.description} className="text-md font-bold mt-1 tracking-tight" />
                  <div className="flex items-center justify-between mt-3 flex-wrap gap-1">
                    <span className="text-[10px] font-mono text-[var(--muted)]">{selectedBankLine.date}</span>
                    <span className="text-sm font-bold font-mono text-[var(--text)] tabular-nums">{formatCurrency(selectedBankLine.amountCents, selectedBankLine.currency)}</span>
                  </div>
                </div>

                {/* Heuristic Probability Weight Indicator */}
                <div className="text-center flex flex-col items-center justify-center p-2">
                  <span className="text-[8px] font-bold text-[var(--muted)] uppercase tracking-wider">Match confidence</span>
                  {viewMode === 'pending' ? (
                     <>
                       <div className="text-2xl md:text-3xl font-mono font-bold tracking-tight text-[var(--pos)] animate-pulse mt-1">
                         {checkSimilarity.overall}%
                       </div>

                       {/* Likeness descriptor */}
                       <div className="text-[7px] font-bold uppercase tracking-wider text-[var(--muted)] mt-2">
                         {checkSimilarity.overall >= 90 ? 'Strong match' : checkSimilarity.overall >= 75 ? 'Good match' : 'Check manually'}
                       </div>

                       {/* Interactive similarity progress tube */}
                       <div className="w-full bg-[var(--ink)] h-1.5 rounded-full mt-2 overflow-hidden max-w-[120px] border border-[var(--line)]">
                         <div className="h-full bg-[var(--pos)] rounded-full transition-all" style={{ width: `${checkSimilarity.overall}%` }} />
                       </div>
                     </>
                  ) : (
                     <>
                        <div className="w-10 h-10 bg-[var(--pos)]/10 border border-[var(--pos)]/20 rounded-full flex items-center justify-center text-[var(--pos)] mt-2">
                          <Lock aria-hidden="true" size={16} />
                        </div>
                        <span className="text-[7px] text-[var(--pos)] font-bold uppercase mt-2">Cleared</span>
                     </>
                  )}
                </div>

                {/* Node B */}
                <div className="md:col-span-2 flex flex-col bg-[var(--ink)]/50 p-4 rounded-xl border border-[var(--line)] relative overflow-hidden group">
                  <div className="absolute top-0 right-0 p-2 opacity-10"><Maximize2 aria-hidden="true" size={36} /></div>
                  <span className="text-[8px] font-bold text-[var(--brass)] uppercase tracking-wider font-mono">Ledger entry</span>
                  <span className="text-md font-bold truncate mt-1 tracking-tight">{selectedLedgerTx?.description || 'No ledger entry selected'}</span>
                  <div className="flex items-center justify-between mt-3 flex-wrap gap-1">
                    <span className="text-[10px] font-mono text-[var(--muted)]">{selectedLedgerTx?.date || 'N/A'}</span>
                    <span className="text-sm font-bold font-mono text-[var(--text)] tabular-nums">
                      {selectedLedgerTx ? formatCurrency(selectedLedgerTx.totalAmountCents) : 'N/A'}
                    </span>
                  </div>
                </div>

              </div>

              {/* Sub stripe: discrepancy calculations */}
              {viewMode === 'pending' && selectedLedgerTx && (
                <div className="bg-black/20 p-4 rounded-xl flex flex-col md:flex-row gap-4 justify-between items-center border border-white/5">

                   {/* Verification items list */}
                   <div className="flex items-center gap-6 flex-wrap">
                      {/* Date Offset Indicators */}
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
                        <span className="text-[10px] text-slate-350 font-bold uppercase tracking-tight">
                          Date difference: <strong className={cn(checkSimilarity.dateDiff > 3 ? "text-amber-300" : "text-emerald-400")}>{checkSimilarity.dateDiff} days</strong>
                        </span>
                      </div>

                      {/* Text likeness */}
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
                        <span className="text-[10px] text-slate-350 font-bold uppercase tracking-tight">
                          Description similarity: <strong className="text-indigo-300">{checkSimilarity.textScore}%</strong>
                        </span>
                      </div>

                      {/* Financial deviation delta */}
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
                        <span className="text-[10px] text-slate-350 font-bold uppercase tracking-tight">
                          Amount difference: <strong className={cn(checkSimilarity.amountDiff !== 0 ? "text-amber-400" : "text-emerald-400", "tabular-nums")}>
                            {checkSimilarity.amountDiff === 0 ? "Amounts match" : `${formatCurrency(Math.abs(checkSimilarity.amountDiff))} difference`}
                          </strong>
                        </span>
                      </div>
                   </div>

                   {/* Alerts / Warnings inside discrepancy state */}
                   {checkSimilarity.amountDiff !== 0 && (
                     <div className="flex items-center gap-1.5 text-[8px] font-black uppercase tracking-widest text-amber-300 bg-amber-500/10 px-3 py-1.5 rounded-lg border border-amber-500/20 leading-none">
                       <AlertCircle aria-hidden="true" size={10} />
                       <span>Difference may be a bank fee or currency conversion</span>
                     </div>
                   )}
                </div>
              )}

              {/* Action Buttons bar */}
              <div className="flex flex-col sm:flex-row items-center justify-between border-t border-white/10 pt-4 gap-4">
                <button
                  onClick={() => { setSelectedBankId(null); setSelectedLedgerId(null); }}
                  className="px-6 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-white/30 hover:text-white transition-colors cursor-pointer w-full sm:w-auto"
                >
                  Cancel
                </button>

                <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                  {viewMode === 'pending' ? (
                    <button
                      onClick={() => {
                        onMatch(selectedBankId!, selectedLedgerId!);
                        setSelectedBankId(null);
                        setSelectedLedgerId(null);
                      }}
                      className="px-8 h-12 bg-emerald-600 text-white rounded-xl font-black text-[11px] uppercase tracking-[0.2em] flex items-center justify-center gap-3 hover:bg-emerald-500 transition-all cursor-pointer shadow-lg shadow-emerald-900/30 w-full sm:w-auto"
                    >
                      <ShieldCheck aria-hidden="true" size={18} />
                      Confirm match
                    </button>
                  ) : (
                    <AsyncButton
                      onClick={() => handleUndoAlignment(selectedBankLine!.id, selectedBankLine!.matchedTransactionId)}
                      loadingText="Undoing..."
                      className="px-8 h-12 bg-rose-600 text-white rounded-xl font-black text-[11px] uppercase tracking-[0.2em] flex items-center justify-center gap-3 hover:bg-rose-500 transition-all cursor-pointer shadow-lg shadow-rose-900/30 w-full sm:w-auto"
                    >
                      <X aria-hidden="true" size={18} />
                      Undo match
                    </AsyncButton>
                  )}
                </div>
              </div>

            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedBankId && !selectedLedgerId && viewMode === 'pending' && (
          <motion.div
            initial={{ y: 50, opacity: 0, x: '-50%' }}
            animate={{ y: 0, opacity: 1, x: '-50%' }}
            exit={{ y: 50, opacity: 0, x: '-50%' }}
            className="fixed bottom-20 lg:bottom-10 left-1/2 -translate-x-1/2 w-full max-w-xl z-[80] px-4 md:px-6"
          >
            <div className="bg-zinc-950 text-white p-5 rounded-[32px] border border-white/10 shadow-3xl flex flex-col gap-3">
               <div className="flex items-center gap-3 pl-2">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                  </span>
                  <span className="text-xs font-bold text-zinc-400">Select a ledger entry to match, or create an entry from this bank line</span>
               </div>
               {selectedBankLine && (
                 <CreateFromBankLine key={selectedBankLine.id} line={selectedBankLine} accounts={accounts} onCreate={async (choice) => {
                   await onAddFromBank(selectedBankLine, choice);
                   setSelectedBankId(null);
                 }} />
               )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* SMART BATCH VERIFICATION CHECKBOX MODAL */}
      <AnimatePresence>
         {showAutoConfirm && Array.from(optimizedMatches.values()).length > 0 && (
             <>
               <div role="presentation" aria-hidden="true" className="fixed inset-0 bg-slate-900/50 backdrop-blur-md z-[150]" onClick={() => setShowAutoConfirm(false)} />
               <motion.div
                  {...batchDialog.dialogProps}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-4xl z-[200] bg-[var(--surface)] rounded-[32px] p-6 md:p-8 shadow-[0_45px_110px_-15px_rgba(0,0,0,0.55)] border border-[var(--line)] overflow-hidden flex flex-col max-h-[85dvh]"
               >
                  <div className="flex flex-col md:flex-row items-start md:items-center justify-between border-b border-[var(--line)] pb-5 gap-4">
                    <div className="flex items-center gap-3">
                       <Zap aria-hidden="true" size={24} className="text-amber-500 fill-amber-500" />
                       <div>
                         <h2 id={batchDialog.titleId} className="text-xl font-black uppercase tracking-tight text-[var(--text)]">
                            Review suggested matches
                         </h2>
                         <p className="text-[10px] text-[var(--muted)] font-bold uppercase tracking-widest mt-0.5">Choose the matches to apply. Tick individual rows, or apply them all at once.</p>
                       </div>
                    </div>
                    {/* Header check/uncheck shortcuts */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          const state: Record<string, boolean> = {};
                          unmatchedBankLines.forEach(b => { if (optimizedMatches.get(b.id)) state[b.id] = true; });
                          setSelectedBatchIds(state);
                        }}
                        className="text-[9px] font-black px-2.5 py-1.5 bg-slate-100 text-slate-600 hover:bg-slate-200 uppercase tracking-widest rounded-lg transition-all cursor-pointer"
                      >
                        Select All
                      </button>
                      <button
                        onClick={() => setSelectedBatchIds({})}
                        className="text-[9px] font-black px-2.5 py-1.5 bg-slate-100 text-slate-600 hover:bg-slate-200 uppercase tracking-widest rounded-lg transition-all cursor-pointer"
                      >
                        Deselect All
                      </button>
                    </div>
                  </div>

                  {/* Checklist matching pairs items list structure */}
                  <div className="py-5 overflow-y-auto custom-scrollbar flex-1 space-y-3.5 my-3">
                     {unmatchedBankLines.filter(tx => optimizedMatches.get(tx.id)).map(btx => {
                        const matchedLtxId = optimizedMatches.get(btx.id);
                        const matchedLtx = unclearedLedgerTransactions.find(t => t.id === matchedLtxId);
                        if (!matchedLtx) return null;

                        const isChecked = !!selectedBatchIds[btx.id];

                        return (
                           <button type="button" aria-pressed={isChecked}
                             key={btx.id}
                             onClick={() => setSelectedBatchIds(prev => ({ ...prev, [btx.id]: !prev[btx.id] }))}
                             className={cn(
                               "w-full text-left flex items-center gap-4 p-4 rounded-xl border transition-all cursor-pointer",
                               isChecked ? "border-emerald-200 bg-emerald-50/20" : "border-slate-150 bg-[var(--ink)]/50 opacity-60 hover:opacity-100 hover:border-slate-300"
                             )}
                           >
                              {/* Stateful Row Checkbox wrapper */}
                              <div className="shrink-0 flex items-center justify-center">
                                 <div className={cn(
                                   "w-5.5 h-5.5 rounded-lg border flex items-center justify-center transition-all",
                                   isChecked ? "bg-emerald-600 border-emerald-600 text-white" : "bg-[var(--surface)] border-slate-300"
                                 )}>
                                    {isChecked && <Check aria-hidden="true" size={12} strokeWidth={3} />}
                                 </div>
                              </div>

                              <div className="flex-1 grid grid-cols-1 md:grid-cols-11 gap-4 items-center overflow-hidden">
                                {/* Bank Item info */}
                                <div className="md:col-span-5 overflow-hidden">
                                   <span className="text-[8px] uppercase tracking-widest font-black text-[var(--muted)] block mb-0.5">Bank statement line</span>
                                   <div className="font-bold text-[var(--text)] text-sm"><BankLineName text={btx.description} /></div>
                                   <p className="text-[10px] font-semibold text-[var(--muted)] font-mono mt-0.5">{btx.date} • {formatCurrency(btx.amountCents, btx.currency)}</p>
                                </div>

                                {/* Flow indicator status line */}
                                <div className="hidden md:flex justify-center text-emerald-500">
                                    <ArrowRight aria-hidden="true" size={16} />
                                </div>

                                {/* Mapped registry internal record item info */}
                                <div className="md:col-span-5 overflow-hidden text-right">
                                   <span className="text-[8px] uppercase tracking-widest font-black text-[var(--muted)] block mb-0.5">Ledger entry</span>
                                   <p className="font-bold text-[var(--text)] truncate text-sm">{matchedLtx.description}</p>
                                   <p className="text-[10px] font-semibold text-[var(--muted)] font-mono mt-0.5">{matchedLtx.date} • {formatCurrency(matchedLtx.totalAmountCents)}</p>
                                   {Math.abs(btx.amountCents) !== Math.abs(matchedLtx.totalAmountCents) && (
                                     <span className="text-[9px] text-amber-600 font-bold uppercase tracking-wider block mt-1 bg-amber-50/50 inline-block px-1.5 py-0.5 rounded border border-amber-200 tabular-nums">
                                       Diff: {formatCurrency(Math.abs(Math.abs(btx.amountCents) - Math.abs(matchedLtx.totalAmountCents)))}
                                     </span>
                                   )}

                                </div>
                              </div>
                           </button>
                        );
                     })}
                  </div>

                  {/* Batch validation button stripe */}
                  <div className="border-t pt-5 flex items-center justify-between shrink-0">
                     <button onClick={() => setShowAutoConfirm(false)} className="px-6 py-3 font-bold text-xs uppercase tracking-widest text-[var(--muted)] hover:text-[var(--text)] transition-colors cursor-pointer">
                        Cancel
                     </button>
                     <button
                        onClick={executeSelectedBatchMatches}
                        disabled={isProcessing}
                        className="bg-[#018669] hover:bg-emerald-500 cursor-pointer transition-all text-white px-8 h-12 rounded-xl font-black uppercase text-xs tracking-widest flex items-center gap-2.5 disabled:opacity-50"
                      aria-label="Apply selected matches">
                        {isProcessing ? <Loader2 aria-hidden="true" size={16} className="animate-spin" /> : <ShieldCheck aria-hidden="true" size={16} />}
                        Apply selected matches ({Object.values(selectedBatchIds).filter(Boolean).length})
                     </button>
                  </div>
               </motion.div>
             </>
         )}
      </AnimatePresence>
    </div>
  );
}
