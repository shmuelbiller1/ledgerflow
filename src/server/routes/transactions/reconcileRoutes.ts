import express, { Request, Response } from 'express';
import { FieldValue } from '../../db/firestore';
import { TransactionValidator } from '../../../kernel/validation/TransactionValidator';
import { BankLineUpdateSchema } from '../../../schemas';
import type { Transaction } from '../../../types';
import { parseLocalDate } from '../../../lib/utils';
import { getDb } from '../../db/firestore';
import type { DocumentData, Firestore } from '../../db/firestore';
import { isPostable, getAbsoluteTotal } from '../../../lib/txFilters';
import { optimizedTransactionSimilarity } from '../../../lib/algorithms';
import { getWorkspaceUserRole } from '../workspaceRoutes';
import { BankLineError, payFromBankLine, splitBankLine } from '../../services/bankLineService';
import { BankRuleError, rerunBankRules } from '../../services/bankRuleService';
import { z } from 'zod';
import { writeServerAuditLog } from '../../services/auditLogService';
import { assertPostingOpen } from '../../../lib/periodLock';
import { errorMessage, requestUser } from '../../auth/requestUser';
import type { ExternalBankLine } from './helpers';

/** POST /reconcile: an endpoint for complex reconciliations (match, unmatch, clear in one batch). */
export async function handleReconcile(req: express.Request, res: express.Response, dbOverride?: Firestore) {
  try {
     const { workspaceId, operations } = req.body;
     if (!workspaceId || !Array.isArray(operations) || operations.length === 0) {
       return res.status(400).json({ error: 'Missing workspaceId or operations' });
     }
     if (operations.length > 250) {
       return res.status(400).json({ error: 'Operations batch exceeds 250 operations limit' });
     }
     const authReq = req as unknown as { user?: { uid: string; email?: string; admin?: boolean } };
     const user = authReq.user;
     if (!user?.uid) {
       return res.status(401).json({ error: 'Sign in required' });
     }
     const db = dbOverride || getDb();
     const wsDoc = await db.collection('workspaces').doc(workspaceId).get();
     if (!wsDoc.exists) {
       return res.status(404).json({ error: 'Workspace not found' });
     }
     const wsData = wsDoc.data();
     const userRole = await getWorkspaceUserRole(db, workspaceId, user.uid);
     if (!['owner', 'accountant', 'bookkeeper'].includes(userRole)) {
       return res.status(403).json({ error: 'Forbidden: requires owner, accountant, or bookkeeper role' });
     }
     // Pre-collect all doc IDs and account IDs
     const bankLineIds = new Set<string>();
     const txIds = new Set<string>();
     const accountIds = new Set<string>();

     for (const op of operations) {
       if (!op.id || typeof op.id !== 'string') {
         throw new Error('Invalid operation ID');
       }
       if (op.type === 'updateBankLine') {
         bankLineIds.add(op.id);
       } else if (op.type === 'updateTransaction' || op.type === 'createTransaction') {
         txIds.add(op.id);
         if (Array.isArray(op.data?.lines)) {
           for (const line of op.data.lines) {
             if (line?.accountId) accountIds.add(line.accountId);
           }
         }
       } else {
         throw new Error(`Unsupported operation type: ${op.type}`);
       }
     }
     
     await db.runTransaction(async (t) => {
        // STEP 1: ALL READS UPFRONT (Guarantees zero read-after-write violations)
        const bankLineSnaps = new Map<string, DocumentData>();
        for (const id of bankLineIds) {
          const snap = await t.get(db.collection('bankLines').doc(id));
          bankLineSnaps.set(id, snap);
        }

        const txSnaps = new Map<string, DocumentData>();
        for (const id of txIds) {
          const snap = await t.get(db.collection('transactions').doc(id));
          txSnaps.set(id, snap);
        }

        // Closed periods (src/lib/periodLock.ts): nothing dated in them is changed or created.
        for (const snap of [...bankLineSnaps.values(), ...txSnaps.values()]) {
          if (snap.exists && snap.data()?.date) assertPostingOpen(snap.data().date, wsData, user.uid);
        }
        for (const op of operations) {
          if (op.type === 'createTransaction' && op.data?.date) assertPostingOpen(op.data.date, wsData, user.uid);
        }

        // Also gather any account IDs from existing transactions that might be updated
        for (const snap of txSnaps.values()) {
          if (snap.exists && Array.isArray(snap.data()?.lines)) {
            for (const l of snap.data().lines) {
              if (l?.accountId) accountIds.add(l.accountId);
            }
          }
        }

        const accMap = new Map<string, DocumentData>();
        if (accountIds.size > 0) {
          const accRefs = Array.from(accountIds).map(id => db.collection('chartAccounts').doc(id));
          const accSnaps = await t.getAll(...accRefs);
          for (const snap of accSnaps) {
            if (snap.exists) {
              accMap.set(snap.id, snap.data() || {});
            }
          }
        }

        // STEP 2: IN-MEMORY VALIDATION AND WRITE PREPARATION
        const writes: Array<() => void> = [];

        for (const op of operations) {
          if (op.type === 'updateBankLine') {
            const lineSnap = bankLineSnaps.get(op.id);
            if (!lineSnap || !lineSnap.exists || lineSnap.data()?.workspaceId !== workspaceId) {
              throw new Error(`Bank line ${op.id} does not belong to authorized workspace`);
            }
            const lineRef = db.collection('bankLines').doc(op.id);
            const validatedData = BankLineUpdateSchema.parse(op.data);
            // a bank line in another currency is not matched as home-currency money: its amount needs a
            // conversion first (AF-001 follow-up, CodeRabbit on #439)
            const lineCurrency = String(lineSnap.data()?.currency || '').toUpperCase();
            const homeCurrency = String(wsData?.currency || 'USD').toUpperCase();
            if (validatedData.status === 'matched' && lineCurrency && lineCurrency !== homeCurrency) {
              throw new Error(`Bank line ${op.id} is in ${lineCurrency}, not ${homeCurrency}; it can't be matched until it is converted`);
            }
            // undoing a match on a line the bank later changed or withdrew: the bank's version is what goes
            // back to To review, since the next sync will not send that change again (CodeRabbit on #439)
            const line = lineSnap.data() || {};
            if (validatedData.status === 'pending' && line.bankChange === 'removed') {
              writes.push(() => t.delete(lineRef));
              continue;
            }
            const correction = validatedData.status === 'pending' && line.bankChange === 'modified' && line.bankCorrection && typeof line.bankCorrection === 'object'
              ? { date: line.bankCorrection.date, description: line.bankCorrection.description, amountCents: line.bankCorrection.amountCents, currency: line.bankCorrection.currency, suggestion: null, bankChange: null, bankChangeAt: null, bankCorrection: null }
              : {};
            writes.push(() => t.update(lineRef, { ...validatedData, ...correction, updatedAt: FieldValue.serverTimestamp() }));
          } else if (op.type === 'updateTransaction') {
            const txSnap = txSnaps.get(op.id);
            if (!txSnap || !txSnap.exists || txSnap.data()?.workspaceId !== workspaceId) {
              throw new Error(`Transaction ${op.id} does not belong to authorized workspace`);
            }
            const existingTxData = txSnap.data() as Transaction;
            
            const safeData = { ...op.data };
            delete safeData.workspaceId;
            delete safeData.uid;

            const merged = { ...existingTxData, ...safeData };
            
            const validatedTx = await TransactionValidator.validateAndPrepare(merged, {
                workspaceId: workspaceId,
                user: { uid: user.uid, admin: user.admin },
                wsData,
                accountsMap: accMap
            }, existingTxData, t);

            const txRef = db.collection('transactions').doc(op.id);
            writes.push(() => t.update(txRef, { ...validatedTx, updatedAt: FieldValue.serverTimestamp() }));
          } else if (op.type === 'createTransaction') {
            const txSnap = txSnaps.get(op.id);
            if (txSnap && txSnap.exists) {
              throw new Error(`Transaction ${op.id} already exists`);
            }
            
            const payload = {
              ...op.data,
              id: op.id,
              workspaceId,
              uid: user.uid,
              createdAt: op.data?.createdAt || new Date().toISOString()
            };
            const validatedTx = await TransactionValidator.validateAndPrepare(payload, {
              workspaceId,
              user: { uid: user.uid, admin: user.admin },
              wsData,
              accountsMap: accMap
            }, undefined, t);

            const txRef = db.collection('transactions').doc(op.id);
            writes.push(() => t.create(txRef, { ...validatedTx, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }));
          }
        }

        // STEP 3: EXECUTE ALL WRITES + AUDIT LOG
        for (const writeOp of writes) {
          writeOp();
        }

        await writeServerAuditLog({
          workspaceId,
          uid: user.uid,
          email: user.email || '',
          action: 'reconcile',
          entityType: 'reconciliation',
          entityId: operations[0]?.id || 'batch',
          details: {
            description: `User ${user.email || user.uid} executed reconciliation batch (${operations.length} operations)`
          },
          severity: 'info'
        }, { db, tx: t });
     });
     res.json({ status: 'ok' });
  } catch(e: unknown) {
    const errMessage = e instanceof Error ? e.message : String(e);
    if (errMessage === 'Not a member' || errMessage.includes('Forbidden')) {
       return res.status(403).json({ error: errMessage });
    }
    res.status(400).json({ error: errMessage });
  }
}

const bankLinePaySchema = z.object({
  workspaceId: z.string().min(1),
  bankAccountId: z.string().min(1).optional(),
  allocations: z.array(z.object({ documentId: z.string().min(1), amountCents: z.number().int().positive() })).min(1).max(100),
});
const bankLineSplitSchema = z.object({
  workspaceId: z.string().min(1),
  bankAccountId: z.string().min(1).optional(),
  splits: z.array(z.object({ accountId: z.string().min(1), amountCents: z.number().int().positive(), description: z.string().max(500).optional() })).min(1).max(50),
});
async function clearBankLine(req: Request, res: Response, action: 'pay' | 'split') {
  try {
    const user = (req as Request & { user: { uid: string } }).user;
    const { id } = req.params as Record<string, string>;
    const result = action === 'pay'
      ? await payFromBankLine(getDb(), { ...bankLinePaySchema.parse(req.body), uid: user.uid, bankLineId: id })
      : await splitBankLine(getDb(), { ...bankLineSplitSchema.parse(req.body), uid: user.uid, bankLineId: id });
    res.json({ status: 'ok', ...result });
  } catch (e) {
    if (e instanceof z.ZodError) return res.status(400).json({ error: 'Invalid request', details: e.issues });
    res.status(e instanceof BankLineError ? e.status : 400).json({ error: e instanceof Error ? e.message : String(e) });
  }
}

/** Bank reconciliation: match and clear bank lines, pay or split a bank line. Part of /api/v1/transactions (F-06), registered in the original order. */
export function registerReconcileRoutes(transactionRouter: express.Router): void {
  transactionRouter.post('/reconcile', (req, res) => handleReconcile(req, res));

  // Clear a pending bank line: pay invoices/bills with it, or split it over accounts (bankLineService)
  transactionRouter.post('/bank-lines/:id/pay', (req, res) => clearBankLine(req, res, 'pay'));
  transactionRouter.post('/bank-lines/:id/split', (req, res) => clearBankLine(req, res, 'split'));

  // EG-9: the bank rules again over the lines not yet matched (suggestions only; owners and accountants)
  transactionRouter.post('/bank-lines/apply-rules', async (req, res) => {
    try {
      const { workspaceId, after, limit } = z.object({ workspaceId: z.string().min(1).max(200), after: z.string().min(1).max(200).optional(), limit: z.number().int().min(1).max(5000).optional() }).strict().parse(req.body);
      const user = requestUser(req);
      if (user.developerWorkspaceId && user.developerWorkspaceId !== workspaceId) return res.status(403).json({ error: 'This API key is for another workspace' });
      res.json(await rerunBankRules(getDb(), { workspaceId, uid: user.uid, after, limit }));
    } catch (e) {
      if (e instanceof z.ZodError) return res.status(400).json({ error: 'Invalid request', details: e.issues });
      if (e instanceof BankRuleError) return res.status(e.status).json({ error: e.message });
      console.error('[BANK RULES]', e);
      res.status(500).json({ error: 'The bank rules could not be run' });
    }
  });

  transactionRouter.patch('/bank-lines/:id', async (req, res) => {
    try {
      const { id } = req.params as Record<string, string>;
      const { workspaceId, ...updatePayload } = req.body;
      if (!workspaceId) {
        return res.status(400).json({ error: 'Missing workspaceId' });
      }
      const user = requestUser(req);
      const db = getDb();
      const wsDoc = await db.collection('workspaces').doc(workspaceId).get();
      if (!wsDoc.exists || (wsDoc.data()?.uid !== user.uid && !wsDoc.data()?.members?.includes(user.uid) && !user.admin)) {
        return res.status(403).json({ error: 'Not a member' });
      }

      const lineRef = db.collection('bankLines').doc(id);
      const lineSnap = await lineRef.get();
      if (!lineSnap.exists || lineSnap.data()?.workspaceId !== workspaceId) {
        return res.status(404).json({ error: `Bank line ${id} not found in workspace` });
      }

      // Strict allowlist validation (#78) - rejects any unknown or protected properties
      const validatedData = BankLineUpdateSchema.parse(updatePayload);
      await lineRef.update({ ...validatedData, updatedAt: FieldValue.serverTimestamp() });
      res.json({ status: 'ok', id, data: validatedData });
    } catch (e) {
      if (e instanceof z.ZodError) {
        return res.status(400).json({ error: 'Schema validation failed', details: e.issues });
      }
      res.status(400).json({ error: errorMessage(e) });
    }
  });




  // ==========================================
  // PROGRAMMATIC RECONCILIATION API (B2B)
  // ==========================================

  transactionRouter.get('/reconciliation/status', async (req, res) => {
    try {
      const user = requestUser(req);
      const workspaceId = (req.query.workspaceId as string) || user.developerWorkspaceId;
      if (!workspaceId) return res.status(400).json({ error: "Missing workspaceId" });

      if (user.developerWorkspaceId && user.developerWorkspaceId !== workspaceId) {
        return res.status(403).json({ error: `Forbidden: API key is scoped strictly to workspace ${user.developerWorkspaceId}` });
      }

      const db = getDb();
      const wsDoc = await db.collection('workspaces').doc(workspaceId).get();
      if (!wsDoc.exists || (wsDoc.data()?.uid !== user.uid && !wsDoc.data()?.members?.includes(user.uid) && !user.admin)) return res.status(403).json({ error: 'Not a member' });

      // Fetch transactions and count uncleared (accounting for unset / false / null isCleared)
      const snapshot = await db.collection('transactions')
        .where('workspaceId', '==', workspaceId)
        .get();
      
      const unclearedDocs = snapshot.docs.filter(doc => {
        const data = doc.data();
        return !data.isCleared && isPostable(data as Transaction);
      });

      const unclearedCount = unclearedDocs.length;
      res.json({
        status: 'ok',
        workspaceId,
        unclearedCount,
        message: `There are ${unclearedCount} uncleared transactions awaiting reconciliation.`
      });
    } catch (e) {
      res.status(500).json({ error: errorMessage(e) });
    }
  });

  transactionRouter.post('/reconciliation/match', async (req, res) => {
    try {
      const { workspaceId, externalBankLines } = req.body;
      if (!workspaceId || !Array.isArray(externalBankLines)) {
        return res.status(400).json({ error: "Missing workspaceId or externalBankLines array" });
      }
      const user = requestUser(req);
      if (user.developerWorkspaceId && user.developerWorkspaceId !== workspaceId) {
        return res.status(403).json({ error: `Forbidden: API key is scoped strictly to workspace ${user.developerWorkspaceId}` });
      }
      const db = getDb();
      const wsDoc = await db.collection('workspaces').doc(workspaceId).get();
      if (!wsDoc.exists || (wsDoc.data()?.uid !== user.uid && !wsDoc.data()?.members?.includes(user.uid) && !user.admin)) return res.status(403).json({ error: 'Not a member' });

      // Fetch uncleared transactions for this workspace
      const snapshot = await db.collection('transactions')
        .where('workspaceId', '==', workspaceId)
        .get();

      const unclearedTxs = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as Transaction & { isCleared?: boolean }))
        .filter(tx => !tx.isCleared && isPostable(tx));

      const suggestions = externalBankLines.map((bankLine: ExternalBankLine) => {
        const lineAmt = Math.abs(bankLine.amountCents || Math.round((bankLine.amount || 0) * 100));
        const lineDesc = bankLine.description || bankLine.merchant || '';
        let lineTime: number | null = null;
        if (bankLine.date) {
          try {
            lineTime = parseLocalDate(bankLine.date).getTime();
          } catch {
            lineTime = null;
          }
        }

        let bestMatchId: string | null = null;
        let highestConfidence = 0;

        for (const tx of unclearedTxs) {
          const txAmt = Math.abs(getAbsoluteTotal(tx));
          const amtMatch = txAmt === lineAmt;
          const amtClose = Math.abs(txAmt - lineAmt) <= 100;

          let dateProximity = 0.5;
          if (lineTime && tx.date) {
            try {
              const txTime = parseLocalDate(tx.date).getTime();
              const diffDays = Math.abs(lineTime - txTime) / (1000 * 60 * 60 * 24);
              if (diffDays === 0) dateProximity = 1.0;
              else if (diffDays <= 3) dateProximity = 0.9;
              else if (diffDays <= 7) dateProximity = 0.7;
              else if (diffDays <= 30) dateProximity = 0.4;
              else dateProximity = 0.1;
            } catch {
              dateProximity = 0.5;
            }
          }

          const textSim = optimizedTransactionSimilarity(lineDesc, tx.description || '');

          let confidence = 0;
          if (amtMatch) {
            confidence = 0.5 + (dateProximity * 0.3) + (textSim * 0.2);
          } else if (amtClose) {
            confidence = 0.3 + (dateProximity * 0.3) + (textSim * 0.3);
          } else if (textSim > 0.8) {
            confidence = textSim * 0.4;
          }

          if (confidence > highestConfidence && confidence >= 0.5) {
            highestConfidence = Math.min(1, Math.round(confidence * 100) / 100);
            bestMatchId = tx.id;
          }
        }

        return {
          externalId: bankLine.id,
          suggestedInternalId: bestMatchId,
          confidence: highestConfidence
        };
      });

      const matchedCount = suggestions.filter(s => s.suggestedInternalId !== null).length;

      res.json({
        status: 'ok',
        matchedCount,
        suggestions
      });
    } catch (e) {
      res.status(500).json({ error: errorMessage(e) });
    }
  });

  transactionRouter.post('/reconciliation/clear', async (req, res) => {
    try {
      const { workspaceId, transactionIds } = req.body;
      if (!workspaceId || !Array.isArray(transactionIds) || transactionIds.length === 0) {
        return res.status(400).json({ error: "Missing workspaceId or transactionIds" });
      }
      if (transactionIds.length > 500) {
        return res.status(400).json({ error: "Batch size exceeds limit of 500 items" });
      }
      const user = requestUser(req);
      const db = getDb();
      const wsDoc = await db.collection('workspaces').doc(workspaceId).get();
      if (!wsDoc.exists || (wsDoc.data()?.uid !== user.uid && !wsDoc.data()?.members?.includes(user.uid) && !user.admin)) {
        return res.status(403).json({ error: 'Not a member' });
      }
      // marking entries cleared is bookkeeping: owners, accountants and bookkeepers (CA-04)
      const role = wsDoc.data()?.uid === user.uid ? 'owner' : wsDoc.data()?.roles?.[user.uid] || 'viewer';
      if (!user.admin && !['owner', 'accountant', 'bookkeeper'].includes(role)) {
        return res.status(403).json({ error: 'Only owners, accountants and bookkeepers mark entries cleared' });
      }
      // the day the bank cleared it (CA-04): optional, never before the entry's own date; cleared: false undoes it
      const { clearanceDate, cleared } = req.body as { clearanceDate?: unknown; cleared?: unknown };
      if (clearanceDate !== undefined && (typeof clearanceDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(clearanceDate))) {
        return res.status(400).json({ error: 'The clearance date must be a date (YYYY-MM-DD)' });
      }
      const undo = cleared === false;

      // Verify all transactions belong to this workspace to prevent cross-tenant IDOR tampering
      const refs = transactionIds.map((id: string) => db.collection('transactions').doc(id));
      const snaps = await db.getAll(...refs);

      const batch = db.batch();
      const wsData = wsDoc.data();
      for (const snap of snaps) {
        if (!snap.exists) {
          return res.status(404).json({ error: `Transaction ${snap.id} not found` });
        }
        const txData = snap.data() as Transaction;
      
        TransactionValidator.validateTransactionState(txData, {
          workspaceId,
          user: { uid: user.uid, admin: user.admin },
          wsData
        });

        if (!undo && typeof clearanceDate === 'string' && txData.date && clearanceDate < String(txData.date).slice(0, 10)) {
          return res.status(400).json({ error: `It can't clear the bank before the entry's own date (${String(txData.date).slice(0, 10)})` });
        }
        batch.update(snap.ref, undo
          ? { isCleared: false, isReconciled: false, clearedAt: FieldValue.delete(), clearanceDate: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() }
          : {
            isCleared: true,
            clearedAt: FieldValue.serverTimestamp(),
            ...(typeof clearanceDate === 'string' ? { clearanceDate } : {}),
            updatedAt: FieldValue.serverTimestamp()
          });
      }
      await batch.commit();

      res.json({
        status: 'ok',
        clearedCount: transactionIds.length,
        message: undo ? 'Marked as not cleared.' : 'Transactions successfully cleared.'
      });
    } catch (e) {
      res.status(500).json({ error: errorMessage(e) });
    }
  });
}
