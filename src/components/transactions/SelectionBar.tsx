import type { Transaction, ChartAccount } from '../../types';
import React, { useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { displayDimensionName } from '../../lib/dimensionUtils';
import { categoryChoices } from '../../lib/accountChoices';
import { motion } from 'motion/react';
import { Clipboard, X } from 'lucide-react';

interface SelectionBarProps {
  selectedCount: number;
  totalAmount: number;
  avgAmount: number;
  onCopy: () => void;
  onClear: () => void;
  onBulkUpdate: (updates: Partial<Transaction> & { accountId?: string; labels?: Record<string, string> }) => void | Promise<unknown>;
  accounts: ChartAccount[];
  formatCurrency: (cents: number) => string;
}

export default function SelectionBar({ 
  selectedCount, 
  totalAmount, 
  onCopy, 
  onClear,
  onBulkUpdate,
  accounts,
  formatCurrency
}: SelectionBarProps) {
  // categories only (no bank accounts), the most used first; applied on Enter or Apply, never while typing
  const choices = useLedgerStore(state => categoryChoices(accounts, state.transactions));
  const [text, setText] = useState('');
  const typed = text.trim().toLowerCase();
  const pick = choices.find(c => c.label.toLowerCase() === typed || c.value === text)
    || choices.find(c => accounts.find(a => a.id === c.value)?.name.toLowerCase() === typed);
  const match = pick ? accounts.find(a => a.id === pick.value) : undefined;
  // the typed account stays if the save was refused (the save already said why)
  const [accountBusy, setAccountBusy] = useState(false);
  const apply = () => {
    if (!match || accountBusy) return; // one save at a time
    setAccountBusy(true);
    void Promise.resolve(onBulkUpdate({ accountId: match.id })).then(() => setText(''), () => undefined).finally(() => setAccountBusy(false));
  };
  // EU-E2: "Set label" — one label and its value on every selected entry (through the same bulk save and Undo)
  const labelDefs = (useAuthStore(state => state.getCurrentWorkspace()?.dimensions) || []).filter(d => d.id !== 'category');
  const nodes = useLedgerStore(state => state.dimensionNodes) || [];
  const [labelId, setLabelId] = useState('');
  const [valueText, setValueText] = useState('');
  const chosenLabel = labelDefs.find(d => d.id === labelId) || labelDefs[0];
  const labelValues = nodes.filter(n => n.dimensionId === chosenLabel?.id && n.status !== 'archived');
  const typedValue = valueText.trim();
  const valueId = labelValues.find(n => n.description.toLowerCase() === typedValue.toLowerCase())?.id || typedValue;
  const [labelBusy, setLabelBusy] = useState(false);
  /** the typed value stays until the save went through (a refused save already said why); one save at a time */
  const applyLabel = () => {
    if (!chosenLabel || !valueId || labelBusy) return;
    setLabelBusy(true);
    void Promise.resolve(onBulkUpdate({ labels: { [chosenLabel.id]: valueId } }))
      .then(() => setValueText(''), () => undefined)
      .finally(() => setLabelBusy(false));
  };
  return (
    <motion.div 
      initial={{ y: 100 }}
      animate={{ y: 0 }}
      exit={{ y: 100 }}
      className="fixed bottom-12 md:bottom-14 left-1/2 -translate-x-1/2 w-[95vw] md:w-auto overflow-x-auto bg-[#09090B] text-white pl-4 md:pl-8 pr-3 md:pr-4 py-3 md:py-4 rounded-[32px] shadow-[0_32px_64px_-16px_rgba(0,0,0,0.8)] flex flex-wrap md:flex-nowrap items-center gap-4 md:gap-8 z-[200] border border-white/20 no-scrollbar"
    >
      <div className="flex items-center gap-6 border-r border-zinc-800 pr-8">
        <div className="flex flex-col">
          <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Selection Vector</span>
          <span className="text-sm font-black">{selectedCount} Transactions</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Net Value</span>
          <span className="text-sm font-black font-mono tabular-nums">
            {formatCurrency(totalAmount)}
          </span>
        </div>
      </div>
      
      <div className="flex items-center gap-3">
        <div className="relative">
          <input aria-label="Bulk Categorize"
            list="selection-bulk-account"
            placeholder="Bulk Categorize..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } }}
            className="w-48 bg-zinc-800 text-[10px] font-medium uppercase tracking-wider px-4 py-2.5 rounded-xl border-none outline-none text-zinc-400 hover:text-white transition-all focus:ring-1 focus:ring-indigo-500 placeholder:text-zinc-600"
          />
          <datalist id="selection-bulk-account">
            {choices.map(c => (
              <option key={c.value} value={c.label} />
            ))}
          </datalist>
        </div>
        <button type="button" onClick={apply} disabled={!match || accountBusy}
          className="px-3 py-2 rounded-xl bg-indigo-600 text-[10px] font-bold uppercase tracking-wider disabled:opacity-30">
          Apply
        </button>
        
        {chosenLabel && (
          <div className="flex items-center gap-2 border-l border-zinc-800 pl-3">
            <select aria-label="Label to set" value={chosenLabel.id} onChange={e => setLabelId(e.target.value)}
              className="bg-zinc-800 text-[10px] font-medium px-2 py-2.5 rounded-xl text-zinc-300">
              {labelDefs.map(d => <option key={d.id} value={d.id}>{displayDimensionName(d)}</option>)}
            </select>
            <input aria-label="Set label" list="selection-label-values" placeholder="Set label…" value={valueText}
              onChange={e => setValueText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applyLabel(); } }}
              className="w-36 bg-zinc-800 text-[10px] font-medium px-3 py-2.5 rounded-xl outline-none text-zinc-300 focus:ring-1 focus:ring-indigo-500 placeholder:text-zinc-600" />
            <datalist id="selection-label-values">
              {labelValues.map(n => <option key={n.id} value={n.description} />)}
            </datalist>
            <button type="button" onClick={applyLabel} disabled={!typedValue || labelBusy}
              className="px-3 py-2 rounded-xl bg-indigo-600 text-[10px] font-bold uppercase tracking-wider disabled:opacity-30">
              Set
            </button>
          </div>
        )}
        <button type="button" aria-label="Copy Text" onClick={onCopy} className="p-2.5 hover:bg-zinc-800 rounded-full text-zinc-400 hover:text-white transition-colors" title="Copy Text">
          <Clipboard aria-hidden="true" size={16} />
        </button>
        <button type="button" aria-label="Clear Selection" onClick={onClear} className="p-2.5 hover:bg-zinc-800 rounded-full text-zinc-400 hover:text-white transition-colors ml-2" title="Clear Selection">
          <X aria-hidden="true" size={16} />
        </button>
      </div>
    </motion.div>
  );
}
