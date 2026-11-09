import React, { useState, useMemo } from 'react';
import { BrainCircuit, ShieldCheck, Cpu, ArrowRight } from 'lucide-react';
import { MatchingEngine } from '../../lib/MatchingEngine';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { LoadedEntriesOnlyNote } from './LoadedEntriesOnlyNote';

interface CategoryWhyPopoverProps {
  description: string;
  accountName?: string;
  className?: string;
}

export default function CategoryWhyPopover({ description, accountName, className = '' }: CategoryWhyPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);

  const autoRules = useLedgerStore(s => s.autoRules);
  const analyticalPatternCache = useLedgerStore(s => s.analyticalPatternCache);
  const matchingThreshold = useLedgerStore(s => s.matchingThreshold);
  const transactions = useLedgerStore(s => s.transactions);
  const accounts = useLedgerStore(s => s.accounts);
  const dimensionNodes = useLedgerStore(s => s.dimensionNodes);
  const user = useAuthStore(s => s.user);
  useAuthStore(s => s.getCurrentWorkspace());

  const engine = useMemo(() => {
    return new MatchingEngine(
      autoRules || [],
      analyticalPatternCache || {},
      user?.uid,
      matchingThreshold || 0.8,
      transactions || [],
      dimensionNodes,
      accounts || []
    );
  }, [autoRules, analyticalPatternCache, user?.uid, matchingThreshold, transactions, dimensionNodes, accounts]);

  const debugInfo = useMemo(() => {
    if (!description) return null;
    return engine.debugResolveCategory(description);
  }, [engine, description]);

  if (!debugInfo) return null;

  const isManual = !debugInfo.accountName || debugInfo.accountName === 'Manual Review' || debugInfo.layer.includes('Manual') || debugInfo.layer.includes('Empty');
  const rawConf = debugInfo.confidence;

  let bandLabel = 'No Evidence';
  let badgeClasses = 'bg-slate-800 text-slate-400 border-slate-700';

  if (!isManual && rawConf !== undefined && rawConf !== null && rawConf > 0) {
    const pct = Math.round(rawConf * 100);
    if (rawConf >= 0.75) {
      bandLabel = `Confident (${pct}%)`;
      badgeClasses = 'bg-emerald-950 text-emerald-400 border-emerald-800';
    } else if (rawConf >= 0.40) {
      bandLabel = `Weak Evidence (${pct}%)`;
      badgeClasses = 'bg-amber-950 text-amber-400 border-amber-800';
    } else {
      bandLabel = `No Evidence (${pct}%)`;
      badgeClasses = 'bg-slate-800 text-slate-400 border-slate-700';
    }
  }

  return (
    <div className={`relative inline-block ${className}`} role="presentation" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        title="Category Resolution Audit Trail (Why?)"
        className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[8px] font-bold tracking-wider text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 rounded border border-indigo-200 dark:border-indigo-800 transition-colors cursor-pointer group"
      >
        <BrainCircuit size={10} className="text-indigo-500 group-hover:scale-110 transition-transform" />
        <span>Why?</span>
      </button>

      {isOpen && (
        <>
          <div 
            className="fixed inset-0 z-[100]" 
            role="presentation" aria-hidden="true" onClick={() => setIsOpen(false)} 
          />
          <div className="absolute top-full left-0 mt-1 z-[110] w-72 p-3 bg-slate-900 text-slate-100 rounded-xl shadow-2xl border border-indigo-500/30 text-xs font-sans space-y-2 animate-in fade-in zoom-in-95 duration-100">
            <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
              <span className="font-bold text-[10px] uppercase tracking-wider text-indigo-400 flex items-center gap-1">
                <Cpu size={12} /> Resolution Audit Trail
              </span>
              <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border font-bold ${badgeClasses}`}>
                {bandLabel}
              </span>
            </div>

            <div className="space-y-1">
              <div className="text-[10px] text-[var(--muted)]">
                Description: <span className="text-slate-200 font-mono italic">"{description}"</span>
              </div>
              <div className="text-[10px] text-[var(--muted)] flex items-center gap-1">
                Resolved Account: <span className="font-bold text-white">{debugInfo.accountName || accountName || 'Manual Review'}</span>
              </div>
            </div>

            <LoadedEntriesOnlyNote testId="category-why-loaded-only" what="the past entries this explanation learns from" className="text-[10px] text-amber-300" />

            <div className="p-2 rounded bg-slate-950/80 border border-slate-800 text-[11px] space-y-1">
              <div className="text-[9px] uppercase tracking-wider text-indigo-300 font-bold">
                Matching Layer
              </div>
              <div className="font-medium text-slate-200 flex items-center gap-1">
                <ShieldCheck size={12} className="text-indigo-400 shrink-0" />
                <span>{debugInfo.layer}</span>
              </div>
            </div>

            {debugInfo.dimensions && Object.keys(debugInfo.dimensions).length > 0 && (
              <div className="space-y-1">
                <div className="text-[9px] uppercase tracking-wider text-[var(--muted)] font-bold">
                  Extracted Dimensions
                </div>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(debugInfo.dimensions).map(([k, v]) => (
                    <span key={k} className="text-[9px] font-mono px-1.5 py-0.5 bg-indigo-900/50 text-indigo-200 rounded border border-indigo-700/50">
                      {k}: {v}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="text-[9px] text-[var(--muted)] italic pt-1 border-t border-slate-800 flex items-center gap-1">
              <ArrowRight size={9} className="text-indigo-400" />
              100% deterministic matching pipeline — cost-ordered rule execution.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
