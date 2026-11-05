import React, { useState, useMemo } from 'react';
import { CheckCircle2, CheckSquare, Zap, AlertCircle, HelpCircle, Check, BrainCircuit, MessageSquare } from 'lucide-react';
import { formatCurrency, formatDate } from '../../lib/utils';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useEntityOperations } from '../../hooks/useEntityOperations';
import { HandOver } from '../collaboration/HandOver';
import { useHandOvers } from '../collaboration/useHandOvers';
import { inBackground } from '../../lib/inBackground';

export default function InboxView() {
  const transactions = useLedgerStore(s => s.transactions);
  const accounts = useLedgerStore(s => s.accounts);
  const { updateEntity } = useEntityOperations();
  // BG-05: who has each entry, and "Give to…" (a task about it)
  const hand = useHandOvers();
  const entry = (t: { id: string; date: string; description?: string }) => ({ type: 'transaction' as const, id: t.id, label: `Entry ${t.date} · ${t.description || ''}`.trim() });

  const [showAllHighConfidence, setShowAllHighConfidence] = useState(false);
  const pendingTransactions = useMemo(() => 
    transactions.filter(t => t.status === 'pending' || t.status === 'draft')
      .map(t => {
        // Compute confidence deterministically based on line categorization & metadata
        const line = t.lines[0];
        let baseConfidence = line?.confidence;
        if (baseConfidence === undefined) {
          if (line?.accountId && line.accountId !== 'uncategorized' && line.accountId !== 'unassigned') {
            baseConfidence = 92;
          } else if (line?.category && line.category !== 'Uncategorized') {
            baseConfidence = 75;
          } else {
            baseConfidence = 45;
          }
        }
        return { ...t, uiConfidence: baseConfidence };
      })
      .sort((a, b) => b.uiConfidence - a.uiConfidence)
  , [transactions]);

  useState<Set<string>>(new Set());

  const highConfidence = pendingTransactions.filter(t => t.uiConfidence >= 90);
  const mediumConfidence = pendingTransactions.filter(t => t.uiConfidence >= 60 && t.uiConfidence < 90);
  const lowConfidence = pendingTransactions.filter(t => t.uiConfidence < 60);

  const _handleCategorize = async (transactionIds: string[], category: string, targetAccountId?: string) => {
    // Find matching chart account
    let resolvedAcc = accounts.find(a => a.id === targetAccountId);
    if (!resolvedAcc && category) {
      const lowerCat = category.toLowerCase();
      resolvedAcc = accounts.find(a => 
        a.name.toLowerCase().includes(lowerCat) || 
        (a.category && a.category.toLowerCase().includes(lowerCat))
      );
    }
    if (!resolvedAcc) {
      // Fallback to first expense account or standard chart account
      resolvedAcc = accounts.find(a => a.type === 'expense') || accounts[0];
    }

    for (const id of transactionIds) {
      const tx = transactions.find(t => t.id === id);
      if (!tx) continue;

      let updatedLines = tx.lines && tx.lines.length > 0 ? tx.lines.map(l => ({ ...l })) : [];
      if (updatedLines.length === 0) {
        const cashAcc = accounts.find(a => a.code === '1010' || a.category === 'Cash' || a.category === 'cash_and_equivalents' || a.type === 'asset') || accounts[0];
        const amt = tx.totalAmountCents || 0;
        updatedLines = [
          { accountId: resolvedAcc.id, accountName: resolvedAcc.name, amountCents: amt, category },
          { accountId: cashAcc?.id || resolvedAcc.id, accountName: cashAcc?.name || 'Main Checking', amountCents: -amt }
        ];
      } else {
        // Find line that needs categorization (e.g. non-cash or uncategorized line)
        const catLineIdx = updatedLines.findIndex(l => !l.accountId || l.accountId === 'uncategorized' || l.accountId === 'unassigned' || l.amountCents > 0);
        const targetIdx = catLineIdx !== -1 ? catLineIdx : 0;
        updatedLines[targetIdx] = {
          ...updatedLines[targetIdx],
          accountId: resolvedAcc.id,
          accountName: resolvedAcc.name,
          category: category || updatedLines[targetIdx].category
        };
      }

      await updateEntity('transactions', id, { 
        lines: updatedLines, 
        status: 'completed',
        isReviewed: true
      });
    }
  };

  const handleAutoFile = () => {
    inBackground(_handleCategorize(highConfidence.map(t => t.id), 'Auto-filed'));
  };

  const handleBatchConfirm = () => {
    const saasAcc = accounts.find(a => a.name.toLowerCase().includes('software') || a.name.toLowerCase().includes('saas') || a.name.toLowerCase().includes('subscription')) || accounts.find(a => a.type === 'expense');
    inBackground(_handleCategorize(mediumConfidence.map(t => t.id), 'Software / SaaS', saasAcc?.id));
  };

  const handleResolveLow = (id: string, category: string) => {
    if (category.toLowerCase().includes('business')) {
      const bizAcc = accounts.find(a => a.name.toLowerCase().includes('office') || a.name.toLowerCase().includes('general') || a.type === 'expense');
      inBackground(_handleCategorize([id], 'Business Expense', bizAcc?.id));
    } else {
      const ownerDrawAcc = accounts.find(a => a.type === 'equity' || a.name.toLowerCase().includes('draw') || a.name.toLowerCase().includes('distribution')) || accounts.find(a => a.type === 'equity');
      inBackground(_handleCategorize([id], 'Owner Draw', ownerDrawAcc?.id));
    }
  };

  if (pendingTransactions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="w-24 h-24 bg-green-50 rounded-full flex items-center justify-center mb-6">
          <CheckCircle2 size={48} className="text-green-500" />
        </div>
        <h1 className="text-2xl font-black text-[var(--text)] mb-2">Inbox Zero</h1>
        <p className="text-[var(--muted)] text-center max-w-sm">
          All transactions have been categorized and filed. Your books are perfectly up to date.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-[var(--text)] tracking-tight flex items-center gap-3">
            <Zap className="text-[var(--brass)]" size={32} />
            AI Inbox
          </h1>
          <p className="text-[var(--muted)] font-medium mt-1">Confidence-driven transaction categorization and inbox zero.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {/* HIGH CONFIDENCE */}
        {highConfidence.length > 0 && (
          <div className="bg-[var(--surface)] rounded-2xl border border-[var(--line)] p-6 shadow-sm">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center">
                  <BrainCircuit className="text-green-600" size={20} />
                </div>
                <div>
                  <h2 className="font-bold text-[var(--text)] text-lg">High Confidence ({highConfidence.length})</h2>
                  <p className="text-sm text-[var(--muted)]">Over 90% match certainty. Ready to auto-file.</p>
                </div>
              </div>
              <button 
                onClick={handleAutoFile}
                className="bg-green-600 hover:bg-green-700 text-white px-5 py-2.5 rounded-xl font-bold text-sm transition-colors shadow-sm flex items-center gap-2"
               aria-label="Auto-file all">
                <Check size={16} />
                Auto-file all {highConfidence.length}
              </button>
            </div>
            <div className="flex flex-wrap gap-2 mt-4">
              {(showAllHighConfidence ? highConfidence : highConfidence.slice(0, 5)).map(t => (
                <div key={t.id} className="bg-[var(--ink)] border border-[var(--line)] px-3 py-2 rounded-lg text-xs font-medium text-slate-600 flex items-center gap-2">
                  <span className="truncate max-w-[120px]">{t.description}</span>
                  <span className="font-bold text-[var(--text)] tabular-nums">{formatCurrency(t.totalAmountCents)}</span>
                  <span className="text-green-600 bg-green-50 px-1.5 py-0.5 rounded text-[10px]">{Math.round(t.uiConfidence)}%</span>
                </div>
              ))}
              {highConfidence.length > 5 && (
                <button 
                  onClick={() => setShowAllHighConfidence(!showAllHighConfidence)}
                  className="bg-[var(--ink)] border border-[var(--line)] px-3 py-2 rounded-lg text-xs font-medium text-[var(--muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
                >
                  {showAllHighConfidence ? 'Show Less' : `+${highConfidence.length - 5} more`}
                </button>
              )}
            </div>
          </div>
        )}

        {/* MEDIUM CONFIDENCE */}
        {mediumConfidence.length > 0 && (
          <div className="bg-[var(--surface)] rounded-2xl border-2 border-[#0047AB] p-6 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 right-0 bg-[#0047AB] text-white text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-bl-xl">Review</div>
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
                  <AlertCircle className="text-[#0047AB]" size={20} />
                </div>
                <div>
                  <h2 className="font-bold text-[var(--text)] text-lg">Needs Quick Review ({mediumConfidence.length})</h2>
                  <p className="text-sm text-[var(--muted)]">We're fairly sure about these. One tap to confirm the batch.</p>
                </div>
              </div>
              <button 
                onClick={handleBatchConfirm}
                className="bg-[#0047AB] hover:bg-blue-800 text-white px-5 py-2.5 rounded-xl font-bold text-sm transition-colors shadow-sm flex items-center gap-2"
               aria-label="Confirm Batch">
                <CheckSquare size={16} />
                Confirm Batch
              </button>
            </div>
            
            <div className="space-y-2">
              {mediumConfidence.map(t => (
                <div key={t.id} className="flex items-center justify-between p-3 hover:bg-[var(--ink)] rounded-xl transition-colors border border-transparent hover:border-[var(--line)]">
                  <div className="flex items-center gap-4">
                    <div className="w-2 h-2 rounded-full bg-[#0047AB]"></div>
                    <div>
                      <p className="font-bold text-[var(--text)] text-sm">{t.description}</p>
                      <p className="text-xs text-[var(--muted)]">{formatDate(t.date)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <p className="text-xs text-[var(--muted)] mb-0.5">Suggested</p>
                      <p className="text-sm font-medium text-[#0047AB] bg-blue-50 px-2 py-0.5 rounded-md">Software / SaaS</p>
                    </div>
                    <p className="font-mono font-bold text-[var(--text)] tabular-nums">{formatCurrency(t.totalAmountCents)}</p>
                    <HandOver record={entry(t)} hand={hand} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* LOW CONFIDENCE */}
        {lowConfidence.length > 0 && (
          <div className="bg-[var(--surface)] rounded-2xl border border-[var(--line)] p-6 shadow-sm">
             <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-orange-50 rounded-xl flex items-center justify-center">
                  <HelpCircle className="text-orange-500" size={20} />
                </div>
                <div>
                  <h2 className="font-bold text-[var(--text)] text-lg">Your Input Needed ({lowConfidence.length})</h2>
                  <p className="text-sm text-[var(--muted)]">Unrecognized patterns. Answer a simple question to train the model.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {lowConfidence.map(t => (
                  <div key={t.id} className="bg-orange-50/30 border border-orange-100 rounded-xl p-5">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <p className="font-bold text-[var(--text)]">{t.description}</p>
                        <p className="font-mono text-sm text-slate-600 mt-1 tabular-nums">{formatCurrency(t.totalAmountCents)}</p>
                      </div>
                      <span className="text-xs font-bold text-orange-600 bg-orange-100 px-2 py-1 rounded-lg flex items-center gap-1">
                        <MessageSquare size={12} />
                        Ask
                      </span>
                    </div>
                    
                    <div className="mb-2"><HandOver record={entry(t)} hand={hand} /></div>
                    <p className="text-sm font-medium text-slate-700 mb-3">Was this charge for business or personal use?</p>
                    
                    <div className="flex gap-2">
                      <button 
                        onClick={() => handleResolveLow(t.id, 'Business')}
                        className="flex-1 bg-[var(--surface)] border border-[var(--line)] hover:border-[#0047AB] hover:text-[#0047AB] text-slate-700 py-2 rounded-lg text-sm font-bold transition-all shadow-sm"
                      >
                        Business
                      </button>
                      <button 
                        onClick={() => handleResolveLow(t.id, 'Personal')}
                        className="flex-1 bg-[var(--surface)] border border-[var(--line)] hover:border-slate-400 text-slate-700 py-2 rounded-lg text-sm font-bold transition-all shadow-sm"
                      >
                        Personal
                      </button>
                    </div>
                  </div>
                ))}
              </div>
          </div>
        )}
      </div>
    </div>
  );
}
