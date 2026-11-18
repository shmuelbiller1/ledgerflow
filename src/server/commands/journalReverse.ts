import { z } from 'zod';
import { ledgerCreate, ledgerMark } from '../services/ledgerDoor';
import { FieldValue, isWorkspaceMemberData, type DocumentData } from '../db/firestore';
import { TransactionValidator } from '../../kernel/validation/TransactionValidator';
import { TransactionTemplates } from '../../kernel/templates/TransactionTemplates';
import type { Transaction } from '../../types';
import { getAbsoluteTotal } from '../../lib/txFilters';
import { LedgerPostingError, prepareStockMoves } from '../services/cogsStockService';
import { lockMessage, postingLock } from '../../lib/periodLock';
import { HttpError } from '../auth/requestUser';
import { formatTzDate } from '../utils/formatTzDate';
import { refusedLabels, refusedLabelsMessage } from '../../lib/requiredLabels';
import { revaluationEntryLock } from '../services/stockRevaluationService';
import { documentEntryRefusal } from '../services/ledgerEditGuards';
import type { CommandDefinition } from './types';

export const journalReverseInput = z.object({
  id: z.string().min(1).max(200),
  requestedWorkspaceId: z.string().optional(),
  reversalDate: z.string().optional(),
  reason: z.string().optional(),
  replacement: z.record(z.string(), z.unknown()).optional(),
}).strict();
type ReverseResult = { originalId: string; reversal: Transaction; replacement: Transaction | null };

/** Reverse and optionally correct a journal entry in the runner's own transaction. */
export const journalReverseCommand: CommandDefinition<typeof journalReverseInput, ReverseResult> = {
  name: 'journal.reverse', input: journalReverseInput, roles: ['owner', 'accountant', 'bookkeeper'], allowPlatformAdmin: true,
  async handler(ctx, t, input) {
    const db = ctx.db; const user = ctx.user;
    const { id, reversalDate, reason, requestedWorkspaceId } = input;
    const replacement = input.replacement as Partial<Transaction> | undefined;

    // 1. ALL READS UPFRONT
    const txRef = db.collection('transactions').doc(id);
    const origDoc = await t.get(txRef);
    if (!origDoc.exists) {
      throw new HttpError('Transaction not found', 404);
    }
    const origData = origDoc.data() as Transaction;
    const targetWsId = origData.workspaceId || requestedWorkspaceId;
    if (targetWsId !== ctx.workspaceId) throw new HttpError('Workspace mismatch: transaction belongs to a different workspace', 403);
    if (!targetWsId) {
      throw new HttpError('Corrupt transaction: missing workspaceId', 400);
    }

    if (requestedWorkspaceId && requestedWorkspaceId !== origData.workspaceId) {
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

    // #652/#662: an invoice's, bill's, payment's or credit's entry is reversed through that document, so
    // the document and the books cannot disagree. The browser already refuses this; the route did not.
    const documentRefusal = documentEntryRefusal(origData as { metadata?: Record<string, unknown> }, Boolean(user.admin));
    if (documentRefusal) throw new HttpError(documentRefusal, 409);

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
      db, workspaceId: targetWsId,
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
        totalAmountCents: replacement.totalAmountCents || getAbsoluteTotal(replacement as Transaction),
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
        db, workspaceId: targetWsId,
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
    ledgerMark(t, txRef, {
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

    return { originalId: id, reversal: validatedReversal, replacement: validatedReplacement };
  },
  async preview(ctx, input) {
    const doc = await ctx.db.collection('transactions').doc(input.id).get();
    if (!doc.exists || doc.data()?.workspaceId !== ctx.workspaceId) throw new HttpError('Transaction not found', 404);
    return { title: `Reverse transaction ${input.id}`, lines: ['Create a reversing entry in an open period', ...(input.replacement ? ['Create a corrected replacement as well'] : [])] };
  },
  audit(input, result) {
    return { action: 'TRANSACTION_REVERSED', entityType: 'transaction', entityId: input.id,
      description: `Reversed transaction [${input.id}] via reversal [${result.reversal.id}]. Reason: ${input.reason || 'Closed-period correction'}.${result.replacement ? ` Replaced with correction [${result.replacement.id}].` : ''}`,
      details: { originalId: input.id, reversalId: result.reversal.id, replacementId: result.replacement?.id || null, reason: input.reason || 'Closed-period correction' } };
  },
  inverse() { return null; }, risk: 'normal',
  describe: { sentence: 'Reverse a journal entry in an open period and optionally post its correction; do not use it for entries belonging to a source document.', example: { id: 'tx_123', reversalDate: '2026-12-01', reason: 'Correction' }, refusals: [
    { code: 'ROLE_REQUIRED', when: 'The caller cannot write the books.', next: 'Ask an owner, accountant or bookkeeper.' },
    { code: 'CONFLICT', when: 'The entry belongs to a document or is protected.', next: 'Use the source document or its own reversal workflow.' },
    { code: 'PERIOD_LOCKED', when: 'The reversal or replacement date is closed.', next: 'Choose a date in an open period.' },
  ] },
};
