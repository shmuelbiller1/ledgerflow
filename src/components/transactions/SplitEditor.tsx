import { useDialog } from '../../hooks/useDialog';
import { TruthEngine } from '../../modules/integrity/TruthEngine';
import React, { useState, useRef, useId } from 'react';
import { Transaction, TransactionLine, ChartAccount, Project } from '../../types';
import { Plus, Trash2, Save, X, AlertCircle, Layers } from 'lucide-react';
import { motion } from 'motion/react';
import { resolveAccountName, cn, parseAmountToCents } from '../../lib/utils';
import { DEFAULT_WORKSPACE_DIMENSIONS, getLineDimension, setLineDimension } from '../../lib/dimensionUtils';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { DimensionValueActions, InlineAddDimensionAxis } from '../common/DimensionValueActions';
import { normalizeDimensionsMap } from '../../lib/dimensionNodeActions';
import { Labelled } from '../ui/Labelled';

function withOccurrenceKeys<T>(items: readonly T[], identity: (item: T) => string) {
  const occurrences = new Map<string, number>();
  return items.map(item => {
    const content = identity(item);
    const occurrence = occurrences.get(content) ?? 0;
    occurrences.set(content, occurrence + 1);
    return { item, key: JSON.stringify([content, occurrence]) };
  });
}

interface SplitEditorProps {
  transaction: Transaction;
  accounts: ChartAccount[];
  projects: Project[];
  onSave: (lines: TransactionLine[]) => void;
  onClose: () => void;
}

export default function SplitEditor({
  transaction,
  accounts,
  projects,
  onSave,
  onClose
}: SplitEditorProps) {
  const { dialogProps: overlayDialogProps, titleId: overlayTitleId } = useDialog(onClose, true);
  const editorId = useId();
  const workspaceDimensions = useAuthStore(s => s.getCurrentWorkspace()?.dimensions);
  const dimensionNodes = useLedgerStore(s => s.dimensionNodes || []);
  const storeClasses = useLedgerStore(s => s.classes || []);
  const storeLocations = useLedgerStore(s => s.locations || []);
  const configuredAxes = (workspaceDimensions && workspaceDimensions.length > 0
    ? workspaceDimensions
    : DEFAULT_WORKSPACE_DIMENSIONS
  ).filter(d => d.id !== 'category');
  const [lines, setLines] = useState<TransactionLine[]>(
    transaction.lines?.length > 0 
      ? [...transaction.lines] 
      : [{ accountId: '', accountName: '', amountCents: transaction.totalAmountCents }]
  );

  // UI-only keys are initialized once and survive changes to editable line fields.
  const [lineKeys, setLineKeys] = useState(() => withOccurrenceKeys(lines, line =>
    line.id || JSON.stringify([line.accountId, line.description, line.amountCents, line.project, line.class, line.location])
  ).map(({ key }) => `existing-${key}`));
  const nextLineKey = useRef(0);

  const totalCents = lines.reduce((sum, l) => sum + l.amountCents, 0);
  const diff = transaction.totalAmountCents - totalCents;
  const isBalanced = diff === 0;

  const addLine = () => {
    setLines([...lines, { accountId: '', accountName: '', amountCents: diff > 0 ? diff : 0 }]);
    const key = `added-${nextLineKey.current++}`;
    setLineKeys(keys => [...keys, key]);
  };

  const removeLine = (index: number) => {
    if (lines.length <= 1) return;
    setLines(lines.filter((_, i) => i !== index));
    setLineKeys(keys => keys.filter((_, i) => i !== index));
  };

  const updateLine = (index: number, updates: Partial<TransactionLine>) => {
    const nextLines = [...lines];
    nextLines[index] = { ...nextLines[index], ...updates };
    
    // Auto-calculate amount if quantity and unitPrice are updated
    if (updates.quantity !== undefined || updates.unitPriceCents !== undefined) {
      const q = updates.quantity ?? nextLines[index].quantity ?? 1;
      const p = updates.unitPriceCents ?? nextLines[index].unitPriceCents ?? 0;
      nextLines[index].amountCents = Math.round(q * p);
    }
    
    setLines(nextLines);
  };

  const [expandedLineKey, setExpandedLineKey] = useState<string | null>(null);

  return (
    <div {...overlayDialogProps} className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-5xl bg-[var(--ink)] rounded-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[90dvh] border border-[#333537]"
      >
        <div className="p-6 border-b border-[var(--line)] flex items-center justify-between bg-[var(--surface)]/50">
          <div>
            <h2 id={overlayTitleId} className="text-xl font-medium text-[var(--text)] tracking-tight flex items-center gap-2">
               <Layers aria-hidden="true" className="text-indigo-600" size={20} />
               Split Transaction Lines
            </h2>
            <p className="text-[10px] text-[var(--muted)] mt-1 font-black uppercase tracking-[0.2em]">{transaction.description} • {new Intl.NumberFormat('en-US', { style: 'currency', currency: transaction.currency }).format(transaction.totalAmountCents / 100)}</p>
          </div>
          <button aria-label="Close" onClick={onClose} className="p-2 hover:bg-[var(--ink)] rounded-full transition-colors text-slate-500 hover:text-white"><X aria-hidden="true" size={20} /></button>
        </div>

        <div className="flex-1 overflow-auto p-4 md:p-6 space-y-4 custom-scrollbar bg-[var(--ink)]">
          <div className="min-w-[700px]">
            <div className="grid grid-cols-[1fr_150px_150px_100px_40px] gap-4 px-2 mb-2 text-[10px] font-black text-[var(--muted)] uppercase tracking-[0.3em]">
              <div>Account / Item Description</div>
              <div>Quantity & Price</div>
              <div>Amount (Total)</div>
              <div className="text-right">Split %</div>
              <div></div>
            </div>

            <div className="space-y-3">
              {lines.map((line, idx) => (
                <div key={lineKeys[idx]} className="space-y-2">
                <div className={cn(
                  "grid grid-cols-[1fr_150px_150px_100px_40px] gap-4 items-center p-3 rounded-[32px] border border-[var(--line)] transition-all group",
                  expandedLineKey === lineKeys[idx] ? "bg-[var(--ink)]/40 border-indigo-600" : "bg-[var(--surface)]/30 hover:bg-[var(--ink)]/20"
                )}>
                  <div className="flex flex-col gap-1">
                    <div className="relative">
                      <input 
                        aria-label={`Account for split line ${idx + 1}`}
                        list={`${editorId}-account-options-${idx}`}
                        value={resolveAccountName(accounts, line.accountId, line.accountName)}
                        onChange={(e) => {
                          const acc = accounts.find(a => a.name === e.target.value || a.id === e.target.value);
                          updateLine(idx, { accountId: acc ? acc.id : '', accountName: acc ? acc.name : e.target.value });
                        }}
                        placeholder="Type or select account"
                        className="bg-transparent border-none outline-none font-bold text-sm text-[var(--text)] focus:text-indigo-600 transition-colors"
                      />
                      <datalist id={`${editorId}-account-options-${idx}`}>
                        {accounts.map(acc => (
                          <option key={acc.id} value={acc.name}>{acc.code}</option>
                        ))}
                      </datalist>
                    </div>
                    <input 
                      aria-label={`Description for split line ${idx + 1}`}
                      type="text"
                      placeholder="Line item description (e.g. Milk 2%)"
                      value={line.description || ''}
                      onChange={(e) => updateLine(idx, { description: e.target.value })}
                      className="bg-transparent border-none outline-none text-[11px] font-medium text-[var(--muted)] focus:text-indigo-600 placeholder:text-slate-500/30"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <input 
                      aria-label={`Quantity for split line ${idx + 1}`}
                      type="number"
                      placeholder="Qty"
                      value={line.quantity || ''}
                      onChange={(e) => updateLine(idx, { quantity: Number.parseFloat(e.target.value) || 1 })}
                      className="w-16 px-2 py-1.5 bg-[var(--ink)] border border-[var(--line)] rounded-lg text-xs font-mono text-center text-[var(--muted)] focus:border-indigo-600 outline-none"
                    />
                    <span className="text-[var(--muted)] text-[10px] font-black uppercase">×</span>
                    <input 
                      aria-label={`Unit price for split line ${idx + 1}`}
                      type="number"
                      placeholder="Price"
                      value={line.unitPriceCents ? line.unitPriceCents / 100 : ''}
                      onChange={(e) => updateLine(idx, { unitPriceCents: TruthEngine.parseAmountToCents(e.target.value || '0') })}
                      className="w-20 px-2 py-1.5 bg-[var(--ink)] border border-[var(--line)] rounded-lg text-xs font-mono text-right text-[var(--muted)] focus:border-indigo-600 outline-none"
                    />
                  </div>

                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)] font-mono text-xs opacity-50">$</span>
                    <input 
                      aria-label={`Amount for split line ${idx + 1}`}
                      type="number"
                      step="0.01"
                      value={line.amountCents / 100}
                      onChange={(e) => {
                        updateLine(idx, { amountCents: parseAmountToCents(e.target.value) });
                      }}
                      className="w-full pl-6 pr-3 py-2 bg-[var(--ink)] border border-[var(--line)] rounded-xl text-sm font-mono text-right text-[var(--text)] focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 outline-none transition-all"
                    />
                  </div>

                  <div className="text-right font-mono text-[10px] font-black text-[var(--muted)] tabular-nums">
                    {((line.amountCents / (transaction.totalAmountCents || 1)) * 100).toFixed(1)}%
                  </div>

                  <div className="flex items-center gap-1">
                    <button 
                      aria-label={`Details for split line ${idx + 1}`}
                      aria-expanded={expandedLineKey === lineKeys[idx]}
                      onClick={() => setExpandedLineKey(expandedLineKey === lineKeys[idx] ? null : lineKeys[idx])}
                      className={cn(
                        "p-2 rounded-lg transition-all",
                        expandedLineKey === lineKeys[idx] ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-[var(--ink)]"
                      )}
                    >
                      <Layers aria-hidden="true" size={14} />
                    </button>
                    <button 
                      aria-label={`Remove split line ${idx + 1}`}
                      onClick={() => removeLine(idx)}
                      className="text-[var(--muted)] hover:text-rose-600 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-all p-2 flex items-center justify-center hover:bg-rose-50/10 rounded-lg"
                    >
                      <Trash2 aria-hidden="true" size={16} />
                    </button>
                  </div>
                </div>

                {expandedLineKey === lineKeys[idx] && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    className="overflow-hidden border-x border-b border-[var(--line)] rounded-b-2xl mx-2 p-4 bg-[var(--ink)]/10 flex flex-col gap-4"
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      {configuredAxes.map(axis => {
                        const rawVal = getLineDimension(line, transaction, axis.id, dimensionNodes);
                        const displayVal = rawVal === 'Unassigned' ? '' : rawVal;
                        const options = Array.from(new Set([
                          ...dimensionNodes
                            .filter(n => n.dimensionId === axis.id && n.status !== 'archived')
                            .map(n => n.description),
                          ...(axis.id === 'project' ? projects.map(p => p.name) : []),
                          ...(axis.id === 'class' ? storeClasses : []),
                          ...(axis.id === 'location' ? storeLocations : []),
                        ].filter(Boolean)));
                        const listId = `${editorId}-dim-options-${axis.id}-${idx}`;
                        return (
                          <div key={axis.id} className="space-y-1.5">
                            <label htmlFor={`${editorId}-dim-${axis.id}-${idx}`} className="text-[10px] font-black text-[var(--muted)] uppercase tracking-widest">
                              {axis.name}
                            </label>
                            <div className="relative">
                              <input
                                id={`${editorId}-dim-${axis.id}-${idx}`}
                                list={listId}
                                aria-label={`${axis.name} for split line ${idx + 1}`}
                                value={displayVal}
                                onChange={e => updateLine(idx, setLineDimension(line, axis.id, e.target.value, dimensionNodes))}
                                placeholder={`Type or select ${axis.name.toLowerCase()}`}
                                className="w-full px-4 py-2.5 bg-[var(--ink)] border border-[var(--line)] rounded-xl text-xs font-bold text-[var(--text)] focus:text-indigo-600 outline-none"
                              />
                              <datalist id={listId}>
                                {options.map(opt => <option key={opt} value={opt} />)}
                              </datalist>
                              <DimensionValueActions
                                dimensionId={axis.id}
                                dimensionName={axis.name}
                                value={displayVal}
                                lineNumber={idx + 1}
                                onSelectNode={node => updateLine(idx, setLineDimension(line, axis.id, node.id, useLedgerStore.getState().dimensionNodes))}
                                onRenamed={node => updateLine(idx, setLineDimension(line, axis.id, node.id, useLedgerStore.getState().dimensionNodes))}
                              />
                            </div>
                          </div>
                        );
                      })}
                      <div className="sm:col-span-2 space-y-1.5">
                        <Labelled labelClassName="text-[10px] font-black text-[var(--muted)] uppercase tracking-widest flex items-center justify-between" label={<>Custom Labels / Tags
                          <span className="text-[9px] lowercase italic font-medium opacity-50">Separate by comma</span></>}>
                          <input 
                            type="text"
                            placeholder="e.g. Organic, Office Supplies, High Priority"
                            value={line.tags?.join(', ') || ''}
                            onChange={(e) => updateLine(idx, { tags: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                            className="w-full px-4 py-2.5 bg-[var(--ink)] border border-[var(--line)] rounded-xl text-xs font-medium text-[var(--text)] focus:border-indigo-600 outline-none"
                          />
                        </Labelled>
                      </div>
                    </div>
                    <div>
                      <InlineAddDimensionAxis />
                    </div>
                  </motion.div>
                )}
              </div>
            ))}
          </div>

          <button 
            onClick={addLine}
            className="flex items-center gap-3 px-6 py-4 bg-[var(--surface)]/50 hover:bg-[var(--ink)]/50 text-indigo-600 rounded-[32px] text-[10px] font-black uppercase tracking-[0.2em] transition-all mt-6 w-full justify-center border border-dashed border-[var(--line)] group"
           aria-label="Append Split Line">
            <Plus aria-hidden="true" size={16} className="group-hover:scale-125 transition-transform" />
            Append Split Line
          </button>
          </div>
        </div>

        <div className="p-4 md:p-6 border-t border-[var(--line)] bg-[var(--surface)] flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className={cn(
              "flex items-center gap-3 px-5 py-2.5 rounded-[32px] text-[10px] font-medium uppercase tracking-wider",
              isBalanced ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20" : "bg-rose-500/10 text-rose-500 border border-rose-500/20"
            )}>
              {isBalanced ? (
                <>
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  Chain Balanced
                </>
              ) : (
                <>
                  <AlertCircle aria-hidden="true" size={14} className="animate-bounce" />
                  Discrepancy: {new Intl.NumberFormat('en-US', { style: 'currency', currency: transaction.currency }).format(diff / 100)}
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button 
              onClick={onClose} 
              className="px-6 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--muted)] hover:text-[var(--text)] transition-all"
             aria-label="Cancel">
              Cancel
            </button>
            <button 
              onClick={() => {
                const currentNodes = useLedgerStore.getState().dimensionNodes || [];
                onSave(lines.map(l => {
                  const normalizedDims = normalizeDimensionsMap(l.dimensions, currentNodes);
                  return normalizedDims !== l.dimensions ? { ...l, dimensions: normalizedDims } : l;
                }));
              }}
              disabled={!isBalanced || lines.some(l => !l.accountId)}
              className="btn-primary !px-10 flex items-center gap-3 disabled:opacity-30 disabled:grayscale transition-all shadow-[0_0_20px_rgba(26,115,232,0.2)]"
            >
              <Save aria-hidden="true" size={18} />
              Commit Atomic Split
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
