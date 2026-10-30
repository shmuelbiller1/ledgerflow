import { RecordInlineField } from '../ui/RecordInlineField';
import { useDialog } from '../../hooks/useDialog';
import { isPostable, lineAmount } from '../../lib/txFilters';
import type { Budget } from '../../types';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { TruthEngine } from '../../modules/integrity/TruthEngine';
import React, { useState, useMemo, useId } from 'react';
import { 
  Target, 
  Plus, 
  Trash2, 
  Edit2,
  AlertCircle,
  DollarSign,
  Activity,
  ShieldCheck,
  Zap,
  ArrowUpRight,
  Layers
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatCurrency, getLocalDateISO, safeConfirm } from '../../lib/utils';
import { addDoc, collection, deleteDoc, doc, updateDoc } from '../../lib/db/firestore';
import { db } from '../../firebase';
import { toast } from 'sonner';
import AsyncButton from '../ui/AsyncButton';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { Labelled } from '../ui/Labelled';
import BudgetControlSetting from './BudgetControlSetting';
import { EmptyState } from '../ui/EmptyState';
import { LoadingState } from '../ui/LoadingState';



export default function BudgetManager() {
  const formId = useId();
  const user = useAuthStore((s) => s.user);
  const isGuest = useAuthStore((s) => s.isGuest);
  // the open workspace lives in the auth store (reading it from the ledger store always gave nothing)
  const currentWorkspaceId = useAuthStore(s => s.currentWorkspaceId);
  const budgets = useLedgerStore((s) => s.budgets);
  const setBudgets = useLedgerStore((s) => s.setBudgets);
  const transactions = useLedgerStore((s) => s.transactions);
  const accounts = useLedgerStore((s) => s.accounts);
  const { loading } = useLedgerCollections('budgets');
  // A signed-in viewer reads budgets; adding or editing one is a write (CodeRabbit #440).
  // A guest owns their local sandbox, so guests keep the write affordances exactly as before
  // (useCurrentRole resolves a guest to 'viewer' — there is no workspace row to read a role from).
  const budgetRole = useCurrentRole();
  const canWriteBudget = isGuest || budgetRole !== 'viewer';
  const [isAdding, setIsAdding] = useState(false);
  const { dialogProps: overlayDialogProps, titleId: overlayTitleId } = useDialog(() => setIsAdding(false), isAdding);
  const [editingBudget, setEditingBudget] = useState<string | null>(null);
  const [newBudget, setNewBudget] = useState({
    targetId: '',
    targetType: 'account' as const,
    amountCents: 0,
    period: 'monthly',
    startDate: getLocalDateISO()
  });

  const handleAddBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWriteBudget) {
      toast.error('Viewers cannot change budgets');
      return;
    }
    const workspaceId = currentWorkspaceId || (isGuest ? 'default' : null);
    if (!workspaceId) {
      toast.error('Workspace context missing');
      return;
    }
    try {
      if (isGuest || !user) {
        if (editingBudget) {
          setBudgets(budgets.map(b => b.id === editingBudget ? {
            ...b,
            targetId: newBudget.targetId,
            amountCents: newBudget.amountCents,
            period: newBudget.period as Budget['period'],
          } : b));
          toast.success('Objective Updated');
        } else {
          setBudgets([
            ...budgets,
            {
              id: `b_${Date.now()}`,
              workspaceId,
              uid: user?.uid || 'guest',
              targetId: newBudget.targetId,
              targetType: newBudget.targetType,
              amountCents: newBudget.amountCents,
              period: newBudget.period as Budget['period'],
              createdAt: new Date().toISOString(),
            } as Budget,
          ]);
          toast.success('Objective Synchronized');
        }
      } else if (editingBudget) {
        await updateDoc(doc(db, 'budgets', editingBudget), {
          targetId: newBudget.targetId,
          amountCents: newBudget.amountCents,
          period: newBudget.period,
          startDate: newBudget.startDate || getLocalDateISO(),
          updatedAt: new Date().toISOString()
        });
        toast.success('Objective Updated');
      } else {
        await addDoc(collection(db, 'budgets'), {
          ...newBudget,
          workspaceId,
          uid: user?.uid || "",
          createdAt: new Date().toISOString()
        });
        toast.success('Objective Synchronized');
      }
      setIsAdding(false);
      setEditingBudget(null);
      setNewBudget({
        targetId: '',
        targetType: 'account',
        amountCents: 0,
        period: 'monthly',
        startDate: getLocalDateISO()
      });
    } catch {
      toast.error('Could not save budget objective. Please try again.');
    }
  };

  const budgetAnalysis = useMemo(() => {
    return budgets.map((budget: Budget & { startDate?: string }) => {
      const targetLower = (budget.targetId || '').toLowerCase();
      // Find matching account ID or name
      const matchingAccount = accounts.find((a) =>
        a.id === budget.targetId || 
        (a.name || '').toLowerCase() === targetLower || 
        (a.code || '').toLowerCase() === targetLower
      );

      const actualCents = (transactions || []).filter(isPostable).reduce((sum: number, t) => {
        const lines = t.lines?.filter((l) =>
          l.accountId === budget.targetId || 
          (matchingAccount && l.accountId === matchingAccount.id) ||
          (l.accountName || '').toLowerCase() === targetLower
        ) || [];
        return sum + lines.reduce((s: number, l) => s + Math.max(0, lineAmount(l, t) || 0), 0);
      }, 0);
      
      const variance = budget.amountCents - actualCents;
      const percentUsed = budget.amountCents > 0 ? (actualCents / budget.amountCents) * 100 : 0;

      return {
        ...budget,
        actualCents,
        variance,
        percentUsed
      };
    });
  }, [budgets, transactions, accounts]);

  return (
    <div className="space-y-12">
      {/* Rule Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-black text-indigo-600 uppercase tracking-widest truncate mb-4">
            <Target aria-hidden="true" size={14} />
            Resource Allocation Matrix
          </div>
          <h1 className="text-3xl md:text-5xl font-black text-[var(--text)] tracking-tighter">Budget Protocol</h1>
          <p className="text-[var(--muted)] font-medium text-lg mt-2 italic opacity-60">Strategic variance analysis and predictive consumption monitoring.</p>
          <BudgetControlSetting />
        </div>

        {canWriteBudget && (
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-3 px-8 py-4 bg-slate-900 text-white rounded-[32px] text-xs font-medium uppercase tracking-wider hover:bg-slate-900/90 transition-all shadow-2xl"
          >
            <Plus aria-hidden="true" size={18} />
            Define Target
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {budgetAnalysis.map((b) => {
          const isOver = b.percentUsed > 100;
          const isWarning = b.percentUsed > 85 && b.percentUsed <= 100;

          return (
            <motion.div 
              key={b.id}
              whileHover={{ y: -5 }}
              className="ledger-card p-4 md:p-8 rounded-[32px] relative overflow-hidden group border border-[var(--line)] hover:border-indigo-600/20 transition-all"
            >
              <div className="absolute technical-grid inset-0 opacity-5 pointer-events-none" />
              
              <div className="flex items-center justify-between mb-8 relative z-10">
                <div className="w-14 h-14 bg-slate-900 rounded-[32px] flex items-center justify-center text-white border border-white/5 shadow-2xl">
                  <Activity aria-hidden="true" size={28} />
                </div>
                <div className="flex items-center gap-2">
                  {isOver ? (
                    <div className="px-4 py-1.5 bg-rose-50 text-rose-700 border border-rose-200 rounded-xl text-[9px] font-medium uppercase tracking-wider flex items-center gap-2">
                      <AlertCircle aria-hidden="true" size={12} />
                      Critical Limit
                    </div>
                  ) : isWarning ? (
                    <div className="px-4 py-1.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-xl text-[9px] font-medium uppercase tracking-wider flex items-center gap-2">
                      <Zap aria-hidden="true" size={12} />
                      Warning Alert
                    </div>
                  ) : (
                    <div className="px-4 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl text-[9px] font-medium uppercase tracking-wider flex items-center gap-2">
                      <ShieldCheck aria-hidden="true" size={12} />
                      Stable Allocation
                    </div>
                  )}
                  {canWriteBudget && (<>
                  <button 
                    aria-label={`Edit budget for ${b.targetId}`}
                    onClick={() => {
                      setNewBudget({
                        targetId: b.targetId,
                        targetType: b.targetType as 'account',
                        amountCents: b.amountCents,
                        period: b.period,
                        startDate: b.startDate || getLocalDateISO()
                      });
                      setEditingBudget(b.id);
                      setIsAdding(true);
                    }}
                    className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg p-2 text-[var(--muted)] hover:text-indigo-600 transition-colors opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
                  >
                    <Edit2 aria-hidden="true" size={16} />
                  </button>
                  <button 
                    aria-label={`Delete budget for ${b.targetId}`}
                    onClick={async () => {
                      // the button is hidden from viewers; refuse defensively too (CodeRabbit #440)
                      if (!canWriteBudget) {
                        toast.error('Viewers cannot change budgets');
                        return;
                      }
                      if (await safeConfirm('Delete budget?')) {
                        if (isGuest || !user) {
                          setBudgets(budgets.filter(item => item.id !== b.id));
                        } else {
                          await deleteDoc(doc(db, 'budgets', b.id));
                        }
                        toast.success('Budget deleted');
                      }
                    }}
                    className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg p-2 text-[var(--muted)] hover:text-rose-500 transition-colors opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
                  >
                    <Trash2 aria-hidden="true" size={16} />
                  </button>
                  </>)}
                </div>
              </div>

              <div className="space-y-2 relative z-10">
                 <h2 className="text-2xl font-black text-[var(--text)] tracking-tight uppercase italic truncate"><RecordInlineField collection="budgets" record={b} field="name" label={`Name of budget ${b.targetId}`} placeholder={b.targetId} /></h2>
                 <p className="text-[10px] font-black text-[var(--muted)] uppercase tracking-[0.2em] opacity-40">{b.period} Allocation</p>
              </div>

              <div className="mt-8 space-y-6 relative z-10">
                <div className="flex justify-between items-end">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black text-[var(--muted)] uppercase tracking-widest opacity-50 mb-1">Consumption Flow</span>
                    <span className="text-2xl font-black text-[var(--text)] font-mono tracking-tighter tabular-nums">{formatCurrency(b.actualCents)}</span>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-[10px] font-black text-[var(--muted)] uppercase tracking-widest opacity-50 mb-1">Cap Magnitude</span>
                    <span className="text-sm font-bold text-[var(--muted)] font-mono tabular-nums"><RecordInlineField collection="budgets" record={b} field="amountCents" kind="money" display={formatCurrency(b.amountCents)} label={`Amount of budget ${b.targetId}`} /></span>
                  </div>
                </div>

                <div className="relative h-4 bg-[var(--ink)] rounded-full overflow-hidden border border-[var(--line)]">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(b.percentUsed, 100)}%` }}
                    transition={{ duration: 1, ease: "easeOut" }}
                    className={cn(
                      "absolute inset-y-0 left-0 transition-colors",
                      isOver ? "bg-rose-500 shadow-[0_0_15px_#f43f5e]" : 
                      isWarning ? "bg-amber-500 shadow-[0_0_15px_#f59e0b]" : 
                      "bg-indigo-600 shadow-[0_0_15px_#10b981]"
                    )}
                  />
                </div>

                <div className="flex justify-between items-center text-[10px] font-medium uppercase tracking-wider">
                  <span className={cn(
                    isOver ? "text-rose-600" : isWarning ? "text-amber-600" : "text-emerald-600"
                  )}>
                    {b.percentUsed.toFixed(1)}% Capacity Utilization
                  </span>
                  <span className="text-[var(--muted)] opacity-40 tabular-nums">
                    {b.variance > 0 ? `Forensic Buffer: ${formatCurrency(b.variance)}` : 'Cap Threshold Breached'}
                  </span>
                </div>
              </div>

              <div className="mt-8 pt-6 border-t border-[var(--line)] flex justify-between items-center relative z-10">
                 <div className="flex items-center gap-2">
                    <Layers aria-hidden="true" size={14} className="text-[var(--muted)] opacity-30" />
                    <span className="text-[9px] font-black text-[var(--muted)] uppercase tracking-widest opacity-30">Analytical Snapshot Matrix</span>
                 </div>
                 {canWriteBudget && <button 
                   onClick={() => {
                     setNewBudget({
                       targetId: b.targetId,
                       targetType: b.targetType as 'account',
                       amountCents: b.amountCents,
                       period: b.period,
                       startDate: b.startDate || getLocalDateISO()
                     });
                     setEditingBudget(b.id);
                     setIsAdding(true);
                   }}
                   className="w-10 h-10 bg-[var(--ink)] rounded-xl flex items-center justify-center text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] transition-all border border-[var(--line)] group-hover:scale-110" 
                   aria-label="Edit budget objective"
                 >
                    <ArrowUpRight aria-hidden="true" size={18} />
                 </button>}
              </div>
            </motion.div>
          );
        })}

        {budgets.length === 0 && (
          <div className="col-span-full">
            {loading ? <LoadingState what="budgets" /> : (
              <EmptyState
                title="No budgets yet"
                description="A budget sets what an account or a project may spend in a month; Budget vs Actual then compares it with what happened."
                actionLabel={canWriteBudget ? 'Add your first budget' : undefined}
                onAction={canWriteBudget ? () => setIsAdding(true) : undefined}
              />
            )}
          </div>
        )}
      </div>

      {/* Add Budget Modal */}
      <AnimatePresence>
        {isAdding && (
          <div {...overlayDialogProps} className="fixed inset-0 z-[500] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAdding(false)}
              className="absolute inset-0 bg-slate-900/80 backdrop-blur-xl"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 30 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 30 }}
              className="relative w-full max-w-xl bg-[var(--ink)] rounded-[32px] shadow-2xl border border-[var(--line)] overflow-hidden p-12"
            >
              <div className="flex items-center justify-between mb-10">
                 <div>
                    <h2 id={overlayTitleId} className="text-2xl md:text-4xl font-black text-[var(--text)] tracking-tight uppercase italic">Define Objective</h2>
                    <p className="text-[10px] font-black text-[var(--muted)] uppercase tracking-[0.3em] mt-1 opacity-50">Operational Resource Allocation</p>
                 </div>
                 <button onClick={() => setIsAdding(false)} aria-label="Close budget dialog" className="w-12 h-12 bg-[var(--ink)] rounded-[32px] flex items-center justify-center text-[var(--muted)] hover:text-[var(--text)] transition-all rotate-45 border border-[var(--line)]">
                    <Plus aria-hidden="true" size={24} />
                 </button>
              </div>

              <form onSubmit={handleAddBudget} className="space-y-8">
                <div className="space-y-2">
                  <label htmlFor={`${formId}-account`} className="block text-[10px] font-black text-[var(--muted)] uppercase tracking-widest truncate opacity-50">Rule Mapping (Account)</label>
                  <div className="relative w-full">
                    <input 
                      id={`${formId}-account`}
                      list={`${formId}-account-list`}
                      required
                      value={newBudget.targetId}
                      onChange={(e) => setNewBudget({ ...newBudget, targetId: e.target.value })}
                      placeholder="Select Protocol Node..."
                      className="w-full px-8 py-5 bg-[var(--surface)] border border-[var(--line)] rounded-[32px] focus:outline-none focus:ring-4 focus:ring-indigo-600/10 focus:border-indigo-600 transition-all font-black text-[var(--text)] uppercase tracking-widest"
                    />
                    <datalist id={`${formId}-account-list`}>
                      {accounts.map((acc) => (
                        <option key={acc.id} value={acc.name}>{acc.code}</option>
                      ))}
                    </datalist>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-8">
                  <div className="space-y-2">
                    <label htmlFor={`${formId}-amount`} className="block text-[10px] font-black text-[var(--muted)] uppercase tracking-widest truncate opacity-50">Target Magnitude ($)</label>
                    <div className="relative">
                      <DollarSign aria-hidden="true" className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-500/30" size={16} />
                      <input 
                        id={`${formId}-amount`}
                        type="number" 
                        step="0.01"
                        required
                        value={newBudget.amountCents / 100}
                        onChange={(e) => setNewBudget({ ...newBudget, amountCents: TruthEngine.parseAmountToCents(e.target.value || '0') })}
                        className="w-full pl-12 pr-8 py-5 bg-[var(--surface)] border border-[var(--line)] rounded-[32px] focus:outline-none focus:ring-4 focus:ring-indigo-600/10 focus:border-indigo-600 transition-all font-mono font-black text-[var(--text)] text-right text-xl"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Labelled labelClassName="block text-[10px] font-black text-[var(--muted)] uppercase tracking-widest truncate opacity-50" label="Velocity Period">
                      <select 
                        value={newBudget.period}
                        onChange={(e) => setNewBudget({ ...newBudget, period: e.target.value })}
                        className="w-full px-8 py-5 bg-[var(--surface)] border border-[var(--line)] rounded-[32px] focus:outline-none focus:ring-4 focus:ring-indigo-600/10 focus:border-indigo-600 transition-all font-black text-[var(--text)] appearance-none cursor-pointer uppercase tracking-widest"
                      >
                        <option value="monthly">Monthly Cycle</option>
                        <option value="quarterly">Quarterly Cycle</option>
                        <option value="yearly">Yearly Cycle</option>
                      </select>
                    </Labelled>
                  </div>
                </div>

                <div className="pt-6 flex gap-6">
                  <button 
                    type="button"
                    onClick={() => setIsAdding(false)}
                    className="flex-1 py-5 bg-[var(--ink)] text-[var(--muted)] opacity-60 rounded-[32px] text-xs font-black uppercase tracking-[0.3em] hover:opacity-100 transition-all"
                  >
                    Abort
                  </button>
                  <AsyncButton 
                    type="submit"
                    loadingText="Saving..."
                    className="flex-[2] py-5 bg-slate-900 text-white rounded-[32px] text-xs font-black uppercase tracking-[0.3em] hover:translate-y-[-2px] transition-all shadow-2xl"
                  >
                    Confirm Allocation
                  </AsyncButton>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
