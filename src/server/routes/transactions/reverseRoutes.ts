import express from 'express';
import { ledgerCreate, ledgerWrite } from '../../services/ledgerDoor';
import { FieldValue } from '../../db/firestore';
import { TransactionValidator } from '../../../kernel/validation/TransactionValidator';
import { TransactionTemplates } from '../../../kernel/templates/TransactionTemplates';
import type { Transaction } from '../../../types';
import { getDb, assertWorkspaceAccess, isWorkspaceMemberData } from '../../db/firestore';
import type { DocumentData } from '../../db/firestore';
import { getAbsoluteTotal } from '../../../lib/txFilters';
import { LedgerPostingError, prepareStockMoves } from '../../services/cogsStockService';
import { writeServerAuditLog } from '../../services/auditLogService';
import { lockMessage, postingLock } from '../../../lib/periodLock';
import { errorMessage, HttpError, requestUser } from '../../auth/requestUser';
import { formatTzDate } from './helpers';
import { refusedLabels, refusedLabelsMessage } from '../../../lib/requiredLabels';
import { revaluationEntryLock } from '../../services/stockRevaluationService';
import { computeIntercompanyIdentityHash } from '../../../lib/selfBalancingDimensions';

/** Reversing an entry and intercompany transfers. Part of /api/v1/transactions (F-06), registered in the original order. */
export function registerReverseRoutes(transactionRouter: express.Router): void {
  /**
   * POST /api/v1/transactions/:id/reverse
   * "Reverse & Correct" — the closed-period correction workflow
   * Atomic reversal and optional replacement of a transaction with audit trail chaining.
   */
  transactionRouter.post('/:id/reverse', async (req, res) => {
    try {
      const { id } = req.params as Record<string, string>;
      const { reversalDate, reason, replacement, workspaceId } = req.body;
      const user = requestUser(req);
      const db = getDb();

      let resultReversal = null as Transaction | null; // set inside the database transaction below
      let resultReplacement = null as Transaction | null;
      let targetWsId = '';

      await db.runTransaction(async (t) => {
        // 1. ALL READS UPFRONT
        const txRef = db.collection('transactions').doc(id);
        const origDoc = await t.get(txRef);
        if (!origDoc.exists) {
          throw new HttpError('Transaction not found', 404);
        }
        const origData = origDoc.data() as Transaction;
        targetWsId = origData.workspaceId || workspaceId;
        if (!targetWsId) {
          throw new HttpError('Corrupt transaction: missing workspaceId', 400);
        }

        if (workspaceId && workspaceId !== origData.workspaceId) {
          throw new HttpError('Workspace mismatch: transaction belongs to a different workspace', 403);
        }

        if (user.developerWorkspaceId && user.developerWorkspaceId !== targetWsId) {
          throw new HttpError(`Forbidden: API key is scoped strictly to workspace ${user.developerWorkspaceId}`, 403);
        }

        // Verify workspace membership & period lock date
        const wsDoc = await t.get(db.collection('workspaces').doc(targetWsId));
        if (!wsDoc.exists) {
          throw new HttpError('Workspace not found', 404);
        }
        const wsData = wsDoc.data();
        if (!isWorkspaceMemberData(wsData, user, targetWsId)) {
          throw new HttpError('Not a member', 403);
        }

        // Check if already reversed — reversing twice must be impossible
        if (origData.reversalEventId) {
          throw new HttpError(`Transaction ${id} has already been reversed by ${origData.reversalEventId}.`, 400);
        }

        // Reject reversing a reversal transaction
        if (origData.type === 'reversal') {
          throw new HttpError(`Cannot reverse a transaction that is already a reversal.`, 400);
        }
        const revaluation = revaluationEntryLock(origData as never); // ISS-130
        if (revaluation) throw new HttpError(revaluation, 409);

        // Status lock check on original
        if ((origData.status === 'certified' || origData.status === 'void') && !user.admin) {
          throw new HttpError(`Forbidden: Transaction ${id} status is locked (${origData.status}).`, 403);
        }

        // Validate reversal date against period lock (must land in an open period)
        const revDate = reversalDate || formatTzDate(new Date(), wsData?.timezone);
        const revLock = postingLock(revDate, wsData, user.uid);
        if (revLock) {
          throw new HttpError(`${lockMessage(revDate, revLock)} Choose a reversal date in an open period.`, 400);
        }

        // Validate replacement date against period lock (must land in an open period)
        if (replacement) {
          const replDate = replacement.date || revDate;
          const replLock = postingLock(replDate, wsData, user.uid);
          if (replLock) {
            throw new HttpError(`${lockMessage(replDate, replLock)} Choose a replacement date in an open period.`, 400);
          }
        }

        // Pre-read all chart accounts for both reversal and replacement
        const accountIds = new Set<string>();
        if (Array.isArray(origData.lines)) {
          for (const l of origData.lines) {
            if (l?.accountId) accountIds.add(l.accountId);
          }
        }
        if (replacement && Array.isArray(replacement.lines)) {
          for (const l of replacement.lines) {
            if (l?.accountId) accountIds.add(l.accountId);
          }
        }

        const accMap = new Map<string, DocumentData>();
        if (accountIds.size > 0) {
          const accRefs = Array.from(accountIds).map(aid => db.collection('chartAccounts').doc(aid));
          const accSnaps = await t.getAll(...accRefs);
          for (const snap of accSnaps) {
            if (snap.exists) {
              accMap.set(snap.id, snap.data() || {});
            }
          }
        }

        // 2. IN-MEMORY PREPARATION & VALIDATION
        const reversalId = db.collection('transactions').doc().id;
        const reversalLines = TransactionTemplates.buildReversalLines(origData.lines || [], origData.description);
        const allowedMetaKeys = ['confidence', 'vaultDocId', 'tags', 'note', 'category', 'source', 'batchId', 'project', 'department'];
        const cleanOrigMeta: Record<string, unknown> = {};
        if (origData.metadata) {
          for (const k of allowedMetaKeys) {
            if (k in origData.metadata) cleanOrigMeta[k] = origData.metadata[k];
          }
        }

        const reversalTxPayload: Record<string, unknown> = {
          id: reversalId,
          workspaceId: targetWsId,
          uid: user.uid,
          date: revDate,
          description: `Reversal of ${origData.description || id}`,
          totalAmountCents: origData.totalAmountCents,
          currency: origData.currency || 'USD',
          originalCurrency: origData.originalCurrency,
          exchangeRate: origData.exchangeRate || 1,
          payee: origData.payee,
          status: 'completed',
          type: 'reversal',
          parentEventId: id,
          lines: reversalLines,
          metadata: {
            ...cleanOrigMeta,
            isReversal: true,
            reversesTxId: id,
            reversalReason: reason || undefined
          }
        };

        const validatedReversal = await TransactionValidator.validateAndPrepare(reversalTxPayload, {
          workspaceId: targetWsId,
          user: { uid: user.uid, admin: user.admin },
          wsData,
          accountsMap: accMap
        }, undefined, t);

        let validatedReplacement: Transaction | null = null;
        if (replacement) {
          if (!replacement.lines || !Array.isArray(replacement.lines) || replacement.lines.length === 0) {
            throw new HttpError('Replacement transaction must specify non-empty lines', 400);
          }
          const replId = replacement.id || db.collection('transactions').doc().id;
          const replPayload: Record<string, unknown> = {
            ...replacement,
            id: replId,
            workspaceId: targetWsId,
            uid: user.uid,
            date: replacement.date || revDate,
            description: replacement.description || origData.description,
            totalAmountCents: replacement.totalAmountCents || getAbsoluteTotal(replacement),
            currency: replacement.currency || origData.currency || 'USD',
            originalCurrency: replacement.originalCurrency || origData.originalCurrency,
            exchangeRate: replacement.exchangeRate || origData.exchangeRate || 1,
            payee: replacement.payee || origData.payee,
            status: replacement.status || 'completed',
            type: replacement.type || origData.type || 'actual',
            parentEventId: id,
            lines: replacement.lines,
            metadata: {
              ...(replacement.metadata || {}),
              isCorrection: true,
              correctsTxId: id,
              correctionReason: reason || undefined
            }
          };

          validatedReplacement = await TransactionValidator.validateAndPrepare(replPayload, {
            workspaceId: targetWsId,
            user: { uid: user.uid, admin: user.admin },
            wsData,
            accountsMap: accMap
          }, undefined, t);
          // Z-12: the corrected entry needs the labels a refusing rule asks for (voiding never does)
          const missing = refusedLabels(validatedReplacement, wsData?.dimensions);
          if (missing.length > 0) throw new LedgerPostingError(400, refusedLabelsMessage(missing));
        }

        // Reversing a cost-of-goods-sold entry puts the stock back (and no entry is reversed twice).
        const stock = await prepareStockMoves(db, t, targetWsId, validatedReplacement ? [validatedReversal, validatedReplacement] : [validatedReversal]);

        // 3. ATOMIC WRITES (All after reads)
        stock.apply();
        // A: Create reversal transaction
        ledgerCreate(t, db.collection('transactions').doc(reversalId), {
          ...validatedReversal,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        });

        // B: Set reversalEventId on original (narrow exemption on locked period)
        t.update(txRef, {
          reversalEventId: reversalId,
          updatedAt: FieldValue.serverTimestamp()
        });

        // C: Create replacement transaction if supplied
        if (validatedReplacement) {
          ledgerCreate(t, db.collection('transactions').doc(validatedReplacement.id), {
            ...validatedReplacement,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
          });
        }

        resultReversal = validatedReversal;
        resultReplacement = validatedReplacement;
      });

      // Write audit-log entry capturing the reason
      await writeServerAuditLog({
        workspaceId: targetWsId,
        uid: user.uid,
        email: user.email || "developer@ledgerflow.io",
        action: "TRANSACTION_REVERSED",
        entityType: "transaction",
        entityId: id,
        details: {
          description: `Reversed transaction [${id}] via reversal [${resultReversal?.id}]. Reason: ${reason || 'Closed-period correction'}.${resultReplacement ? ` Replaced with correction [${resultReplacement.id}].` : ''}`,
          originalId: id,
          reversalId: resultReversal?.id,
          replacementId: resultReplacement?.id || null,
          reason: reason || 'Closed-period correction'
        }
      }, { db });

      res.json({
        status: 'ok',
        originalId: id,
        reversal: resultReversal,
        replacement: resultReplacement
      });
    } catch (e) {
      const statusCode = (e as { statusCode?: number }).statusCode || (e instanceof LedgerPostingError ? e.status : (errorMessage(e) === 'Transaction not found' ? 404 : (errorMessage(e).includes('Forbidden') || errorMessage(e) === 'Not a member' ? 403 : 400)));
      res.status(statusCode).json({ error: errorMessage(e) });
    }
  });

  /**
   * ATOMIC INTERCOMPANY TRANSFER ENGINE
   * Posts reciprocal balancing entries in two workspaces simultaneously.
   * Uses a Due To / Due From logic to maintain group-wide reconciliation.
   */
  transactionRouter.post('/intercompany/post', async (req, res) => {
    try {
      const { 
        sourceWorkspaceId, 
        targetWorkspaceId, 
        amountCents, 
        description, 
        date,
        sourceAccountId, // e.g. Cash account in Source
        targetAccountId,  // e.g. Inventory/Expense in Target
        targetAmountCents: givenTargetCents // what arrives, in the target's currency (needed when the currencies differ)
      } = req.body;
    
      if (!sourceWorkspaceId || !targetWorkspaceId || !amountCents) {
        return res.status(400).json({ error: 'Missing required intercompany parameters (source, target, amount)' });
      }

      const user = requestUser(req);
      const db = getDb();

      // 1. Validate permissions for BOTH entities (Intercompany requires group-level access)
      const [sourceAuth, targetAuth] = await Promise.all([
        assertWorkspaceAccess(db, sourceWorkspaceId, user),
        assertWorkspaceAccess(db, targetWorkspaceId, user)
      ]);
    
      const sourceWsData = sourceAuth.data;
      const targetWsData = targetAuth.data;
      // Z-19 (found by DA-09): companies in different currencies need the amount that arrives; it is
      // never converted with a guessed rate
      const sourceCurrency = String(sourceWsData.currency || 'USD');
      const targetCurrency = String(targetWsData.currency || 'USD');
      let targetCents = amountCents;
      if (sourceCurrency !== targetCurrency) {
        if (!Number.isSafeInteger(givenTargetCents) || givenTargetCents <= 0) {
          return res.status(400).json({ error: `${sourceWsData.name || 'One company'} keeps its books in ${sourceCurrency} and ${targetWsData.name || 'the other'} in ${targetCurrency}: say how much arrives in ${targetCurrency} (targetAmountCents).` });
        }
        targetCents = givenTargetCents;
      }

      // 2. Resolve Reciprocal Clearing Accounts
      // We look for accounts marked as 'intercompany' role or named 'Intercompany'
      const [sourceAccsSnap, targetAccsSnap] = await Promise.all([
        db.collection('chartAccounts').where('workspaceId', '==', sourceWorkspaceId).get(),
        db.collection('chartAccounts').where('workspaceId', '==', targetWorkspaceId).get()
      ]);

      const sourceAccounts = sourceAccsSnap.docs.map(d => ({ id: d.id, ...d.data() } as DocumentData & { id: string }));
      const targetAccounts = targetAccsSnap.docs.map(d => ({ id: d.id, ...d.data() } as DocumentData & { id: string }));

      let sourceClearing = sourceAccounts.find(a => a.role === 'intercompany' || (a.name || '').toLowerCase().includes('intercompany'));
      let targetClearing = targetAccounts.find(a => a.role === 'intercompany' || (a.name || '').toLowerCase().includes('intercompany'));

      // Create clearing accounts if missing
      const batch = db.batch();
      if (!sourceClearing) {
        const ref = db.collection('chartAccounts').doc();
        sourceClearing = {
          id: ref.id,
          workspaceId: sourceWorkspaceId,
          name: `Intercompany Due From ${targetWsData.name || 'Target'}`,
          code: '1300',
          type: 'asset',
          subtype: 'other_current_asset',
          category: 'Receivables',
          balanceCents: 0,
          createdAt: new Date().toISOString()
        };
        batch.set(ref, sourceClearing);
      }

      if (!targetClearing) {
        const ref = db.collection('chartAccounts').doc();
        targetClearing = {
          id: ref.id,
          workspaceId: targetWorkspaceId,
          name: `Intercompany Due To ${sourceWsData.name || 'Source'}`,
          code: '2300',
          type: 'liability',
          subtype: 'other_current_liability',
          category: 'Payables',
          balanceCents: 0,
          createdAt: new Date().toISOString()
        };
        batch.set(ref, targetClearing);
      }

      // 3. Prepare Reciprocal Transactions
      const sourceTxId = db.collection('transactions').doc().id;
      const targetTxId = db.collection('transactions').doc().id;
      const effectiveSourceDate = date || formatTzDate(new Date(), sourceWsData?.timezone);
      const sharedIdentityHash = computeIntercompanyIdentityHash({
        sourceWorkspaceId,
        targetWorkspaceId,
        sourceTxId,
        targetTxId,
        date: effectiveSourceDate,
        sourceAmountCents: amountCents,
        targetAmountCents: targetCents,
        sourceCurrency,
        targetCurrency,
      });

      // SOURCE: Dr Intercompany Clearing / Cr Cash (Asset Transfer Out)
      const sourceTx: Record<string, unknown> = {
        id: sourceTxId,
        uid: user.uid,
        workspaceId: sourceWorkspaceId,
        date: effectiveSourceDate,
        description: description || `Intercompany Transfer to ${targetWsData.name}`,
        totalAmountCents: amountCents,
        currency: sourceWsData.currency || 'USD',
        exchangeRate: 1,
        status: 'completed',
        type: 'actual',
        metadata: { isIntercompany: true, targetWorkspaceId, targetTxId, sharedIdentityHash },
        lines: [
          {
            accountId: sourceClearing.id,
            accountName: sourceClearing.name,
            amountCents: amountCents, // Debit Due From (Asset Up)
            description: `Due From ${targetWsData.name}`
          },
          {
            accountId: sourceAccountId || sourceAccounts.find(a => a.role === 'cash' || a.subtype === 'cash')?.id,
            accountName: 'Cash/Bank',
            amountCents: -amountCents, // Credit Cash (Asset Down)
            description: `Transfer Out`
          }
        ]
      };

      // TARGET: Dr Asset/Expense / Cr Intercompany Clearing (Liability Up)
      const targetTx: Record<string, unknown> = {
        id: targetTxId,
        uid: user.uid,
        workspaceId: targetWorkspaceId,
        date: date || formatTzDate(new Date(), targetWsData?.timezone),
        description: description || `Intercompany Receipt from ${sourceWsData.name}`,
        totalAmountCents: targetCents,
        currency: targetWsData.currency || 'USD',
        exchangeRate: 1,
        status: 'completed',
        type: 'actual',
        metadata: { isIntercompany: true, sourceWorkspaceId, sourceTxId, sharedIdentityHash },
        lines: [
          {
            accountId: targetAccountId || targetAccounts.find(a => a.type === 'expense' || a.type === 'asset')?.id,
            accountName: 'Target Account',
            amountCents: targetCents, // Debit Asset/Expense (Asset Up / Expense Up)
            description: `Intercompany Receipt`
          },
          {
            accountId: targetClearing.id,
            accountName: targetClearing.name,
            amountCents: -targetCents, // Credit Due To (Liability Up)
            description: `Due To ${sourceWsData.name}`
          }
        ]
      };

      // 4. Validate both transactions before posting
      // the clearing accounts made above are written in the same batch as the entries, so the check
      // is given each company's accounts including them (DA-09 found the first post always refused)
      const accountsOf = (list: Array<DocumentData & { id: string }>, clearing: DocumentData & { id: string }) =>
        new Map<string, { workspaceId?: string; name?: string }>([...list, clearing].map(a => [a.id, { workspaceId: a.workspaceId, name: a.name }]));
      const [validSource, validTarget] = await Promise.all([
        TransactionValidator.validateAndPrepare(sourceTx, { workspaceId: sourceWorkspaceId, user, wsData: sourceWsData, accountsMap: accountsOf(sourceAccounts, sourceClearing as DocumentData & { id: string }) }),
        TransactionValidator.validateAndPrepare(targetTx, { workspaceId: targetWorkspaceId, user, wsData: targetWsData, accountsMap: accountsOf(targetAccounts, targetClearing as DocumentData & { id: string }) })
      ]);

      // 5. Commit Atomically
      await ledgerWrite(batch, db.collection('transactions').doc(sourceTxId), { ...validSource, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      await ledgerWrite(batch, db.collection('transactions').doc(targetTxId), { ...validTarget, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    
      await batch.commit();
      await Promise.all([
        writeServerAuditLog({
          workspaceId: sourceWorkspaceId,
          uid: user.uid,
          email: user.email,
          action: 'INTERCOMPANY_TRANSFER_POSTED',
          entityType: 'transaction',
          entityId: sourceTxId,
          details: {
            description: `Posted intercompany transfer out to ${targetWsData.name}`,
            targetWorkspaceId,
            targetTxId,
            amountCents,
          },
        }, { db }),
        writeServerAuditLog({
          workspaceId: targetWorkspaceId,
          uid: user.uid,
          email: user.email,
          action: 'INTERCOMPANY_TRANSFER_POSTED',
          entityType: 'transaction',
          entityId: targetTxId,
          details: {
            description: `Posted intercompany receipt from ${sourceWsData.name}`,
            sourceWorkspaceId,
            sourceTxId,
            amountCents: targetCents,
          },
        }, { db }),
      ]);

      res.json({
        status: 'ok',
        message: 'Intercompany reciprocal entries posted successfully',
        sourceTxId,
        targetTxId,
        sharedIdentityHash,
      });
    } catch (err) {
      res.status((err as { status?: number }).status || 500).json({ error: errorMessage(err) });
    }
  });
}
