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
import { fillOnboarding } from '../../lib/i18n/onboardingTranslations';
import { firstWeekStepText, overviewText } from '../../lib/i18n/overviewTranslations';
import { directionOf, useUiLanguage } from '../../lib/i18n/useUiLanguage';

/**
 * The Overview's data-backed first-week guide; this is guidance, not a bookkeeping control.
 *
 * AI12-N10-01 (#838): the checklist's words, its progress sentence and its actions follow the
 * selected UI language. The count itself is isolated between the two sentences so "0 מתוך 5 שלבים
 * הושלמו" keeps its reading order in a right-to-left page. Which records complete a step is
 * unchanged (`evaluateFirstWeekChecklist`).
 */
export default function FirstWeekChecklist() {
  const language = useUiLanguage();
  const t = (key: Parameters<typeof overviewText>[0]) => overviewText(key, language);
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
  const shown = useMemo(() => steps.map(step => ({ ...step, ...firstWeekStepText(step, language) })), [steps, language]);

  if (isGuest || !workspaceId || dismissed) return null;

  const failedCollections = (['accounts', 'customers', 'invoices', 'payments'] as const).filter(key => Boolean(failed[key]));
  if (failedCollections.length) {
    return (
      <section lang={language} dir={directionOf(language)} aria-labelledby="first-week-heading" className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 sm:p-5">
        <h2 id="first-week-heading" className="text-sm font-bold text-[var(--text)]">{t('firstWeek.heading')}</h2>
        <p role="alert" className="mt-2 text-sm text-[var(--muted)]">{t('firstWeek.failed')}</p>
        <button type="button" onClick={() => failedCollections.forEach(key => retry(key))} className="mt-3 min-h-11 rounded-lg border border-[var(--line)] px-3 text-sm font-semibold text-[var(--text)]">{t('firstWeek.retry')}</button>
      </section>
    );
  }
  if (loading) {
    return <section lang={language} dir={directionOf(language)} aria-labelledby="first-week-heading" className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 sm:p-5"><h2 id="first-week-heading" className="text-sm font-bold text-[var(--text)]">{t('firstWeek.heading')}</h2><p role="status" className="mt-2 text-sm text-[var(--muted)]">{t('firstWeek.loading')}</p></section>;
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
    <section lang={language} dir={directionOf(language)} aria-labelledby="first-week-heading" className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          {/* The count is filled into the translated sentence, so it keeps the sentence's own reading order. */}
          <p className="text-xs font-semibold text-[var(--muted)]">{fillOnboarding(
            t('firstWeek.progress'), { done: completed, total: steps.length })}</p>
          <h2 id="first-week-heading" className="mt-1 text-sm font-bold text-[var(--text)]">{t('firstWeek.heading')}</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">{t('firstWeek.intro')}</p>
        </div>
        <button type="button" onClick={() => { saveFirstWeekDismissed(userId, workspaceId); setDismissed(true); }} aria-label={t('firstWeek.hide')} title={t('firstWeek.hideTitle')} className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--panel)] focus-visible:outline-2 focus-visible:outline-[var(--brass)]">
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      {anyCollectionCapped(truncated, ['accounts', 'customers', 'invoices', 'payments']) && <p role="note" className="mt-3 text-xs text-[var(--muted)]">{t('firstWeek.capped')}</p>}
      <ol className="mt-3 divide-y divide-[var(--line)]">
        {shown.map(step => (
          <li key={step.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <div className="flex min-w-0 items-start gap-3">
              {step.done ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[var(--pos)]" aria-label={t('firstWeek.complete')} /> : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--muted)]" aria-hidden="true" />}
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
