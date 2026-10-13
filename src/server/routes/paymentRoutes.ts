import express from 'express';
import { z } from 'zod';
import type { Firestore } from '../db/firestore';
import { getDb, validateWorkspaceMember } from '../db/firestore';
import { applyUnappliedPayment, createPaymentAtomic, createPaymentIdempotent, PaymentApplyError } from '../services/paymentService';
import { extractCanonicalOperationId } from '../utils/idempotency';
import { getLocalDateISO } from '../../lib/utils';
import { getWorkspaceUserRole, AuthenticatedRequest, requireWorkspaceRole } from './workspaceRoutes';
import { applyCredit, autoApplyCredits, CreditError, refundCredit } from '../services/creditService';
import { createDeposit, DepositError } from '../services/depositService';
import { writeServerAuditLog } from '../services/auditLogService';
import { afterPaymentRecorded } from '../services/afterPayment';

export const paymentRouter = express.Router();

const paymentAllocationSchema = z.object({
  documentId: z.string().min(1),
  documentType: z.enum(['invoice', 'bill']),
  amountCents: z.number().int().positive()
});

const paymentInputSchema = z.object({
  workspaceId: z.string().min(1),
  amountCents: z.number().int().positive(),
  paymentDate: z.string().default(() => getLocalDateISO()),
  cashAccountId: z.string().min(1),
  paymentMethod: z.string().optional(),
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
    const { workspaceId, sendRemittance, ...payload } = parsed.data;

    const db = dbOverride || getDb();
    await validateWorkspaceMember(db, workspaceId, authReq.user);

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
    // Existing clients without an operation ID remain compatible; callers with a stable ID
    // receive replay-safe posting, including when the server committed but HTTP response was lost.
    const paymentInput = { ...payload, workspaceId, uid: authReq.user.uid };
    const result = operationId
      ? await createPaymentIdempotent(db, paymentInput, operationId)
      : { ...(await createPaymentAtomic(db, paymentInput)), replayed: false };
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
});
const creditRefundSchema = z.object({
  workspaceId: z.string().min(1),
  kind: z.enum(['customer', 'vendor']),
  creditId: z.string().min(1),
  amountCents: z.number().int().positive(),
  cashAccountId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(() => getLocalDateISO()),
  memo: z.string().max(500).optional(),
});

async function handleCredit(req: express.Request, res: express.Response, action: 'apply' | 'refund') {
  try {
    const user = (req as AuthenticatedRequest).user;
    const db = getDb();
    let result: Record<string, unknown>;
    if (action === 'apply') {
      const input = creditApplySchema.parse(req.body);
      result = await applyCredit(db, input);
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
    const result = await autoApplyCredits(db, input);
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
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(() => getLocalDateISO()),
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
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict();

/** BE-12, K-18: apply a payment's unapplied part (a deposit or prepayment) to invoices or bills. */
paymentRouter.post('/:paymentId/apply', async (req, res) => {
  const authReq = req as unknown as Partial<AuthenticatedRequest>;
  if (!authReq.user?.uid) return res.status(401).json({ status: 'error', message: 'Sign in required' });
  const parsed = applySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ status: 'error', message: 'Invalid request', details: parsed.error.issues });
  try {
    const db = getDb();
    await validateWorkspaceMember(db, parsed.data.workspaceId, authReq.user);
    const result = await applyUnappliedPayment(db, {
      workspaceId: parsed.data.workspaceId, uid: authReq.user.uid, paymentId: String((req.params as Record<string, string>).paymentId),
      allocations: parsed.data.allocations, date: parsed.data.date || getLocalDateISO(),
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
