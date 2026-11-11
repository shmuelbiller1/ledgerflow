import { useDialog } from '../../hooks/useDialog';
import { isTransactionInDateRange, isPostable, lineAmount } from '../../lib/txFilters';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { TruthEngine } from '../../modules/integrity/TruthEngine';
import React,
 { useState, useMemo } from 'react';
import { ChartAccount } from '../../types';
import { motion, AnimatePresence } from 'motion/react';
import { 
  RefreshCw, 
  CheckCircle2, 
  AlertCircle,
  X,
  ChevronRight,
  ChevronLeft,
  Search,
  CheckSquare,
  Sparkles
} from 'lucide-react';
import { cn, formatDate } from '../../lib/utils';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { Labelled } from '../ui/Labelled';

/** What a finished reconciliation reports back (saved by the Ledger screen). */
export interface ReconciliationResult {
  accountId?: string;
  accountName: string;
  statementDate: string;
  statementBalanceCents: number;
  reconciledIds: string[];
  timestamp: string;
}

interface ReconciliationWizardProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: ChartAccount[];
  onComplete: (data: ReconciliationResult) => Promise<void> | void;
  formatCurrency: (val: number) => string;
}

export default function ReconciliationWizard({ isOpen, onClose, accounts, onComplete, formatCurrency }: ReconciliationWizardProps) {
  const { dialogProps: overlayDialogProps, titleId: overlayTitleId } = useDialog(onClose, isOpen);
  const transactions = useLedgerStore(state => state.transactions || []);
  const reconciliations = useLedgerStore(state => state.reconciliations || []);
  useLedgerCollections('reconciliations');
  
  const [step, setStep] = useState(1);
  const [selectedAccount, setSelectedAccount] = useState<string>('');
  const [statementDate, setStatementDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [endingBalance, setEndingBalance] = useState<string>('0');
  const [reconciledIds, setReconciledIds] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [, setIsFinalizing] = useState(false);

  const account = useMemo(() => accounts.find(a => a.name === selectedAccount || a.id === selectedAccount), [accounts, selectedAccount]);
  
  const lastReconciliation = useMemo(() => {
    if (!account) return null;
    const list = (reconciliations || []).filter(r => r.accountId === account.id || r.accountName === account.name);
    list.sort((a, b) => (b.statementDate || '').localeCompare(a.statementDate || ''));
    return list[0] || null;
  }, [reconciliations, account]);

  const beginningBalance = useMemo(() => {
    if (lastReconciliation && typeof lastReconciliation.statementBalanceCents === 'number') {
      return lastReconciliation.statementBalanceCents;
    }
    return account?.openingBalanceCents || account?.balanceCents || 0;
  }, [lastReconciliation, account]);

  const safeParseCents = (val: string): number => {
    if (!val || !val.trim()) return 0;
    try {
      let clean = val.trim();
      if (clean.startsWith('(') && clean.endsWith(')')) {
        clean = '-' + clean.slice(1, -1);
      }
      clean = clean.replace(/[$,]/g, '');
      return TruthEngine.parseAmountToCents(clean || '0');
    } catch {
      return 0;
    }
  };

  const filteredTransactions = useMemo(() => {
    if (!selectedAccount || !account) return [];
    return (transactions || []).filter(t => 
      isPostable(t) &&
      t.status !== 'reconciled' &&
      !t.reconciled &&
      !t.isReconciled &&
      !t.clearedAt &&
      isTransactionInDateRange(t, undefined, statementDate) &&
      t.lines?.some(l => l.accountId === account.id || l.accountName === account.name) && 
      (t.description.toLowerCase().includes(searchTerm.toLowerCase()) || t.totalAmountCents.toString().includes(searchTerm))
    ).map(t => {
      const matchLine = t.lines?.find(l => l.accountId === account.id || l.accountName === account.name);
      return {
        ...t,
        // For reconciliation, we care about the amount specifically for the selected account
        relevantAmountCents: matchLine ? lineAmount(matchLine, t) : 0
      };
    });
  }, [selectedAccount, account, statementDate, searchTerm, transactions]);

  const stats = useMemo(() => {
    const cleared = filteredTransactions
      .filter(t => reconciledIds.includes(t.id))
      .reduce((sum, t) => sum + t.relevantAmountCents, 0);
    
    const targetBalance = safeParseCents(endingBalance);
    const currentBalance = beginningBalance + cleared;
    const difference = targetBalance - currentBalance;

    return { cleared, beginningBalance, targetBalance, currentBalance, difference };
  }, [filteredTransactions, reconciledIds, beginningBalance, endingBalance]);

  const handleToggle = (id: string) => {
    setReconciledIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleAutoMatch = () => {
    const targetAmountCents = safeParseCents(endingBalance);
    const needed = targetAmountCents - beginningBalance;

    // Greedy matching algorithm for exact amounts
    const matches: string[] = [];
    let matchedSum = 0;

    // Sort by amount to try and find combinations
    const sorted = [...filteredTransactions].sort((a, b) => Math.abs(b.relevantAmountCents) - Math.abs(a.relevantAmountCents));

    sorted.forEach(t => {
      if (Math.abs(matchedSum + t.relevantAmountCents - needed) < Math.abs(matchedSum - needed) || 
          Math.abs(matchedSum + t.relevantAmountCents) <= Math.abs(needed)) {
        matches.push(t.id);
        matchedSum += t.relevantAmountCents;
      }
    });

    setReconciledIds(matches);
    toast.success(`Auto-matched ${matches.length} transactions based on statement balance.`);
  };

  const handleFinalize = async () => {
    if (Math.abs(stats.difference) > 0.01) {
      toast.error('Difference must be zero to finalize reconciliation.');
      return;
    }

    setIsFinalizing(true);
    try {
      await onComplete({
        accountId: account?.id,
        accountName: selectedAccount,
        statementDate,
        statementBalanceCents: stats.targetBalance,
        reconciledIds,
        timestamp: new Date().toISOString()
      });
      onClose();
    } catch (err) {
      console.error('Finalization error:', err);
    } finally {
      setIsFinalizing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div {...overlayDialogProps} className="fixed inset-0 z-[300] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-zinc-900/60 backdrop-blur-md"
      />
      
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative w-full max-w-5xl bg-[var(--ink)] rounded-[40px] shadow-2xl border border-[var(--line)] overflow-hidden flex flex-col max-h-[90dvh]"
      >
        {/* Header */}
        <div className="p-4 md:p-10 border-b border-[var(--line)] flex items-center justify-between bg-[var(--ink)]/30">
          <div className="flex items-center gap-6">
            <div className="w-16 h-16 bg-indigo-600 text-white rounded-[32px] flex items-center justify-center border border-indigo-600/20 shadow-lg shadow-ledger-accent/10">
              <RefreshCw aria-hidden="true" size={32} />
            </div>
            <div>
              <h2 id={overlayTitleId} className="text-2xl font-black text-[var(--text)] uppercase italic tracking-tighter">Reconcile account</h2>
              <p className="text-[10px] font-black text-[var(--muted)] uppercase tracking-[0.2em] mt-1 opacity-40">Step {step} of 2 // {step === 1 ? 'Statement details' : 'Match transactions'}</p>
            </div>
          </div>
          <button aria-label="Close" onClick={onClose} className="w-12 h-12 bg-[var(--ink)] hover:bg-slate-200 rounded-[32px] flex items-center justify-center text-[var(--muted)] transition-all"><X aria-hidden="true" size={24} /></button>
        </div>

        <div className="flex-1 overflow-auto p-4 md:p-10 bg-[var(--ink)]">
          <AnimatePresence mode="wait">
            {step === 1 ? (
              <motion.div 
                key="step1"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="max-w-lg mx-auto space-y-10"
              >
                <div className="space-y-8">
                  <div className="space-y-3">
                    <Labelled labelClassName="block text-[10px] font-black text-[var(--muted)] uppercase tracking-[0.2em] italic ml-2" label="Bank account">
                      <select 
                        value={selectedAccount}
                        onChange={(e) => setSelectedAccount(e.target.value)}
                        className="w-full px-8 py-5 bg-[var(--ink)] border border-[var(--line)] rounded-[32px] focus:outline-none focus:ring-2 focus:ring-indigo-600 transition-all font-black text-[var(--text)] uppercase italic tracking-tight"
                      >
                        <option value="" className="bg-[var(--ink)]">Select an account...</option>
                        {accounts.filter(a => a.type === 'asset' || a.type === 'liability').map(acc => (
                          <option key={acc.id} value={acc.name} className="bg-[var(--ink)] uppercase">{acc.name}</option>
                        ))}
                      </select>
                    </Labelled>
                  </div>

                  <div className="grid grid-cols-2 gap-8">
                    <div className="space-y-3">
                      <Labelled labelClassName="block text-[10px] font-black text-[var(--muted)] uppercase tracking-[0.2em] italic ml-2" label="Statement date">
                        <input 
                          type="date"
                          value={statementDate}
                          onChange={(e) => setStatementDate(e.target.value)}
                          className="w-full px-8 py-5 bg-[var(--ink)] border border-[var(--line)] rounded-[32px] focus:outline-none focus:ring-2 focus:ring-indigo-600 transition-all font-black text-[var(--text)] uppercase italic tracking-tight"
                        />
                      </Labelled>
                    </div>
                    <div className="space-y-3">
                      <Labelled labelClassName="block text-[10px] font-black text-[var(--muted)] uppercase tracking-[0.2em] italic ml-2" label="Statement ending balance ($)">
                        <input 
                          type="number"
                          step="0.01"
                          value={endingBalance}
                          onChange={(e) => setEndingBalance(e.target.value)}
                          className="w-full px-8 py-5 bg-[var(--ink)] border border-[var(--line)] rounded-[32px] focus:outline-none focus:ring-2 focus:ring-indigo-600 transition-all font-mono font-black text-[var(--text)] text-lg italic"
                        />
                      </Labelled>
                    </div>
                  </div>
                </div>

                <div className="p-4 md:p-8 bg-[var(--ink)]/40 border border-[var(--line)] rounded-[32px] flex gap-5 shadow-inner">
                  <AlertCircle aria-hidden="true" className="text-indigo-600 shrink-0" size={24} />
                  <p className="text-[11px] text-[var(--muted)] leading-relaxed font-bold italic opacity-70">
                    Enter the ending date and balance exactly as shown on the bank statement. They determine which transactions should be cleared.
                  </p>
                </div>
              </motion.div>
            ) : (
              <motion.div 
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-10"
              >
                {/* Summary Bar */}
                <div className="grid grid-cols-4 gap-6">
                  <div className="p-7 bg-[var(--ink)] rounded-[32px] border border-[var(--line)] shadow-inner">
                    <p className="text-[9px] font-black text-[var(--muted)] uppercase tracking-[0.2em] mb-2 italic">Statement ending balance</p>
                    <p className="text-xl font-black text-[var(--text)] font-mono italic tracking-tight tabular-nums">{formatCurrency(stats.targetBalance)}</p>
                  </div>
                  <div className="p-7 bg-[var(--ink)] rounded-[32px] border border-[var(--line)] shadow-inner">
                    <p className="text-[9px] font-black text-[var(--muted)] uppercase tracking-[0.2em] mb-2 italic">Cleared in this session</p>
                    <p className="text-xl font-black text-[var(--text)] font-mono italic tracking-tight tabular-nums">{formatCurrency(stats.cleared)}</p>
                  </div>
                  <div className="p-7 bg-[var(--ink)] rounded-[32px] border border-[var(--line)] shadow-inner">
                    <p className="text-[9px] font-black text-[var(--muted)] uppercase tracking-[0.2em] mb-2 italic">Book balance</p>
                    <p className="text-xl font-black text-[var(--text)] font-mono italic tracking-tight tabular-nums">{formatCurrency(stats.currentBalance)}</p>
                  </div>
                  <div className={cn(
                    "p-7 rounded-[32px] border transition-all shadow-lg",
                    Math.abs(stats.difference) < 1 ? "bg-slate-900/10 border-indigo-600/30" : "bg-rose-500/10 border-rose-500/30"
                  )}>
                    <p className={cn(
                      "text-[9px] font-black uppercase tracking-[0.2em] mb-2 italic",
                      Math.abs(stats.difference) < 1 ? "text-indigo-600" : "text-rose-500"
                    )}>Difference</p>
                    <p className={cn(
                      "text-xl font-black font-mono italic",
                      Math.abs(stats.difference) < 1 ? "text-indigo-600" : "text-rose-500"
                    )}>{formatCurrency(stats.difference)}</p>
                  </div>
                </div>

                {/* Matching Interface */}
                <div className="bg-[var(--surface)] rounded-[40px] border border-[var(--line)] overflow-hidden shadow-sm">
                  <div className="p-6 border-b border-[var(--line)] bg-[var(--ink)]/30 flex justify-between items-center">
                    <div>
                        <h3 className="text-[10px] font-black text-[var(--text)] uppercase tracking-[0.3em] italic">Transactions to clear</h3>
                        <p className="text-[8px] font-black text-[var(--muted)] uppercase mt-1 opacity-40">Tick the entries shown on the statement</p>
                    </div>
                    <div className="relative">
                      <Search aria-hidden="true" className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--muted)]" size={14} />
                      <input aria-label="Search ledger transactions"
                        type="text" 
                        placeholder="Search transactions..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-11 pr-5 py-3 bg-[var(--ink)] border border-[var(--line)] rounded-xl text-[10px] font-black uppercase italic tracking-tight focus:outline-none focus:ring-1 focus:ring-indigo-600 text-[var(--text)] w-64 transition-all"
                      />
                    </div>
                  </div>
                  <div className="divide-y divide-ledger-line/50 max-h-[400px] overflow-auto scrollbar-thin scrollbar-thumb-ledger-line">
                    {filteredTransactions.map(t => (
                      <button type="button"
                        key={t.id}
                        onClick={() => handleToggle(t.id)}
                        className={cn(
                          "w-full text-left p-6 flex items-center justify-between hover:bg-[var(--ink)]/40 transition-all cursor-pointer group",
                          reconciledIds.includes(t.id) && "bg-indigo-600/[0.03]"
                        )}
                      >
                        <div className="flex items-center gap-6">
                          <div className={cn(
                            "w-8 h-8 rounded-xl border-2 flex items-center justify-center transition-all transform",
                            reconciledIds.includes(t.id) ? "bg-indigo-600 border-indigo-600 text-white scale-105" : "border-[var(--line)] bg-[var(--ink)] group-hover:bg-slate-200/50"
                          )}>
                            {reconciledIds.includes(t.id) && <CheckSquare aria-hidden="true" size={16} />}
                          </div>
                          <div>
                            <p className="text-xs font-black text-[var(--text)] uppercase italic tracking-tight">{t.description}</p>
                            <p className="text-[9px] text-[var(--muted)] font-black uppercase tracking-[0.2em] mt-1 opacity-50">{formatDate(t.date)} · Ref {t.id.substring(0,8)}</p>
                          </div>
                        </div>
                        <p className="text-sm font-black font-mono text-[var(--text)] italic tracking-tight tabular-nums">
                          {formatCurrency(t.relevantAmountCents)}
                        </p>
                      </button>
                    ))}
                    {filteredTransactions.length === 0 && (
                      <div className="p-24 text-center text-[var(--muted)] font-medium uppercase tracking-wider truncate text-[10px] italic opacity-20">No transactions to clear for this statement date.</div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="p-4 md:p-10 border-t border-[var(--line)] flex justify-between bg-[var(--ink)]/20">
          {step === 2 && (
            <button 
              onClick={() => setStep(1)}
              className="flex items-center gap-3 px-8 py-4 bg-[var(--ink)] text-[var(--muted)] rounded-[32px] font-black uppercase tracking-[0.2em] text-[10px] border border-[var(--line)] hover:text-[var(--text)] transition-all"
            >
              <ChevronLeft aria-hidden="true" size={18} />
              Back
            </button>
          )}
          <div className="flex-1" />
          {step === 1 ? (
            <button 
              onClick={() => {
                if (!selectedAccount) {
                  toast.error('Select a bank account to continue.');
                  return;
                }
                setStep(2);
              }}
              className="flex items-center gap-3 px-12 py-4 bg-indigo-600 text-white rounded-[32px] font-black uppercase tracking-[0.2em] text-[10px] hover:brightness-110 transition-all shadow-xl shadow-ledger-accent/20"
            >
              Continue
              <ChevronRight aria-hidden="true" size={18} />
            </button>
          ) : (
            <div className="flex items-center gap-5">
              <button 
                onClick={handleAutoMatch}
                className="flex items-center gap-3 px-8 py-4 bg-[var(--ink)] text-indigo-600 rounded-[32px] font-black uppercase tracking-[0.1em] text-[10px] border border-indigo-600/20 hover:bg-indigo-600/10 transition-all"
               aria-label="Auto-match">
                <Sparkles aria-hidden="true" size={18} />
                Auto-match
              </button>
              <button 
                onClick={handleFinalize}
                className={cn(
                  "flex items-center gap-3 px-12 py-4 rounded-[32px] font-black uppercase tracking-[0.2em] text-[10px] transition-all shadow-xl",
                  Math.abs(stats.difference) < 1 
                    ? "bg-slate-900 text-white hover:brightness-110 shadow-ledger-google-blue/20" 
                    : "bg-[var(--ink)] text-slate-500/30 cursor-not-allowed border border-[var(--line)] grayscale"
                )}
               aria-label="Finish reconciliation">
                <CheckCircle2 aria-hidden="true" size={18} />
                Finish reconciliation
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
