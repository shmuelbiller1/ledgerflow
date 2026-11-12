import React, { useState, useMemo } from 'react';
import { CheckCircle2, CheckSquare, Zap, AlertCircle, HelpCircle, Check, BrainCircuit, MessageSquare, Layers, Calculator } from 'lucide-react';
import { toast } from 'sonner';
import { formatCurrency, formatDate } from '../../lib/utils';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { db, getIdToken } from '../../firebase';
import { addDoc, collection } from '../../lib/db/firestore';
import { useBankRules } from '../../hooks/useBankRules';
import { merchantKey, merchantLabel, ruleFromDecision } from '../../lib/ruleFromDecision';
import { reviewReason, type ReviewReason } from '../../lib/reviewReason';
import type { AutoRule, ChartAccount, Transaction } from '../../types';
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
  // EU-C1: the workspace's bank rules, so each line can say which rule suggests its account
  const [rules, setRules] = useBankRules(currentWorkspaceId);
  // EU-C3: "Always do this for Shell" — the lines whose acceptance should also make a rule
  const uid = useAuthStore(s => s.user?.uid) || '';
  const [alwaysFor, setAlwaysFor] = useState<Set<string>>(new Set());
  const toggleAlways = (id: string) => setAlwaysFor(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  /** EU-C3: saves the rule for an accepted line (account and labels); the list then says "rule: …" for the next ones. */
  const makeRuleFor = async (t: Transaction, accountId?: string) => {
    const account = accounts.find(a => a.id === accountId);
    const categoryLine = (t.lines || []).find(l => l.accountId === accountId) || t.lines?.[0];
    const rule = account ? ruleFromDecision({ payee: t.payee, description: t.description, accountId: account.id, accountName: account.name, labels: { ...(t.dimensions || {}), ...(categoryLine?.dimensions || {}) } }) : null;
    if (!rule || !currentWorkspaceId || !uid) return;
    try {
      const saved = { ...rule, uid, workspaceId: currentWorkspaceId, createdAt: new Date().toISOString() };
      const ref = await addDoc(collection(db, 'autoRules'), saved);
      setRules(prev => [...prev, { ...saved, id: ref.id } as AutoRule]);
      toast.success(`Rule saved: ${rule.name}`);
    } catch (err) {
      toast.error('The entry was accepted, but the rule was not saved', { description: err instanceof Error ? err.message : String(err) });
    }
  };
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
        const reason: ReviewReason = reviewReason({ tx: t, rules, accounts, calibration });
        return { ...t, uiConfidence: baseConfidence, calibration, reason };
      })
      .sort((a, b) => REASON_ORDER[a.reason.kind] - REASON_ORDER[b.reason.kind])
  , [transactions, historicalPosted, rules, accounts]);

  const similarClusters = useMemo(
    () => groupSimilarUnreviewedLines(pendingTransactions, transactions).filter(c => c.count >= 2),
    [pendingTransactions, transactions],
  );

  const connectedSignals = useMemo(
    () => buildConnectedAlgorithmSignals({ transactions: historicalPosted }),
    [historicalPosted],
  );

  const calibratedReady = pendingTransactions.filter(t => t.calibration.decision === 'auto_post');
  // EU-C1: grouped by why, not by an invented percentage
  const highConfidence = pendingTransactions.filter(t => t.reason.kind === 'rule' || t.reason.kind === 'history');
  const mediumConfidence = pendingTransactions.filter(t => t.reason.kind === 'guess');
  const lowConfidence = pendingTransactions.filter(t => t.reason.kind === 'none');

  /** EU-C1: file each entry to its own suggested account (a rule's, history's or the guess on the line). */
  const fileEach = async (items: Array<{ id: string; accountId?: string }>, what: string): Promise<boolean> => {
    if (!currentWorkspaceId) return false;
    const updates: Array<{ id: string; data: { lines: Transaction['lines']; status: 'completed'; isReviewed: boolean } }> = [];
    for (const item of items) {
      const tx = transactions.find(t => t.id === item.id);
      const account = accounts.find(a => a.id === item.accountId && !a.isArchived);
      if (!tx || !account) continue;
      const lines = filedLines(tx, account, accounts);
      if (lines) updates.push({ id: tx.id, data: { lines, status: 'completed', isReviewed: true } });
    }
    if (!updates.length) { toast.error('Nothing to accept: the suggested accounts are missing or archived.'); return false; }
    const token = await getIdToken();
    const res = await fetch('/api/v1/transactions/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ workspaceId: currentWorkspaceId, updates }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(body.error || body.message || 'Could not save the accepted entries'); return false; }
    const patchMap = new Map(updates.map(u => [u.id, u.data]));
    useLedgerStore.getState().setTransactions(
      useLedgerStore.getState().transactions.map(t => (patchMap.has(t.id) ? { ...t, ...patchMap.get(t.id)! } : t)),
    );
    toast.success(`${what}: ${updates.length} ${updates.length === 1 ? 'entry' : 'entries'}`);
    return true;
  };

  const _handleCategorize = async (transactionIds: string[], category: string, targetAccountId?: string) => {
    let resolvedAcc = accounts.find(a => a.id === targetAccountId);
    if (!resolvedAcc && category) {
      const lowerCat = category.toLowerCase();
      resolvedAcc = accounts.find(a => a.name.toLowerCase().includes(lowerCat) || (a.category && a.category.toLowerCase().includes(lowerCat)));
    }
    resolvedAcc = resolvedAcc || accounts.find(a => a.type === 'expense') || accounts[0];
    if (!resolvedAcc) return;
    await fileEach(transactionIds.map(id => ({ id, accountId: resolvedAcc.id })), 'Filed');
  };

  const handleCalibratedAutoPost = async () => {
    if (calibratedReady.length === 0) return;
    await fileEach(calibratedReady.map(item => ({ id: item.id, accountId: item.calibration.suggestedAccountId || undefined })), 'Auto-posted calibrated');
  };

  const handleAutoFile = () => {
    inBackground(fileEach(highConfidence.map(t => ({ id: t.id, accountId: t.reason.accountId })), 'Accepted with a rule or history'));
  };

  const handleBatchConfirm = () => {
    // EU-C1: each guess keeps its own account (this used to file the whole group to a "Software / SaaS" account)
    inBackground(fileEach(mediumConfidence.map(t => ({ id: t.id, accountId: t.reason.accountId })), 'Guesses accepted'));
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
            To review
          </h1>
          <p className="text-[var(--muted)] font-medium mt-1">
            Entries waiting for you. Each one says why it suggests an account: a rule, the same payee before, or a guess.
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
                  <h2 className="font-bold text-[var(--text)] text-lg">A rule or history says where ({highConfidence.length})</h2>
                  <p className="text-sm text-[var(--muted)]">Each line says why. Accept them in one go, or open one to change it.</p>
                </div>
              </div>
              <button 
                onClick={handleAutoFile}
                className="bg-green-600 hover:bg-green-700 text-white px-5 py-2.5 rounded-xl font-bold text-sm transition-colors shadow-sm flex items-center gap-2"
               aria-label="Accept all with a rule or history">
                <Check size={16} />
                Accept all {highConfidence.length} with a rule or history
              </button>
            </div>
            <div className="flex flex-wrap gap-2 mt-4">
              {(showAllHighConfidence ? highConfidence : highConfidence.slice(0, 5)).map(t => (
                <div key={t.id} className="bg-[var(--ink)] border border-[var(--line)] px-3 py-2 rounded-lg text-xs font-medium text-slate-600 flex items-center gap-2">
                  <span className="truncate max-w-[120px]">{t.description}</span>
                  <span className="font-bold text-[var(--text)] tabular-nums">{formatCurrency(t.totalAmountCents)}</span>
                  <span className="text-green-700 bg-green-50 px-1.5 py-0.5 rounded text-[10px]">{t.reason.text}</span>
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
                  <h2 className="font-bold text-[var(--text)] text-lg">Check these guesses ({mediumConfidence.length})</h2>
                  <p className="text-sm text-[var(--muted)]">An account is filled in, but no rule or history backs it. Accept each, or all.</p>
                </div>
              </div>
              <button 
                onClick={handleBatchConfirm}
                className="bg-[#0047AB] hover:bg-blue-800 text-white px-5 py-2.5 rounded-xl font-bold text-sm transition-colors shadow-sm flex items-center gap-2"
               aria-label="Accept these guesses">
                <CheckSquare size={16} />
                Accept these {mediumConfidence.length}
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
                      <p className="text-sm font-medium text-[#0047AB] bg-blue-50 px-2 py-0.5 rounded-md">{t.reason.text}</p>
                    </div>
                    {merchantKey(t.payee, t.description) && (
                      <label className="flex items-center gap-1 text-xs text-[var(--muted)]">
                        <input type="checkbox" checked={alwaysFor.has(t.id)} onChange={() => toggleAlways(t.id)} />
                        Always do this for {merchantLabel(merchantKey(t.payee, t.description))}
                      </label>
                    )}
                    <button type="button" onClick={() => inBackground((async () => {
                      const saved = await fileEach([{ id: t.id, accountId: t.reason.accountId }], 'Accepted');
                      if (saved && alwaysFor.has(t.id)) await makeRuleFor(t, t.reason.accountId);
                    })())}
                      aria-label={`Accept ${t.description}: ${t.reason.accountName}`}
                      className="px-2.5 py-1 rounded-lg border border-[var(--line)] text-xs font-semibold hover:border-[#0047AB]">Accept</button>
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
                  <p className="text-sm text-[var(--muted)]">No rule or history yet. Answer one question; a rule can do it next time.</p>
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

const REASON_ORDER: Record<ReviewReason['kind'], number> = { rule: 0, history: 1, guess: 2, none: 3 };

/** The entry's lines with the category line set to `account` (two lines against the bank when it has none). */
function filedLines(tx: Transaction, account: ChartAccount, accounts: readonly ChartAccount[]): Transaction['lines'] | null {
  const lines = tx.lines && tx.lines.length > 0 ? tx.lines.map(l => ({ ...l })) : [];
  if (lines.length === 0) {
    const cash = accounts.find(a => !a.isArchived && resolveAccountRole(a) === 'cash');
    if (!cash || cash.id === account.id) return null;
    const amt = tx.totalAmountCents || 0;
    return [
      { accountId: account.id, accountName: account.name, amountCents: amt, category: account.name },
      { accountId: cash.id, accountName: cash.name, amountCents: -amt },
    ];
  }
  const idx = lines.findIndex(l => !l.accountId || l.accountId === 'uncategorized' || l.accountId === 'unassigned' || lineAmount(l, tx) > 0);
  const at = idx !== -1 ? idx : 0;
  lines[at] = { ...lines[at], accountId: account.id, accountName: account.name, category: account.name };
  return lines;
}
