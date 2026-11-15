import { runCommand } from '../../lib/runCommand';
import React, { useState, useMemo } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { 
  Calendar, 
  Lock, 
  Unlock, 
  CheckCircle2, 
  AlertTriangle, 
  ArrowRight,
  ShieldCheck,
  History,
  Settings2,
  FileText
} from 'lucide-react';
import { toast } from 'sonner';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { cn, formatCurrency } from '../../lib/utils';
import { useUIStore } from '../../stores/useUIStore';
import { monthCloseState } from '../../lib/periodLock';
import { isPostable, calculateTransactionImpact, lineAmount, isRevenueAccount, isExpenseAccount } from '../../lib/txFilters';
import { useServerActivity } from '../../hooks/useServerActivity';
import { countActivity, sumActivity } from '../../lib/periodActivity';

export default function FiscalPeriodManager() {
  const currentWorkspaceId = useAuthStore(s => s.currentWorkspaceId);
  const workspaces = useAuthStore(s => s.workspaces);
  const setWorkspaces = useAuthStore(s => s.setWorkspaces);
  const setActiveTab = useUIStore(s => s.setActiveTab);
  const workspace = workspaces.find(w => w.id === currentWorkspaceId);
  
  const transactions = useLedgerStore(s => s.transactions);
  const accounts = useLedgerStore(s => s.accounts);
  const lockDate = useLedgerStore(s => s.lockDate);

  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);

  // Derive periods for the last 12 months + current
  const periods = useMemo(() => {
    const list = [];
    let curr = startOfMonth(new Date());
    for (let i = 0; i < 18; i++) {
      const pId = format(curr, 'yyyy-MM');
      // Closed (soft or hard) under the workspace's lock dates (src/lib/periodLock.ts)
      const isLocked = monthCloseState(pId, workspace) !== 'open';
      list.push({
        id: pId,
        label: format(curr, 'MMMM yyyy'),
        startDate: format(startOfMonth(curr), 'yyyy-MM-dd'),
        endDate: format(endOfMonth(curr), 'yyyy-MM-dd'),
        isLocked
      });
      curr = subMonths(curr, 1);
    }
    return list;
  }, [workspace]);

  // Closing goes through the server (role check, drafts check, audit log): periodCloseService.ts
  const closeMonth = async (month: string) => {
    if (!currentWorkspaceId) return;
    setIsProcessing(true);
    try {
      const data = await runCommand<{ lockDate?: string; softLockDate?: string }>({
        path: `/api/v1/workspaces/${encodeURIComponent(currentWorkspaceId)}/periods/${month}/close`,
        method: 'POST',
        body: { mode: 'hard' },
      });
      setWorkspaces(workspaces.map(w => (w.id === currentWorkspaceId ? { ...w, lockDate: data.lockDate, softLockDate: data.softLockDate } : w)));
      toast.success(`${month} closed`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The period could not be closed');
    } finally {
      setIsProcessing(false);
    }
  };

  // L-123 step 3e: when the loaded entries are capped, a month they may miss is audited from the server's sums
  const { activity, serverMonths } = useServerActivity(periods[periods.length - 1]?.startDate || '', periods[0]?.endDate || '');

  const runPeriodAudit = (period: { id: string; startDate: string; endDate: string; label: string; isLocked: boolean }) => {
    if (serverMonths) {
      const accountMap = new Map(accounts.map(a => [a.id, a]));
      const profitLine = (id: string) => { const a = accountMap.get(id); return isRevenueAccount(a) || isExpenseAccount(a); };
      const { entries, unbalanced } = countActivity(activity, period.id, period.id);
      // calculateTransactionImpact: minus each revenue and expense line
      const netImpact = -sumActivity(activity, period.id, period.id, profitLine, a => a.net);
      return { txCount: entries, netImpact, isBalanced: unbalanced === 0, unbalancedCount: unbalanced };
    }
    const periodTxs = transactions.filter(t => 
      isPostable(t) && 
      t.date >= period.startDate && 
      t.date <= period.endDate
    );

    const accountMap = new Map(accounts.map(a => [a.id, a]));
    const totalImpact = periodTxs.reduce((sum, t) => sum + calculateTransactionImpact(t, accountMap), 0);
    
    // Check for unbalanced JEs in this period
    const unbalanced = periodTxs.filter(t => {
      const sum = (t.lines || []).reduce((s, l) => s + lineAmount(l, t), 0);
      return Math.abs(sum) > 0;
    });

    return {
      txCount: periodTxs.length,
      netImpact: totalImpact,
      isBalanced: unbalanced.length === 0,
      unbalancedCount: unbalanced.length
    };
  };

  const handleClosePeriod = async (period: { id: string; startDate: string; endDate: string; label: string; isLocked: boolean }) => {
    const audit = runPeriodAudit(period);
    
    if (!audit.isBalanced) {
      toast.error(`Cannot close period: Found ${audit.unbalancedCount} unbalanced transactions.`);
      return;
    }

    if (audit.txCount === 0) {
      toast.warning("Closing an empty period. No transactions found.");
    }

    await closeMonth(period.id);
    setSelectedPeriod(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-[var(--color-ledger-line)] shadow-xs">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2.5">
            <Lock className="w-5 h-5 text-indigo-600" />
            Fiscal Periods & Hard Close
          </h1>
          <p className="text-xs text-[var(--muted)] mt-1">
            Manage accounting periods and enforce immutable record locking for finalized cycles.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 rounded-xl border border-slate-200">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-tight">Active Lock Date:</span>
            <span className="text-xs font-mono font-bold text-slate-900">{lockDate || 'NONE'}</span>
          </div>
          {lockDate && (
            <button 
              onClick={() => setActiveTab('month-end-close')}
              disabled={isProcessing}
              className="p-2 bg-rose-50 text-rose-600 hover:bg-rose-100 rounded-xl transition-colors cursor-pointer"
              title="Reopen a period (Month-End Close, with a reason)"
              aria-label="Reopen a period in Month-End Close"
            >
              <Unlock className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Period List */}
        <div className="lg:col-span-2 space-y-3">
          <h2 className="text-sm font-bold text-slate-900 px-1">Accounting Cycles</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {periods.map(p => (
              <div 
                key={p.id}
                role="presentation" onClick={() => setSelectedPeriod(p.id)}
                className={cn(
                  "p-4 rounded-2xl border transition-all cursor-pointer group relative overflow-hidden",
                  p.isLocked 
                    ? "bg-slate-50 border-slate-200 opacity-80" 
                    : "bg-white border-slate-200 hover:border-indigo-400 hover:shadow-md",
                  selectedPeriod === p.id && "ring-2 ring-indigo-500 border-transparent shadow-lg"
                )}
              >
                <button type="button" aria-pressed={selectedPeriod === p.id} className="w-full text-left flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className={cn(
                      "p-2 rounded-lg",
                      p.isLocked ? "bg-slate-200 text-[var(--muted)]" : "bg-indigo-50 text-indigo-600"
                    )}>
                      <Calendar className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-900">{p.label}</p>
                      <p className="text-[10px] text-[var(--muted)] font-medium uppercase tracking-wider">
                        {p.startDate} — {p.endDate}
                      </p>
                    </div>
                  </div>
                  {p.isLocked ? (
                    <Lock className="w-3.5 h-3.5 text-[var(--muted)]" />
                  ) : (
                    <div className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
                  )}
                </button>

                <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                  <span className={cn(
                    "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase",
                    p.isLocked ? "bg-slate-200 text-slate-600" : "bg-emerald-100 text-emerald-700"
                  )}>
                    {p.isLocked ? 'Closed' : 'Open Cycle'}
                  </span>
                  
                  {!p.isLocked && (
                    <button type="button" onClick={() => setSelectedPeriod(p.id)} className="min-h-11 text-[10px] font-bold text-indigo-600 flex items-center gap-1">
                      Review period <ArrowRight className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Audit & Action Sidebar */}
        <div className="space-y-4">
          <div className="bg-white p-6 rounded-3xl border border-[var(--color-ledger-line)] shadow-xs sticky top-6">
            <h2 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
              <History className="w-4 h-4 text-[var(--muted)]" />
              Period Closing Audit
            </h2>

            {selectedPeriod ? (
              <div className="space-y-6">
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
                  <p className="text-xs font-bold text-[var(--muted)] uppercase">Target: {periods.find(p => p.id === selectedPeriod)?.label}</p>
                  
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-600">Total Transactions</span>
                      <span className="text-xs font-mono font-bold">{runPeriodAudit(periods.find(p => p.id === selectedPeriod)!).txCount}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-600">Net Period Impact</span>
                      <span className={cn(
                        "text-xs font-mono font-bold",
                        runPeriodAudit(periods.find(p => p.id === selectedPeriod)!).netImpact >= 0 ? "text-emerald-600" : "text-rose-600"
                      )}>
                        {formatCurrency(runPeriodAudit(periods.find(p => p.id === selectedPeriod)!).netImpact)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                      <span className="text-xs font-bold text-slate-900">Integrity Check</span>
                      {runPeriodAudit(periods.find(p => p.id === selectedPeriod)!).isBalanced ? (
                        <div className="flex items-center gap-1 text-emerald-600">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span className="text-[10px] font-bold uppercase">Balanced</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-rose-600">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span className="text-[10px] font-bold uppercase">Unbalanced</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <button 
                    disabled={isProcessing || periods.find(p => p.id === selectedPeriod)?.isLocked}
                    onClick={() => handleClosePeriod(periods.find(p => p.id === selectedPeriod)!)}
                    className="w-full py-3 bg-slate-900 hover:bg-black disabled:bg-slate-300 text-white text-xs font-bold rounded-xl transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    Hard Close Period
                  </button>
                  <p className="text-[10px] text-center text-[var(--muted)] italic px-2">
                    Closing a period prevents any future modifications or deletions of transactions within this cycle.
                  </p>
                </div>
              </div>
            ) : (
              <div className="py-12 text-center text-[var(--muted)]">
                <Settings2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-xs font-medium">Select a period to run audit and initiate closing.</p>
              </div>
            )}
          </div>

          <div className="bg-indigo-600 p-6 rounded-3xl text-white shadow-lg relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
              <FileText className="w-24 h-24 rotate-12" />
            </div>
            <h3 className="text-sm font-bold mb-2 relative z-10">Year-End Close</h3>
            <p className="text-xs text-indigo-100 mb-4 relative z-10 leading-relaxed">
              Review closing checks in the closing workspace. This button does not close a year or post an entry.
            </p>
            <button type="button" onClick={() => setActiveTab('month-end-close')} className="w-full min-h-11 py-2 bg-white/10 hover:bg-white/20 text-white text-[10px] font-bold rounded-lg border border-white/20 transition-all cursor-pointer relative z-10">
              Open closing workspace
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
