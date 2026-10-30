import { rateUsedId, rateUsedText, type RateUsed } from '../../lib/rateUsed';
import React from 'react';
import { X, Calendar, FileText, Building2, Trash2, Plus, ShieldAlert, Hash, Sliders, RefreshCcw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { auth } from '../../firebase';
import { formatDecimal, getLocalDateISO, parseAmountToCents, cn } from '../../lib/utils';
import CategoryWhyPopover from '../common/CategoryWhyPopover';
import { getLineDimension, setLineDimension, extractUniqueDimensionPaths } from '../../lib/dimensionUtils';
import TagInput from './TagInput';
import AsyncButton from '../ui/AsyncButton';
import EntryLinks from './EntryLinks';
import EntryQuestions from './EntryQuestions';
import type { TransactionEditModalModel } from './TransactionEditModal';

export function TransactionEditModalView({ transaction, accounts, lockDate, onClose, onReverseAndCorrect, withOccurrenceKeys, formId, dimensionNodes, isReverseMode, setIsReverseMode, reversalDate, setReversalDate, correctionReason, setCorrectionReason, date, setDate, description, setDescription, payee, setPayee, type, setType, status, setStatus, project, setProject, isCleared, setIsCleared, isFlagged, setIsFlagged, fileUrls, setFileUrls, originalCurrency, setOriginalCurrency, exchangeRate, setExchangeRate, isFetchingRate, setIsFetchingRate, transactions, activeDimensions, lines, lineKeys, isLocked, totalAmountCents, sumLines, handleAddLine, handleRemoveLine, handleLineChange, handleSave, dialogProps, titleId }: TransactionEditModalModel) {
  return (
    <AnimatePresence>
      <div {...dialogProps} className="fixed inset-0 z-[210] flex items-center justify-center p-4">
        {/* Backdrop overlay */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-zinc-950/70 backdrop-blur-sm"
        />

        {/* Modal Sheet panel */}
        <motion.div
          initial={{ opacity: 0, scale: 0.98, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.98, y: 15 }}
          className="relative w-full max-w-4xl bg-[var(--surface)] rounded-[32px] shadow-2xl border border-[var(--line)] overflow-hidden flex flex-col max-h-[90dvh]"
        >
          {/* Header with audit indicators */}
          <div className="px-6 py-5 border-b border-[var(--line)] flex items-center justify-between bg-[var(--ink)]/50">
            <div className="flex items-center gap-3">
              <div className={cn(
                "w-10 h-10 rounded-xl flex items-center justify-center shadow-md",
                isReverseMode ? "bg-indigo-600 text-white shadow-indigo-600/20" : "bg-zinc-900 text-white shadow-zinc-800/10"
              )}>
                {isReverseMode ? <RefreshCcw aria-hidden="true" size={18} className="text-white" /> : <Sliders aria-hidden="true" size={18} className="text-zinc-100" />}
              </div>
              <div>
                <h2 id={titleId} className="text-lg font-bold text-[var(--text)] tracking-tight flex items-center gap-2">
                  {isReverseMode ? 'Reverse & Correct Entry' : 'Edit Ledger Entry details'}
                </h2>
                <p className="text-[10px] text-zinc-400 font-mono uppercase tracking-widest mt-0.5">
                  ID: {transaction.id.slice(0, 12)}... • {isReverseMode ? 'Atomic Reversal & Correction' : 'SHA-255 Audit Sealed'}
                </p>
              </div>
            </div>

            <button aria-label="Close" 
              onClick={onClose} 
              className="p-2 hover:bg-zinc-100 rounded-full transition-all text-zinc-400 hover:text-[var(--text)]"
            ><X aria-hidden="true" size={18} /></button>
          </div>

          {/* Form Content body */}
          <div className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 space-y-8">
            
            {/* Reverse & Correct Workflow Alert banner */}
            {isReverseMode && (
              <div className="flex items-start gap-3 p-4 bg-indigo-50/80 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 rounded-2xl text-indigo-900 dark:text-indigo-200">
                <RefreshCcw aria-hidden="true" className="shrink-0 mt-0.5 text-indigo-600 dark:text-indigo-400" size={18} />
                <div className="text-xs space-y-1">
                  <p className="font-bold">Sanctioned Closed-Period Correction</p>
                  <p className="text-indigo-700/90 dark:text-indigo-300 leading-relaxed">
                    This action atomically posts a reversal to zero out the original locked entry, sets <code className="font-mono bg-indigo-100 dark:bg-indigo-900/50 px-1 py-0.5 rounded">reversalEventId</code> on the original, and posts this corrected entry into the open period.
                  </p>
                </div>
              </div>
            )}

            {/* Sealed Alert banner if transaction is period locked (and not yet in reverse mode) */}
            {isLocked && !isReverseMode && (
              <div className="flex items-start justify-between gap-3 p-4 bg-amber-50 border border-amber-200 rounded-2xl text-amber-800">
                <div className="flex items-start gap-3">
                  <ShieldAlert aria-hidden="true" className="shrink-0 mt-0.5 text-amber-600" size={18} />
                  <div className="text-xs space-y-1">
                    <p className="font-bold">Period Locked (Absolute Integrity Principle)</p>
                    <p className="text-amber-700/90 leading-relaxed">
                      This transaction Date ({date}) is prior to the lock date ({lockDate}). Direct edits are prohibited, but you can Reverse & Correct.
                    </p>
                  </div>
                </div>
                {onReverseAndCorrect && (
                  <button
                    type="button"
                    onClick={() => setIsReverseMode(true)}
                    className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold shrink-0 transition-colors shadow-sm"
                  >
                    Reverse & Correct
                  </button>
                )}
              </div>
            )}

            {/* Reversal Parameters if in Reverse Mode */}
            {isReverseMode && (
              <div className="p-4 bg-zinc-50 dark:bg-zinc-900/50 rounded-2xl border border-[var(--line)] grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor={`${formId}-tx-reversal-date`} className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-1">
                    <Calendar aria-hidden="true" size={12} /> Reversal Date (Open Period)
                  </label>
                  <input
                    id={`${formId}-tx-reversal-date`}
                    type="date"
                    value={reversalDate}
                    onChange={(e) => setReversalDate(e.target.value)}
                    className="w-full mt-1.5 bg-white dark:bg-zinc-800 border border-[var(--line)] rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label htmlFor={`${formId}-tx-correction-reason`} className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-1">
                    <FileText aria-hidden="true" size={12} /> Reason for Correction / Audit Note
                  </label>
                  <input
                    id={`${formId}-tx-correction-reason`}
                    type="text"
                    value={correctionReason}
                    onChange={(e) => setCorrectionReason(e.target.value)}
                    placeholder="e.g. Reclassified to correct department"
                    className="w-full mt-1.5 bg-white dark:bg-zinc-800 border border-[var(--line)] rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
            )}

            {/* Crucial Meta Fields */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              
              <div className="space-y-1.5Col">
                <label htmlFor={`${formId}-tx-date`} className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-1">
                  <Calendar aria-hidden="true" size={11} /> Transaction Date
                </label>
                <input
                  id={`${formId}-tx-date`}
                  type="date"
                  disabled={isLocked}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full px-4 py-2.5 bg-[var(--ink)] border border-[var(--line)]/80 rounded-xl focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-950 focus:bg-[var(--surface)] outline-none transition-all text-sm font-medium text-[var(--text)] disabled:opacity-50"
                />
              </div>

              <div className="md:col-span-2 space-y-1.5">
                <label htmlFor={`${formId}-tx-description`} className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-1">
                  <FileText aria-hidden="true" size={11} /> Description
                </label>
                <input
                  id={`${formId}-tx-description`}
                  type="text"
                  disabled={isLocked}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. AWS Production Virtual Servers"
                  className="w-full px-4 py-2.5 bg-[var(--ink)] border border-[var(--line)]/80 rounded-xl focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-950 focus:bg-[var(--surface)] outline-none transition-all text-sm font-semibold text-[var(--text)] placeholder:text-zinc-300 disabled:opacity-50"
                />
              </div>

            </div>

            {/* Secondary Meta details */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              
              <div className="space-y-1.5">
                <label htmlFor={`${formId}-tx-payee`} className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-1">
                  <Building2 aria-hidden="true" size={11} /> Payee / counterparty
                </label>
                <input
                  id={`${formId}-tx-payee`}
                  type="text"
                  disabled={isLocked}
                  value={payee}
                  onChange={(e) => setPayee(e.target.value)}
                  placeholder="e.g. Amazon Web Services"
                  className="w-full px-4 py-2 bg-[var(--ink)] border border-[var(--line)]/80 rounded-xl focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-950 focus:bg-[var(--surface)] outline-none transition-all text-xs font-semibold text-[var(--text)]"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor={`${formId}-tx-project`} className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-1">
                  Custom Project Code
                </label>
                <input
                  id={`${formId}-tx-project`}
                  type="text"
                  disabled={isLocked}
                  value={project}
                  onChange={(e) => setProject(e.target.value)}
                  placeholder="e.g. PRJ-METRICS"
                  className="w-full px-4 py-2 bg-[var(--ink)] border border-[var(--line)]/80 rounded-xl focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-950 focus:bg-[var(--surface)] outline-none transition-all text-xs font-semibold text-[var(--text)] uppercase"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor={`${formId}-tx-type`} className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
                  Vector Type
                </label>
                <select
                  id={`${formId}-tx-type`}
                  disabled={isLocked}
                  value={type}
                  onChange={(e) => setType(e.target.value as unknown as React.SetStateAction<"actual" | "forecast" | "adjustment" | "reversal" | "journal" | "expense" | "income" | "bank_import">)}
                  className="w-full px-3 py-2 bg-[var(--ink)] border border-[var(--line)] hover:border-zinc-300 rounded-xl text-xs font-semibold text-[var(--text)] outline-none focus:bg-[var(--surface)]"
                >
                  <option value="actual">Actual Ledger Node</option>
                  <option value="forecast">Forecast projection</option>
                  <option value="adjustment">Manual Adjustment</option>
                  <option value="reversal">Reversal Entry</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor={`${formId}-tx-status`} className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
                  Process Status
                </label>
                <select
                  id={`${formId}-tx-status`}
                  disabled={isLocked}
                  value={status}
                  onChange={(e) => setStatus(e.target.value as unknown as React.SetStateAction<"draft" | "pending" | "certified" | "completed" | "failed" | "flagged" | "reconciled" | "reviewed" | "overdue" | "approved" | "void">)}
                  className="w-full px-3 py-2 bg-[var(--ink)] border border-[var(--line)] hover:border-zinc-300 rounded-xl text-xs font-semibold text-[var(--text)] outline-none focus:bg-[var(--surface)]"
                >
                  <option value="completed">Completed / Signed</option>
                  <option value="pending">Pending Validation</option>
                  <option value="flagged">Flagged for Audit</option>
                  <option value="reconciled">Reconciled Lock</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor={`${formId}-tx-original-currency`} className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
                  Currency Context
                </label>
                <select
                  id={`${formId}-tx-original-currency`}
                  disabled={isLocked}
                  value={originalCurrency}
                  onChange={(e) => setOriginalCurrency(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--ink)] border border-[var(--line)] hover:border-zinc-300 rounded-xl text-xs font-semibold text-[var(--text)] outline-none focus:bg-[var(--surface)]"
                >
                  {['USD', 'EUR', 'GBP', 'ILS', 'JPY', 'CAD'].map(cur => (
                    <option key={cur} value={cur}>{cur}</option>
                  ))}
                </select>
              </div>

              {(originalCurrency !== 'USD') && (
                <div className="space-y-1.5 md:col-span-3">
                  <div className="flex items-center justify-between">
                    <label htmlFor={`${formId}-exchange-rate`} className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">
                      Historical Exchange Rate Offset (1 {originalCurrency} =)
                    </label>
                    <button
                      type="button"
                      disabled={isFetchingRate || isLocked}
                      onClick={async () => {
                        try {
                          setIsFetchingRate(true);
                          const token = await auth.currentUser?.getIdToken();
                          if (!token) return;
                          
                          // Use the transaction date or today
                          const date = transaction.date || getLocalDateISO();
                          const res = await fetch(`/api/v1/currency/historical?date=${date}&source=USD&currencies=${originalCurrency}`, {
                             headers: { 'Authorization': `Bearer ${token}` }
                          });
                          const data = await res.json();
                          if (data.success && data.historical && data.quotes[`USD${originalCurrency}`]) {
                             // The quote is 1 USD = X Currency. We need 1 Currency = X USD, so 1 / X
                             const usdRate = 1 / data.quotes[`USD${originalCurrency}`];
                             setExchangeRate(Number(usdRate.toFixed(6)));
                             toast.success('Market rate synchronized from Currency API');
                          } else {
                             toast.error('Failed to sync rate', { description: data.error?.info || 'Unknown error' });
                          }
                        } catch (err) {
                          toast.error('Failed to fetch rate', { description: (err as Error).message });
                        } finally {
                          setIsFetchingRate(false);
                        }
                      }}
                      className="text-[10px] font-bold text-emerald-600 hover:text-emerald-700 disabled:opacity-50 flex items-center gap-1"
                    >
                      <RefreshCcw aria-hidden="true" size={12} className={isFetchingRate ? 'animate-spin' : ''} />
                      Sync from Market
                    </button>
                  </div>
                  <input
                    id={`${formId}-exchange-rate`}
                    type="number"
                    step="0.000001"
                    disabled={isLocked}
                    value={exchangeRate}
                    onChange={(e) => setExchangeRate(parseFloat(e.target.value) || 1.0)}
                    placeholder="e.g. 1.08"
                    className="w-full px-4 py-2 bg-emerald-50 border border-emerald-200 rounded-xl focus:ring-2 focus:ring-emerald-900/10 focus:border-emerald-500 outline-none transition-all text-xs font-mono font-bold text-emerald-900"
                  />
                </div>
              )}

            </div>

            <RatesUsed metadata={transaction?.metadata} />

            {/* Structural Double-Entry Ledger Lines splits section */}
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-[var(--line)] pb-2">
                <div>
                  <h3 className="text-xs font-bold text-[var(--text)] uppercase tracking-wider flex items-center gap-1.5">
                    <Hash aria-hidden="true" size={13} className="text-zinc-500" /> Ledger Line Distribution Coordinates
                  </h3>
                  <p className="text-[10px] text-zinc-400">Specify precise split mappings to enforce trial balance zero-sum equivalence</p>
                </div>

                {!isLocked && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (lines.length > 0) {
                           // Set the second line (if exists, or first line) to a Credit Card Liability
                           const cc = accounts.find(a => a.type === 'liability' || a.type === 'asset');
                           if (cc && lines.length === 2) {
                             handleLineChange(0, { accountId: cc.id, accountName: cc.name, description: 'Inter-Account Transfer Link' });
                             toast.success('Converted leg to transfer. P&L expense nullified.');
                           } else {
                             toast.error('Ensure you have 2 lines minimum and a valid Liability account setup.');
                           }
                        }
                      }}
                      className="flex items-center gap-1 px-3 py-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 text-[10px] uppercase tracking-widest font-black rounded-lg transition-all"
                    >
                      Convert to Transfer
                    </button>
                    <button
                      type="button"
                      onClick={handleAddLine}
                      className="flex items-center gap-1 px-3 py-1 bg-zinc-900 hover:bg-zinc-800 text-white text-[11px] font-bold rounded-lg transition-all"
                     aria-label="Add Split Vector">
                      <Plus aria-hidden="true" size={12} />
                      <span>Add Split Vector</span>
                    </button>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                {lines.map((line, idx) => (
                  <div 
                    key={lineKeys[idx]}
                    className="grid grid-cols-1 md:grid-cols-12 gap-3 p-3 rounded-[32px] border border-[var(--line)] bg-[var(--ink)]/20 hover:bg-[var(--ink)]/50 transition-colors"
                  >
                    {/* Top Row: Account & Amount & Delete */}
                    <div className="md:col-span-6 space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">Chart of Account</div>
                        <CategoryWhyPopover 
                          description={description} 
                          accountName={line.accountName} 
                        />
                      </div>
                      <select
                        aria-label={`Chart of Account for line ${idx + 1}`}
                        disabled={isLocked}
                        value={line.accountId}
                        onChange={(e) => {
                          const acc = accounts.find(a => a.id === e.target.value);
                          handleLineChange(idx, { 
                            accountId: e.target.value, 
                            accountName: acc ? acc.name : '' 
                          });
                        }}
                        className="w-full bg-[var(--surface)] border border-[var(--line)] hover:border-zinc-300 rounded-xl px-2.5 py-1.5 text-xs font-bold text-[var(--text)] outline-none"
                      >
                        <option value="uncategorized">Select Account</option>
                        {accounts.map(acc => (
                          <option key={acc.id} value={acc.id}>
                            {acc.name} ({acc.code}) [{acc.type}]
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="md:col-span-5 space-y-1">
                      <div className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider text-right">Amount</div>
                      <div className="relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-zinc-400 font-mono">$</span>
                        <input
                          aria-label={`Amount for line ${idx + 1}`}
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          disabled={isLocked}
                          value={line.amountCents === 0 ? '' : formatDecimal(line.amountCents)}
                          onChange={(e) => {
                            handleLineChange(idx, { amountCents: parseAmountToCents(e.target.value) });
                          }}
                          className="w-full bg-[var(--surface)] border border-[var(--line)] rounded-xl pl-6 pr-2.5 py-1.5 text-xs text-right text-[var(--text)] font-mono font-bold outline-none"
                        />
                      </div>
                    </div>

                    <div className="md:col-span-1 pt-4 text-center">
                      {!isLocked && (
                        <button
                          aria-label={`Remove distribution line ${idx + 1}`}
                          type="button"
                          onClick={() => handleRemoveLine(idx)}
                          className="p-1 px-2.5 text-red-500 hover:bg-red-50 hover:text-red-700 rounded-lg transition-all"
                          title="Remove distribution vector"
                        >
                          <Trash2 aria-hidden="true" size={14} />
                        </button>
                      )}
                    </div>

                    {/* Bottom Row: Additional Dimensions */}
                    {activeDimensions.filter(d => d.id !== 'category').map(dim => {
                      const dimVal = getLineDimension(line, transaction, dim.id, dimensionNodes);
                      const displayVal = dimVal === 'Unassigned' ? '' : dimVal;
                      const pathOptions = Array.from(new Set([
                        ...(dimensionNodes || [])
                          .filter(n => n.dimensionId === dim.id && n.status !== 'archived')
                          .map(n => n.description),
                        ...extractUniqueDimensionPaths(transactions, dim.id)
                      ]));
                      return (
                        <div key={dim.id} className="md:col-span-2 space-y-1">
                          <div className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">{dim.name}</div>
                          <div className="relative">
                            <input
                              aria-label={`${dim.name} for line ${idx + 1}`}
                              list={`${formId}-dim-list-${idx}-${dim.id}`}
                              value={displayVal}
                              disabled={isLocked}
                              onChange={(e) => {
                                const updatedLine = setLineDimension(line, dim.id, e.target.value, dimensionNodes);
                                handleLineChange(idx, updatedLine);
                              }}
                              placeholder={`Type or select ${dim.name.toLowerCase()}`}
                              className="w-full bg-[var(--surface)] border border-[var(--line)] rounded-xl px-2.5 py-1.5 text-xs text-[var(--text)] outline-none focus:border-zinc-400"
                            />
                            <datalist id={`${formId}-dim-list-${idx}-${dim.id}`}>
                              {pathOptions.map(p => <option key={p} value={p}>{p}</option>)}
                            </datalist>
                          </div>
                        </div>
                      );
                    })}

                    <div className="md:col-span-3 space-y-1">
                      <div className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">Tags</div>
                      <TagInput
                        aria-label={`Tags for line ${idx + 1}`}
                        tags={line.tags || []}
                        onChange={(tags) => handleLineChange(idx, { tags })}
                        disabled={isLocked}
                        placeholder="Add tag and press Enter"
                      />
                    </div>

                    <div className="md:col-span-3 space-y-1">
                      <div className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">Line Notes</div>
                      <input
                        aria-label={`Line Notes for line ${idx + 1}`}
                        type="text"
                        placeholder="Optional details..."
                        disabled={isLocked}
                        value={line.description || ''}
                        onChange={(e) => handleLineChange(idx, { description: e.target.value })}
                        className="w-full bg-[var(--surface)] border border-[var(--line)] rounded-xl px-2.5 py-1.5 text-xs text-zinc-700 outline-none focus:border-zinc-400"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Reconciliation and Balance audit strip */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-[var(--ink)] p-4 rounded-[32px] border border-zinc-150">
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Reconciliation Checklist</span>
                <div className="flex gap-4 items-center">
                  <label htmlFor={`${formId}-cleared`} className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input 
                      id={`${formId}-cleared`}
                      type="checkbox"
                      disabled={isLocked}
                      checked={isCleared}
                      onChange={(e) => setIsCleared(e.target.checked)}
                      className="rounded text-[var(--text)] focus:ring-zinc-900/10 cursor-pointer accent-zinc-900"
                    />
                    <span className="text-xs text-zinc-600 font-medium">Cleared and Verified</span>
                  </label>
                  
                  <label htmlFor={`${formId}-flagged`} className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input 
                      id={`${formId}-flagged`}
                      type="checkbox"
                      disabled={isLocked}
                      checked={isFlagged}
                      onChange={(e) => setIsFlagged(e.target.checked)}
                      className="rounded text-[var(--text)] focus:ring-zinc-900/10 cursor-pointer accent-zinc-900"
                    />
                    <span className="text-xs text-amber-600 font-medium">Flag for deep auditing</span>
                  </label>
                </div>
              </div>

              <div className="text-right flex flex-col justify-center space-y-0.5">
                <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">Total Transaction Sum</span>
                <div className="text-sm font-mono font-black text-[var(--text)]">
                  {new Intl.NumberFormat('en-US', { style: 'currency', currency: transaction.currency || 'USD' }).format(totalAmountCents / 100)}
                </div>
                {sumLines !== 0 && (
                  <p className="text-[10px] text-amber-600 font-medium tabular-nums">
                    Trial balance variance offset: ${formatDecimal(sumLines)}
                  </p>
                )}
              </div>
            </div>

            {/* Document Management Section */}
            <div className="bg-[var(--ink)]/50 p-4 rounded-[32px] border border-zinc-150 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-[var(--text)] uppercase tracking-wider flex items-center gap-1.5">
                    <FileText aria-hidden="true" size={13} className="text-zinc-500" /> Source Documents & Receipts
                  </h3>
                  <p className="text-[10px] text-zinc-400">Attach underlying evidence for this specific vector node.</p>
                </div>
                <label htmlFor={`${formId}-documents`} className="flex items-center gap-1 px-3 py-1 bg-[var(--surface)] hover:bg-zinc-100 text-[var(--text)] border border-[var(--line)] text-[11px] font-bold rounded-lg transition-all cursor-pointer">
                  <Plus aria-hidden="true" size={12} />
                  <span>Attach Document</span>
                  <input
                    id={`${formId}-documents`}
                    type="file"
                    className="hidden"
                    accept="image/*,application/pdf"
                    multiple
                    disabled={isLocked}
                    onChange={(e) => {
                      if (!e.target.files) return;
                      const files = Array.from(e.target.files);
                      
                      files.forEach(file => {
                        const reader = new FileReader();
                        reader.readAsDataURL(file);
                        reader.onload = () => {
                          setFileUrls(prev => [...prev, reader.result as string]);
                        };
                      });
                    }}
                  />
                </label>
              </div>

              {fileUrls.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                  {withOccurrenceKeys(fileUrls, url => url).map(({ item: url, key }, i) => (
                    <div key={key} className="relative group rounded-xl border border-[var(--line)] overflow-hidden bg-[var(--surface)] h-24 flex items-center justify-center">
                      {url.startsWith('data:image') ? (
                        <img src={url} alt="Attached receipt" className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity" />
                      ) : (
                        <div className="flex flex-col items-center gap-1 text-zinc-400">
                          <FileText aria-hidden="true" size={24} />
                          <span className="text-[9px] uppercase font-bold tracking-widest">Document</span>
                        </div>
                      )}
                      
                      {!isLocked && (
                        <button aria-label="Remove attached document"
                          onClick={() => setFileUrls(prev => prev.filter((_, index) => index !== i))}
                          className="absolute top-1 right-1 p-1 bg-red-500/80 hover:bg-red-500 text-white rounded-md opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity"
                        >
                          <Trash2 aria-hidden="true" size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {!isReverseMode && transaction.id && <EntryQuestions transactionId={transaction.id} />}
            {!isReverseMode && transaction.id && <EntryLinks transactionId={transaction.id} />}
          </div>

          {/* Actions footer */}
          <div className="px-6 py-4 bg-[var(--ink)] border-t border-[var(--line)] flex items-center justify-end gap-3 shrink-0">
            <button
              onClick={onClose}
              type="button"
              className="px-4 py-2 hover:bg-zinc-100 rounded-xl text-xs font-semibold text-zinc-500 hover:text-[var(--text)] transition-colors"
             aria-label="Cancel">
              Cancel
            </button>
            <AsyncButton
              onClick={handleSave}
              disabled={isLocked}
              loadingText={isReverseMode ? "Posting Reversal & Correction..." : "Recording..."}
              className={cn(
                "px-5 py-2 text-white rounded-xl text-xs font-bold transition-all shadow-md disabled:opacity-50",
                isReverseMode 
                  ? "bg-indigo-600 hover:bg-indigo-700 shadow-indigo-600/20" 
                  : "bg-zinc-900 hover:bg-zinc-800 shadow-zinc-800/15"
              )}
            >
              {isReverseMode ? 'Post Reversal & Correction' : 'Record synchronized changes'}
            </AsyncButton>
          </div>

        </motion.div>
      </div>
    </AnimatePresence>
  );
}

/** BM-06: the exchange rates this entry was converted at (one, or two on a payment: the document's and the day's). */
function RatesUsed({ metadata }: { metadata?: Record<string, unknown> | null }) {
  const rates = ((metadata?.ratesUsed as RateUsed[] | undefined) || (metadata?.rateUsed ? [metadata.rateUsed as RateUsed] : []))
    .filter(r => r && typeof r.rate === 'number' && typeof r.currency === 'string');
  if (rates.length === 0) return null;
  return <section aria-label="Exchange rates used" className="text-xs text-[var(--text)] space-y-1">
    <h3 className="font-bold uppercase tracking-wider text-[10px] text-zinc-500">Exchange rates used</h3>
    <ul className="list-disc ps-5">{rates.map(r => <li key={rateUsedId(r)}>{rateUsedText(r)}</li>)}</ul>
  </section>;
}
