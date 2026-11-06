import { useState } from 'react';
import NeedsAttentionCard from './dashboard/NeedsAttentionCard';
import { Plus, CheckCircle2, Layers, UploadCloud, Sparkles, X } from 'lucide-react';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useUIStore } from '../stores/useUIStore';
import { useAuthStore } from '../stores/useAuthStore';
import { TaxReserveWidget } from './finance/TaxReserveWidget';
import OnboardingView from './onboarding/OnboardingView';
import FirstHourGuide from './onboarding/FirstHourGuide';
import SetupWizard from './onboarding/SetupWizard';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { LoadingState } from './ui/LoadingState';
import SavedViewsBar from './ui/SavedViewsBar';
import { cn } from '../lib/utils';
import DashboardWidgets from './dashboard/DashboardWidgets';

import { useShallow } from 'zustand/react/shallow';
import SinceLastVisitCard from './SinceLastVisitCard';

export default function Dashboard() {
  const { 
    rawTransactions, 
    accounts
  } = useLedgerStore(useShallow(s => ({
    rawTransactions: s.transactions,
    accounts: s.accounts,
  })));
  const setQuickEntryOpen = useUIStore(s => s.setQuickEntryOpen);
  const setTemplateSelectorOpen = useUIStore(s => s.setTemplateSelectorOpen);
  const setActiveTab = useUIStore(s => s.setActiveTab);
  const currentWorkspaceId = useAuthStore(s => s.currentWorkspaceId);
  const workspaces = useAuthStore(s => s.workspaces);

  // Setup completion criteria:
  // Brand new workspace has 0 transactions AND 0 accounts.
  const isCompletelyEmpty = rawTransactions.length === 0 && accounts.length === 0;
  // First-run setup (L-19): a signed-in workspace not set up yet and without entries (once its
  // entries have loaded). The wizard stays until finished, even after it posts the first entry.
  const isGuest = useAuthStore(s => s.isGuest);
  const transactionsLoaded = useDataNeedsStore(s => Boolean(s.loaded.transactions));
  const accountsLoaded = useDataNeedsStore(s => Boolean(s.loaded.accounts));
  const loadedWorkspaceId = useDataNeedsStore(s => s.loadedWorkspaceId);
  const transactionsFailure = useDataNeedsStore(s => s.failed.transactions);
  const accountsFailure = useDataNeedsStore(s => s.failed.accounts);
  const retryCollection = useDataNeedsStore(s => s.retry);
  const loadFailure = transactionsFailure || accountsFailure;
  const workspaceForSetup = workspaces.find(w => w.id === currentWorkspaceId);
  const needsSetup = !isGuest && Boolean(workspaceForSetup) && !workspaceForSetup?.setupCompletedAt && rawTransactions.length === 0;
  // Setup activity belongs to one workspace. Switching books must not reuse another draft.
  const [setupStartedFor, setSetupStartedFor] = useState<string | null>(null);
  const [setupClosedFor, setSetupClosedFor] = useState<string | null>(null);
  const setupStarted = Boolean(currentWorkspaceId && setupStartedFor === currentWorkspaceId);
  const setupClosed = Boolean(currentWorkspaceId && setupClosedFor === currentWorkspaceId);

  // Track setup checklist banner dismissal in localStorage
  const [isChecklistDismissed, setIsChecklistDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(`lf_checklist_dismissed_${currentWorkspaceId}`) === 'true';
    } catch {
      return false;
    }
  });

  const dismissChecklist = () => {
    setIsChecklistDismissed(true);
    try {
      if (currentWorkspaceId) {
        localStorage.setItem(`lf_checklist_dismissed_${currentWorkspaceId}`, 'true');
      }
    } catch {
      // ignore
    }
  };

  // Setup steps status
  const currentWorkspace = workspaces.find(w => w.id === currentWorkspaceId);
  const hasSelectedTemplate = Boolean(currentWorkspace?.businessType && currentWorkspace.businessType !== 'custom');
  const hasAccounts = accounts.length > 0;
  const hasTransactions = rawTransactions.length > 0;
  const setupStepCount = [hasSelectedTemplate, hasAccounts, hasTransactions].filter(Boolean).length;
  const isSetupIncomplete = setupStepCount < 3 && !isChecklistDismissed;

  // Never interpret a cleared cache or an old workspace's ready flags as a new set of books.
  // Wait for the actual workspace and both core snapshots before choosing the first-run screen.
  if (!isGuest && !setupStarted && (
    !workspaceForSetup || loadedWorkspaceId !== currentWorkspaceId || !transactionsLoaded || !accountsLoaded
  )) {
    return loadFailure && loadedWorkspaceId === currentWorkspaceId
      ? <div role="alert" className="p-8 text-center text-sm text-[var(--text)]">
          <p>Could not load your books. Check your connection, then retry the failed collection.</p>
          <button type="button" onClick={() => {
            if (transactionsFailure) retryCollection('transactions');
            if (accountsFailure) retryCollection('accounts');
          }} className="mt-4 min-h-11 rounded-xl bg-[var(--text)] px-5 py-2 text-xs font-bold text-[var(--surface)]">Try again</button>
        </div>
      : <LoadingState what="your books" rows={12} />;
  }

  if ((needsSetup || setupStarted) && !setupClosed) {
    return <SetupWizard onStarted={() => setSetupStartedFor(currentWorkspaceId)} onDone={() => setSetupClosedFor(currentWorkspaceId)} />;
  }

  // Only guest/demo books show the generic welcome screen. Signed-in workspaces use
  // their persisted setupCompletedAt and do not become 'new' when their history is empty.
  if (isGuest && isCompletelyEmpty) {
    return <OnboardingView />;
  }

  return (
    <div className="w-full p-4 sm:p-6 lg:p-8 space-y-6 max-w-[1360px] mx-auto text-[var(--text)]">
      {/* D-85: a short heading, then the numbers a shop owner opens the page for. */}
      <header className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[var(--line)]">
        <div className="min-w-0">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-[var(--muted)] mt-0.5">Cash, what customers owe you, what you owe, and profit for the selected period.</p>
        </div>
        <button
          type="button"
          onClick={() => setQuickEntryOpen(true)}
          className="flex min-h-11 items-center gap-1.5 rounded-lg bg-[var(--brass)] px-4 text-sm font-semibold text-[var(--ink)] hover:opacity-95 transition-opacity"
        >
          <Plus size={15} aria-hidden="true" />
          Add Entry
        </button>
      </header>

      <details className="border border-[var(--line)] rounded-xl p-4">
        <summary className="min-h-11 flex items-center cursor-pointer font-semibold focus-visible:outline-2 focus-visible:outline-[var(--brass)]">First-hour bookkeeping guide</summary>
        <FirstHourGuide />
      </details>

      <DashboardWidgets>
        <SinceLastVisitCard />
        <NeedsAttentionCard />
      {/* Setup Checklist Guidance Banner (when setup is incomplete) */}
      {isSetupIncomplete && (
        <div className="bg-[var(--panel)] border border-[var(--line)] rounded-2xl p-4 sm:p-5 relative">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-wider bg-[var(--brass)] text-[var(--ink)] px-2 py-0.5 rounded-md font-bold">
                  Setup {setupStepCount} of 3
                </span>
                <h2 className="text-sm font-semibold text-[var(--text)]">Finish setting up your books</h2>
              </div>
              <p className="text-xs text-[var(--muted)]">
                Choose a chart of accounts, import your history and check the balances. This checklist does not verify their accuracy.
              </p>
            </div>
            <button
              type="button"
              onClick={dismissChecklist}
              className="text-[var(--muted)] hover:text-[var(--text)] min-h-11 min-w-11 flex items-center justify-center rounded-lg hover:bg-[var(--surface)] transition-colors"
              title="Dismiss checklist"
              aria-label="Dismiss checklist">
              <X size={16} aria-hidden="true" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
            <button
              type="button"
              onClick={() => setTemplateSelectorOpen(true)}
              className={cn(
                "flex items-center gap-3 p-3 rounded-xl border text-left transition-colors min-h-11",
                hasAccounts
                  ? "bg-[var(--surface)] border-[var(--brass-line)]/50"
                  : "bg-[var(--panel)] border-[var(--brass-line)] hover:border-[var(--brass)]"
              )}
            >
              <div className={cn(
                "w-7 h-7 rounded-lg flex items-center justify-center shrink-0",
                hasAccounts ? "bg-emerald-500/10 text-emerald-500" : "bg-[var(--brass)]/10 text-[var(--brass)]"
              )}>
                {hasAccounts ? <CheckCircle2 size={16} aria-hidden="true" /> : <Layers size={16} aria-hidden="true" />}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[var(--text)] truncate">1. Chart of accounts</p>
                <p className="text-[10px] text-[var(--muted)] truncate">
                  {hasAccounts ? `${accounts.length} accounts set up` : 'Choose a starting list'}
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('banking')}
              className={cn(
                "flex items-center gap-3 p-3 rounded-xl border text-left transition-colors min-h-11",
                hasTransactions
                  ? "bg-[var(--surface)] border-[var(--brass-line)]/50"
                  : "bg-[var(--panel)] border-[var(--line)] hover:border-[var(--brass-line)]"
              )}
            >
              <div className={cn(
                "w-7 h-7 rounded-lg flex items-center justify-center shrink-0",
                hasTransactions ? "bg-emerald-500/10 text-emerald-500" : "bg-indigo-500/10 text-indigo-500"
              )}>
                {hasTransactions ? <CheckCircle2 size={16} aria-hidden="true" /> : <UploadCloud size={16} aria-hidden="true" />}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[var(--text)] truncate">2. Import your history</p>
                <p className="text-[10px] text-[var(--muted)] truncate">
                  {hasTransactions ? `${rawTransactions.length} entries recorded` : 'Connect a bank or import a CSV'}
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => hasTransactions ? setActiveTab('reconciliation') : setQuickEntryOpen(true)}
              className={cn(
                "flex items-center gap-3 p-3 rounded-xl border text-left transition-colors min-h-11",
                hasTransactions
                  ? "bg-[var(--surface)] border-[var(--brass-line)]/50"
                  : "bg-[var(--panel)] border-[var(--line)] hover:border-[var(--brass-line)]"
              )}
            >
              <div className={cn(
                "w-7 h-7 rounded-lg flex items-center justify-center shrink-0",
                hasTransactions ? "bg-emerald-500/10 text-emerald-500" : "bg-amber-500/10 text-amber-500"
              )}>
                {hasTransactions ? <CheckCircle2 size={16} aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[var(--text)] truncate">3. Check the balances</p>
                <p className="text-[10px] text-[var(--muted)] truncate">
                  {hasTransactions ? 'Reconcile and review the rules' : 'Record your first entry'}
                </p>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Saved Views & Default Lenses Bar */}
      <SavedViewsBar />

      </DashboardWidgets>
      <details className="border border-[var(--line)] rounded-xl p-4"><summary className="min-h-11 flex items-center cursor-pointer font-semibold">Live tax and spending planning</summary><p className="text-sm text-[var(--muted)] mb-3">This planner uses current cash and future assumptions independently of the dashboard reporting dates.</p><TaxReserveWidget /></details>
    </div>
  );
}
