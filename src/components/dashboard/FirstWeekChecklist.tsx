import { useMemo, useState } from 'react';
import { CheckCircle2, Circle, X } from 'lucide-react';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { anyCollectionCapped } from '../../lib/ledgerCollections';
import { useUIStore } from '../../stores/useUIStore';
import {
  evaluateFirstWeekChecklist,
  loadFirstWeekDismissed,
  loadProfitAndLossVisited,
  saveFirstWeekDismissed,
  saveProfitAndLossVisited,
} from '../../lib/firstWeekChecklist';

/** The Overview's data-backed first-week guide; this is guidance, not a bookkeeping control. */
export default function FirstWeekChecklist() {
  const userId = useAuthStore(state => state.user?.uid);
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const isGuest = useAuthStore(state => state.isGuest && !state.user);
  const { loading } = useLedgerCollections('accounts', 'customers', 'invoices', 'payments');
  const accounts = useLedgerStore(state => state.accounts);
  const customers = useLedgerStore(state => state.customers);
  const invoices = useLedgerStore(state => state.invoices);
  const payments = useLedgerStore(state => state.payments);
  const truncated = useLedgerStore(state => state.truncatedCollections);
  const failed = useDataNeedsStore(state => state.failed);
  const retry = useDataNeedsStore(state => state.retry);
  const goToPage = useUIStore(state => state.goToPage);
  const [dismissed, setDismissed] = useState(() => loadFirstWeekDismissed(userId, workspaceId));
  const [profitAndLossVisited, setProfitAndLossVisited] = useState(() => loadProfitAndLossVisited(userId, workspaceId));

  const steps = useMemo(() => evaluateFirstWeekChecklist({
    workspaceId: workspaceId || '', accounts, customers, invoices, payments, profitAndLossVisited,
  }), [workspaceId, accounts, customers, invoices, payments, profitAndLossVisited]);

  if (isGuest || !workspaceId || dismissed) return null;

  const failedCollections = (['accounts', 'customers', 'invoices', 'payments'] as const).filter(key => Boolean(failed[key]));
  if (failedCollections.length) {
    return (
      <section aria-labelledby="first-week-heading" className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 sm:p-5">
        <h2 id="first-week-heading" className="text-sm font-bold text-[var(--text)]">Your first week</h2>
        <p role="alert" className="mt-2 text-sm text-[var(--muted)]">Could not load the records for this checklist, so progress is not shown.</p>
        <button type="button" onClick={() => failedCollections.forEach(key => retry(key))} className="mt-3 min-h-11 rounded-lg border border-[var(--line)] px-3 text-sm font-semibold text-[var(--text)]">Retry checklist</button>
      </section>
    );
  }
  if (loading) {
    return <section aria-labelledby="first-week-heading" className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 sm:p-5"><h2 id="first-week-heading" className="text-sm font-bold text-[var(--text)]">Your first week</h2><p role="status" className="mt-2 text-sm text-[var(--muted)]">Loading your checklist…</p></section>;
  }

  const completed = steps.filter(step => step.done).length;
  if (completed === steps.length) return null;

  const openStep = (step: typeof steps[number]) => {
    if (step.id === 'profit-and-loss') {
      saveProfitAndLossVisited(userId, workspaceId);
      setProfitAndLossVisited(true);
    }
    goToPage(step.page);
  };

  return (
    <section aria-labelledby="first-week-heading" className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-[var(--muted)]">{completed} of {steps.length} steps complete</p>
          <h2 id="first-week-heading" className="mt-1 text-sm font-bold text-[var(--text)]">Your first week</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Build a few real records, then review your first report. Steps update from this workspace’s saved records.</p>
        </div>
        <button type="button" onClick={() => { saveFirstWeekDismissed(userId, workspaceId); setDismissed(true); }} aria-label="Hide first-week checklist" title="Hide checklist" className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--panel)] focus-visible:outline-2 focus-visible:outline-[var(--brass)]">
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      {anyCollectionCapped(truncated, ['accounts', 'customers', 'invoices', 'payments']) && <p role="note" className="mt-3 text-xs text-[var(--muted)]">Some older records are outside the loaded list. Unfinished steps may already be complete.</p>}
      <ol className="mt-3 divide-y divide-[var(--line)]">
        {steps.map(step => (
          <li key={step.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <div className="flex min-w-0 items-start gap-3">
              {step.done ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[var(--pos)]" aria-label="Complete" /> : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--muted)]" aria-hidden="true" />}
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-[var(--text)]">{step.title}</h3>
                <p className="mt-0.5 text-xs text-[var(--muted)]">{step.description}</p>
              </div>
            </div>
            {!step.done && <button type="button" onClick={() => openStep(step)} className="min-h-11 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 text-sm font-semibold text-[var(--text)] hover:bg-[var(--elevated)] focus-visible:outline-2 focus-visible:outline-[var(--brass)]">{step.action}</button>}
          </li>
        ))}
      </ol>
    </section>
  );
}
