import { errorMessage, requestUser, type RequestUser } from '../auth/requestUser';
import { planFor } from '../../lib/plans';
import express from "express";
import crypto from "crypto";
import { getDb, validateWorkspaceMember, FieldValue } from "../db/firestore.ts";
import { checkoutIdempotencyKey, checkoutParamsFingerprint, getStripe, isIdempotencyInFlight } from "../services/stripeService.ts";
import { getTrustedAppUrl } from "../utils/urlHelper.ts";
import { roleInWorkspace } from "../middleware/requireLedgerWriter.ts";
import { incrementShardedCounter, getShardedCounterValue } from "../services/shardedCounterService.ts";
import { writeServerAuditLog } from "../services/auditLogService.ts";

import { BRAND_NAME } from '../../config/brand';
export const billingRouter = express.Router();

const errorStatus = (err: unknown) => (errorMessage(err).startsWith('FORBIDDEN') ? 403 : errorMessage(err).startsWith('NOT_FOUND') ? 404 : 500);

/** Member check; with `roles`, the user must also hold one of them (billing changes are owner-only). */
async function authorizeWorkspace(user: RequestUser, workspaceId: string, roles?: string[]) {
  const db = getDb();
  if (!workspaceId || typeof workspaceId !== 'string') {
    throw new Error("NOT_FOUND: Invalid workspace identifier provided.");
  }
  try {
    const { data } = await validateWorkspaceMember(db, workspaceId, user);
    if (roles && !user?.admin && !roles.includes(roleInWorkspace(data, user?.uid))) {
      throw new Error(`FORBIDDEN: requires the ${roles.join(' or ')} role.`);
    }
    return data;
  } catch (err) {
    if (errorMessage(err).includes("Forbidden") || errorMessage(err).includes("not authorized") || errorMessage(err).includes("not a member")) {
      throw new Error("FORBIDDEN: User does not belong to this workspace.", { cause: err });
    }
    throw err;
  }
}

billingRouter.post("/checkout", async (req: express.Request, res: express.Response) => {
  try {
    const workspaceId = (req.body.workspaceId as string) || requestUser(req)?.developerWorkspaceId;
    if (!workspaceId) return res.status(400).json({ status: "error", message: "Missing workspaceId" });

    const workspace = await authorizeWorkspace(requestUser(req), workspaceId, ['owner']);

    const stripe = getStripe();
    const { plan } = req.body;
    // the price shown on both pricing pages (src/lib/plans.ts); the free plan has nothing to buy
    const chosen = planFor(plan);
    if (chosen.monthlyUsd <= 0) return res.status(400).json({ status: "error", message: "The free plan needs no checkout" });
    const priceInfo = {
      price_data: {
        currency: 'usd',
        product_data: { name: `${BRAND_NAME} ${chosen.name}`, description: chosen.description },
        unit_amount: chosen.monthlyUsd * 100,
        recurring: { interval: 'month' as const },
      },
      quantity: 1,
    };

    // Use trusted app URL helper to prevent Host-header poisoning (#85-R, N6)
    const baseUrl = getTrustedAppUrl(req);

    const params = {
      payment_method_types: ['card'],
      line_items: [priceInfo],
      mode: 'subscription',
      success_url: `${baseUrl}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/?checkout=canceled`,
      metadata: {
        workspaceId,
        plan: chosen.id
      },
      subscription_data: {
        metadata: {
          workspaceId,
          plan: plan || 'pro'
        }
      }
    } satisfies Parameters<typeof stripe.checkout.sessions.create>[0];
    const session = await stripe.checkout.sessions.create(params, {
      // INT-6: one key per workspace, plan, price and current subscription — a double click gets the same session,
      // not two subscriptions; after a subscription ends (its id cleared by the webhook) a new checkout gets a new key
      idempotencyKey: checkoutIdempotencyKey('subscription', workspaceId, chosen.id, priceInfo.price_data.unit_amount, String(workspace?.stripeSubscriptionId || 'none'), checkoutParamsFingerprint(params)),
    });

    res.json({ url: session.url });
  } catch (err) {
    if (isIdempotencyInFlight(err)) return res.status(409).json({ status: "error", message: "This checkout is already being opened. Wait a moment and try again." });
    console.error("[Stripe] Failed:", err);
    res.status(errorStatus(err)).json({ status: "error", message: errorMessage(err) });
  }
});

billingRouter.post("/portal", async (req: express.Request, res: express.Response) => {
  try {
    const workspaceId = (req.body.workspaceId as string) || requestUser(req)?.developerWorkspaceId;
    if (!workspaceId) return res.status(400).json({ status: "error", message: "Missing workspaceId" });

    await authorizeWorkspace(requestUser(req), workspaceId, ['owner']);

    const db = getDb();
    const wsDoc = await db.collection("workspaces").doc(workspaceId).get();
    const wsData = wsDoc.exists ? wsDoc.data() || {} : {};

    const stripe = getStripe();
    const baseUrl = getTrustedAppUrl(req);

    if (!wsData.stripeCustomerId) {
      return res.status(400).json({ status: "error", message: "No active Stripe customer found for this workspace" });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: wsData.stripeCustomerId,
      return_url: `${baseUrl}/`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("[Stripe Portal] Failed:", err);
    res.status(errorStatus(err)).json({ status: "error", message: errorMessage(err) });
  }
});

billingRouter.post("/verify-session", async (req: express.Request, res: express.Response) => {
  try {
    const { session_id, workspaceId } = req.body;
    if (!session_id || !workspaceId) {
      return res.status(400).json({ status: "error", message: "Missing required parameters" });
    }

    await authorizeWorkspace(requestUser(req), workspaceId, ['owner']);

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (session.payment_status === 'paid' && session.metadata?.workspaceId === workspaceId) {
      const db = getDb();
      const eventRef = db.collection('stripeProcessedEvents').doc(`session_${session.id}`);
      const alreadyClaimed = await db.runTransaction(async (t) => {
        const snap = await t.get(eventRef);
        if (snap.exists) return true;
        t.set(eventRef, {
          sessionId: session.id,
          workspaceId,
          claimedAt: FieldValue.serverTimestamp()
        });
        return false;
      });

      const targetPlan = planFor(session.metadata?.plan).id;
      const creditsToGrant = targetPlan === 'enterprise' ? 10000000 : 1000000;

      if (alreadyClaimed) {
        return res.json({ status: "success", plan: targetPlan, message: "Session already verified" });
      }

      await db.collection("workspaces").doc(workspaceId).set({
        plan: targetPlan,
        billingCycle: "monthly",
        computeCreditBalance: FieldValue.increment(creditsToGrant),
        computeLimit: creditsToGrant, 
        stripeCustomerId: session.customer || null,
        stripeSubscriptionId: session.subscription || null,
        lastUpgradedAt: new Date().toISOString()
      }, { merge: true });
      await writeServerAuditLog({
        workspaceId,
        uid: requestUser(req).uid,
        email: requestUser(req).email,
        action: 'WORKSPACE_PLAN_UPGRADED',
        entityType: 'workspace',
        entityId: workspaceId,
        details: { description: `Upgraded workspace plan to ${targetPlan}`, plan: targetPlan, sessionId: session.id },
      }, { db });
      return res.json({ status: "success", plan: targetPlan });
    } else {
       return res.status(400).json({ status: "incomplete", message: "Session not paid or metadata mismatch" });
    }
  } catch (err) {
     console.error("[Stripe Verify] Error:", err);
     res.status(errorStatus(err)).json({ status: "error", message: errorStatus(err) === 403 ? errorMessage(err) : "Stripe verification failed" });
  }
});

billingRouter.get("/status", async (req: express.Request, res: express.Response) => {
  try {
    const workspaceId = (req.query.workspaceId as string);
    if (!workspaceId) return res.status(400).json({ status: "error", message: "Missing workspaceId" });

    const wsData: Record<string, number | string | boolean | undefined> = ((await authorizeWorkspace(requestUser(req), workspaceId)) || {}) as Record<string, number | string | boolean | undefined>;

    const db = getDb();
    const baselineQueries = Number(wsData.totalQueriesThisMonth || 0);
    const baselineCredit = wsData.computeCreditBalance !== undefined ? Number(wsData.computeCreditBalance) : 100000;

    const shardedQueries = await getShardedCounterValue(db, workspaceId, 'totalQueriesThisMonth', baselineQueries);
    const shardedCredit = await getShardedCounterValue(db, workspaceId, 'computeCreditBalance', baselineCredit);

    // Populate secure default development limits if missing to maintain continuous operations
    const statusData = {
      workspaceId,
      plan: String(wsData.plan || 'sandbox'),
      billingCycle: String(wsData.billingCycle || 'free'),
      concurrentUserLimit: Number(wsData.concurrentUserLimit || 50),
      activeUserCount: Number(wsData.activeUserCount || 1),
      seatCount: Number(wsData.seatCount || 1),
      maxSeats: Number(wsData.maxSeats || 3),
      totalQueriesThisMonth: shardedQueries,
      computeHardnessScore: Number(wsData.computeHardnessScore || 0),
      computeCreditBalance: Math.max(0, shardedCredit), // 100k compute units default
      apiQuotaTotalCentsUsed: Number(wsData.apiQuotaTotalCentsUsed || 0),
      apiQuotaMonthlyLimitCents: Number(wsData.apiQuotaMonthlyLimitCents || 0), // Sandbox has no real dollar limits, just credit limits
    };

    res.json(statusData);
  } catch (err) {
    console.error("[Billing Status Error]:", err);
    res.status(errorStatus(err)).json({ status: "error", message: errorMessage(err) });
  }
});

billingRouter.post("/record-compute", async (req: express.Request, res: express.Response) => {
  try {
    const { workspaceId, algorithmName, complexityFormat, weightScore, executionTimeMs } = req.body;
    if (!workspaceId || !algorithmName) {
      return res.status(400).json({ status: "error", message: "Missing required query parameters: workspaceId and algorithmName" });
    }

    const user = requestUser(req);
    const wsData = ((await authorizeWorkspace(user, workspaceId)) || {}) as Record<string, number | undefined>;

    const sanitizedWeight = Math.max(1, Math.min(1000, Math.floor(Math.abs(Number(weightScore) || 10))));
    const sanitizedExecutionTime = Math.max(1, Math.min(60000, Math.floor(Math.abs(Number(executionTimeMs) || 50))));

    const ledgerEntry = {
      id: `trace-${crypto.randomUUID()}`,
      workspaceId,
      uid: user.uid,
      userEmail: user.email,
      algorithmName,
      complexityFormat,
      weightScore: sanitizedWeight,
      executionTimeMs: sanitizedExecutionTime,
      timestamp: new Date().toISOString(),
      hash: crypto.createHash('sha256').update(`${workspaceId}-${algorithmName}-${sanitizedWeight}-${crypto.randomUUID()}`).digest('hex')
    };

    const db = getDb();
    const billingLedgerRef = db.collection("billingLedgerTraces").doc();
    ledgerEntry.id = billingLedgerRef.id;
    await billingLedgerRef.set(ledgerEntry);

    // Usage counters: sharded for the hot ones, atomic increments on the workspace for the rest
    const quotaCents = Math.round(sanitizedWeight * 0.1); // 0.1 cent per complexity score
    await incrementShardedCounter(db, workspaceId, 'totalQueriesThisMonth', 1);
    await incrementShardedCounter(db, workspaceId, 'computeCreditBalance', -sanitizedWeight);
    await db.collection("workspaces").doc(workspaceId).update({
      apiQuotaTotalCentsUsed: FieldValue.increment(quotaCents),
      computeHardnessScore: FieldValue.increment(sanitizedWeight)
    });

    const updatedMetrics = {
      apiQuotaTotalCentsUsed: (wsData.apiQuotaTotalCentsUsed || 0) + quotaCents,
      totalQueriesThisMonth: await getShardedCounterValue(db, workspaceId, 'totalQueriesThisMonth', wsData.totalQueriesThisMonth || 0),
      computeHardnessScore: (wsData.computeHardnessScore || 0) + sanitizedWeight,
      computeCreditBalance: Math.max(0, await getShardedCounterValue(db, workspaceId, 'computeCreditBalance', wsData.computeCreditBalance ?? 100000))
    };

    res.json({
      status: "success",
      traceRecord: ledgerEntry,
      updatedMetrics
    });
  } catch (err) {
    console.error("[Record Compute Error]:", err);
    res.status(errorStatus(err)).json({ status: "error", message: errorMessage(err) });
  }
});
