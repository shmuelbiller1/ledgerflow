import { errorMessage, requestUser } from '../auth/requestUser';
import express from 'express';
import { z } from 'zod';
import { FieldValue, getDb, assertPeriodOpen, isWorkspaceMemberData } from '../db/firestore';
import { TransactionValidator } from '../../kernel/validation/TransactionValidator';
import { getDateInTimezoneISO } from '../../lib/calendarDate';
import { mayPostEntries } from '../http/ledgerWriter';
import { ledgerCreate } from '../services/ledgerDoor';
import { writeServerAuditLog } from '../services/auditLogService';
import { deriveScopedOperationKey, executeIdempotent, extractCanonicalOperationId, requestPayloadHash } from '../utils/idempotency';

const RecognizeRevenueSchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId is required'),
  contractId: z.string().optional(),
  periodId: z.string().optional(),
  amountCents: z.number().int().positive('amountCents must be a positive integer'),
  deferredAccountId: z.string().min(1, 'deferredAccountId is required'),
  revenueAccountId: z.string().min(1, 'revenueAccountId is required'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format').optional()
});

export const revenueRouter = express.Router();

revenueRouter.post('/recognize', async (req, res) => {
  try {
    const parseResult = RecognizeRevenueSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        status: 'error',
        error: 'Validation failed',
        details: parseResult.error.issues
      });
    }

    const { workspaceId, contractId, periodId, amountCents, deferredAccountId, revenueAccountId, date } = parseResult.data;
    const user = requestUser(req);
    const db = getDb();

    // 1. Authorize workspace membership FIRST before checking idempotency (#82)
    const wsDoc = await db.collection('workspaces').doc(workspaceId).get();
    const wsData = wsDoc.data();
    if (!wsDoc.exists || !isWorkspaceMemberData(wsData, user, workspaceId)) {
      return res.status(403).json({ error: 'Not a member' });
    }
    if (!mayPostEntries(wsData, user)) return res.status(403).json({ error: 'Only owners, accountants and bookkeepers post entries' }); // AUD-09

    const explicitOpId = extractCanonicalOperationId(req);
    const rawOpId = explicitOpId || (contractId && periodId ? `${contractId}_${periodId}` : undefined);

    const wsTimezone = typeof wsData?.timezone === 'string' ? wsData.timezone : undefined;
    const txDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : getDateInTimezoneISO(new Date(), wsTimezone);

    // 2. Validate period lock
    await assertPeriodOpen(db, workspaceId, txDate, user.uid);

    const tx = {
      id: db.collection('transactions').doc().id,
      workspaceId,
      uid: user.uid,
      date: txDate,
      description: `ASC 606 Revenue Recognition for Contract ${contractId || 'Unknown'} (Period ${periodId || 'N/A'})`,
      totalAmountCents: amountCents,
      currency: 'USD',
      type: 'journal' as const,
      status: 'approved' as const,
      isCleared: true,
      createdAt: new Date().toISOString(),
      lines: [
        {
          id: 'line-1',
          accountId: deferredAccountId,
          amountCents: amountCents,
          description: 'Recognized revenue - reducing liability'
        },
        {
          id: 'line-2',
          accountId: revenueAccountId,
          amountCents: -amountCents,
          description: 'Recognized revenue - increasing income'
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
      message: 'Revenue recognized successfully (ASC 606 compliance).',
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
        action: 'REVENUE_RECOGNIZED',
        entityType: 'transaction',
        entityId: validatedTx.id,
        details: {
          description: `Recognized revenue for contract ${contractId || 'Unknown'} (${amountCents} cents) on ${txDate}`,
          contractId: contractId || null,
          periodId: periodId || null,
          amountCents,
          deferredAccountId,
          revenueAccountId,
          date: txDate,
        },
      }, { db, tx: t });
      return responsePayload;
    };

    const resultResponse = rawOpId
      ? await executeIdempotent(
          deriveScopedOperationKey(workspaceId, 'REVENUE_RECOGNIZE', rawOpId),
          {
            actor: explicitOpId ? user.uid : '',
            workspaceId,
            operationType: 'REVENUE_RECOGNIZE',
            payloadHash: requestPayloadHash(parseResult.data),
          },
          performCommit,
        )
      : await db.runTransaction(performCommit);

    res.json(resultResponse);
  } catch (e) {
    const explicitStatus = (e as { status?: number })?.status;
    const status = typeof explicitStatus === 'number'
      ? explicitStatus
      : (errorMessage(e).includes('Unauthorized') || errorMessage(e).includes('Forbidden') ? 403 : 400);
    res.status(status).json({ error: errorMessage(e) });
  }
});
