import express from 'express';
import { z } from 'zod';
import { getDb } from '../db/firestore';
import { getTrustedAppUrl } from '../utils/urlHelper';
import { calculateAmountDue, depositAppliedCents } from '../../lib/documentMath';
import { computePlatformFeeQuote } from '../../lib/paymentVolumeFee';
import { checkoutIdempotencyKey, checkoutParamsFingerprint, getStripe, isIdempotencyInFlight } from '../services/stripeService';
import { publicPortalRouter } from './customerPortalRoutes';
import { publicEstimateRouter } from './estimateSignRoutes';
import { recordInvoiceView } from '../services/invoiceViewService';

export const publicInvoiceRouter = express.Router();

/**
 * The business's own connected Stripe account, the only place an invoice payment may go. Without one the
 * checkout would run on the platform's Stripe account: the money would land with the platform while the
 * business's books marked the invoice paid. So no connected account means no online payment (fail closed).
 */
function connectedPayoutAccount(ws: Record<string, unknown> | undefined): string | null {
  const id = ws?.stripeConnectAccountId;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}
async function workspaceOf(db: ReturnType<typeof getDb>, workspaceId: unknown): Promise<Record<string, unknown> | undefined> {
  if (typeof workspaceId !== 'string' || !workspaceId) return undefined;
  try {
    const snap = await db.collection('workspaces').doc(workspaceId).get();
    return snap?.exists ? snap.data() : undefined;
  } catch {
    return undefined;
  }
}
// the customer portal (K-27) shares this public route and its rate limit: /api/v1/invoices/public/portal/<token>
publicInvoiceRouter.use('/portal', publicPortalRouter);
// signing an estimate (Y-20): /api/v1/invoices/public/estimate/<token>
publicInvoiceRouter.use('/estimate', publicEstimateRouter);

const publicInvoiceTokenParamsSchema = z.object({
  token: z.string().regex(/^pay_[a-zA-Z0-9_-]{10,128}$/, 'Invalid payment token format')
});

const publicInvoicePayBodySchema = z.object({
  paymentMethod: z.string().optional()
}).passthrough();

publicInvoiceRouter.get('/:token', async (req, res) => {
  try {
    const parsedParams = publicInvoiceTokenParamsSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid token format', details: parsedParams.error.issues });
    }
    const { token } = parsedParams.data;
    const db = getDb();
    
    // Check top-level collection first, with collectionGroup fallback
    let snapshot = await db.collection('invoices').where('paymentToken', '==', token).limit(1).get();
    if (snapshot.empty) {
      snapshot = await db.collectionGroup('invoices').where('paymentToken', '==', token).limit(1).get();
    }
    
    if (snapshot.empty) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const doc = snapshot.docs[0];
    const invoice = doc.data();

    // A8-023: never expose internal draft, void, cancelled, or rejected invoices on the unauthenticated link
    if (['draft', 'void', 'voided', 'cancelled', 'rejected'].includes(String(invoice.status || '').toLowerCase())) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    interface RawInvoiceLine { description?: string; quantity?: number; unitPriceCents?: number; amountCents?: number }
    const lineTotal = Array.isArray(invoice.lines) 
      ? (invoice.lines as RawInvoiceLine[]).reduce((sum: number, l: RawInvoiceLine) => {
          const lineAmt = typeof l.amountCents === 'number' 
            ? l.amountCents 
            : Math.round((Number(l.quantity) || 1) * (Number(l.unitPriceCents) || 0));
          return sum + lineAmt;
        }, 0)
      : 0;

    const totalInvoiceAmount = typeof invoice.amountCents === 'number'
      ? invoice.amountCents
      : lineTotal;
    const amountPaid = typeof invoice.amountPaidCents === 'number' 
      ? invoice.amountPaidCents 
      : 0;
    // What is still due, by the one money rule (discounts, retainage, credits, payments)
    const remainingBalance = calculateAmountDue(invoice);
    // S-02: the customer opened it (recorded before answering: work after the answer may not run on the host)
    if (!['draft', 'void', 'voided'].includes(String(invoice.status || '').toLowerCase())) await recordInvoiceView(db, doc.ref, invoice);
    const payOnline = Boolean(connectedPayoutAccount(await workspaceOf(db, invoice.workspaceId)));

    res.json({
      invoice: {
        id: invoice.id || doc.id,
        number: invoice.number,
        date: invoice.date,
        dueDate: invoice.dueDate,
        status: invoice.status,
        amountCents: totalInvoiceAmount,
        amountPaidCents: amountPaid,
        depositCents: depositAppliedCents(invoice),
        remainingBalanceCents: remainingBalance,
        currency: invoice.currency || 'USD',
        customerName: invoice.customerName,
        paymentToken: invoice.paymentToken,
        // the business connected its own Stripe account: only then can this invoice be paid online
        payOnline,
        lines: Array.isArray(invoice.lines) ? (invoice.lines as RawInvoiceLine[]).map((l: RawInvoiceLine) => ({
          description: l.description,
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
          amountCents: typeof l.amountCents === 'number' ? l.amountCents : Math.round((Number(l.quantity) || 1) * (Number(l.unitPriceCents) || 0))
        })) : []
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

publicInvoiceRouter.post('/:token/pay', async (req, res) => {
  try {
    const parsedParams = publicInvoiceTokenParamsSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid token format', details: parsedParams.error.issues });
    }
    const { token } = parsedParams.data;

    const parsedBody = publicInvoicePayBodySchema.safeParse(req.body || {});
    if (!parsedBody.success) {
      return res.status(400).json({ error: 'Invalid request payload', details: parsedBody.error.issues });
    }

    const db = getDb();
    
    let snapshot = await db.collection('invoices').where('paymentToken', '==', token).limit(1).get();
    if (snapshot.empty) {
      snapshot = await db.collectionGroup('invoices').where('paymentToken', '==', token).limit(1).get();
    }
    
    if (snapshot.empty) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const doc = snapshot.docs[0];
    const invoice = doc.data();

    const payableStatuses = ['sent', 'unpaid', 'pending', 'overdue', 'approved', 'invoiced', 'partially_paid'];
    if (!payableStatuses.includes(invoice.status) || invoice.isLocked === true) {
      return res.status(400).json({ 
        error: `Invoice cannot be paid. Current status: ${invoice.status || 'unknown'}${invoice.isLocked ? ' (locked)' : ''}` 
      });
    }

    // What is still due, by the one money rule (discounts, retainage, credits, payments)
    const remainingBalance = calculateAmountDue(invoice);

    if (!Number.isInteger(remainingBalance) || remainingBalance <= 0) {
      return res.status(400).json({ error: 'Invoice has no outstanding unpaid balance or is already paid.' });
    }

    // Use configured trusted application URL to prevent host-header poisoning (#85)
    const origin = getTrustedAppUrl(req);

    const wsData = await workspaceOf(db, invoice.workspaceId);
    const connectDestination = connectedPayoutAccount(wsData);
    if (!connectDestination) {
      return res.status(409).json({
        error: 'This business has not set up online payments yet. Contact them to pay this invoice.',
        code: 'ONLINE_PAYMENTS_NOT_SET_UP',
      });
    }
    const stripe = getStripe();

    const requestedRail = parsedBody.data.paymentMethod;
    const paymentMethodTypes: Array<'card' | 'us_bank_account'> =
      requestedRail === 'us_bank_account'
        ? ['us_bank_account']
        : requestedRail === 'card'
          ? ['card']
          : ['card', 'us_bank_account'];
    const feeRail = requestedRail === 'us_bank_account' ? 'us_bank_account' : 'card';
    const feeQuote = computePlatformFeeQuote(remainingBalance, String(wsData?.plan || 'free'), feeRail);

    // INT-6: one key per invoice and amount still due — a double click gets the same session, not a second one
    const params = {
      payment_method_types: paymentMethodTypes,
      line_items: [
        {
          price_data: {
            currency: (invoice.currency || 'usd').toLowerCase(),
            product_data: {
              name: `Invoice ${invoice.number || 'Payment'}`,
              description: `Payment for ${invoice.customerName || 'Services'}`
            },
            unit_amount: remainingBalance,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${origin}/i/${token}?success=true`,
      cancel_url: `${origin}/i/${token}?canceled=true`,
      client_reference_id: doc.id,
      metadata: {
        invoiceId: doc.id,
        workspaceId: invoice.workspaceId,
        paymentToken: token,
        platformFeeCents: String(feeQuote.platformFeeCents),
        platformFeeBps: String(feeQuote.platformFeeBps),
        rail: feeRail,
      },
      // the money goes to the business's own Stripe account; the platform keeps only its fee
      payment_intent_data: {
        ...(feeQuote.platformFeeCents > 0 ? { application_fee_amount: feeQuote.platformFeeCents } : {}),
        transfer_data: { destination: connectDestination },
      },
    } satisfies Parameters<typeof stripe.checkout.sessions.create>[0];
    // the same parameters get the same key; changed ones (another amount, a renamed invoice) a new one
    const idempotencyKey = checkoutIdempotencyKey(doc.id, remainingBalance, token.slice(-16), checkoutParamsFingerprint(params));
    const session = await stripe.checkout.sessions.create(params, { idempotencyKey });

    res.json({ url: session.url, feeQuote });

  } catch (err) {
    if (isIdempotencyInFlight(err)) return res.status(409).json({ error: 'This payment is already being opened. Wait a moment and try again.' });
    console.error(err);
    res.status(500).json({ error: 'Failed to create payment session' });
  }
});
