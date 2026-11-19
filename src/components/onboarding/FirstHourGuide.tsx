import { useUIStore } from '../../stores/useUIStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { onboardingText } from '../../lib/i18n/onboardingTranslations';
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
  const t = (key: Parameters<typeof onboardingText>[0], fallback: string) => onboardingText(key, language, fallback);
  const goToPage = useUIStore(s => s.goToPage);
  const setTemplateSelectorOpen = useUIStore(s => s.setTemplateSelectorOpen);
  const isGuest = useAuthStore(s => s.isGuest && !s.user);
  const signIn = () => useAuthStore.getState().setIsGuest(false);
  const steps = [
    { id: 'step1', title: t('firstHour.step1.title', 'Choose accounts'), description: t('firstHour.step1.description', 'After saving your business details in setup, choose a chart of accounts. Review it before recording entries.'), action: t('firstHour.step1.action', 'Choose accounts'), open: () => setTemplateSelectorOpen(true) },
    { id: 'step2', title: t('firstHour.step2.title', 'Add a customer'), description: t('firstHour.step2.description', 'In Sales, open Customers, then Add Customer. Keep names and addresses in their original language.'), action: t('firstHour.step2.action', 'Open customers'), open: () => goToPage({ tab: 'sales' }) },
    { id: 'step3', title: t('firstHour.step3.title', 'Create an invoice'), description: t('firstHour.step3.description', 'In Sales, choose Add Invoice. Select the customer, date, account and amount. A draft is not a posted sale.'), action: t('firstHour.step3.action', 'Open invoices'), open: () => goToPage({ tab: 'sales' }) },
    { id: 'step4', title: t('firstHour.step4.title', 'Record a bill'), description: t('firstHour.step4.description', 'In Purchases, add a vendor, then choose Record Bill. Review the account, date and amount before saving.'), action: t('firstHour.step4.action', 'Open bills'), open: () => goToPage({ tab: 'purchases' }) },
    { id: 'step5', title: t('firstHour.step5.title', 'Record a payment'), description: t('firstHour.step5.description', 'Open an unpaid invoice in Sales and use Receive Payment. For a bill payment, use Purchases. Recording a payment does not send money through your bank.'), action: t('firstHour.step5.action', 'Open unpaid invoices'), open: () => goToPage({ tab: 'sales' }) },
    { id: 'step6', title: t('firstHour.step6.title', 'Import a bank statement'), description: t('firstHour.step6.description', 'In Bank Connections, choose Import statement and review the file mapping. Importing bank lines does not mean they have been reconciled.'), action: t('firstHour.step6.action', 'Open bank import'), open: () => goToPage({ tab: 'banking' }) },
    { id: 'step7', title: t('firstHour.step7.title', 'Reconcile the bank'), description: t('firstHour.step7.description', 'Select a bank line and its entry under To review. Check the dates and amounts before confirming. A match is not a statement close.'), action: t('firstHour.step7.action', 'Open reconciliation'), open: () => goToPage({ tab: 'reconciliation' }) },
    { id: 'step8', title: t('firstHour.step8.title', 'Review profit and loss'), description: t('firstHour.step8.description', 'Choose the reporting dates and Generate. Check the results against your posted documents; a balanced report alone does not prove the books are correct.'), action: t('firstHour.step8.action', 'Open profit and loss'), open: () => goToPage({ tab: 'reports', sub: 'pnl' }) },
  ];

  return (
    <section lang={language} dir={directionOf(language)} aria-label={t('firstHour.region', 'First-hour bookkeeping guide')} className="space-y-4 text-start">
      {isGuest ? (
        <div role="note" className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4 space-y-3">
          <p className="text-sm font-semibold text-[var(--text)]">{t('firstHour.guest.title', 'Try bookkeeping in the sample company')}</p>
          <p className="text-sm text-[var(--muted)]">{t('firstHour.guest.body', 'Try creating invoices, contacts and other local sample records. Saved sample records stay in this browser tab after a refresh; leaving the demo discards them. Server-only tools and file attachments still need sign-in.')}</p>
          <button type="button" onClick={signIn} className="min-h-11 px-4 py-2 rounded-lg border border-[var(--line)] font-semibold text-sm focus-visible:outline-2 focus-visible:outline-[var(--brass)]">{t('firstHour.guest.signIn', 'Sign in to start bookkeeping')}</button>
        </div>
      ) : (
        <p className="text-sm text-[var(--muted)]">{t('firstHour.intro', 'Start with a small set of test records. These links open the existing screens; they do not save records or mark steps complete. Return to Overview to continue this guide.')}</p>
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
      <p className="text-sm text-[var(--muted)]">{isGuest ? t('firstHour.footer.guest', 'Sample records are practice only, not your real books.') : t('firstHour.footer.signedIn', 'Cannot save? Check the message beside the field and your workspace role. If data did not load, use Data Status to retry.')} {t('firstHour.footer.limits', 'Unverified tax filing and live bank payments are not part of this walkthrough.')}</p>
      <button type="button" onClick={() => goToPage({ tab: 'help' })} className="min-h-11 px-3 py-2 rounded-lg border border-[var(--line)] text-sm font-semibold focus-visible:outline-2 focus-visible:outline-[var(--brass)]">{t('firstHour.openHelp', 'Open help and guide')}</button>
    </section>
  );
}
