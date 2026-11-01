import { useRef, useState } from 'react';


import { ActiveFilterChips } from './ActiveFilterChips';
import InlineEntryRow from '../transactions/InlineEntryRow';
import { Plus, Loader2, ShieldCheck, AlertCircle } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { toast } from 'sonner';

import { cn, formatCurrency } from '../../lib/utils';

import SelectionBar from '../transactions/SelectionBar';

import SplitEditor from '../transactions/SplitEditor';
import TransactionEditModal from '../transactions/TransactionEditModal';

import { TransactionGridToolbar } from './TransactionGridToolbar';
import { TransactionGridBody } from './TransactionGridBody';
import type { TransactionGridModel } from './TransactionGrid';
import { copyWithFeedback } from '../../lib/clipboard';
import { inBackground } from '../../lib/inBackground';
export function TransactionGridView(model: TransactionGridModel) {
 // one split save at a time: a second press while the first is pending is ignored (the ref is checked synchronously)
 const splitSaving = useRef(false);
 const [isSplitSaving, setIsSplitSaving] = useState(false);
 const { filterCriteria, onFilterApplied, txActions, onUpdate, isCompactMode, editingDetailsTx, setEditingDetailsTx, isReverseModeModal, setIsReverseModeModal, lockDate, selectedIds, setSelectedIds, parsingQueue, setParsingQueue, splittingTxId, setSplittingTxId, accounts, projects, dragActive, splittingTransaction, selectedTransactions, handleBulkUpdate, handleDrag, handleDrop } = model;
 return (
    <div
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
      className={cn(
        "ledger-card flex flex-col min-h-full transition-all bg-[var(--surface)] border border-[var(--line)] shadow-sm relative",
        isCompactMode && "rounded-none border-none",
        dragActive && "ring-4 ring-indigo-600 ring-inset"
      )}
    >
      {dragActive && (
        <div className="absolute inset-0 z-[100] bg-indigo-600/10 backdrop-blur-sm flex items-center justify-center pointer-events-none">
          <div className="p-4 md:p-8 bg-[var(--surface)] rounded-[32px] shadow-2xl border-2 border-indigo-600 flex flex-col items-center gap-4 animate-in fade-in zoom-in slide-in-from-bottom-4">
             <div className="w-16 h-16 rounded-full bg-indigo-600/10 flex items-center justify-center text-indigo-600">
                <Plus aria-hidden="true" size={32} />
             </div>
             <div className="text-center">
                <p className="text-xl font-bold text-[var(--text)] uppercase tracking-tight">Drop receipts here</p>
                <p className="text-sm text-[var(--muted)]">AI will auto-categorize and balance them</p>
             </div>
          </div>
        </div>
      )}

      {/* Parsing Queue Overlay */}
      <AnimatePresence>
        {parsingQueue.length > 0 && (
          <div className="absolute top-4 right-4 z-[80] flex flex-col gap-2 w-72 pointer-events-none">
            {parsingQueue.map(item => (
              <motion.div
                key={item.id}
                initial={{ x: 300, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 300, opacity: 0 }}
                className="p-3 bg-slate-900 rounded-xl shadow-2xl border border-white/10 flex items-center gap-3 pointer-events-auto"
              >
                <div className="w-8 h-8 rounded-lg bg-[var(--surface)]/5 flex items-center justify-center">
                  {item.status === 'done' ? (
                    <ShieldCheck aria-hidden="true" size={16} className="text-emerald-500" />
                  ) : item.status === 'error' ? (
                    <AlertCircle aria-hidden="true" size={16} className="text-rose-500" />
                  ) : (
                    <Loader2 aria-hidden="true" size={16} className="text-indigo-600 animate-spin" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-bold text-white/50 uppercase tracking-widest leading-none mb-1">AI Processor</p>
                  <p className="text-[11px] font-medium text-white truncate">{item.name}</p>
                </div>
                {item.status === 'error' && (
                  <button
                    aria-label={`Dismiss import error for ${item.name}`}
                    onClick={() => setParsingQueue(parsingQueue.filter(i => i.id !== item.id))}
                    className="p-1 hover:bg-[var(--surface)]/10 rounded"
                  >
                    <Plus aria-hidden="true" size={10} className="text-white rotate-45" />
                  </button>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {splittingTransaction && (
          <SplitEditor
            transaction={splittingTransaction}
            accounts={accounts}
            projects={projects}
            onSave={(lines) => {
              if (splittingTxId && !splitSaving.current) {
                splitSaving.current = true;
                setIsSplitSaving(true);
                // confirm only once the save has gone through (a handled failure resolves false)
                inBackground(Promise.resolve(onUpdate?.(splittingTxId, { lines })).then(result => {
                  if (result === false) return;
                  setSplittingTxId(null);
                  toast.success('Transaction split applied');
                }).finally(() => { splitSaving.current = false; setIsSplitSaving(false); }));
              }
            }}
            saving={isSplitSaving}
            onClose={() => setSplittingTxId(null)}
          />
        )}
      </AnimatePresence>

      <TransactionGridToolbar model={model} />

      <ActiveFilterChips filters={filterCriteria} search={model.searchTerm} onFilters={onFilterApplied} onSearch={model.setSearchTerm} />
      {/* add an entry right here: description, amount, Enter (I-22, I-23) */}
      <InlineEntryRow />

      {/* the table scrolls sideways inside its box when the window is narrower than its columns */}
      <TransactionGridBody model={model} />

      <AnimatePresence>
        {selectedIds.size > 0 && (
          <SelectionBar
            selectedCount={selectedIds.size}
            totalAmount={selectedTransactions.reduce((sum, t) => sum + t.totalAmountCents, 0)}
            avgAmount={selectedIds.size > 0 ? selectedTransactions.reduce((sum, t) => sum + t.totalAmountCents, 0) / selectedIds.size : 0}
            onCopy={() => {
              if (selectedIds.size > 0) {
                const copyText = selectedTransactions.map(t => `${t.date} | ${t.description} | ${formatCurrency(t.totalAmountCents)}`).join('\n');
                void copyWithFeedback(copyText, `Copied payload strings for ${selectedIds.size} lines to clipboard`);
              }
            }}
            onClear={() => setSelectedIds(new Set())}
            onBulkUpdate={handleBulkUpdate}
            accounts={accounts}
            formatCurrency={formatCurrency}
          />
        )}
      </AnimatePresence>

      {editingDetailsTx && (
        <TransactionEditModal
          isOpen={!!editingDetailsTx}
          transaction={editingDetailsTx}
          accounts={accounts}
          lockDate={lockDate}
          isReverseAndCorrectMode={isReverseModeModal}
          onClose={() => { setEditingDetailsTx(null); setIsReverseModeModal(false); }}
          onUpdate={onUpdate || (() => {})}
          onReverseAndCorrect={txActions.handleReverseTransaction}
        />
      )}
    </div>
  );
}
