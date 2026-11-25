import express from "express";
import type { ServerContext } from "../http/serverKit";
import { errorMessage } from "../auth/requestUser";
import { getDb, FieldValue } from "../db/firestore";
import { checkoutSessionClaimId, getStripe, stripeId, type Stripe } from "../services/stripeService";
import { recordStripeInvoicePayment } from "../services/onlinePaymentService";
import { recordInvoicePaymentFailed, recordSubscriptionPaymentFailed } from "../services/paymentFailureService";
import { logger } from "../utils/logger";

/** Routes moved out of server.ts (F-01). Registered before the JSON body parser: Stripe signs the raw body. */
export function registerStripeWebhookRoutes(app: express.Express, _ctx: ServerContext): void {
  // Stripe Webhook needs raw body
  app.post('/api/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
      const stripe = getStripe();
      const sig = req.headers['stripe-signature'];
      let event;

      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!webhookSecret || !sig) {
        console.error('Missing Stripe webhook signature or STRIPE_WEBHOOK_SECRET configuration.');
        return res.status(400).send('Webhook Error: Missing signature or STRIPE_WEBHOOK_SECRET');
      }

      try {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
      } catch (err) {
        console.error('Webhook signature verification failed.', errorMessage(err));
        return res.status(400).send('Webhook Error: Invalid signature');
      }

      const eventId = event.id;
      const db = getDb();
      const eventRef = db.collection('stripeProcessedEvents').doc(eventId);

      if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
        const session = event.data.object as Stripe.Checkout.Session;
        const isPaid = session.payment_status === 'paid';
        
        // --- 1. A customer paid an invoice through its payment link (K-11) ---
        if (session.metadata?.invoiceId) {
          const outcome = await recordStripeInvoicePayment(db, eventId, event.type, session);
          if (outcome.status === 'already_processed') {
            logger.info('Stripe webhook event already processed, skipping replay', { eventId });
            return res.json({ received: true, skipped: true });
          }
          logger.info('Stripe invoice payment', { eventId, outcome: outcome.status });
        }
        
        // --- 2. Subscription Upgrade & Credit Provisioning ---
        if (isPaid && (session.mode === 'subscription' || session.metadata?.plan)) {
          const workspaceId = session.metadata?.workspaceId;
          const plan = session.metadata?.plan || 'pro';
          
          if (workspaceId) {
            const creditsToGrant = plan === 'enterprise' ? 10000000 : 1000000;
            const wsRef = db.collection("workspaces").doc(workspaceId);
            
            const subResult = await db.runTransaction(async (t) => {
              const eventSnap = await t.get(eventRef);
              if (eventSnap.exists) {
                return { alreadyProcessed: true };
              }

              // AUP-15: the same per-session claim the verify-session route takes; only the first grants
              const claimRef = db.collection('stripeProcessedEvents').doc(checkoutSessionClaimId(session.id));
              const sessionClaimed = (await t.get(claimRef)).exists;
              const wsSnap = await t.get(wsRef);
              const wsData = wsSnap.data() || {};
              const currentSubId = wsData.stripeSubscriptionId;
              const incomingSubId = stripeId(session.subscription);

              // Only increment compute credits if this is a fresh upgrade or distinct subscription
              const isNewSubscription = incomingSubId && incomingSubId !== currentSubId;
              const updatePayload: Record<string, unknown> = {
                plan: plan,
                billingCycle: "monthly",
                computeLimit: creditsToGrant,
                stripeCustomerId: stripeId(session.customer),
                stripeSubscriptionId: incomingSubId,
                lastUpgradedAt: new Date().toISOString()
              };

              if (!sessionClaimed && (isNewSubscription || wsData.computeCreditBalance === undefined)) {
                updatePayload.computeCreditBalance = FieldValue.increment(creditsToGrant);
              }
              if (!sessionClaimed) t.set(claimRef, { sessionId: session.id, workspaceId, source: 'webhook', eventId, claimedAt: FieldValue.serverTimestamp() });

              t.set(wsRef, updatePayload, { merge: true });

              t.set(eventRef, {
                id: eventId,
                type: event.type,
                outcome: 'plan_updated',
                workspaceId,
                processedAt: FieldValue.serverTimestamp()
              });

              return { success: true };
            });

            if (subResult?.alreadyProcessed) {
              logger.info('Stripe webhook event already processed, skipping replay', { eventId });
              return res.json({ received: true, skipped: true });
            }
            
            logger.info('Workspace upgraded with compute credits', { workspaceId, plan, creditsGranted: creditsToGrant });
          }
        }
      } else if (event.type === 'customer.subscription.deleted') {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = stripeId(subscription.customer);
        const subscriptionId = subscription.id;
        
        await db.runTransaction(async (t) => {
          const eventSnap = await t.get(eventRef);
          if (eventSnap.exists) {
            return;
          }

          let wsSnap = await t.get(db.collection("workspaces").where("stripeSubscriptionId", "==", subscriptionId).limit(1));
          if (wsSnap.empty && customerId) {
            wsSnap = await t.get(db.collection("workspaces").where("stripeCustomerId", "==", customerId).limit(1));
          }

          if (!wsSnap.empty) {
            const wsDoc = wsSnap.docs[0];
            t.set(wsDoc.ref, {
              plan: 'starter',
              billingCycle: 'free',
              stripeSubscriptionId: null,
              lastDowngradedAt: new Date().toISOString()
            }, { merge: true });
          }

          t.set(eventRef, {
            id: eventId,
            type: event.type,
            outcome: wsSnap.empty ? 'no_workspace' : 'plan_cancelled',
            ...(wsSnap.empty ? {} : { workspaceId: wsSnap.docs[0].id }),
            processedAt: FieldValue.serverTimestamp()
          });
        });
      } else if (event.type === 'checkout.session.async_payment_failed' && (event.data.object as Stripe.Checkout.Session).metadata?.invoiceId) {
        // S-05: a customer's bank payment for an invoice did not go through
        const outcome = await recordInvoicePaymentFailed(db, eventId, event.type, event.data.object as Stripe.Checkout.Session);
        if (outcome === 'already_processed') return res.json({ received: true, skipped: true });
      } else if (event.type === 'invoice.payment_failed') {
        // S-16: the workspace's own plan could not be charged
        const outcome = await recordSubscriptionPaymentFailed(db, eventId, event.type, event.data.object as unknown as Parameters<typeof recordSubscriptionPaymentFailed>[3]);
        if (outcome === 'already_processed') return res.json({ received: true, skipped: true });
      } else {
        // Record event idempotency for other unhandled types
        await eventRef.set({
          id: eventId,
          type: event.type,
          outcome: 'ignored',
          processedAt: FieldValue.serverTimestamp()
        }, { merge: true });
      }

      res.json({received: true});
    } catch (err) {
      console.error(err);
      res.status(500).send('Internal Server Error');
    }
  });
}
