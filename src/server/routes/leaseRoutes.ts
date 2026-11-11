import { errorMessage, requestUser } from '../auth/requestUser';
import express from 'express';
import { z } from 'zod';
import { FieldValue, getDb, assertPeriodOpen, isWorkspaceMemberData, validateWorkspaceMember } from '../db/firestore';
import { TransactionValidator } from '../../kernel/validation/TransactionValidator';
import { getDateInTimezoneISO } from '../../lib/calendarDate';
import { mayPostEntries } from '../http/ledgerWriter';
import { computePropertyRentRoll, reconcileSecurityDepositTrust } from '../../lib/verticalAccounting';
import type { Invoice } from '../../types';
import { ledgerCreate } from '../services/ledgerDoor';
import { writeServerAuditLog } from '../services/auditLogService';
import { extractCanonicalOperationId, runOptionalIdempotent } from '../utils/idempotency';

const CapitalizeLeaseSchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId is required'),
  leaseName: z.string().optional(),
  pvAmountCents: z.number().int().positive('pvAmountCents must be a positive integer'),
  rouAssetAccountId: z.string().min(1, 'rouAssetAccountId is required'),
  leaseLiabilityAccountId: z.string().min(1, 'leaseLiabilityAccountId is required'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format').optional()
});

export const leaseRouter = express.Router();

leaseRouter.post('/capitalize', async (req, res) => {
  try {
    const parseResult = CapitalizeLeaseSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        status: 'error',
        error: 'Validation failed',
        details: parseResult.error.issues
      });
    }

    const { workspaceId, leaseName, pvAmountCents, rouAssetAccountId, leaseLiabilityAccountId, date } = parseResult.data;
    const user = requestUser(req);
    const db = getDb();

    // 1. Authorize workspace membership & API-key workspace scope FIRST before checking idempotency (#82)
    let wsData: Record<string, unknown> | undefined;
    try {
      ({ data: wsData } = await validateWorkspaceMember(db, workspaceId, user));
    } catch {
      return res.status(403).json({ error: 'Not a member' });
    }
    if (!mayPostEntries(wsData, user)) return res.status(403).json({ error: 'Only owners, accountants and bookkeepers post entries' }); // AUD-09

    const explicitOpId = extractCanonicalOperationId(req);
    const rawOpId = explicitOpId || (leaseName ? `lease_${leaseName.toLowerCase().replace(/[^a-z0-9]/g, '_')}` : undefined);

    const wsTimezone = typeof wsData?.timezone === 'string' ? wsData.timezone : undefined;
    const txDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : getDateInTimezoneISO(new Date(), wsTimezone);

    // 2. Validate period lock
    await assertPeriodOpen(db, workspaceId, txDate, user.uid);

    const tx = {
      id: db.collection('transactions').doc().id,
      workspaceId,
      uid: user.uid,
      date: txDate,
      description: `ASC 842 Initial Recognition: ${leaseName || 'Operating Lease'}`,
      totalAmountCents: pvAmountCents,
      currency: 'USD',
      type: 'journal' as const,
      status: 'approved' as const,
      isCleared: true,
      createdAt: new Date().toISOString(),
      lines: [
        {
          id: 'line-1',
          accountId: rouAssetAccountId,
          amountCents: pvAmountCents,
          description: 'Capitalize PV of lease payments'
        },
        {
          id: 'line-2',
          accountId: leaseLiabilityAccountId,
          amountCents: -pvAmountCents,
          description: 'Recognize lease liability'
        }
      ]
    };

    // 3. Validate through canonical validator (#102-R)
    const validatedTx = await TransactionValidator.validateAndPrepare(tx, {
      workspaceId,
      user: { uid: user.uid, admin: user.admin },
      wsData
    });

    const responsePayload = {
      status: 'ok' as const,
      message: 'ASC 842 Lease capitalized successfully.',
      transactionId: validatedTx.id
    };

    const performCommit = async (t: Parameters<Parameters<typeof db.runTransaction>[0]>[0]) => {
      const wsNow = (await t.get(db.collection('workspaces').doc(workspaceId))).data();
      if (!isWorkspaceMemberData(wsNow, user, workspaceId) || !mayPostEntries(wsNow, user)) {
        throw Object.assign(new Error('Only owners, accountants and bookkeepers post entries'), { status: 403 });
      }
      const txRef = db.collection('transactions').doc(validatedTx.id);
      ledgerCreate(t, txRef, { ...validatedTx, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      await writeServerAuditLog({
        workspaceId,
        uid: user.uid,
        email: user.email,
        action: 'LEASE_CAPITALIZED',
        entityType: 'transaction',
        entityId: validatedTx.id,
        details: {
          description: `Capitalized lease ${leaseName || 'Operating Lease'} (${pvAmountCents} cents) on ${txDate}`,
          leaseName: leaseName || 'Operating Lease',
          pvAmountCents,
          rouAssetAccountId,
          leaseLiabilityAccountId,
          date: txDate,
        },
      }, { db, tx: t });
      return responsePayload;
    };

    const resultResponse = await runOptionalIdempotent(
      { workspaceId, operationType: 'LEASE_CAPITALIZE', rawOperationId: rawOpId, legacyPrefix: 'lease', actor: explicitOpId ? user.uid : '', payload: parseResult.data },
      performCommit,
    );

    res.json(resultResponse);
  } catch (e) {
    const explicitStatus = (e as { status?: number })?.status;
    const status = typeof explicitStatus === 'number'
      ? explicitStatus
      : (errorMessage(e).includes('Unauthorized') || errorMessage(e).includes('Forbidden') ? 403 : 400);
    res.status(status).json({ error: errorMessage(e) });
  }
});

const TrustReconciliationSchema = z.object({
  workspaceId: z.string().min(1),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  bankStatementTrustCents: z.number().int(),
  outstandingDepositsCents: z.number().int().optional(),
  outstandingChecksCents: z.number().int().optional(),
  trustCashBookBalanceCents: z.number().int(),
  trustLiabilityAccountBalanceCents: z.number().int(),
  tenantSubledgers: z.array(
    z.object({
      unitId: z.string().min(1),
      tenantName: z.string().min(1),
      heldCents: z.number().int(),
    }),
  ),
});

leaseRouter.post('/trust-reconciliation', async (req, res) => {
  try {
    const rawWorkspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId.trim() : '';
    if (!rawWorkspaceId) {
      return res.status(400).json({ error: 'workspaceId is required' });
    }
    const user = requestUser(req);
    const db = getDb();
    let wsData: Record<string, unknown> | undefined;
    try {
      ({ data: wsData } = await validateWorkspaceMember(db, rawWorkspaceId, user));
    } catch {
      return res.status(403).json({ error: 'Not a member' });
    }
    if (!mayPostEntries(wsData, user)) {
      return res.status(403).json({ error: 'Only owners, accountants and bookkeepers run trust reconciliations' });
    }

    const parsed = TrustReconciliationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const result = reconcileSecurityDepositTrust(parsed.data);
    return res.json({ status: 'ok', reconciliation: result });
  } catch (e) {
    return res.status(400).json({ error: errorMessage(e) });
  }
});

const RentRollRequestSchema = z.object({
  workspaceId: z.string().min(1),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  units: z.array(
    z.object({
      unitId: z.string().min(1),
      propertyId: z.string().min(1),
      propertyName: z.string().min(1),
      unitLabel: z.string().min(1),
      tenantId: z.string().nullable().optional(),
      tenantName: z.string().nullable().optional(),
      monthlyRentCents: z.number().int().nonnegative(),
      leaseStart: z.string().nullable().optional(),
      leaseEnd: z.string().nullable().optional(),
      securityDepositHeldCents: z.number().int().nonnegative(),
    }),
  ),
});

leaseRouter.post('/rent-roll', async (req, res) => {
  try {
    const rawWorkspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId.trim() : '';
    if (!rawWorkspaceId) {
      return res.status(400).json({ error: 'workspaceId is required' });
    }
    const user = requestUser(req);
    const db = getDb();
    let wsData: Record<string, unknown> | undefined;
    try {
      ({ data: wsData } = await validateWorkspaceMember(db, rawWorkspaceId, user));
    } catch {
      return res.status(403).json({ error: 'Not a member' });
    }
    if (!mayPostEntries(wsData, user)) {
      return res.status(403).json({ error: 'Only owners, accountants and bookkeepers compute rent rolls' });
    }

    const parsed = RentRollRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const invSnap = await db.collection('invoices').where('workspaceId', '==', rawWorkspaceId).get();
    const invoices = invSnap.docs.map(d => ({ ...(d.data() as Invoice), id: d.id }));
    const rentRoll = computePropertyRentRoll(parsed.data.units, invoices, parsed.data.asOfDate);
    return res.json({ status: 'ok', rentRoll });
  } catch (e) {
    return res.status(400).json({ error: errorMessage(e) });
  }
});
