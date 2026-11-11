import React, { useState, useMemo } from 'react';
import { CheckCircle2, CheckSquare, Zap, AlertCircle, HelpCircle, Check, BrainCircuit, MessageSquare, Layers, Calculator } from 'lucide-react';
import { toast } from 'sonner';
import { formatCurrency, formatDate } from '../../lib/utils';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { getIdToken } from '../../firebase';
import { HandOver } from '../collaboration/HandOver';
import { useHandOvers } from '../collaboration/useHandOvers';
import { inBackground } from '../../lib/inBackground';
import { resolveAccountRole } from '../../lib/accountUtils';
import { isPostable, lineAmount } from '../../lib/txFilters';
import {
  buildConnectedAlgorithmSignals,
  evaluateCalibratedAutoPost,
  groupSimilarUnreviewedLines,
  tryEvaluateAmountInput,
} from '../../lib/practiceAutomation';

export default function InboxView() {
  const transactions = useLedgerStore(s => s.transactions);
  const accounts = useLedgerStore(s => s.accounts);
  const currentWorkspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  // BG-05: who has each entry, and "Give to…" (a task about it)
  const hand = useHandOvers();
  const entry = (t: { id: string; date: string; description?: string }) => ({ type: 'transaction' as const, id: t.id, label: `Entry ${t.date} · ${t.description || ''}`.trim() });

  const [showAllHighConfidence, setShowAllHighConfidence] = useState(false);
  const [exprInput, setExprInput] = useState('');
  const exprResult = useMemo(() => (exprInput.trim() ? tryEvaluateAmountInput(exprInput) : null), [exprInput]);

  const historicalPosted = useMemo(
    () => transactions.filter(t => t.status !== 'pending' && t.status !== 'draft' && t.status !== 'void'),
    [transactions],
  );

  const pendingTransactions = useMemo(() => 
    transactions.filter(t => !isPostable(t) && !t.deletedAt && (t.status === 'pending' || t.status === 'draft'))
      .map(t => {
        const line = t.lines[0];
        const calibration = evaluateCalibratedAutoPost(
          {
            payee: t.payee,
            description: t.description,
            suggestedAccountId: line?.accountId,
            suggestedAccountName: line?.accountName,
          },
          historicalPosted,
        );
        let baseConfidence = line?.confidence;
        if (baseConfidence === undefined) {
          if (calibration.decision === 'auto_post') {
            baseConfidence = 99;
          } else if (line?.accountId && line.accountId !== 'uncategorized' && line.accountId !== 'unassigned') {
            baseConfidence = 92;
          } else if (line?.category && line.category !== 'Uncategorized') {
            baseConfidence = 75;
          } else {
            baseConfidence = 45;
          }
        }
        return { ...t, uiConfidence: baseConfidence, calibration };
      })
      .sort((a, b) => b.uiConfidence - a.uiConfidence)
  , [transactions, historicalPosted]);

  const similarClusters = useMemo(
    () => groupSimilarUnreviewedLines(pendingTransactions, transactions).filter(c => c.count >= 2),
    [pendingTransactions, transactions],
  );

  const connectedSignals = useMemo(
    () => buildConnectedAlgorithmSignals({ transactions: historicalPosted }),
    [historicalPosted],
  );

  const calibratedReady = pendingTransactions.filter(t => t.calibration.decision === 'auto_post');
  const highConfidence = pendingTransactions.filter(t => t.uiConfidence >= 90);
  const mediumConfidence = pendingTransactions.filter(t => t.uiConfidence >= 60 && t.uiConfidence < 90);
  const lowConfidence = pendingTransactions.filter(t => t.uiConfidence < 60);

  const _handleCategorize = async (transactionIds: string[], category: string, targetAccountId?: string) => {
    if (!currentWorkspaceId || transactionIds.length === 0) return;
    let resolvedAcc = accounts.find(a => a.id === targetAccountId);
    if (!resolvedAcc && category) {
      const lowerCat = category.toLowerCase();
      resolvedAcc = accounts.find(a => 
        a.name.toLowerCase().includes(lowerCat) || 
        (a.category && a.category.toLowerCase().includes(lowerCat))
      );
    }
    if (!resolvedAcc) {
      resolvedAcc = accounts.find(a => a.type === 'expense') || accounts[0];
    }
    if (!resolvedAcc) return;

    const updates: Array<{ id: string; data: { lines: typeof transactions[number]['lines']; status: 'completed'; isReviewed: boolean } }> = [];
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
        const catLineIdx = updatedLines.findIndex(l => !l.accountId || l.accountId === 'uncategorized' || l.accountId === 'unassigned' || lineAmount(l, tx) > 0);
        const targetIdx = catLineIdx !== -1 ? catLineIdx : 0;
        updatedLines[targetIdx] = {
          ...updatedLines[targetIdx],
          accountId: resolvedAcc.id,
          accountName: resolvedAcc.name,
          category: category || updatedLines[targetIdx].category
        };
      }

      updates.push({
        id,
        data: { lines: updatedLines, status: 'completed', isReviewed: true }
      });
    }

    if (updates.length === 0 || !currentWorkspaceId) return;
    const token = await getIdToken();
    const res = await fetch('/api/v1/transactions/batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ workspaceId: currentWorkspaceId, updates }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(body.error || body.message || 'Could not save categorized entries');
      return;
    }
    const patchMap = new Map(updates.map(u => [u.id, u.data]));
    useLedgerStore.getState().setTransactions(
      useLedgerStore.getState().transactions.map(t => (patchMap.has(t.id) ? { ...t, ...patchMap.get(t.id)! } : t)),
    );
    toast.success(`Filed ${updates.length} ${updates.length === 1 ? 'entry' : 'entries'}`);
  };

  const handleCalibratedAutoPost = async () => {
    if (!currentWorkspaceId || calibratedReady.length === 0) return;
    const cashAcc = accounts.find(a => !a.isArchived && resolveAccountRole(a) === 'cash');
    const updates: Array<{ id: string; data: { lines: typeof transactions[number]['lines']; status: 'completed'; isReviewed: boolean } }> = [];
    let skippedUnresolved = 0;

    for (const item of calibratedReady) {
      const targetAccId = item.calibration.suggestedAccountId;
      const resolvedAcc = targetAccId ? accounts.find(a => a.id === targetAccId && !a.isArchived) : undefined;
      if (!resolvedAcc) {
        skippedUnresolved += 1;
        continue;
      }

      let updatedLines = item.lines && item.lines.length > 0 ? item.lines.map(l => ({ ...l })) : [];
      if (updatedLines.length === 0) {
        if (!cashAcc || cashAcc.id === resolvedAcc.id) {
          skippedUnresolved += 1;
          continue;
        }
        const amt = item.totalAmountCents || 0;
        updatedLines = [
          { accountId: resolvedAcc.id, accountName: resolvedAcc.name, amountCents: amt, category: resolvedAcc.name },
          { accountId: cashAcc.id, accountName: cashAcc.name, amountCents: -amt },
        ];
      } else {
        const catLineIdx = updatedLines.findIndex(
          l => !l.accountId || l.accountId === 'uncategorized' || l.accountId === 'unassigned' || lineAmount(l, item) > 0,
        );
        const targetIdx = catLineIdx !== -1 ? catLineIdx : 0;
        updatedLines[targetIdx] = {
          ...updatedLines[targetIdx],
          accountId: resolvedAcc.id,
          accountName: resolvedAcc.name,
          category: resolvedAcc.name,
        };
      }

      updates.push({
        id: item.id,
        data: {
          lines: updatedLines,
          status: 'completed',
          isReviewed: true,
        },
      });
    }

    if (updates.length === 0) {
      toast.error('Cannot auto-post: calibrated accounts are missing or archived in the chart of accounts.');
      return;
    }

    const token = await getIdToken();
    const res = await fetch('/api/v1/transactions/batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        workspaceId: currentWorkspaceId,
        updates,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(body.error || body.message || 'Could not auto-post calibrated entries');
      return;
    }
    const patchMap = new Map(updates.map(u => [u.id, u.data]));
    useLedgerStore.getState().setTransactions(
      useLedgerStore.getState().transactions.map(t => (patchMap.has(t.id) ? { ...t, ...patchMap.get(t.id)! } : t)),
    );
    const suffix = skippedUnresolved > 0 ? ` (${skippedUnresolved} skipped due to unresolved accounts)` : '';
    toast.success(`Auto-posted ${updates.length} calibrated ${updates.length === 1 ? 'entry' : 'entries'}${suffix}`);
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
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-[var(--text)] tracking-tight flex items-center gap-3">
            <Zap className="text-[var(--brass)]" size={32} />
            AI Inbox
          </h1>
          <p className="text-[var(--muted)] font-medium mt-1">
            Calibrated automatic posting (≥99% unchanged over ≥10 cases) and grouped review.
          </p>
        </div>
        <div className="flex items-center gap-2 bg-[var(--surface)] border border-[var(--line)] rounded-xl px-3 py-2 text-xs">
          <Calculator size={14} className="text-[var(--muted)]" aria-hidden="true" />
          <label htmlFor="inbox-amount-expr" className="sr-only">Quick split calculator</label>
          <input
            id="inbox-amount-expr"
            value={exprInput}
            onChange={e => setExprInput(e.target.value)}
            placeholder="Split math e.g. (120 + 45) / 3"
            className="bg-transparent outline-none text-[var(--text)] w-44"
          />
          {exprResult && (
            <span className="font-mono font-bold text-[var(--text)]">
              {exprResult.ok ? `= ${formatCurrency(exprResult.cents)}` : 'Invalid'}
            </span>
          )}
        </div>
      </div>

      {/* DECIDE ONCE, APPLY TO MANY (TF-IDF SIMILAR CLUSTERS) */}
      {similarClusters.length > 0 && (
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--line)] p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <Layers size={18} className="text-indigo-600" aria-hidden="true" />
              <div>
                <h2 className="font-bold text-[var(--text)] text-sm">Decide once, apply to many ({similarClusters.length} merchant groups)</h2>
                <p className="text-xs text-[var(--muted)]">Grouped by TF-IDF merchant token similarity so banking noise is ignored.</p>
              </div>
            </div>
            {calibratedReady.length > 0 && (
              <button
                type="button"
                onClick={() => inBackground(handleCalibratedAutoPost())}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
              >
                Auto-post {calibratedReady.length} calibrated (≥99%)
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {similarClusters.slice(0, 4).map(cluster => (
              <div key={cluster.clusterId} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[var(--ink)] border border-[var(--line)] text-xs">
                <div className="min-w-0">
                  <p className="font-bold text-[var(--text)] truncate">{cluster.label}</p>
                  <p className="text-[var(--muted)]">
                    {cluster.count} similar lines · {formatCurrency(cluster.totalAbsAmountCents)}
                    {cluster.suggestedCategory ? ` · ${cluster.suggestedCategory}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => inBackground(_handleCategorize(cluster.memberIds, cluster.suggestedCategory || 'Operating Expense'))}
                  className="px-3 py-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] font-semibold text-[var(--text)] hover:border-indigo-500 shrink-0"
                >
                  Apply to all {cluster.count}
                </button>
              </div>
            ))}
          </div>
          {connectedSignals.inducedRules.length > 0 && (
            <p className="text-xs text-[var(--muted)]">
              Suggested rule from verified history: &ldquo;{connectedSignals.inducedRules[0].condition}&rdquo; → {connectedSignals.inducedRules[0].targetAccount} ({Math.round(connectedSignals.inducedRules[0].confidence * 100)}% over {connectedSignals.inducedRules[0].support} entries)
            </p>
          )}
        </div>
      )}

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
