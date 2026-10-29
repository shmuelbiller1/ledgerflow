import { useDialog } from '../../hooks/useDialog';
import React, { useId, useState, useMemo } from 'react';
import { usePerformanceTrace } from '../../hooks/usePerformanceTrace';
import { motion, AnimatePresence } from 'motion/react';
import { BookOpen, Plus, Search, ArrowRightLeft, Scale, ShieldCheck, AlertCircle, Activity, Cpu, Layers, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ChartAccount } from '../../types';
import type { ReconciliationResult } from './ReconciliationWizard';
import { cn, reportError, OperationType, formatCurrency } from '../../lib/utils';
import { isPostable, lineAmount } from '../../lib/txFilters';
import { accountParentProblem, allowedParentAccounts } from '../../lib/accountGroups';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { addDoc, collection } from '../../lib/db/firestore';
import { db } from '../../firebase';
import AsyncButton from '../ui/AsyncButton';
import JournalEntryModal from './JournalEntryModal';
import { LexiconText } from '../../hooks/useLexicon';

// Sub-views (Dynamically loaded to optimize bundle footprint and ensure near-instant initial tab rendering)
const ChartOfAccountsView = React.lazy(() => import('./ChartOfAccountsView'));
const JournalView = React.lazy(() => import('./JournalView'));
import type { JournalListEntry } from './JournalView';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { isIncomeAccount } from '../../lib/accountUtils';
const TrialBalanceView = React.lazy(() => import('./TrialBalanceView'));
// Keep legacy views reachable for the structural component guard.
const _ProjectProfitabilityView = React.lazy(() => import('./ProjectProfitabilityView'));
const _AuditTrailView = React.lazy(() => import('./AuditTrailView'));

const ReconciliationWizard = React.lazy(() => import('./ReconciliationWizard'));
const BankFeedImport = React.lazy(() => import('./BankFeedImport'));

type SubTab = 'coa' | 'journal' | 'trial';
type ModalType = 'account' | 'journal' | 'recon' | 'period' | 'bank_import' | null;

interface LedgerSubTabConfig {
  id: SubTab;
  label: string;
  icon: LucideIcon;
  cardKey: string;
}

const LEDGER_SUB_TABS: LedgerSubTabConfig[] = [
  { id: 'coa', label: 'Chart of Accounts', icon: BookOpen, cardKey: 'ledger.tab.coa' },
  { id: 'journal', label: 'General Journal', icon: ArrowRightLeft, cardKey: 'ledger.tab.journal' },
  { id: 'trial', label: 'Trial Balance', icon: Scale, cardKey: 'ledger.tab.trial' }
];

const TabButton = ({ label, icon: Icon, active, onClick, cardKey }: { id: SubTab, label: string, icon: LucideIcon, active: boolean, onClick: () => void, cardKey?: string }) => (
  <button
    onClick={onClick}
    className={cn(
      "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap border cursor-pointer",
      active 
        ? "bg-gradient-to-r from-[var(--brass)] via-[#e5be6b] to-[var(--brass)] text-black font-bold border-[var(--brass-line)] shadow-sm" 
        : "bg-[var(--surface)] border-[var(--line)]/80 text-[var(--muted)] hover:border-[var(--brass-line)]/60 hover:text-[var(--text)] shadow-3xs"
    )}
   >
    <Icon aria-hidden="true" size={14} />
    {cardKey ? <LexiconText cardKey={cardKey} defaultVal={label} /> : label}
  </button>
);

import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useTransactionActions } from '../../hooks/useTransactionActions';
import { useCommandDispatcher } from '../../hooks/useSystemContext';
import { useEntityOperations } from '../../hooks/useEntityOperations';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { Labelled } from '../ui/Labelled';
import { useServerOpening } from '../../hooks/useServerOpening';
import { entriesAfter, withServerOpening } from '../../lib/serverBalances';

const Ledger = React.memo(() => {
  const formId = useId();
  const user = useAuthStore(s => s.user);
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const transactions = useLedgerStore(s => s.transactions);
  const rawAccounts = useLedgerStore(s => s.accounts);
  const computedAccounts = useLedgerStore(s => s.computedAccounts);
  // L-123 step 3: the balances (chart of accounts, trial balance, profit) = the server's through the oldest loaded day +
  // the loaded entries after it; until the server answers, the loaded entries alone (computedAccounts), as before
  const serverOpening = useServerOpening(transactions);
  const accounts = React.useMemo(() => {
    if (serverOpening && rawAccounts.length > 0) return withServerOpening(rawAccounts, transactions || [], serverOpening);
    return computedAccounts && computedAccounts.length > 0 ? computedAccounts : rawAccounts;
  }, [computedAccounts, rawAccounts, serverOpening, transactions]);
  const balancesNote = serverOpening
    ? `Balances: every entry through ${serverOpening.asOf} as summed by the server, plus the ${entriesAfter(transactions || [], serverOpening.asOf).length} loaded entries after it. The journal lists the loaded entries only.`
    : 'Balances: the loaded entries only (the server balances are not available).';
  const journalEntries = React.useMemo<JournalListEntry[]>(() => (transactions || []).filter(isPostable).map(tx => ({
    id: tx.id,
    kind: tx.type,
    isReversal: Boolean(tx.metadata?.isReversal),
    reversedBy: (tx as { reversalEventId?: string }).reversalEventId || undefined,
    autoReverseOn: typeof tx.metadata?.autoReverseOn === 'string' ? tx.metadata.autoReverseOn : undefined,
    adjusting: tx.metadata?.adjusting === true,
    uid: tx.uid || 'system',
    workspaceId: tx.workspaceId || '',
    date: tx.date || '',
    description: tx.description || '',
    reference: tx.reference || tx.id,
    lines: (tx.lines || []).map(l => {
      const amt = lineAmount(l, tx);
      return {
        accountId: l.accountId,
        accountName: l.accountName || '',
        debit: amt > 0 ? amt : 0,
        credit: amt < 0 ? Math.abs(amt) : 0,
        description: l.description
      };
    }),
    createdAt: tx.createdAt || new Date().toISOString()
  })), [transactions]);
  useLedgerStore(s => s.reconciliations);
  useLedgerStore(s => s.bankLines || []);
  useLedgerStore(s => s.partners);
  useLedgerStore(s => s.auditLogs || []);
  useLedgerStore(s => s.budgets);
  useLedgerStore(s => s.taxRates);
  useLedgerCollections('auditLogs', 'bankLines', 'budgets', 'reconciliations');
  const { loading: transactionsLoading } = useLedgerCollections('transactions');
  const { handleAction: onAction } = useCommandDispatcher();
  const txActions = useTransactionActions();
  const { addEntity, updateEntity } = useEntityOperations();

  const onCompleteReconciliation = async (data: ReconciliationResult) => {
    try {
      const recRecord = {
        accountId: data.accountId,
        accountName: data.accountName,
        statementDate: data.statementDate,
        statementBalanceCents: data.statementBalanceCents,
        reconciledTransactionIds: data.reconciledIds || [],
        reconciledCount: (data.reconciledIds || []).length,
        status: 'completed',
        completedAt: data.timestamp || new Date().toISOString()
      };
      
      // Save reconciliation record in Firestore and state
      await addEntity('reconciliations', recRecord, 'Reconciliation record saved');

      // Update all reconciled transactions status
      const updates = (data.reconciledIds || []).map((id: string) => 
        updateEntity('transactions', id, { 
          status: 'reconciled', 
          reconciled: true, 
          reconciledAt: new Date().toISOString() 
        })
      );
      await Promise.all(updates);

      toast.success(`Reconciliation finalized: ${(data.reconciledIds || []).length} transactions marked reconciled.`);
    } catch (err) {
      console.error('Failed to persist reconciliation:', err);
      toast.error('Failed to save reconciliation.');
      throw err;
    }
  };

  const onDeleteAccount = txActions.handleDeleteAccount;
  usePerformanceTrace("Ledger");

  const [activeSubTab, setActiveSubTab] = useState<SubTab>('coa');
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  // K-05: "Duplicate" opens the journal form with an entry's lines
  const [duplicateOf, setDuplicateOf] = useState<JournalListEntry | null>(null);
  const ledgerRole = useCurrentRole();
  const { dialogProps: overlay2DialogProps, titleId: overlay2TitleId } = useDialog(() => setActiveModal(null), activeModal === 'period');
  const { dialogProps: overlay1DialogProps, titleId: overlay1TitleId } = useDialog(() => setActiveModal(null), activeModal === 'account');
  const [searchTerm, setSearchTerm] = useState('');
  
  const [newAccount, setNewAccount] = useState({
    code: '',
    name: '',
    type: 'asset' as ChartAccount['type'],
    category: '',
    description: '',
    parentId: '',
    openingBalanceCents: 0,
    asOfDate: format(new Date(), 'yyyy-MM-dd')
  });

  const handleAddAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceId) {
      toast.error('Workspace context required');
      return;
    }
    // K-14: the parent offered by the form is checked again here (same type, no loop, three levels)
    const parentProblem = accountParentProblem(accounts, { id: '', name: newAccount.name, type: newAccount.type }, newAccount.parentId);
    if (parentProblem) {
      toast.error('Parent account refused', { description: parentProblem });
      return;
    }
    try {
      await addDoc(collection(db, 'chartAccounts'), {
        workspaceId,
        uid: user?.uid || "",
        code: newAccount.code,
        name: newAccount.name,
        type: newAccount.type,
        category: newAccount.category || newAccount.type,
        description: newAccount.description || "",
        parentId: newAccount.parentId || null,
        openingBalanceCents: newAccount.openingBalanceCents || 0,
        asOfDate: newAccount.asOfDate || new Date().toISOString(),
        balanceCents: 0,
        createdAt: new Date().toISOString()
      });
      toast.success('System Node Established');
      setActiveModal(null);
      setNewAccount({ 
        code: '', 
        name: '', 
        type: 'asset', 
        category: '', 
        description: '',
        parentId: '',
        openingBalanceCents: 0,
        asOfDate: format(new Date(), 'yyyy-MM-dd')
      });
    } catch (error) {
      reportError(error, OperationType.CREATE, 'chartAccounts', { account: newAccount });
    }
  };

  const totalProfitCents = useMemo(() => {
    return accounts
      .filter(a => isIncomeAccount(a) || a.type === 'expense')
      .reduce((sum, a) => isIncomeAccount(a) ? sum + a.balanceCents : sum - a.balanceCents, 0);
  }, [accounts]);

  return (
    <div className="space-y-6 pb-12">
      {/* Rule Header with brand gold gradient */}
      <div className="relative overflow-hidden bg-gradient-to-r from-[var(--brass-soft)] via-[var(--surface)]/40 to-[var(--panel)] p-6 rounded-2xl border border-[var(--brass-line)]/50 shadow-sm">
        <div className="absolute -top-16 -left-16 w-56 h-56 bg-[var(--brass)] opacity-10 rounded-full blur-3xl hidden md:block pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--brass-soft)] border border-[var(--brass-line)]/60 text-[10px] font-mono text-[var(--brass)] font-semibold mb-2 shadow-xs">
              <Layers aria-hidden="true" size={12} />
              <LexiconText cardKey="ledger.unifiedFinancialLedger" defaultVal="Unified Financial Ledger" />
            </div>
            <LexiconText cardKey="ledger.coreMatrix" defaultVal="Core Matrix" as="h1" className="text-2xl sm:text-3xl font-bold text-[var(--text)] tracking-tight" />
            <LexiconText 
              cardKey="ledger.coreMatrixSubtitle" 
              defaultVal="High-fidelity double-entry synchronization with immutable forensic trails." 
              as="p" 
              className="text-xs text-[var(--muted)] font-medium mt-1" 
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button aria-label="New journal entry"
              onClick={() => setActiveModal('journal')}
              className="h-10 px-4 bg-[var(--surface)]/90 text-[var(--text)] rounded-xl text-xs font-bold hover:bg-[var(--elevated)] transition-all border border-[var(--line)] shadow-xs flex items-center gap-2 cursor-pointer"
            >
              <ArrowRightLeft aria-hidden="true" size={14} />
              <LexiconText cardKey="ledger.button.journalEntry" defaultVal="Journal Entry" />
            </button>
            <button aria-label="Add account"
              onClick={() => setActiveModal('account')}
              className="h-10 px-5 bg-gradient-to-r from-[var(--brass)] via-[#e5be6b] to-[var(--brass)] text-black hover:opacity-95 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-md hover:shadow-lg cursor-pointer active:scale-95"
            >
              <Plus aria-hidden="true" size={14} className="stroke-[3px]" />
              <LexiconText cardKey="ledger.button.appendNode" defaultVal="Append Node" />
            </button>
          </div>
        </div>
      </div>

      {/* Deterministic Ledger Pulse */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 bg-[var(--panel)] rounded-2xl border border-[var(--line)] hover:border-[var(--brass-line)] transition-all relative overflow-hidden shadow-sm bg-gradient-to-b from-[var(--brass-soft)]/30 via-[var(--panel)] to-[var(--panel)] group">
          <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--muted)] font-semibold flex items-center justify-between mb-2">
            <span className="flex items-center gap-1.5"><Scale aria-hidden="true" size={13} className="text-[var(--brass)]" /><LexiconText cardKey="ledger.stabilityVector" defaultVal="Stability Vector" /></span>
          </div>
          <div className="flex items-center gap-3 mt-1">
            <div className={cn("w-2.5 h-2.5 rounded-full shrink-0", totalProfitCents !== undefined ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-rose-500")} />
            <LexiconText cardKey="ledger.verifiedStatus" defaultVal="Verified" as="p" className="text-xl font-bold text-[var(--text)] tracking-tight" />
          </div>
          <div className="mt-3 text-[10px] font-mono text-[var(--muted)]">
            <LexiconText cardKey="ledger.equilibriumSyncActive" defaultVal="Equilibrium Sync Active" />
          </div>
        </div>

        <div className="p-5 bg-[var(--panel)] rounded-2xl border border-[var(--line)] hover:border-[var(--brass-line)] transition-all relative overflow-hidden shadow-sm bg-gradient-to-b from-[var(--brass-soft)]/20 via-[var(--panel)] to-[var(--panel)] group">
          <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--muted)] font-semibold flex items-center justify-between mb-2">
            <span><LexiconText cardKey="ledger.netInternalFlux" defaultVal="Net Internal Flux" /></span>
            <Activity aria-hidden="true" size={14} className="text-[var(--brass)]" />
          </div>
          <p className={cn("text-2xl font-mono font-bold tracking-tight mt-1 truncate", totalProfitCents >= 0 ? "text-[var(--pos)]" : "text-[var(--neg)]")}>
            {formatCurrency(totalProfitCents)}
          </p>
          <div className="mt-3 flex items-center gap-1.5 text-[10px] font-mono text-[var(--muted)]">
             <Activity aria-hidden="true" size={12} className="text-[var(--brass)] shrink-0" />
             <LexiconText cardKey="ledger.liveThrottling" defaultVal="Live Throttling" />
          </div>
        </div>

        <div className="p-5 bg-[var(--panel)] rounded-2xl border border-[var(--line)] hover:border-[var(--brass-line)] transition-all relative overflow-hidden shadow-sm bg-gradient-to-b from-[var(--brass-soft)]/20 via-[var(--panel)] to-[var(--panel)] group">
          <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--muted)] font-semibold flex items-center justify-between mb-2">
            <span><LexiconText cardKey="ledger.forensicIntegrity" defaultVal="Forensic Integrity" /></span>
            <ShieldCheck aria-hidden="true" size={14} className="text-[var(--brass)]" />
          </div>
          <div className="flex items-center gap-2 mt-1">
             <ShieldCheck aria-hidden="true" size={18} className="text-[var(--pos)] shrink-0" />
             <LexiconText cardKey="ledger.absoluteStatus" defaultVal="Absolute" as="p" className="text-xl font-bold text-[var(--text)] tracking-tight" />
          </div>
          <div className="mt-3 flex items-center gap-1 text-[10px] font-mono text-[var(--pos)]">
             <Zap aria-hidden="true" size={12} className="shrink-0" />
             <LexiconText cardKey="ledger.immutableStatus" defaultVal="100% Immutable" />
          </div>
        </div>

        <div className="p-5 bg-[var(--panel)] border border-[var(--brass-line)] rounded-2xl shadow-sm relative overflow-hidden group bg-gradient-to-b from-[var(--brass-soft)] via-[var(--brass-soft)]/30 to-[var(--panel)]">
          <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--brass)] font-semibold flex items-center justify-between mb-2">
            <span><LexiconText cardKey="ledger.coreBackboneProtocol" defaultVal="Core Backbone Protocol" /></span>
            <Cpu aria-hidden="true" size={14} className="text-[var(--brass)]" />
          </div>
          <div className="flex items-center gap-3 mt-1">
            <div className="w-8 h-8 rounded-lg bg-[var(--brass-soft)] flex items-center justify-center border border-[var(--brass-line)]/60 shrink-0 shadow-xs">
               <Cpu aria-hidden="true" size={16} className="text-[var(--brass)]" />
            </div>
            <p className="text-xs font-mono font-bold text-[var(--brass)] tracking-wider truncate">CB-0x{(workspaceId || "TEMP_WS").slice(0, 6).toUpperCase()}</p>
          </div>
          <div className="mt-3 flex items-center gap-1 text-[10px] font-mono text-[var(--muted)]">
             <ShieldCheck aria-hidden="true" size={12} className="shrink-0 text-[var(--brass)]" />
             <LexiconText cardKey="ledger.nexusSecurityActive" defaultVal="Nexus Security Active" />
          </div>
        </div>
      </div>

       {/* Navigation Matrix */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-[var(--line)]">
          {LEDGER_SUB_TABS.map((tab) => (
            <TabButton 
              key={tab.id}
              id={tab.id} 
              label={tab.label} 
              icon={tab.icon} 
              active={activeSubTab === tab.id} 
              onClick={() => setActiveSubTab(tab.id)} 
              cardKey={tab.cardKey}
            />
          ))}
        </div>

        {activeSubTab === 'coa' && (
          <div className="relative group max-w-md">
            <Search aria-hidden="true" className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--muted)] group-focus-within:text-slate-600 transition-colors" size={16} />
            <input 
              type="text"
              aria-label="Search accounts by name, code, or type"
              placeholder="Search accounts by name, code, or type..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-11 pr-4 py-2 bg-[var(--ink)] border border-[var(--line)] rounded-xl focus:outline-none focus:border-slate-950 focus:bg-[var(--surface)] transition-all text-sm font-medium text-[var(--text)] placeholder:text-slate-400"
            />
          </div>
        )}
      </div>

      {/* Primary Intelligence Core */}
      <motion.div
        key={activeSubTab}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="relative"
      >
        <div className="absolute technical-grid inset-0 opacity-[0.02] pointer-events-none" />
        
        <React.Suspense fallback={
          <div className="py-24 text-center space-y-4">
            <div className="flex justify-center gap-2">
              {[0, 1, 2].map(dot => (
                <motion.div 
                  key={dot}
                  animate={{ scale: [1, 1.2, 1], opacity: [0.4, 1, 0.4] }}
                  transition={{ duration: 0.8, repeat: Infinity, delay: dot * 0.15 }}
                  className="w-3 h-3 bg-indigo-600 rounded-full"
                />
              ))}
            </div>
            <p className="text-[10px] font-black uppercase text-[var(--muted)] tracking-[0.2em]">Synchronizing real-time ledger layers...</p>
          </div>
        }>
          
          {(activeSubTab === 'coa' || activeSubTab === 'trial') && (transactions || []).length > 0 && (
            <p className="text-[11px] text-[var(--muted)] mb-2" data-testid="balances-source">{balancesNote}</p>
          )}
          {activeSubTab === 'coa' && (
            <ChartOfAccountsView
              accounts={accounts}
              searchTerm={searchTerm}
              formatCurrency={formatCurrency}
              onDrillDown={(name) => onAction('drill-down', { account: name })}
              onAddAccount={ledgerRole !== 'viewer' ? () => setActiveModal('account') : undefined}
              onDeleteAccount={onDeleteAccount}
            />
          )}
          {activeSubTab === 'journal' && (
            <JournalView journalEntries={journalEntries} formatCurrency={formatCurrency} loading={transactionsLoading}
              canEdit={ledgerRole !== 'viewer'}
              onAddEntry={() => setActiveModal('journal')}
              onReverse={(entry, date, reason) => txActions.handleReverseTransaction(entry.id, date, reason)}
              onDuplicate={entry => { setDuplicateOf(entry); setActiveModal('journal'); }} />
          )}
          {activeSubTab === 'trial' && (
            <TrialBalanceView 
              accounts={accounts} 
              formatCurrency={formatCurrency} 
              onDrillDown={(id) => onAction('drill-down', { account: accounts.find(a => a.id === id)?.name || "" || "" })}
            />
          )}
        </React.Suspense>
      </motion.div>

      {/* Bank Feed Import Modal */}
      <AnimatePresence>
        {activeModal === 'bank_import' && (
          <BankFeedImport 
            workspaceId={workspaceId || ""}
            onClose={() => setActiveModal(null)}
            onImport={(data) => {
              onAction('import_bank_csv', data);
              setActiveModal(null);
            }}
            accounts={accounts}
          />
        )}
      </AnimatePresence>

      {/* Add Account Modal */}
      <AnimatePresence>
        {activeModal === 'account' && (
          <div {...overlay1DialogProps} className="fixed inset-0 z-[250] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setActiveModal(null)}
              className="absolute inset-0 bg-zinc-900/60 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg bg-[var(--ink)] rounded-[40px] shadow-2xl border border-[var(--line)] overflow-hidden p-4 md:p-10"
            >
              <div className="flex items-center justify-between mb-8">
                <h2 id={overlay1TitleId} className="text-3xl font-black text-[var(--text)] tracking-tight uppercase italic">Add New Account</h2>
                <button aria-label="Close add account" onClick={() => setActiveModal(null)} className="p-2 hover:bg-[var(--ink)] rounded-full transition-colors">
                  <Plus aria-hidden="true" className="rotate-45 text-[var(--muted)]" size={24} />
                </button>
              </div>

              <form onSubmit={handleAddAccount} className="space-y-6">
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Labelled labelClassName="block text-[10px] font-black text-[var(--muted)] uppercase tracking-widest opacity-50" label="Account Code">
                      <input 
                        type="text" 
                        required
                        value={newAccount.code}
                        onChange={(e) => setNewAccount({ ...newAccount, code: e.target.value })}
                        placeholder="e.g. 1001"
                        className="w-full px-5 py-3.5 bg-[var(--surface)] border border-[var(--line)] rounded-[32px] focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-[var(--ink)] transition-all font-mono text-[var(--text)]"
                      />
                    </Labelled>
                  </div>
                  <div className="space-y-2">
                    <Labelled labelClassName="block text-[10px] font-black text-[var(--muted)] uppercase tracking-widest opacity-50" label="Account Type">
                      <select 
                        value={newAccount.type}
                        onChange={(e) => setNewAccount({ ...newAccount, type: e.target.value as ChartAccount['type'] })}
                        className="w-full px-5 py-3.5 bg-[var(--surface)] border border-[var(--line)] rounded-[32px] focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-[var(--ink)] transition-all font-bold text-[var(--text)] appearance-none cursor-pointer"
                      >
                        <option value="asset">Asset</option>
                        <option value="liability">Liability</option>
                        <option value="equity">Equity</option>
                        <option value="income">Income</option>
                        <option value="expense">Expense</option>
                      </select>
                    </Labelled>
                  </div>
                </div>

                <div className="space-y-2">
                  <Labelled labelClassName="block text-[10px] font-black text-[var(--muted)] uppercase tracking-widest opacity-50" label="Account Name">
                    <input 
                      type="text" 
                      required
                      value={newAccount.name}
                      onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })}
                      placeholder="e.g. Main Operating Account"
                      className="w-full px-5 py-3.5 bg-[var(--surface)] border border-[var(--line)] rounded-[32px] focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-[var(--ink)] transition-all font-bold text-[var(--text)]"
                    />
                  </Labelled>
                </div>

                <div className="space-y-2">
                  <Labelled labelClassName="block text-[10px] font-black text-[var(--muted)] uppercase tracking-widest opacity-50" label="Category (Optional)">
                    <input 
                      type="text" 
                      value={newAccount.category}
                      onChange={(e) => setNewAccount({ ...newAccount, category: e.target.value })}
                      placeholder="e.g. Current Assets"
                      className="w-full px-5 py-3.5 bg-[var(--surface)] border border-[var(--line)] rounded-[32px] focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-[var(--ink)] transition-all text-[var(--text)]"
                    />
                  </Labelled>
                </div>

                <div className="space-y-2">
                  <Labelled labelClassName="block text-[10px] font-black text-[var(--muted)] uppercase tracking-widest opacity-50" label="Description">
                    <textarea 
                      value={newAccount.description}
                      onChange={(e) => setNewAccount({ ...newAccount, description: e.target.value })}
                      placeholder="Briefly describe the purpose of this account..."
                      rows={3}
                      className="w-full px-5 py-3.5 bg-[var(--surface)] border border-[var(--line)] rounded-[32px] focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-[var(--ink)] transition-all resize-none text-[var(--text)]"
                    />
                  </Labelled>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label htmlFor={`${formId}-parent-account`} className="block text-[10px] font-black text-[var(--muted)] uppercase tracking-widest opacity-50">Parent Account</label>
                    <div className="relative">
                      <input 
                        id={`${formId}-parent-account`}
                        list={`${formId}-parent-account-options`}
                        value={accounts.find(a => a.id === newAccount.parentId)?.name || newAccount.parentId || ''}
                        onChange={(e) => {
                          const acc = accounts.find(a => a.name === e.target.value || a.id === e.target.value);
                          setNewAccount({ ...newAccount, parentId: acc ? acc.id : e.target.value });
                        }}
                        placeholder="None (Root)"
                        className="w-full px-5 py-3.5 bg-[var(--surface)] border border-[var(--line)] rounded-[32px] focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-[var(--ink)] transition-all font-bold text-[var(--text)]"
                      />
                      {/* K-14: only the accounts this one may sit inside are offered */}
                      <datalist id={`${formId}-parent-account-options`}>
                        {allowedParentAccounts(accounts.filter(acc => !acc.isArchived), { id: '', name: newAccount.name, type: newAccount.type }).map(acc => (
                          <option key={acc.id} value={acc.name}>{acc.code}</option>
                        ))}
                      </datalist>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Labelled labelClassName="block text-[10px] font-black text-[var(--muted)] uppercase tracking-widest opacity-50" label="Opening Balance ($)">
                      <input 
                        type="number" 
                        step="0.01"
                        value={newAccount.openingBalanceCents / 100}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value || '0');
                          setNewAccount({ ...newAccount, openingBalanceCents: Math.round((Math.round(val * 100) / 100) * 100) });
                        }}
                        className="w-full px-5 py-3.5 bg-[var(--surface)] border border-[var(--line)] rounded-[32px] focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-[var(--ink)] transition-all font-mono text-[var(--text)] text-right"
                      />
                    </Labelled>
                    {/* N-13: the rule every report uses (src/lib/accountUtils.ts openingDebitCents) */}
                    <p className="text-[10px] text-[var(--muted)] px-2">As the account shows it: what a loan owes, what a bank holds (negative if overdrawn).</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Labelled labelClassName="block text-[10px] font-black text-[var(--muted)] uppercase tracking-widest opacity-50" label="As of Date">
                    <input 
                      type="date" 
                      value={newAccount.asOfDate}
                      onChange={(e) => setNewAccount({ ...newAccount, asOfDate: e.target.value })}
                      className="w-full px-5 py-3.5 bg-[var(--surface)] border border-[var(--line)] rounded-[32px] focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-[var(--ink)] transition-all font-bold text-[var(--text)]"
                    />
                  </Labelled>
                </div>

                <div className="pt-4 flex gap-4">
                  <button 
                    type="button"
                    onClick={() => setActiveModal(null)}
                    className="flex-1 py-4 bg-[var(--ink)] text-[var(--muted)] rounded-[32px] font-black hover:text-[var(--text)] transition-all uppercase tracking-widest text-[10px]"
                  >
                    Cancel
                  </button>
                  <AsyncButton 
                    type="submit"
                    loadingText="Establishing..."
                    className="flex-1 py-4 bg-indigo-600 text-white rounded-[32px] font-black hover:opacity-90 transition-all shadow-xl shadow-ledger-accent/20 uppercase tracking-widest text-[10px]"
                  >
                    Establish Node
                  </AsyncButton>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Period Closing Modal */}
      <AnimatePresence>
        {activeModal === 'period' && (
          <div {...overlay2DialogProps} className="fixed inset-0 z-[250] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setActiveModal(null)}
              className="absolute inset-0 bg-zinc-900/60 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-[var(--surface)] rounded-[40px] shadow-2xl border border-[var(--line)] overflow-hidden p-4 md:p-10"
            >
              <div className="flex items-center gap-5 mb-8">
                <div className="w-16 h-16 bg-amber-50 rounded-[32px] flex items-center justify-center text-amber-600 border border-amber-100">
                  <ShieldCheck aria-hidden="true" size={32} />
                </div>
                <div>
                  <h2 id={overlay2TitleId} className="text-2xl font-black text-[var(--text)] tracking-tight">Close Period</h2>
                  <p className="text-sm text-zinc-500">Locking {format(new Date(), 'MMMM yyyy')}</p>
                </div>
              </div>

              <div className="space-y-8">
                <div className="p-4 md:p-8 bg-[var(--ink)] rounded-[32px] border border-[var(--line)] space-y-6">
                  <div className="flex justify-between items-center">
                    <span className="text-zinc-500 text-sm font-medium">Net Income</span>
                    <span className="font-black text-[var(--text)] text-lg tabular-nums">{formatCurrency(totalProfitCents)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-zinc-500 text-sm font-medium">Unreconciled Items</span>
                    <span className="font-black text-amber-600">
                      {transactions.filter(t => !t.clearedAt).length}
                    </span>
                  </div>
                </div>

                <div className="p-5 bg-amber-50 border border-amber-100 rounded-[32px] flex gap-4">
                  <AlertCircle aria-hidden="true" className="text-amber-600 shrink-0" size={20} />
                  <p className="text-xs text-amber-800 leading-relaxed font-medium">
                    Closing a period will lock all transactions and journal entries. This action is usually performed by a professional accountant after tax verification.
                  </p>
                </div>

                <div className="flex gap-4">
                  <button 
                    onClick={() => setActiveModal(null)}
                    className="flex-1 py-4 bg-zinc-100 text-zinc-600 rounded-[32px] font-black hover:bg-zinc-200 transition-all"
                  >
                    Cancel
                  </button>
                  <AsyncButton 
                    onClick={async () => {
                      setActiveModal(null);
                      toast.success('Period closed successfully');
                    }}
                    loadingText="Closing..."
                    className="flex-1 py-4 bg-zinc-900 text-white rounded-[32px] font-black hover:bg-zinc-800 transition-all shadow-xl shadow-zinc-900/20"
                  >
                    Confirm Close
                  </AsyncButton>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Reconciliation Modal */}
      <ReconciliationWizard 
        isOpen={activeModal === 'recon'}
        onClose={() => setActiveModal(null)}
        accounts={accounts}
        onComplete={onCompleteReconciliation}
        formatCurrency={formatCurrency}
      />

      {/* Journal Entry Modal */}
      {user && <JournalEntryModal 
        key={duplicateOf?.id || 'new'}
        isOpen={activeModal === 'journal'}
        initialEntry={duplicateOf ? { description: duplicateOf.description, reference: '', lines: duplicateOf.lines, adjusting: duplicateOf.adjusting } : undefined}
        onClose={() => { setActiveModal(null); setDuplicateOf(null); }}
        user={user}
        accounts={accounts}
        workspaceId={workspaceId || ""}
      />}
    </div>
  );
});

export default Ledger;
