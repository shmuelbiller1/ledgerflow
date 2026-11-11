import { useUIStore } from '../../stores/useUIStore';
import { useAuthStore } from '../../stores/useAuthStore';

/** Navigation only: visiting a step is not evidence that a financial action succeeded. */
export default function FirstHourGuide() {
  const goToPage = useUIStore(s => s.goToPage);
  const setTemplateSelectorOpen = useUIStore(s => s.setTemplateSelectorOpen);
  const isGuest = useAuthStore(s => s.isGuest && !s.user);
  const signIn = () => useAuthStore.getState().setIsGuest(false);
  const steps = [
    { title: 'Choose accounts', description: 'After saving your business details in setup, choose a chart of accounts. Review it before recording entries.', action: 'Choose accounts', open: () => setTemplateSelectorOpen(true) },
    { title: 'Add a customer', description: 'In Sales, open Customers, then Add Customer. Keep names and addresses in their original language.', action: 'Open customers', open: () => goToPage({ tab: 'sales' }) },
    { title: 'Create an invoice', description: 'In Sales, choose Add Invoice. Select the customer, date, account and amount. A draft is not a posted sale.', action: 'Open invoices', open: () => goToPage({ tab: 'sales' }) },
    { title: 'Record a bill', description: 'In Purchases, add a vendor, then choose Record Bill. Review the account, date and amount before saving.', action: 'Open bills', open: () => goToPage({ tab: 'purchases' }) },
    { title: 'Record a payment', description: 'Open an unpaid invoice in Sales and use Receive Payment. For a bill payment, use Purchases. Recording a payment does not send money through your bank.', action: 'Open unpaid invoices', open: () => goToPage({ tab: 'sales' }) },
    { title: 'Import a bank statement', description: 'In Bank Connections, choose Import statement and review the file mapping. Importing bank lines does not mean they have been reconciled.', action: 'Open bank import', open: () => goToPage({ tab: 'banking' }) },
    { title: 'Reconcile the bank', description: 'Match imported bank lines to existing entries and review differences. Check the statement dates and closing balance before completing reconciliation.', action: 'Open reconciliation', open: () => goToPage({ tab: 'reconciliation' }) },
    { title: 'Review profit and loss', description: 'Choose the reporting dates and Generate. Check the results against your posted documents; a balanced report alone does not prove the books are correct.', action: 'Open profit and loss', open: () => goToPage({ tab: 'reports', sub: 'pnl' }) },
  ];

  return (
    <section aria-label="First-hour bookkeeping guide" className="space-y-4 text-left">
      {isGuest ? (
        <div role="note" className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4 space-y-3">
          <p className="text-sm font-semibold text-[var(--text)]">Try bookkeeping in the sample company</p>
          <p className="text-sm text-[var(--muted)]">Try creating invoices, contacts and other local sample records. Saved sample records stay in this browser tab after a refresh; leaving the demo discards them. Server-only tools and file attachments still need sign-in.</p>
          <button type="button" onClick={signIn} className="min-h-11 px-4 py-2 rounded-lg border border-[var(--line)] font-semibold text-sm focus-visible:outline-2 focus-visible:outline-[var(--brass)]">Sign in to start bookkeeping</button>
        </div>
      ) : (
        <p className="text-sm text-[var(--muted)]">Start with a small set of test records. These links open the existing screens; they do not save records or mark steps complete. Return to Overview to continue this guide.</p>
      )}
      <ol className="grid gap-3 sm:grid-cols-2">
        {steps.map((step, index) => (
          <li key={step.title} className="min-w-0 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 flex flex-col gap-2">
            <h2 className="font-semibold text-sm text-[var(--text)]">{index + 1}. {step.title}</h2>
            <p className="text-sm text-[var(--muted)] flex-1">{step.description}</p>
            <button type="button" onClick={step.open} className="min-h-11 px-3 py-2 rounded-lg border border-[var(--line)] text-sm font-semibold text-[var(--text)] hover:bg-[var(--surface)] focus-visible:outline-2 focus-visible:outline-[var(--brass)]">{step.action}</button>
          </li>
        ))}
      </ol>
      <p className="text-sm text-[var(--muted)]">{isGuest ? 'Sample records are practice only, not your real books.' : 'Cannot save? Check the message beside the field and your workspace role. If data did not load, use Data Status to retry.'} Unverified tax filing and live bank payments are not part of this walkthrough.</p>
      <button type="button" onClick={() => goToPage({ tab: 'help' })} className="min-h-11 px-3 py-2 rounded-lg border border-[var(--line)] text-sm font-semibold focus-visible:outline-2 focus-visible:outline-[var(--brass)]">Open help and guide</button>
    </section>
  );
}
