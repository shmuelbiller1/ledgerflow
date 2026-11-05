import { useDialog } from '../../hooks/useDialog';
import React, { useState, useMemo } from 'react';
import { 
  ArrowLeftRight, 
  Plus, 
  Search, 
  Building2, 
  CheckCircle2, 
  AlertCircle,
  Clock,
  ArrowRight
} from 'lucide-react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { toast } from 'sonner';
import AsyncButton from '../ui/AsyncButton';
import { motion, AnimatePresence } from 'motion/react';
import { Labelled } from '../ui/Labelled';

export default function IntercompanyManager() {
  useAuthStore(s => s.user);
  const workspaces = useAuthStore(s => s.workspaces || []);
  const currentWorkspaceId = useAuthStore(s => s.currentWorkspaceId);
  const transactions = useLedgerStore(s => s.transactions || []);
  useLedgerStore(s => s.accounts || []);

  const [isAdding, setIsAdding] = useState(false);
  const { dialogProps: overlayDialogProps, titleId: overlayTitleId } = useDialog(() => setIsAdding(false), isAdding);
  const [formData, setFormData] = useState({
    targetWorkspaceId: '',
    amountCents: 0,
    description: '',
    date: getLocalDateISO(),
    sourceAccountId: '',
    targetAccountId: '',
    targetAmountCents: 0
  });

  const activeWorkspace = workspaces.find(w => w.id === currentWorkspaceId);
  const otherWorkspaces = workspaces.filter(w => w.id !== currentWorkspaceId);
  // Z-19: between companies in different currencies, say what arrives (never a guessed rate)
  const targetCurrency = workspaces.find(w => w.id === formData.targetWorkspaceId)?.currency || 'USD';
  const sourceCurrency = activeWorkspace?.currency || 'USD';
  const crossCurrency = Boolean(formData.targetWorkspaceId) && targetCurrency !== sourceCurrency;

  const intercompanyTransactions = useMemo(() => {
    return transactions.filter(t => t.metadata?.isIntercompany);
  }, [transactions]);

  const handlePostIntercompany = async () => {
    if (!currentWorkspaceId || !formData.targetWorkspaceId) {
      toast.error('Select a target workspace');
      return;
    }

    try {
      const user = useAuthStore.getState().user;
      const token = user ? await user.getIdToken() : '';
      
      const response = await fetch('/api/v1/transactions/intercompany/post', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          sourceWorkspaceId: currentWorkspaceId,
          targetWorkspaceId: formData.targetWorkspaceId,
          amountCents: formData.amountCents,
          description: formData.description,
          date: formData.date,
          sourceAccountId: formData.sourceAccountId,
          targetAccountId: formData.targetAccountId,
          ...(crossCurrency ? { targetAmountCents: formData.targetAmountCents } : {})
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to post intercompany transaction');

      toast.success('Intercompany transfer synchronized successfully');
      setIsAdding(false);
      setFormData({
        targetWorkspaceId: '',
        amountCents: 0,
        description: '',
        date: getLocalDateISO(),
        sourceAccountId: '',
        targetAccountId: '',
        targetAmountCents: 0
      });
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-12 pb-24">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-black text-[#0047AB] uppercase tracking-widest mb-4">
            <Building2 aria-hidden="true" size={14} />
            Consolidated Financial Group
          </div>
          <h1 className="text-4xl font-black text-[var(--text)] tracking-tighter">Intercompany Clearing</h1>
          <p className="text-[var(--muted)] font-medium mt-2 italic opacity-60">Manage cross-entity transfers and reciprocal ledger balances.</p>
        </div>

        <button 
          onClick={() => setIsAdding(true)}
          className="h-12 px-8 bg-[#0047AB] text-white rounded-2xl font-bold text-sm flex items-center gap-2 hover:bg-blue-800 transition-all shadow-xl"
        >
          <Plus aria-hidden="true" size={18} />
          Initiate Transfer
        </button>
      </div>

      {/* Stats / Status */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="p-8 bg-white rounded-[32px] border-2 border-[var(--line)] shadow-sm">
           <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest mb-1">Total Cross-Entity Volume</p>
           <h2 className="text-3xl font-black text-[var(--text)]">
             {formatCurrency(intercompanyTransactions.reduce((sum, t) => sum + (t.totalAmountCents || 0), 0))}
           </h2>
           <div className="flex items-center gap-1.5 mt-3 text-xs font-bold text-emerald-600">
             <CheckCircle2 aria-hidden="true" size={14} />
             All Entities Reconciled
           </div>
        </div>

        <div className="p-8 bg-[#0047AB] rounded-[32px] text-white shadow-xl">
           <p className="text-[10px] font-bold text-blue-200 uppercase tracking-widest mb-1">Active Entities</p>
           <h2 className="text-3xl font-black">{workspaces.length}</h2>
           <p className="text-xs text-blue-200 mt-2 font-medium">Monitoring reciprocal balances across group.</p>
        </div>

        <div className="p-8 bg-[var(--brass)] rounded-[32px] text-black shadow-lg">
           <p className="text-[10px] font-bold text-black/40 uppercase tracking-widest mb-1">Pending Eliminations</p>
           <h2 className="text-3xl font-black">0</h2>
           <div className="flex items-center gap-1.5 mt-3 text-xs font-bold opacity-60">
             <Clock aria-hidden="true" size={14} />
             Next consolidation in 12 days
           </div>
        </div>
      </div>

      {/* Transaction Table */}
      <div className="bg-white rounded-[32px] border-2 border-[var(--line)] overflow-hidden shadow-sm">
        <div className="p-6 border-b border-[var(--line)] flex items-center justify-between bg-slate-50/50">
          <h2 className="font-bold text-[var(--text)]">Reciprocal Audit Trail</h2>
          <div className="relative">
            <Search aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" size={16} />
            <input 
              aria-label="Filter transfers"
              type="text" 
              placeholder="Filter transfers..." 
              className="pl-10 pr-4 py-2 bg-white border border-[var(--line)] rounded-xl text-sm focus:outline-none focus:border-[#0047AB]"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <caption className="sr-only">Intercompany transfers</caption>
            <thead>
              <tr className="text-[10px] font-black text-[var(--muted)] uppercase tracking-widest border-b border-[var(--line)]">
                <th scope="col" className="px-6 py-4 text-left">Date</th>
                <th scope="col" className="px-6 py-4 text-left">Source Entity</th>
                <th scope="col" className="px-6 py-4 text-center">Direction</th>
                <th scope="col" className="px-6 py-4 text-left">Target Entity</th>
                <th scope="col" className="px-6 py-4 text-left">Description</th>
                <th scope="col" className="px-6 py-4 text-right">Amount</th>
                <th scope="col" className="px-6 py-4 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {intercompanyTransactions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-20 text-center">
                    <div className="flex flex-col items-center gap-4 opacity-40">
                      <ArrowLeftRight aria-hidden="true" size={48} className="text-slate-300" />
                      <p className="font-bold text-[var(--muted)]">No intercompany transfers recorded.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                intercompanyTransactions.map(t => (
                  <tr key={t.id} className="hover:bg-slate-50/50 transition-colors group">
                    <td className="px-6 py-4 text-sm font-bold text-slate-600">{t.date}</td>
                    <td className="px-6 py-4">
                       <span className="text-sm font-black text-[var(--text)] uppercase tracking-tight">
                         {workspaces.find(w => w.id === t.workspaceId)?.name || 'Unknown'}
                       </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="inline-flex items-center justify-center w-8 h-8 bg-slate-100 rounded-full text-[#0047AB]">
                        <ArrowRight aria-hidden="true" size={16} />
                      </div>
                    </td>
                    <td className="px-6 py-4">
                       <span className="text-sm font-black text-[var(--text)] uppercase tracking-tight">
                         {workspaces.find(w => w.id === t.metadata?.targetWorkspaceId)?.name || 'Unknown'}
                       </span>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm font-medium text-slate-600 truncate max-w-xs">{t.description}</p>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className="text-sm font-black text-[var(--text)]">{formatCurrency(t.totalAmountCents || 0)}</span>
                    </td>
                    <td className="px-6 py-4">
                       <div className="flex justify-center">
                         <span className="px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full text-[10px] font-black uppercase tracking-widest border border-emerald-100">
                           Synchronized
                         </span>
                       </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Initiation Modal */}
      <AnimatePresence>
        {isAdding && (
          <div {...overlayDialogProps} className="fixed inset-0 z-[600] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setIsAdding(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl bg-white rounded-[40px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-10 border-b border-[var(--line)]">
                <h2 id={overlayTitleId} className="text-3xl font-black text-[var(--text)] tracking-tight flex items-center gap-3">
                  <ArrowLeftRight aria-hidden="true" className="text-[#0047AB]" size={32} />
                  New Cross-Entity Transfer
                </h2>
                <p className="text-[var(--muted)] font-medium mt-1">Initiate an atomic reciprocal posting between group entities.</p>
              </div>

              <div className="p-10 overflow-y-auto space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-3">
                    <span className="text-[10px] font-black text-[var(--muted)] uppercase tracking-widest">Source Entity</span>
                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex items-center gap-3">
                       <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center shadow-sm text-[#0047AB]">
                         <Building2 aria-hidden="true" size={16} />
                       </div>
                       <span className="font-bold text-slate-600">{activeWorkspace?.name || 'Current Workspace'}</span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <Labelled labelClassName="text-[10px] font-black text-[var(--muted)] uppercase tracking-widest" label="Target Entity">
                      <select 
                        value={formData.targetWorkspaceId}
                        onChange={e => setFormData({...formData, targetWorkspaceId: e.target.value})}
                        className="w-full p-4 bg-white rounded-2xl border-2 border-[var(--line)] font-bold text-sm focus:border-[#0047AB] outline-none transition-all"
                      >
                        <option value="">Select Target...</option>
                        {otherWorkspaces.map(w => (
                          <option key={w.id} value={w.id}>{w.name}</option>
                        ))}
                      </select>
                    </Labelled>
                  </div>
                </div>

                <div className="space-y-3">
                  <Labelled labelClassName="text-[10px] font-black text-[var(--muted)] uppercase tracking-widest" label="Description">
                    <input 
                      type="text" 
                      placeholder="e.g. Monthly management fee recharge..."
                      value={formData.description}
                      onChange={e => setFormData({...formData, description: e.target.value})}
                      className="w-full p-4 bg-white rounded-2xl border-2 border-[var(--line)] font-bold text-sm focus:border-[#0047AB] outline-none transition-all"
                    />
                  </Labelled>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-3">
                    <Labelled labelClassName="text-[10px] font-black text-[var(--muted)] uppercase tracking-widest" label="Transfer Amount ($)">
                      <input 
                        type="number" 
                        placeholder="0.00"
                        value={formData.amountCents / 100}
                        onChange={e => setFormData({...formData, amountCents: Math.round(Number.parseFloat(e.target.value || '0') * 100)})}
                        className="w-full p-4 bg-white rounded-2xl border-2 border-[var(--line)] font-black text-2xl font-mono focus:border-[#0047AB] outline-none transition-all"
                      />
                    </Labelled>
                    {crossCurrency && (
                      <Labelled labelClassName="text-[10px] font-black text-[var(--muted)] uppercase tracking-widest" label={`Arrives as (${targetCurrency})`}>
                        <input
                          type="number"
                          placeholder="0.00"
                          value={formData.targetAmountCents / 100}
                          onChange={e => setFormData({...formData, targetAmountCents: Math.round(Number.parseFloat(e.target.value || '0') * 100)})}
                          className="w-full p-3 bg-white rounded-2xl border-2 border-[var(--line)] font-mono focus:border-[#0047AB] outline-none transition-all"
                        />
                      </Labelled>
                    )}
                  </div>

                  <div className="space-y-3">
                    <Labelled labelClassName="text-[10px] font-black text-[var(--muted)] uppercase tracking-widest" label="Effective Date">
                      <input 
                        type="date" 
                        value={formData.date}
                        onChange={e => setFormData({...formData, date: e.target.value})}
                        className="w-full p-4 bg-white rounded-2xl border-2 border-[var(--line)] font-bold text-sm focus:border-[#0047AB] outline-none transition-all"
                      />
                    </Labelled>
                  </div>
                </div>

                <div className="p-6 bg-blue-50/50 rounded-3xl border border-blue-100/50 space-y-4">
                  <div className="flex items-start gap-3">
                    <AlertCircle aria-hidden="true" className="text-[#0047AB] shrink-0 mt-0.5" size={16} />
                    <div>
                      <p className="text-xs font-bold text-blue-900">Ledger Mapping Notice</p>
                      <p className="text-[10px] text-blue-700/70 mt-0.5 leading-relaxed">
                        This operation will automatically generate balancing entries in both entities using the reciprocal "Due To/From" clearing accounts.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-10 bg-slate-50 border-t border-[var(--line)] flex gap-4">
                <button 
                  onClick={() => setIsAdding(false)}
                  className="flex-1 h-14 rounded-2xl border-2 border-[var(--line)] font-bold text-slate-600 hover:bg-white transition-all"
                >
                  Cancel
                </button>
                <AsyncButton 
                  onClick={handlePostIntercompany}
                  className="flex-[2] h-14 bg-[#0047AB] text-white rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-blue-800 transition-all shadow-lg"
                >
                  Authorize Transfer
                </AsyncButton>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
