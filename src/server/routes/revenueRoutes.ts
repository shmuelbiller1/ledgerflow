import { errorMessage, requestUser } from '../auth/requestUser';
import express from 'express';
import { z } from 'zod';
import { FieldValue } from '../db/firestore';
import { TransactionValidator } from '../../kernel/validation/TransactionValidator';
import { getDb, assertPeriodOpen } from '../db/firestore';
import { getDateInTimezoneISO } from '../../lib/calendarDate';
import { workspaceRole } from '../../lib/periodLock';

const LEDGER_WRITERS = ['owner', 'accountant', 'bookkeeper'];

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
    if (!wsDoc.exists || (wsData?.uid !== user.uid && !wsData?.members?.includes(user.uid) && !user.admin)) {
      return res.status(403).json({ error: 'Not a member' });
    }
    // AUD-09: posting an entry needs a role that may post; a viewer is a member but may not (found by aud09 test)
    if (!user.admin && !LEDGER_WRITERS.includes(workspaceRole(wsData as never, user.uid))) {
      return res.status(403).json({ error: 'Only owners, accountants and bookkeepers post entries' });
    }

    // 2. Check idempotency record AFTER authorization (#82)
    const idempotencyKey = (req.headers['idempotency-key'] as string) || (contractId && periodId ? `${contractId}_${periodId}` : undefined);
    if (idempotencyKey) {
      const idempDoc = await db.collection('idempotencyKeys').doc(`${workspaceId}_rev_${idempotencyKey}`).get();
      if (idempDoc.exists) {
        return res.json(idempDoc.data()?.response);
      }
    }

    const wsTimezone = typeof wsData?.timezone === 'string' ? wsData.timezone : undefined;
    const txDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : getDateInTimezoneISO(new Date(), wsTimezone);

    // 3. Validate period lock
    await assertPeriodOpen(db, workspaceId, txDate, user.uid);

    const tx = {
      id: db.collection("transactions").doc().id,
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
          amountCents: amountCents, // Debit Liability
          description: 'Recognized revenue - reducing liability'
        },
        {
          id: 'line-2',
          accountId: revenueAccountId,
          amountCents: -amountCents, // Credit Revenue
          description: 'Recognized revenue - increasing income'
        }
      ]
    };

    // 4. Validate through canonical validator (#102-R)
    const validatedTx = await TransactionValidator.validateAndPrepare(tx, {
      workspaceId,
      user: { uid: user.uid, admin: user.admin },
      wsData
    });

    const responsePayload = {
      status: 'ok',
      message: 'Revenue recognized successfully (ASC 606 compliance).',
      transactionId: validatedTx.id
    };

    let resultResponse = responsePayload;

    await db.runTransaction(async (t: any) => {
      if (idempotencyKey) {
        const idempRef = db.collection('idempotencyKeys').doc(`${workspaceId}_rev_${idempotencyKey}`);
        const idempSnap = await t.get(idempRef);
        if (idempSnap.exists) {
          resultResponse = idempSnap.data()?.response || responsePayload;
          return;
        }
      }

      const txRef = db.collection('transactions').doc(validatedTx.id);
      t.set(txRef, { ...validatedTx, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });

      if (idempotencyKey) {
        const idempRef = db.collection('idempotencyKeys').doc(`${workspaceId}_rev_${idempotencyKey}`);
        t.set(idempRef, {
          response: responsePayload,
          timestamp: new Date().toISOString(),
          workspaceId
        });
      }
    });

    res.json(resultResponse);
  } catch (e) {
    res.status(errorMessage(e).includes('Unauthorized') || errorMessage(e).includes('Forbidden') ? 403 : 400).json({ error: errorMessage(e) });
  }
});
