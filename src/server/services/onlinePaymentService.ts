/**
 * A customer paid an invoice online through its payment link (K-11: /i/:token → Stripe Checkout).
 * Stripe's webhook calls this once per event. The money is recorded exactly like a payment a
 * person records (paymentService.createPaymentInTransaction): a payment record, the invoice's
 * paid amount and status, and one ledger entry in the home currency. It lands in a "Stripe
 * Clearing" account (Stripe pays out to the bank later, minus its fees). Replays of the same
 * event do nothing; a payment in another currency than the invoice's is not booked.
 * INT-7: money above what is still due (the invoice was paid by hand meanwhile, or twice online) is never applied
 * twice: it is the customer's credit, kept in Customer Deposits (created on first use, so A/R never goes below
 * zero), and the payment is flagged for refund review with a notice to the books' people.
 */
import type { DocumentData, Firestore } from '../db/firestore';
import { createPaymentInTransaction } from './paymentService';
import { notify } from './notificationService';
import { advanceAccount } from '../../lib/advancePayments';
import type { ChartAccount } from '../../types';
import { afterPaymentRecorded } from './afterPayment';
import { logger } from '../utils/logger';
import { calculateAmountDue } from '../../lib/documentMath';
import { formatTzDate } from '../../lib/calendarDate';

export interface StripeInvoiceSession {
  id: string;
  payment_status?: string | null;
  amount_total?: number | null;
  currency?: string | null;
  payment_intent?: string | { id?: string } | null;
  metadata?: Record<string, string> | null;
}

export type OnlinePaymentResult =
  | { status: 'recorded'; paymentId: string; overpaidCents?: number }
  | { status: 'already_processed' | 'pending' | 'not_found' | 'currency_mismatch' | 'nothing_due' };

/** The workspace's Stripe clearing account, created on first use. */
async function clearingAccountId(db: Firestore, workspaceId: string): Promise<string> {
  const accounts = await db.collection('chartAccounts').where('workspaceId', '==', workspaceId).get();
  const existing = accounts.docs.find(d => {
    const a = d.data();
    return String(a.type).toLowerCase() === 'asset' && (a.subtype === 'payment_clearing' || /stripe/i.test(String(a.name || '')));
  });
  if (existing) return existing.id;
  const id = `${workspaceId}_stripe_clearing`;
  const ref = db.collection('chartAccounts').doc(id);
  if (!(await ref.get()).exists) {
    await ref.set({
      id, uid: 'system', workspaceId, name: 'Stripe Clearing', code: '1015', type: 'asset', subtype: 'cash', category: 'Cash',
      description: 'Online card payments received, until Stripe pays them out to the bank', isSystem: false,
      createdAt: new Date().toISOString(),
    });
  }
  return id;
}

/** INT-7: where a customer's overpayment waits — the chart's Customer Deposits account, created on first use. */
async function ensureCustomerDeposits(db: Firestore, workspaceId: string, mappings?: Record<string, string | undefined>): Promise<void> {
  const chart = (await db.collection('chartAccounts').where('workspaceId', '==', workspaceId).get()).docs.map(d => ({ ...d.data(), id: d.id }) as ChartAccount);
  if (advanceAccount(chart, 'received', mappings)) return;
  const id = `${workspaceId}_customer_deposits`;
  const ref = db.collection('chartAccounts').doc(id);
  if (!(await ref.get()).exists) {
    await ref.set({
      id, uid: 'system', workspaceId, name: 'Customer Deposits', code: '2150', type: 'liability', category: 'Current Liabilities',
      description: 'Money customers paid before or above an invoice, until it is applied or refunded', isSystem: false,
      createdAt: new Date().toISOString(),
    });
  }
}

/** A Customer Deposits account was missing when the overpayment was found inside the transaction: try again. */
class RetryOverpayment extends Error {}

export async function recordStripeInvoicePayment(db: Firestore, eventId: string, eventType: string, session: StripeInvoiceSession): Promise<OnlinePaymentResult> {
  const invoiceId = session.metadata?.invoiceId;
  const eventRef = db.collection('stripeProcessedEvents').doc(eventId);
  // every outcome is kept, with the workspace when known, for Settings → Incoming events (K-37)
  const markEvent = (note: string, workspaceId?: string) => eventRef.set({ id: eventId, type: eventType, sessionId: session.id, note, outcome: note, ...(workspaceId ? { workspaceId } : {}), ...(invoiceId ? { invoiceId: String(invoiceId) } : {}), processedAt: new Date().toISOString() });
  if ((await eventRef.get()).exists) return { status: 'already_processed' };

  const invoiceRef = db.collection('invoices').doc(String(invoiceId || ''));
  const invoice = invoiceId ? (await invoiceRef.get()).data() : undefined;
  if (!invoice || !invoice.workspaceId || (session.metadata?.workspaceId && session.metadata.workspaceId !== invoice.workspaceId)) {
    await markEvent('invoice_not_found');
    return { status: 'not_found' };
  }
  const workspaceId = String(invoice.workspaceId);
  const workspace = (await db.collection('workspaces').doc(workspaceId).get()).data() || {};

  if (session.payment_status !== 'paid') {
    // e.g. a bank debit still clearing: the next event (async_payment_succeeded) records it
    await invoiceRef.update({ paymentStatus: 'pending_settlement', updatedAt: new Date().toISOString() });
    await markEvent('pending', workspaceId);
    return { status: 'pending' };
  }

  const invoiceCurrency = String(invoice.currency || workspace.currency || 'USD').toLowerCase();
  if (String(session.currency || '').toLowerCase() !== invoiceCurrency) {
    logger.warn('online payment currency differs from the invoice; not booked', { workspaceId, invoiceId, sessionId: session.id });
    await markEvent('currency_mismatch', workspaceId);
    return { status: 'currency_mismatch' };
  }

  const paidCents = Math.max(0, Math.round(Number(session.amount_total) || 0));
  const dueCents = calculateAmountDue(invoice as DocumentData);
  if (paidCents <= 0) {
    await markEvent('nothing_paid', workspaceId);
    return { status: 'nothing_due' };
  }
  const cashAccountId = await clearingAccountId(db, workspaceId);
  // INT-7: more than is due → its own account first, so the rest never sits on A/R
  const mappings = workspace.defaultAccountMappings as Record<string, string | undefined> | undefined;
  if (paidCents > dueCents) await ensureCustomerDeposits(db, workspaceId, mappings);
  const paymentIntent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
  const today = formatTzDate(new Date(), typeof workspace.timezone === 'string' ? workspace.timezone : 'UTC');

  const run = () => db.runTransaction(async (t) => {
    if ((await t.get(eventRef)).exists) return null;
    // what is due now, inside the transaction: a payment recorded by hand a moment ago counts
    const current = (await t.get(invoiceRef)).data() || invoice;
    const due = calculateAmountDue(current as DocumentData);
    const overpaidCents = Math.max(0, paidCents - due);
    if (overpaidCents > 0) {
      const chart = (await t.get(db.collection('chartAccounts').where('workspaceId', '==', workspaceId))).docs.map(d => ({ ...d.data(), id: d.id }) as ChartAccount);
      if (!advanceAccount(chart, 'received', mappings)) throw new RetryOverpayment();
    }
    const payment = await createPaymentInTransaction(db, t, {
      workspaceId,
      uid: 'system',
      paymentDate: today,
      amountCents: paidCents,
      paymentMethod: 'card',
      referenceNumber: paymentIntent || session.id,
      memo: `Paid online (Stripe ${session.id})`,
      customerId: invoice.customerId ? String(invoice.customerId) : undefined,
      entityName: String(invoice.customerName || ''),
      cashAccountId,
      // anything above what is due stays on the payment as unapplied (a credit for the customer)
      allocations: due > 0 ? [{ documentId: invoiceRef.id, documentType: 'invoice', amountCents: Math.min(paidCents, due) }] : [],
    });
    if (overpaidCents > 0) {
      t.update(db.collection('payments').doc(payment.paymentId), {
        refundReview: { status: 'open', overpaidCents, invoiceId: invoiceRef.id, reason: due > 0 ? 'paid_more_than_due' : 'invoice_already_paid', flaggedAt: new Date().toISOString() },
      });
    }
    t.set(eventRef, { id: eventId, type: eventType, sessionId: session.id, paymentId: payment.paymentId, outcome: overpaidCents > 0 ? 'recorded_overpaid' : 'recorded', workspaceId, invoiceId: invoiceRef.id, amountCents: paidCents, ...(overpaidCents > 0 ? { overpaidCents } : {}), processedAt: new Date().toISOString() });
    return { ...payment, overpaidCents };
  });
  let result: Awaited<ReturnType<typeof run>>;
  try {
    result = await run();
  } catch (err) {
    if (!(err instanceof RetryOverpayment)) throw err;
    // paid by hand between the first read and the transaction: make the deposits account, then once more
    await ensureCustomerDeposits(db, workspaceId, mappings);
    result = await run();
  }
  if (!result) return { status: 'already_processed' };
  await afterPaymentRecorded(db, result.payment);
  if (result.overpaidCents > 0) {
    const money = (cents: number) => `${(cents / 100).toFixed(2)} ${String(invoice.currency || workspace.currency || 'USD').toUpperCase()}`;
    await notify(db, {
      workspaceId, kind: 'payment.received', workspace, recordId: result.paymentId, eventKey: `refund-review:${result.paymentId}`,
      title: `Overpaid online: ${money(result.overpaidCents)} to review for a refund`,
      message: `${String(invoice.customerName || 'A customer')} paid ${money(paidCents)} online for invoice ${String(invoice.number || invoiceRef.id)}, ${money(result.overpaidCents)} more than was due. It is kept as the customer's credit (Customer Deposits) and was not applied twice; refund it or apply it to another invoice.`,
    }).catch(err => logger.warn('refund review notice not sent', { workspaceId, paymentId: result?.paymentId, error: err instanceof Error ? err.message : String(err) }));
  }
  return { status: 'recorded', paymentId: result.paymentId, ...(result.overpaidCents > 0 ? { overpaidCents: result.overpaidCents } : {}) };
}
