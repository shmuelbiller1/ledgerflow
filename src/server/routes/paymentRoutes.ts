import express from 'express';
import { z } from 'zod';
import type { Firestore } from '../db/firestore';
import { getDb, validateWorkspaceMember } from '../db/firestore';
import { applyUnappliedPayment, committedPaymentReplay, createPaymentAtomic, createPaymentIdempotent, PaymentApplyError } from '../services/paymentService';
import { voidPayment } from '../services/paymentVoidService';
import { extractCanonicalOperationId } from '../utils/idempotency';
import { getDateInTimezoneISO } from '../../lib/calendarDate';
import { isIsoDate } from '../../lib/warehouseRecordUtils';
import { getWorkspaceUserRole, AuthenticatedRequest, requireWorkspaceRole } from './workspaceRoutes';
import { applyCredit, autoApplyCredits, CreditError, refundCredit } from '../services/creditService';
import { createDeposit, DepositError } from '../services/depositService';
import { writeServerAuditLog } from '../services/auditLogService';
import { afterPaymentRecorded } from '../services/afterPayment';
import { findPaymentType } from '../../lib/paymentTypes';
import { computePlatformFeeQuote, summarizePaymentVolume } from '../../lib/paymentVolumeFee';
import { checkoutParamsFingerprint, getStripe, type Stripe } from '../services/stripeService';

export const paymentRouter = express.Router();

const paymentAllocationSchema = z.object({
  documentId: z.string().min(1),
  documentType: z.enum(['invoice', 'bill']),
  amountCents: z.number().int().positive()
});

const paymentInputSchema = z.object({
  workspaceId: z.string().min(1),
  amountCents: z.number().int().positive(),
  // audit F5: a real calendar date (2026-02-30 and 'not-a-date' are refused before anything is written)
  paymentDate: z.string().refine(isIsoDate, 'paymentDate must be a real date (YYYY-MM-DD)').optional(),
  cashAccountId: z.string().min(1),
  paymentMethod: z.string().optional(),
  /** CC-09: one of the workspace's payment types; the server takes its method and name from the workspace */
  paymentTypeId: z.string().min(1).max(40).optional(),
  referenceNumber: z.string().optional(),
  memo: z.string().optional(),
  customerId: z.string().optional(),
  vendorId: z.string().optional(),
  entityName: z.string().optional(),
  offsetAccountId: z.string().optional(),
  allocations: z.array(paymentAllocationSchema).default([]),
  /** K-25: email the vendor a remittance advice afterwards (not stored on the payment). */
  sendRemittance: z.boolean().optional(),
  /** Home-currency units for one unit of a foreign document's currency on the payment day (L-192). */
  paymentExchangeRate: z.number().positive().max(1e6).optional(),
  paymentRateSource: z.enum(['typed', 'last-used', 'live', 'books-on-date']).optional(),
  /** BE-05: a deposit for this estimate */
  estimateId: z.string().min(1).max(200).optional(),
  /** IL-5: tax withheld at source from a payment to a vendor, its rate and certificate */
  withheldCents: z.number().int().nonnegative().optional(),
  withholdingRatePercent: z.number().min(0).max(100).optional(),
  withholdingCertificate: z.string().max(40).optional(),
});

export async function handleCreatePayment(req: express.Request, res: express.Response, dbOverride?: Firestore) {
  try {
    const authReq = req as Partial<AuthenticatedRequest>;
    if (!authReq.user?.uid) {
      return res.status(401).json({ status: 'error', message: 'Sign in required' });
    }

    const parsed = paymentInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ status: 'error', message: 'Invalid payment payload', details: parsed.error.issues });
    }
    const { workspaceId, sendRemittance, paymentTypeId, ...rest } = parsed.data;

    const db = dbOverride || getDb();
    const { data: wsData } = await validateWorkspaceMember(db, workspaceId, authReq.user);
    const wsTimezone = typeof wsData?.timezone === 'string' ? wsData.timezone : undefined;
    if (!authReq.user.admin) {
      const userRole = await getWorkspaceUserRole(db, workspaceId, authReq.user.uid);
      if (!['owner', 'accountant', 'bookkeeper'].includes(userRole)) {
        return res.status(403).json({ status: 'error', message: 'Forbidden: requires owner, accountant, or bookkeeper role' });
      }
    }

    const operationId = extractCanonicalOperationId(req);
    if (operationId && !/^[A-Za-z0-9_.:-]{1,128}$/.test(operationId)) {
      return res.status(400).json({ status: 'error', message: 'Invalid payment operation ID' });
    }
    // CC-09: a payment type is looked up in the workspace, never trusted from the client. An idempotent
    // request with a type is matched on what was sent (the type's id), not on its current name or method,
    // so renaming or removing the type cannot turn a retry into a conflict or a second payment.
    const typedRequestFingerprint = () => ({ ...rest, paymentTypeId, paymentDate: rest.paymentDate || null, workspaceId, uid: authReq.user!.uid });
    let payload: typeof rest & { paymentType?: { id: string; name: string } } = rest;
    if (paymentTypeId) {
      const type = findPaymentType(wsData?.paymentTypes, paymentTypeId);
      if (!type) {
        // the same operation may already have been recorded (its reply lost) before the type was removed:
        // hand that payment back rather than ask for another type, which would record it a second time
        const committed = operationId ? await committedPaymentReplay(db, workspaceId, operationId, authReq.user.uid, typedRequestFingerprint()) : null;
        if (committed) return res.json({ status: 'success', data: committed });
        return res.status(400).json({ status: 'error', message: 'That payment type is no longer in Settings. Choose another and try again.' });
      }
      payload = { ...rest, paymentMethod: type.method, paymentType: { id: type.id, name: type.name } };
    }
    // Existing clients without an operation ID remain compatible; callers with a stable ID
    // receive replay-safe posting, including when the server committed but HTTP response was lost.
    const paymentInput = { ...payload, paymentDate: payload.paymentDate || getDateInTimezoneISO(new Date(), wsTimezone), workspaceId, uid: authReq.user.uid };
    const authorization = { platformAdmin: authReq.user.admin === true };
    const result = operationId
      ? await createPaymentIdempotent(db, paymentInput, operationId, paymentTypeId ? typedRequestFingerprint() : undefined, authorization)
      : { ...(await createPaymentAtomic(db, paymentInput, authorization)), replayed: false };
    // Notifications/e-mails are side effects, not part of the payment transaction. Never repeat
    // them when replaying an already-committed payment operation.
    const remittance = result.replayed ? undefined : await afterPaymentRecorded(db, { ...result.payment, id: result.paymentId }, authReq.user.uid, { remittance: sendRemittance });

    res.json({ status: 'success', data: { ...result, ...(sendRemittance ? { remittance } : {}) } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'FORBIDDEN' || message.includes('Forbidden') || message.includes('Unauthorized') || message.includes('Security Violation')) {
      return res.status(403).json({ status: 'error', message });
    }
    if ((err as { status?: number }).status === 409) return res.status(409).json({ status: 'error', message });
    if (message === 'NOT_FOUND' || message.includes('not found')) {
      return res.status(404).json({ status: 'error', message });
    }
    res.status(400).json({ status: 'error', message });
  }
}

paymentRouter.post('/', (req, res) => handleCreatePayment(req, res));



// Credit notes / vendor credits: apply to an open invoice / bill, or refund
const creditApplySchema = z.object({
  workspaceId: z.string().min(1),
  kind: z.enum(['customer', 'vendor']),
  creditId: z.string().min(1),
  documentId: z.string().min(1),
  amountCents: z.number().int().positive(),
  date: z.string().refine(isIsoDate, 'date must be a real date (YYYY-MM-DD)').optional(),
});
const creditRefundSchema = z.object({
  workspaceId: z.string().min(1),
  kind: z.enum(['customer', 'vendor']),
  creditId: z.string().min(1),
  amountCents: z.number().int().positive(),
  cashAccountId: z.string().min(1),
  date: z.string().refine(isIsoDate, 'date must be a real date (YYYY-MM-DD)').optional(),
  memo: z.string().max(500).optional(),
});

async function handleCredit(req: express.Request, res: express.Response, action: 'apply' | 'refund') {
  try {
    const user = (req as AuthenticatedRequest).user;
    const db = getDb();
    let result: Record<string, unknown>;
    if (action === 'apply') {
      const input = creditApplySchema.parse(req.body);
      result = await applyCredit(db, { ...input, uid: user.uid, operationId: extractCanonicalOperationId({ headers: req.headers }) });
    } else {
      const input = creditRefundSchema.parse(req.body);
      result = await refundCredit(db, { ...input, uid: user.uid });
    }
    const { workspaceId, kind, creditId, amountCents } = req.body;
    await writeServerAuditLog({
      workspaceId, uid: user.uid, email: user.email || '', action: action === 'apply' ? 'CREDIT_APPLIED' : 'CREDIT_REFUNDED',
      entityType: kind === 'vendor' ? 'vendorCredit' : 'creditNote', entityId: creditId,
      details: { amountCents, documentId: req.body.documentId, description: `${action === 'apply' ? 'Applied' : 'Refunded'} ${amountCents} cents of credit ${creditId}` },
    }, { db });
    res.json({ status: 'success', data: result });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ status: 'error', message: 'Invalid request', details: err.issues });
    if (err instanceof CreditError) return res.status(err.status).json({ status: 'error', message: err.message });
    res.status(400).json({ status: 'error', message: err instanceof Error ? err.message : String(err) });
  }
}

const ledgerWriters = requireWorkspaceRole(['owner', 'accountant', 'bookkeeper']);
paymentRouter.post('/credits/apply', ledgerWriters, (req, res) => handleCredit(req, res, 'apply'));
paymentRouter.post('/credits/refund', ledgerWriters, (req, res) => handleCredit(req, res, 'refund'));

// BE-06: every open credit (of one customer/vendor, or all) to their open invoices/bills, oldest first
const autoApplySchema = z.object({
  workspaceId: z.string().min(1),
  kind: z.enum(['customer', 'vendor']),
  partyId: z.string().min(1).max(200).optional(),
});
paymentRouter.post('/credits/auto-apply', ledgerWriters, async (req, res) => {
  try {
    const input = autoApplySchema.parse(req.body);
    const user = (req as AuthenticatedRequest).user;
    const db = getDb();
    const result = await autoApplyCredits(db, { ...input, uid: user.uid });
    if (result.applications.length) {
      await writeServerAuditLog({
        workspaceId: input.workspaceId, uid: user.uid, email: user.email || '', action: 'CREDITS_AUTO_APPLIED',
        entityType: input.kind === 'vendor' ? 'vendorCredit' : 'creditNote', entityId: input.partyId || 'all',
        details: { applications: result.applications, description: `Applied ${result.totalCents} cents of open credits to ${result.applications.length} ${input.kind === 'vendor' ? 'bill' : 'invoice'} line(s)` },
      }, { db });
    }
    res.json({ status: 'success', data: result });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ status: 'error', message: 'Invalid request', details: err.issues });
    if (err instanceof CreditError) return res.status(err.status).json({ status: 'error', message: err.message });
    res.status(500).json({ status: 'error', message: 'The credits could not be applied', details: err instanceof Error ? err.message : String(err) });
  }
});

// Make deposit: payments waiting in Undeposited Funds go to the bank in one entry
const depositSchema = z.object({
  workspaceId: z.string().min(1),
  bankAccountId: z.string().min(1),
  date: z.string().refine(isIsoDate, 'date must be a real date (YYYY-MM-DD)').optional(),
  paymentIds: z.array(z.string().min(1)).min(1).max(500),
  memo: z.string().max(500).optional(),
});

paymentRouter.post('/deposits', ledgerWriters, async (req, res) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const input = depositSchema.parse(req.body);
    const db = getDb();
    const result = await createDeposit(db, { ...input, uid: user.uid });
    await writeServerAuditLog({
      workspaceId: input.workspaceId, uid: user.uid, email: user.email || '', action: 'DEPOSIT_MADE',
      entityType: 'transaction', entityId: result.transactionId,
      details: { paymentIds: input.paymentIds, totalCents: result.totalCents, description: `Deposited ${result.count} payment(s) totalling ${result.totalCents} cents` },
    }, { db });
    res.json({ status: 'success', data: result });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ status: 'error', message: 'Invalid request', details: err.issues });
    if (err instanceof DepositError) return res.status(err.status).json({ status: 'error', message: err.message });
    res.status(400).json({ status: 'error', message: err instanceof Error ? err.message : String(err) });
  }
});

// registered last: '/:paymentId/apply' must not catch '/credits/apply'
const applySchema = z.object({
  workspaceId: z.string().min(1),
  allocations: z.array(paymentAllocationSchema).min(1).max(100),
  date: z.string().refine(isIsoDate, 'date must be a real date (YYYY-MM-DD)').optional(),
}).strict();

/** BE-12, K-18: apply a payment's unapplied part (a deposit or prepayment) to invoices or bills. */
paymentRouter.post('/:paymentId/apply', async (req, res) => {
  const authReq = req as unknown as Partial<AuthenticatedRequest>;
  if (!authReq.user?.uid) return res.status(401).json({ status: 'error', message: 'Sign in required' });
  const parsed = applySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ status: 'error', message: 'Invalid request', details: parsed.error.issues });
  try {
    const db = getDb();
    const { data: wsData } = await validateWorkspaceMember(db, parsed.data.workspaceId, authReq.user);
    const wsTimezone = typeof wsData?.timezone === 'string' ? wsData.timezone : undefined;
    const result = await applyUnappliedPayment(db, {
      workspaceId: parsed.data.workspaceId, uid: authReq.user.uid, paymentId: String((req.params as Record<string, string>).paymentId),
      allocations: parsed.data.allocations, date: parsed.data.date || getDateInTimezoneISO(new Date(), wsTimezone),
      operationId: extractCanonicalOperationId({ headers: req.headers }),
    });
    res.json({ status: 'success', data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof PaymentApplyError) return res.status(err.status).json({ status: 'error', message });
    if (/Period Locked/i.test(message)) return res.status(409).json({ status: 'error', message });
    if (/not a member|Forbidden|Unauthorized/i.test(message)) return res.status(403).json({ status: 'error', message });
    res.status(400).json({ status: 'error', message });
  }
});

const voidSchema = z.object({
  workspaceId: z.string().min(1),
  date: z.string().refine(isIsoDate, 'date must be a real date (YYYY-MM-DD)').optional(),
  reason: z.string().max(300).optional(),
}).strict();

/** EG-2 step 4: void a payment: its entries reversed, its ledger rows reversed, its documents due again. A retry posts nothing. */
paymentRouter.post('/:paymentId/void', async (req, res) => {
  const authReq = req as unknown as Partial<AuthenticatedRequest>;
  if (!authReq.user?.uid) return res.status(401).json({ status: 'error', message: 'Sign in required' });
  const parsed = voidSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ status: 'error', message: 'Invalid request', details: parsed.error.issues });
  try {
    const db = getDb();
    await validateWorkspaceMember(db, parsed.data.workspaceId, authReq.user);
    const result = await voidPayment(db, {
      workspaceId: parsed.data.workspaceId, uid: authReq.user.uid, paymentId: String((req.params as Record<string, string>).paymentId),
      date: parsed.data.date, reason: parsed.data.reason,
    });
    res.json({ status: 'success', data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof PaymentApplyError) return res.status(err.status).json({ status: 'error', message });
    if (/Period Locked/i.test(message)) return res.status(409).json({ status: 'error', message });
    if (/not a member|Forbidden|Unauthorized/i.test(message)) return res.status(403).json({ status: 'error', message });
    res.status(400).json({ status: 'error', message });
  }
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
