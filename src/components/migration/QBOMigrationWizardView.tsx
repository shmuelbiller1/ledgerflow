import { motion, AnimatePresence } from 'motion/react';
import { FileUp, CheckCircle2, Download, Activity, RefreshCw, Loader2, Sparkles } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';
import type { QBOMigrationWizardModel } from './QBOMigrationWizard';

import { BRAND_NAME } from '../../config/brand';
export function QBOMigrationWizardView({ onClose, withOccurrenceKeys, overlayDialogProps, overlayTitleId, step, setStep, isProcessing, file, parsedRows, accountMappings, setAccountMappings, accounts, getRootProps, getInputProps, isDragActive, handleLoadSampleQBO, metrics, handleNext }: QBOMigrationWizardModel) {
  return (
    <div {...overlayDialogProps} className="fixed inset-0 z-[600] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/60 backdrop-blur-md"
        onClick={onClose}
      />
      
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="relative w-full max-w-4xl bg-[var(--surface)] border border-[var(--line)] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="p-6 md:p-8 border-b border-[var(--line)] bg-[var(--panel)]">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-500/10 text-emerald-600 rounded-full text-xs font-bold uppercase tracking-widest mb-2">
                <RefreshCw aria-hidden="true" size={14} className={isProcessing ? 'animate-spin' : ''} />
                QuickBooks Migration Engine
              </div>
              <h2 id={overlayTitleId} className="text-2xl md:text-3xl font-black text-[var(--text)] tracking-tight">QuickBooks Switcher</h2>
              <p className="text-sm text-[var(--muted)] mt-1">Import your historical general ledger, chart of accounts, and transactions with double-entry integrity.</p>
            </div>
            
            <div className="flex items-center gap-2 self-end sm:self-center">
              {[1, 2, 3].map(n => (
                <div key={n} className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs transition-all ${step >= n ? 'bg-emerald-600 text-white shadow-md' : 'bg-slate-200 text-slate-500'}`}>
                    {step > n ? <CheckCircle2 aria-hidden="true" size={16} /> : n}
                  </div>
                  {n < 3 && <div className={`w-6 h-0.5 ${step > n ? 'bg-emerald-500' : 'bg-slate-200'}`} />}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar">
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                className="space-y-6"
              >
                <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-xl p-5 flex gap-4 items-start">
                  <div className="w-10 h-10 rounded-full bg-indigo-500/10 text-indigo-600 flex items-center justify-center shrink-0">
                    <Download aria-hidden="true" size={20} />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-bold text-[var(--text)] text-sm">QuickBooks Export Instructions</h4>
                    <p className="text-xs text-[var(--muted)] mt-1 leading-relaxed">
                      In QuickBooks Online or Desktop, navigate to <strong>Reports &rarr; General Ledger / Transaction Detail</strong> or <strong>Chart of Accounts</strong>. Export as <strong>.CSV</strong> or <strong>.XLSX</strong>.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleLoadSampleQBO}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all shadow-xs shrink-0 cursor-pointer"
                   aria-label="Try with Sample Export">
                    <Sparkles aria-hidden="true" size={14} /> Try with Sample Export
                  </button>
                </div>

                <div 
                  {...getRootProps()} 
                  className={`border-2 border-dashed rounded-2xl p-10 text-center transition-all cursor-pointer ${
                    isDragActive ? 'border-emerald-500 bg-emerald-50/10' : 'border-[var(--line)] hover:border-indigo-400 hover:bg-slate-50/50'
                  }`}
                >
                  <input {...getInputProps()} aria-label="Upload QuickBooks export" />
                  <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-400">
                    <FileUp aria-hidden="true" size={32} />
                  </div>
                  <h3 className="text-base font-bold text-[var(--text)] mb-1">
                    {file ? file.name : 'Drop your QuickBooks file here, or browse'}
                  </h3>
                  <p className="text-xs text-[var(--muted)]">Supports .csv and .xlsx exports. An older .xls export must be saved as .xlsx first.</p>
                  
                  {file && (
                    <div className="mt-4 inline-flex items-center gap-2 px-4 py-1.5 bg-emerald-500/10 text-emerald-600 rounded-full text-xs font-bold border border-emerald-500/20">
                      <CheckCircle2 aria-hidden="true" size={14} />
                      {parsedRows.length} transactions parsed ready for mapping
                    </div>
                  )}
                </div>

                {parsedRows.length > 0 && (
                  <div className="p-4 bg-[var(--panel)] rounded-xl border border-[var(--line)]">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">Preview of Parsed Data (First 3 Records)</span>
                      <span className="text-xs font-mono font-bold text-indigo-600">{parsedRows.length} Total Rows</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <caption className="sr-only">Sample QuickBooks export</caption>
                        <thead>
                          <tr className="border-b border-[var(--line)] text-[var(--muted)]">
                            <th scope="col" className="p-2 font-semibold">Date</th>
                            <th scope="col" className="p-2 font-semibold">Payee/Memo</th>
                            <th scope="col" className="p-2 font-semibold">Source Account</th>
                            <th scope="col" className="p-2 font-semibold">Split</th>
                            <th scope="col" className="p-2 font-semibold text-right">Debit ($)</th>
                            <th scope="col" className="p-2 font-semibold text-right">Credit ($)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--line)]">
                          {withOccurrenceKeys(parsedRows.slice(0, 3), row => JSON.stringify(row)).map(({ item: r, key }) => (
                            <tr key={key}>
                              <td className="p-2 font-mono">{r.date}</td>
                              <td className="p-2 truncate max-w-[200px]">{r.payee || r.memo}</td>
                              <td className="p-2 font-medium">{r.account}</td>
                              <td className="p-2 text-[var(--muted)]">{r.split || '—'}</td>
                              <td className="p-2 text-right font-mono">{r.debitCents > 0 ? (r.debitCents / 100).toFixed(2) : '—'}</td>
                              <td className="p-2 text-right font-mono">{r.creditCents > 0 ? (r.creditCents / 100).toFixed(2) : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {step === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                className="space-y-6"
              >
                <div>
                  <h3 className="text-lg font-bold text-[var(--text)]">Chart of Accounts Mapping</h3>
                  <p className="text-xs text-[var(--muted)] mt-0.5">
                    Match accounts from your QuickBooks export to your {BRAND_NAME} Chart of Accounts.
                  </p>
                </div>

                <div className="border border-[var(--line)] rounded-xl overflow-hidden bg-[var(--panel)]">
                  <table className="w-full text-left text-xs border-collapse">
                    <caption className="sr-only">Chart of accounts mapping</caption>
                    <thead>
                      <tr className="border-b border-[var(--line)] bg-[var(--surface)] text-[var(--muted)]">
                        <th scope="col" className="p-3 font-bold uppercase tracking-wider">QuickBooks Account</th>
                        <th scope="col" className="p-3 font-bold uppercase tracking-wider">Category Type</th>
                        <th scope="col" className="p-3 font-bold uppercase tracking-wider text-center">Tx Count</th>
                        <th scope="col" className="p-3 font-bold uppercase tracking-wider">Target {BRAND_NAME} Account</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--line)]">
                      {accountMappings.map((m, idx) => (
                        <tr key={m.qbAccount} className="hover:bg-[var(--surface)] transition-colors">
                          <td className="p-3 font-bold text-[var(--text)]">
                            {m.qbAccount}
                          </td>
                          <td className="p-3">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                              {m.detectedType}
                            </span>
                          </td>
                          <td className="p-3 text-center font-mono text-[var(--muted)]">
                            {m.txCount}
                          </td>
                          <td className="p-3">
                            <select aria-label={`Target account for ${m.qbAccount}`}
                              value={m.targetAccountId}
                              onChange={(e) => {
                                const newMappings = [...accountMappings];
                                newMappings[idx].targetAccountId = e.target.value;
                                setAccountMappings(newMappings);
                              }}
                              className="w-full bg-[var(--surface)] border border-[var(--line)] rounded-lg px-3 py-1.5 text-xs text-[var(--text)] focus:outline-none focus:border-indigo-500 font-medium"
                            >
                              <option value="__create_new__">+ Create New Account ({m.qbAccount})</option>
                              <optgroup label="Existing Accounts">
                                {accounts.map(a => (
                                  <option key={a.id} value={a.id}>
                                    {a.code ? `[${a.code}] ` : ''}{a.name} ({a.type})
                                  </option>
                                ))}
                              </optgroup>
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                className="space-y-6 text-center py-4"
              >
                <div className="w-16 h-16 bg-emerald-500/10 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/10">
                  <Activity aria-hidden="true" size={32} />
                </div>
                <div>
                  <h3 className="text-2xl font-black text-[var(--text)] tracking-tight">Integrity Verification Complete</h3>
                  <p className="text-sm text-[var(--muted)] max-w-md mx-auto mt-1">
                    We parsed <strong>{metrics.txCount} transactions</strong> spanning <strong>{metrics.accountCount} accounts</strong>.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 max-w-lg mx-auto gap-3 text-left">
                  <div className="p-4 bg-[var(--panel)] rounded-xl border border-[var(--line)]">
                    <div className="text-[10px] text-[var(--muted)] font-bold uppercase tracking-wider mb-1">Total Debits</div>
                    <div className="text-lg font-mono font-bold text-[var(--text)] tabular-nums">
                      {formatCurrency(metrics.totalDebitCents)}
                    </div>
                  </div>
                  <div className="p-4 bg-[var(--panel)] rounded-xl border border-[var(--line)]">
                    <div className="text-[10px] text-[var(--muted)] font-bold uppercase tracking-wider mb-1">Total Credits</div>
                    <div className="text-lg font-mono font-bold text-[var(--text)] tabular-nums">
                      {formatCurrency(metrics.totalCreditCents)}
                    </div>
                  </div>
                  <div className="p-4 bg-[var(--panel)] rounded-xl border border-[var(--line)]">
                    <div className="text-[10px] text-[var(--muted)] font-bold uppercase tracking-wider mb-1">Trial Balance Net</div>
                    <div className={`text-lg font-mono font-bold ${metrics.isBalanced ? 'text-emerald-600' : 'text-amber-500'} tabular-nums`}>
                      {formatCurrency(metrics.netCents)}
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-xl max-w-lg mx-auto text-left flex items-center gap-3">
                  <CheckCircle2 aria-hidden="true" className="w-5 h-5 text-emerald-600 shrink-0" />
                  <span className="text-xs text-[var(--text)] font-medium">
                    Ready to commit transactions into the double-entry matrix. Historical balances will synchronize automatically.
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer Controls */}
        <div className="p-5 border-t border-[var(--line)] bg-[var(--panel)] flex justify-between items-center">
          <button
            type="button"
            onClick={step === 1 ? onClose : () => setStep(step - 1)}
            className="px-5 py-2.5 font-bold text-xs text-[var(--muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
          >
            {step === 1 ? 'Cancel' : 'Back'}
          </button>
          
          <button
            type="button"
            onClick={handleNext}
            disabled={isProcessing || (step === 1 && parsedRows.length === 0)}
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center gap-2 cursor-pointer"
           aria-label="Loader2 action">
            {isProcessing ? (
              <><Loader2 aria-hidden="true" size={16} className="animate-spin" /> Importing Transactions...</>
            ) : (
              step === 3 ? 'Commit & Import to Ledger' : 'Continue'
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
