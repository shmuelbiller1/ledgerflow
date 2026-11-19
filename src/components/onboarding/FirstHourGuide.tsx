import { useUIStore } from '../../stores/useUIStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { overviewText } from '../../lib/i18n/overviewTranslations';
import { directionOf, useUiLanguage } from '../../lib/i18n/useUiLanguage';

/**
 * Navigation only: visiting a step is not evidence that a financial action succeeded.
 *
 * AI12-N10-01 (#838): the eight steps, their descriptions, their actions and the notes around them
 * follow the selected UI language. The step each button opens, and the fact that a visit marks
 * nothing complete, are unchanged.
 */
export default function FirstHourGuide() {
  const language = useUiLanguage();
  const t = (key: Parameters<typeof overviewText>[0]) => overviewText(key, language);
  const goToPage = useUIStore(s => s.goToPage);
  const setTemplateSelectorOpen = useUIStore(s => s.setTemplateSelectorOpen);
  const isGuest = useAuthStore(s => s.isGuest && !s.user);
  const signIn = () => useAuthStore.getState().setIsGuest(false);
  const steps = [
    { id: 'step1', title: t('firstHour.step1.title'), description: t('firstHour.step1.description'), action: t('firstHour.step1.action'), open: () => setTemplateSelectorOpen(true) },
    { id: 'step2', title: t('firstHour.step2.title'), description: t('firstHour.step2.description'), action: t('firstHour.step2.action'), open: () => goToPage({ tab: 'sales' }) },
    { id: 'step3', title: t('firstHour.step3.title'), description: t('firstHour.step3.description'), action: t('firstHour.step3.action'), open: () => goToPage({ tab: 'sales' }) },
    { id: 'step4', title: t('firstHour.step4.title'), description: t('firstHour.step4.description'), action: t('firstHour.step4.action'), open: () => goToPage({ tab: 'purchases' }) },
    { id: 'step5', title: t('firstHour.step5.title'), description: t('firstHour.step5.description'), action: t('firstHour.step5.action'), open: () => goToPage({ tab: 'sales' }) },
    { id: 'step6', title: t('firstHour.step6.title'), description: t('firstHour.step6.description'), action: t('firstHour.step6.action'), open: () => goToPage({ tab: 'banking' }) },
    { id: 'step7', title: t('firstHour.step7.title'), description: t('firstHour.step7.description'), action: t('firstHour.step7.action'), open: () => goToPage({ tab: 'reconciliation' }) },
    { id: 'step8', title: t('firstHour.step8.title'), description: t('firstHour.step8.description'), action: t('firstHour.step8.action'), open: () => goToPage({ tab: 'reports', sub: 'pnl' }) },
  ];

  return (
    <section lang={language} dir={directionOf(language)} aria-label={t('firstHour.region')} className="space-y-4 text-start">
      {isGuest ? (
        <div role="note" className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4 space-y-3">
          <p className="text-sm font-semibold text-[var(--text)]">{t('firstHour.guest.title')}</p>
          <p className="text-sm text-[var(--muted)]">{t('firstHour.guest.body')}</p>
          <button type="button" onClick={signIn} className="min-h-11 px-4 py-2 rounded-lg border border-[var(--line)] font-semibold text-sm focus-visible:outline-2 focus-visible:outline-[var(--brass)]">{t('firstHour.guest.signIn')}</button>
        </div>
      ) : (
        <p className="text-sm text-[var(--muted)]">{t('firstHour.intro')}</p>
      )}
      <ol className="grid gap-3 sm:grid-cols-2">
        {steps.map((step, index) => (
          <li key={step.id} className="min-w-0 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 flex flex-col gap-2">
            <h2 className="font-semibold text-sm text-[var(--text)]">{index + 1}. {step.title}</h2>
            <p className="text-sm text-[var(--muted)] flex-1">{step.description}</p>
            <button type="button" onClick={step.open} className="min-h-11 px-3 py-2 rounded-lg border border-[var(--line)] text-sm font-semibold text-[var(--text)] hover:bg-[var(--surface)] focus-visible:outline-2 focus-visible:outline-[var(--brass)]">{step.action}</button>
          </li>
        ))}
      </ol>
      <p className="text-sm text-[var(--muted)]">{isGuest ? t('firstHour.footer.guest') : t('firstHour.footer.signedIn')} {t('firstHour.footer.limits')}</p>
      <button type="button" onClick={() => goToPage({ tab: 'help' })} className="min-h-11 px-3 py-2 rounded-lg border border-[var(--line)] text-sm font-semibold focus-visible:outline-2 focus-visible:outline-[var(--brass)]">{t('firstHour.openHelp')}</button>
    </section>
  );
}
