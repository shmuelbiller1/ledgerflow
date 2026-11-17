import express from 'express';
import { z } from 'zod';
import type { Firestore } from '../db/firestore';
import { getDb, validateWorkspaceMember } from '../db/firestore';
import { committedPaymentReplay, createPaymentIdempotent, PaymentApplyError } from '../services/paymentService';

import { getDateInTimezoneISO } from '../../lib/calendarDate';
import { isIsoDate } from '../../lib/warehouseRecordUtils';
import { getWorkspaceUserRole, AuthenticatedRequest, requireWorkspaceRole } from './workspaceRoutes';
import { CreditError } from '../services/creditService';
import { DepositError } from '../services/depositService';
import { writeServerAuditLog } from '../services/auditLogService';

import { computePlatformFeeQuote, summarizePaymentVolume } from '../../lib/paymentVolumeFee';
import { checkoutParamsFingerprint, getStripe, type Stripe } from '../services/stripeService';
import { executeCommand } from '../utils/commandExecutor';
import {
  paymentApplyCommand, paymentCreditApplyCommand, paymentCreditRefundCommand, paymentCreditsAutoApplyCommand,
  paymentDepositCommand, paymentReceiveCommand, paymentVoidCommand,
} from '../commands/payments';
import type { CommandExecutionOutcome } from '../commands/types';

export const paymentRouter = express.Router();

/**
 * POST /api/v1/payments: record a payment and apply it to open documents. The registered
 * `payment.receive` command owns the schema, the role and period gates, the replay-safe posting and
 * the audit line; this keeps the legacy address, body and `{ status: 'success', data }` answer, and
 * still accepts the database the route's tests inject. `handleCreatePayment` stays exported for the
 * two suites that call it directly (atomicity, audit F4/F5).
 */
function paymentAnswer(outcome: CommandExecutionOutcome, sendRemittance: boolean, workspaceId: unknown): { status: number; body: unknown } {
  if (outcome.ok) return { status: 200, body: { status: 'success', data: outcome.data } };
  const message = outcome.message;
  if (outcome.error instanceof z.ZodError) {
    return { status: 400, body: { status: 'error', message: 'Invalid payment payload', details: outcome.error.issues } };
  }
  // a missing workspace is refused before any schema is read: the legacy body said the same, in words
  if (!String(workspaceId || '').trim()) {
    return { status: 400, body: { status: 'error', message: 'Invalid payment payload', details: [{ path: ['workspaceId'], message: 'Required' }] } };
  }
  if (outcome.code === 'INVALID_OPERATION_ID') {
    return { status: 400, body: { status: 'error', message: 'Invalid payment operation ID' } };
  }
  if (outcome.status === 403) return { status: 403, body: { status: 'error', message } };
  if (outcome.status === 409) return { status: 409, body: { status: 'error', message } };
  if (outcome.status === 404) return { status: 404, body: { status: 'error', message } };
  if (outcome.code === 'PERIOD_LOCKED') {
    // the legacy answer to a closed period on this route was a 400 carrying the lock's wording
    return { status: 400, body: { status: 'error', message } };
  }
  return { status: 400, body: { status: 'error', message: sendRemittance && !message ? 'The payment could not be recorded' : message } };
}

export async function handleCreatePayment(req: express.Request, res: express.Response, dbOverride?: Firestore) {
  const authReq = req as Partial<AuthenticatedRequest>;
  if (!authReq.user?.uid) return res.status(401).json({ status: 'error', message: 'Sign in required' });
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  // `operationId` reached this route in the body as well as in a header; the command's input is strict
  const { operationId: _bodyOperationId, ...input } = body;
  await executeCommand(req, res, {
    definition: paymentReceiveCommand,
    workspaceId: String(body.workspaceId || ''),
    input,
    formatResponse: outcome => paymentAnswer(outcome, body.sendRemittance === true, body.workspaceId),
  }, dbOverride ? { getDb: () => dbOverride } : undefined);
}

paymentRouter.post('/', async (req, res) => {
  await handleCreatePayment(req, res);
});



// The roles these five writes always required, checked before the body is read (the commands check
// them again, and before the period: the same order the route middleware had).
const ledgerWriters = requireWorkspaceRole(['owner', 'accountant', 'bookkeeper']);

// Credit notes / vendor credits: apply to an open invoice / bill, or refund.
// The command owns the schema, the role check, the date and the audit line inside the service's own
// transaction; these two addresses keep their `{ status: 'success', data }` / `{ status: 'error' }` answer.
const creditAnswer = (outcome: CommandExecutionOutcome): { status: number; body: unknown } => outcome.ok
  ? { status: 200, body: { status: 'success', data: outcome.data } }
  : outcome.error instanceof z.ZodError
    ? { status: 400, body: { status: 'error', message: 'Invalid request', details: outcome.error.issues } }
    : outcome.error instanceof CreditError
      ? { status: outcome.error.status, body: { status: 'error', message: outcome.error.message } }
      : { status: 400, body: { status: 'error', message: outcome.message } };

paymentRouter.post('/credits/apply', ledgerWriters, async (req, res) => {
  await executeCommand(req, res, {
    definition: paymentCreditApplyCommand,
    workspaceId: String((req.body as { workspaceId?: unknown } | undefined)?.workspaceId || ''),
    input: req.body,
    formatResponse: creditAnswer,
  });
});

paymentRouter.post('/credits/refund', ledgerWriters, async (req, res) => {
  await executeCommand(req, res, {
    definition: paymentCreditRefundCommand,
    workspaceId: String((req.body as { workspaceId?: unknown } | undefined)?.workspaceId || ''),
    input: req.body,
    formatResponse: creditAnswer,
  });
});

// BE-06: every open credit (of one customer/vendor, or all) to their open invoices/bills, oldest first
paymentRouter.post('/credits/auto-apply', ledgerWriters, async (req, res) => {
  await executeCommand(req, res, {
    definition: paymentCreditsAutoApplyCommand,
    workspaceId: String((req.body as { workspaceId?: unknown } | undefined)?.workspaceId || ''),
    input: req.body,
    formatResponse: (outcome) => {
      if (outcome.ok) return { status: 200, body: { status: 'success', data: outcome.data } };
      if (outcome.error instanceof z.ZodError) return { status: 400, body: { status: 'error', message: 'Invalid request', details: outcome.error.issues } };
      if (outcome.error instanceof CreditError) return { status: outcome.error.status, body: { status: 'error', message: outcome.error.message } };
      return { status: 500, body: { status: 'error', message: 'The credits could not be applied', details: outcome.message } };
    },
  });
});

// Make deposit: payments waiting in Undeposited Funds go to the bank in one entry
paymentRouter.post('/deposits', ledgerWriters, async (req, res) => {
  await executeCommand(req, res, {
    definition: paymentDepositCommand,
    workspaceId: String((req.body as { workspaceId?: unknown } | undefined)?.workspaceId || ''),
    input: req.body,
    formatResponse: (outcome) => {
      if (outcome.ok) return { status: 200, body: { status: 'success', data: outcome.data } };
      if (outcome.error instanceof z.ZodError) return { status: 400, body: { status: 'error', message: 'Invalid request', details: outcome.error.issues } };
      if (outcome.error instanceof DepositError) return { status: outcome.error.status, body: { status: 'error', message: outcome.error.message } };
      return { status: 400, body: { status: 'error', message: outcome.message } };
    },
  });
});

// registered last: '/:paymentId/apply' must not catch '/credits/apply'
/** BE-12, K-18: apply a payment's unapplied part (a deposit or prepayment) to invoices or bills. */
paymentRouter.post('/:paymentId/apply', async (req, res) => {
  await executeCommand(req, res, {
    definition: paymentApplyCommand,
    workspaceId: String((req.body as { workspaceId?: unknown } | undefined)?.workspaceId || ''),
    input: { ...(req.body as Record<string, unknown>), paymentId: String((req.params as Record<string, string>).paymentId) },
    formatResponse: (outcome) => {
      if (outcome.ok) return { status: 200, body: { status: 'success', data: outcome.data } };
      if (outcome.error instanceof z.ZodError) return { status: 400, body: { status: 'error', message: 'Invalid request', details: outcome.error.issues } };
      if (outcome.error instanceof PaymentApplyError) return { status: outcome.error.status, body: { status: 'error', message: outcome.error.message } };
      // a closed period stayed a 409 on this route, as the apply service always answered it
      if (/Period Locked/i.test(outcome.message)) return { status: 409, body: { status: 'error', message: outcome.message } };
      if (/not a member|Forbidden|Unauthorized/i.test(outcome.message)) return { status: 403, body: { status: 'error', message: outcome.message } };
      return { status: 400, body: { status: 'error', message: outcome.message } };
    },
  });
});

/** EG-2 step 4: void a payment: its entries reversed, its ledger rows reversed, its documents due again. A retry posts nothing. */
paymentRouter.post('/:paymentId/void', async (req, res) => {
  await executeCommand(req, res, {
    definition: paymentVoidCommand,
    workspaceId: String((req.body as { workspaceId?: unknown } | undefined)?.workspaceId || ''),
    input: { ...(req.body as Record<string, unknown>), paymentId: String((req.params as Record<string, string>).paymentId) },
    formatResponse: (outcome) => {
      if (outcome.ok) return { status: 200, body: { status: 'success', data: outcome.data } };
      if (outcome.error instanceof z.ZodError) return { status: 400, body: { status: 'error', message: 'Invalid request', details: outcome.error.issues } };
      if (outcome.error instanceof PaymentApplyError) return { status: outcome.error.status, body: { status: 'error', message: outcome.error.message } };
      if (/Period Locked/i.test(outcome.message)) return { status: 409, body: { status: 'error', message: outcome.message } };
      if (/not a member|Forbidden|Unauthorized/i.test(outcome.message)) return { status: 403, body: { status: 'error', message: outcome.message } };
      return { status: 400, body: { status: 'error', message: outcome.message } };
    },
  });
});

const payoutRunItemSchema = z.object({
  vendorId: z.string().min(1),
  vendorName: z.string().min(1),
  amountCents: z.number().int().positive(),
  operationId: z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/),
  allocations: z.array(z.object({
    documentId: z.string().min(1),
    documentType: z.literal('bill'),
    amountCents: z.number().int().positive(),
  })).min(1),
}).strict();

const payoutRunSchema = z.object({
  workspaceId: z.string().min(1),
  cashAccountId: z.string().min(1),
  paymentDate: z.string().refine(isIsoDate, 'paymentDate must be YYYY-MM-DD').optional(),
  payouts: z.array(payoutRunItemSchema).min(1).max(200),
}).strict();

/** Strategy 4: Processor-backed vendor ACH/bank payouts initiated directly from a payment run. */
paymentRouter.post('/payout-run', async (req, res) => {
  const authReq = req as unknown as Partial<AuthenticatedRequest>;
  if (!authReq.user?.uid) return res.status(401).json({ status: 'error', message: 'Sign in required' });
  const rawWorkspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId.trim() : '';
  if (!rawWorkspaceId) {
    return res.status(400).json({ status: 'error', message: 'Invalid payout run payload: workspaceId required' });
  }

  try {
    const db = getDb();
    const { data: wsData } = await validateWorkspaceMember(db, rawWorkspaceId, authReq.user);
    if (!authReq.user.admin) {
      const userRole = await getWorkspaceUserRole(db, rawWorkspaceId, authReq.user.uid);
      if (!['owner', 'accountant', 'bookkeeper'].includes(userRole)) {
        return res.status(403).json({ status: 'error', message: 'Forbidden: requires owner, accountant, or bookkeeper role' });
      }
    }

    const parsed = payoutRunSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ status: 'error', message: 'Invalid payout run payload', details: parsed.error.issues });
    const { workspaceId, cashAccountId, paymentDate, payouts } = parsed.data;

    let stripe: Stripe;
    try {
      stripe = getStripe();
    } catch (stripeErr) {
      return res.status(503).json({
        status: 'error',
        code: 'PROCESSOR_NOT_CONFIGURED',
        message: stripeErr instanceof Error ? stripeErr.message : 'Live bank payouts require a configured payment processor.',
      });
    }

    const wsTimezone = typeof wsData?.timezone === 'string' ? wsData.timezone : undefined;
    const effectiveDate = paymentDate || getDateInTimezoneISO(new Date(), wsTimezone);
    const payoutBatchId = `pob_${effectiveDate.replace(/-/g, '')}_${payouts[0].operationId.slice(-8)}`;
    const plan = String(wsData?.plan || 'free');
    const payoutCurrency = String(wsData?.currency || 'USD').toLowerCase();

    const uniqueVendorIds = Array.from(new Set(payouts.map(p => p.vendorId)));
    const vendorSnaps = uniqueVendorIds.length > 0
      ? await db.getAll(...uniqueVendorIds.map(id => db.collection('vendors').doc(id)))
      : [];
    const vendorById = new Map<string, Record<string, unknown>>();
    for (const snap of vendorSnaps) {
      if (snap.exists) vendorById.set(snap.id, (snap.data() || {}) as Record<string, unknown>);
    }

    const completed: Array<{
      vendorId: string;
      vendorName: string;
      paymentId: string;
      amountCents: number;
      platformFeeCents: number;
      payoutReference: string;
    }> = [];
    const failed: Array<{ vendorId: string; vendorName: string; message: string }> = [];
    let totalDisbursedCents = 0;
    let totalPlatformFeeCents = 0;

    for (const item of payouts) {
      try {
        const feeQuote = computePlatformFeeQuote(item.amountCents, plan, 'vendor_payout');
        const payoutFingerprint = {
          workspaceId,
          uid: authReq.user.uid,
          vendorId: item.vendorId,
          amountCents: item.amountCents,
          paymentDate: effectiveDate,
          cashAccountId,
          allocations: item.allocations,
        };
        const replay = await committedPaymentReplay(db, workspaceId, item.operationId, authReq.user.uid, payoutFingerprint);
        if (replay) {
          const replayId = String((replay as { paymentId?: string; id?: string }).paymentId || (replay as { id?: string }).id || item.operationId);
          const replayRef = String((replay as { referenceNumber?: string }).referenceNumber || `REPLAY-${item.operationId.slice(-8)}`);
          completed.push({
            vendorId: item.vendorId,
            vendorName: item.vendorName,
            paymentId: replayId,
            amountCents: item.amountCents,
            platformFeeCents: feeQuote.platformFeeCents,
            payoutReference: replayRef,
          });
          totalDisbursedCents += item.amountCents;
          totalPlatformFeeCents += feeQuote.platformFeeCents;
          continue;
        }

        const vendorDoc = vendorById.get(item.vendorId);
        if (!vendorDoc || vendorDoc.workspaceId !== workspaceId) {
          throw new Error(`Vendor "${item.vendorName}" does not belong to this workspace.`);
        }
        const connectDestination = typeof vendorDoc.stripeConnectAccountId === 'string'
          ? vendorDoc.stripeConnectAccountId.trim()
          : '';
        if (!connectDestination) {
          throw new Error(`Vendor "${item.vendorName}" has no connected payout account (stripeConnectAccountId). Use "Pay and download bank file" until connected.`);
        }

        const transferParams = {
          amount: item.amountCents,
          currency: payoutCurrency,
          destination: connectDestination,
          description: `Vendor payout (${payoutBatchId}) to ${item.vendorName}`,
          metadata: {
            workspaceId,
            vendorId: item.vendorId,
            payoutBatchId,
            operationId: item.operationId,
            platformFeeCents: String(feeQuote.platformFeeCents),
          },
        };
        const transferKey = `payout_${workspaceId}_${item.operationId}_${checkoutParamsFingerprint(transferParams)}`.slice(0, 255);
        const transfer = await stripe.transfers.create(transferParams, { idempotencyKey: transferKey });
        const payoutReference = transfer.id;

        const created = await createPaymentIdempotent(
          db,
          {
            workspaceId,
            uid: authReq.user.uid,
            amountCents: item.amountCents,
            paymentDate: effectiveDate,
            cashAccountId,
            paymentMethod: 'vendor_payout',
            referenceNumber: payoutReference,
            memo: `Processor ACH payout (${payoutBatchId}) · ${payoutReference}`,
            vendorId: item.vendorId,
            entityName: item.vendorName,
            allocations: item.allocations,
          },
          item.operationId,
          payoutFingerprint,
        );
        const paymentId = String((created as { paymentId?: string; id?: string }).paymentId || (created as { id?: string }).id || item.operationId);
        completed.push({
          vendorId: item.vendorId,
          vendorName: item.vendorName,
          paymentId,
          amountCents: item.amountCents,
          platformFeeCents: feeQuote.platformFeeCents,
          payoutReference,
        });
        totalDisbursedCents += item.amountCents;
        totalPlatformFeeCents += feeQuote.platformFeeCents;
      } catch (itemErr) {
        failed.push({
          vendorId: item.vendorId,
          vendorName: item.vendorName,
          message: itemErr instanceof Error ? itemErr.message : String(itemErr),
        });
      }
    }

    if (completed.length > 0) {
      await writeServerAuditLog({
        workspaceId,
        uid: authReq.user.uid,
        email: authReq.user.email || '',
        action: 'VENDOR_PAYOUT_RUN_EXECUTED',
        entityType: 'payment',
        entityId: payoutBatchId,
        details: {
          description: `Executed vendor ACH payout batch ${payoutBatchId} (${completed.length} sent)`,
          payoutBatchId,
          completedCount: completed.length,
          failedCount: failed.length,
          totalDisbursedCents,
          totalPlatformFeeCents,
        },
        severity: 'info',
      });
    }

    res.json({
      status: 'success',
      payoutBatchId,
      completed,
      failed,
      totalDisbursedCents,
      totalPlatformFeeCents,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/not a member|Forbidden|Unauthorized/i.test(message)) return res.status(403).json({ status: 'error', message });
    res.status(400).json({ status: 'error', message });
  }
});

/** GET /api/v1/payments/volume-summary: monthly processed volume & platform fee revenue share. */
paymentRouter.get('/volume-summary', async (req, res) => {
  const authReq = req as unknown as Partial<AuthenticatedRequest>;
  if (!authReq.user?.uid) return res.status(401).json({ status: 'error', message: 'Sign in required' });
  const workspaceId = String(req.query.workspaceId || '');
  const month = String(req.query.month || new Date().toISOString().slice(0, 7));
  if (!workspaceId || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ status: 'error', message: 'workspaceId and YYYY-MM month are required' });
  }
  try {
    const db = getDb();
    const { data: wsData } = await validateWorkspaceMember(db, workspaceId, authReq.user);
    const snap = await db.collection('payments').where('workspaceId', '==', workspaceId).get();
    const rows = snap.docs.map(d => d.data() as Record<string, unknown>);
    const summary = summarizePaymentVolume(rows as never, month, String(wsData?.plan || 'free'));
    res.json({ status: 'success', summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/not a member|Forbidden|Unauthorized/i.test(message)) return res.status(403).json({ status: 'error', message });
    res.status(500).json({ status: 'error', message });
  }
});
