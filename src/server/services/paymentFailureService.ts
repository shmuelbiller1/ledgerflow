import type { Firestore } from '../db/firestore';
import { FieldValue } from '../db/firestore';
import { formatMoney as formatCurrency } from '../../lib/moneyFormat';
import { notify } from './notificationService';

/**
 * Payments that did not go through, as Stripe tells us afterwards:
 * - S-05: a customer's bank payment for an invoice (paid from its link) failed. The invoice stays
 *   open; the people who keep the books are told so they can ask again.
 * - S-16: the workspace's own LedgerFlow plan could not be charged. The owners are told to update
 *   the card.
 * Each Stripe event is handled once (kept in `stripeProcessedEvents` with its outcome, which
 * Settings → Incoming events shows).
 */
type Result = 'recorded' | 'already_processed' | 'not_found';

interface SessionLike { metadata?: Record<string, string> | null; amount_total?: number | null; currency?: string | null }

export async function recordInvoicePaymentFailed(db: Firestore, eventId: string, eventType: string, session: SessionLike): Promise<Result> {
  const invoiceId = session.metadata?.invoiceId;
  const eventRef = db.collection('stripeProcessedEvents').doc(eventId);
  const found = await db.runTransaction(async t => {
    if ((await t.get(eventRef)).exists) return null;
    const invoice = invoiceId ? (await t.get(db.collection('invoices').doc(invoiceId))).data() : undefined;
    t.set(eventRef, {
      id: eventId, type: eventType, outcome: invoice ? 'payment_failed' : 'invoice_not_found',
      ...(invoice ? { workspaceId: invoice.workspaceId, invoiceId } : {}),
      ...(typeof session.amount_total === 'number' ? { amountCents: session.amount_total } : {}),
      processedAt: FieldValue.serverTimestamp(),
    });
    return { invoice };
  });
  if (!found) return 'already_processed';
  const invoice = found.invoice;
  if (!invoice || typeof invoice.workspaceId !== 'string') return 'not_found';
  const number = String(invoice.number || invoiceId);
  const currency = String(session.currency || invoice.currency || 'USD').toUpperCase();
  const amount = typeof session.amount_total === 'number' ? ` of ${formatCurrency(session.amount_total, currency)}` : '';
  await notify(db, {
    workspaceId: invoice.workspaceId, kind: 'payment.failed', title: `A payment for invoice ${number} failed`,
    message: `${String(invoice.customerName || 'The customer')}'s bank payment${amount} did not go through. The invoice is still open; they can pay again from its link.`,
    eventKey: `payment-failed:${eventId}`, recordId: invoiceId,
  });
  return 'recorded';
}

interface StripeInvoiceLike { customer?: string | { id: string } | null; subscription?: string | { id: string } | null; amount_due?: number | null; currency?: string | null }
const idOf = (v: string | { id: string } | null | undefined) => (typeof v === 'string' ? v : v?.id || '');

export async function recordSubscriptionPaymentFailed(db: Firestore, eventId: string, eventType: string, invoice: StripeInvoiceLike): Promise<Result> {
  const eventRef = db.collection('stripeProcessedEvents').doc(eventId);
  const subscriptionId = idOf(invoice.subscription);
  const customerId = idOf(invoice.customer);
  const workspaceId = await db.runTransaction(async t => {
    if ((await t.get(eventRef)).exists) return undefined;
    let found = subscriptionId ? await t.get(db.collection('workspaces').where('stripeSubscriptionId', '==', subscriptionId).limit(1)) : null;
    if ((!found || found.empty) && customerId) found = await t.get(db.collection('workspaces').where('stripeCustomerId', '==', customerId).limit(1));
    const id = found && !found.empty ? found.docs[0].id : '';
    t.set(eventRef, {
      id: eventId, type: eventType, outcome: id ? 'subscription_payment_failed' : 'no_workspace',
      ...(id ? { workspaceId: id } : {}),
      ...(typeof invoice.amount_due === 'number' ? { amountCents: invoice.amount_due } : {}),
      processedAt: FieldValue.serverTimestamp(),
    });
    return id;
  });
  if (workspaceId === undefined) return 'already_processed';
  if (!workspaceId) return 'not_found';
  const amount = typeof invoice.amount_due === 'number' ? ` (${formatCurrency(invoice.amount_due, String(invoice.currency || 'usd').toUpperCase())})` : '';
  await notify(db, {
    workspaceId, kind: 'subscription.payment_failed', title: 'Your LedgerFlow payment failed',
    message: `The card for your plan could not be charged${amount}. Update it in Settings → Billing to keep the plan.`,
    eventKey: `subscription-failed:${eventId}`,
  });
  return 'recorded';
}
