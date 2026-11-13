import express from 'express';
import { BudgetBlocked, budgetWarningsFor, enforceBudgetControl, type BudgetWarning } from '../../services/budgetGuard';
import { revaluationEntryLock } from '../../services/stockRevaluationService';
import { ledgerCreate } from '../../services/ledgerDoor';
import { FieldValue } from '../../db/firestore';
import { TransactionValidator } from '../../../kernel/validation/TransactionValidator';
import { TransactionSchema } from '../../../schemas';
import type { Transaction, TransactionLine } from '../../../types';
import { getDb, isWorkspaceMemberData } from '../../db/firestore';
import type { DocumentData } from '../../db/firestore';
import { getAbsoluteTotal } from '../../../lib/txFilters';
import { executeCommand } from '../../utils/commandExecutor';
import { deriveScopedOperationKey, extractCanonicalOperationId } from '../../utils/idempotency';
import { requirePlanCapacity } from '../../middleware/planCapacity';
import { requireOpenPeriod } from '../../middleware/periodLock';
import { writeServerAuditLog } from '../../services/auditLogService';
import { deletionSentence, deletionSnapshot } from '../../services/deletionRecord';
import { assertPostingOpen, lockMessage, postingLock } from '../../../lib/periodLock';
import { errorMessage, HttpError, requestUser } from '../../auth/requestUser';
import { enforceDoubleEntrySafety, ifMatchVersion, isUpdatedAtMismatch } from './helpers';
import { FieldsError, parseFields, pickFields } from '../../http/sparseFields';
import { refusedLabels, refusedLabelsMessage } from '../../../lib/requiredLabels';
import { auditSnapshot, documentEntryRefusal, postedDeletionRefusal, postedStatusRefusal } from '../../services/ledgerEditGuards';

/**
 * Audit F3: what a journal save checks inside its own transaction, against the workspace as it is now: the actor is
 * still a member, and every date the save touches is open for them (hard close, or the soft close for their role).
 */
function assertStillOpen(ws: DocumentData | undefined, user: { uid: string; admin?: boolean }, dates: Array<string | null | undefined>): void {
  if (!isWorkspaceMemberData(ws, user)) throw new HttpError('Not a member', 403);
  for (const date of dates) {
    const lock = date ? postingLock(date, ws, user.uid) : null;
    if (lock) throw new HttpError(lockMessage(date, lock), 400);
  }
}

/** Read, create, edit and delete one entry. Part of /api/v1/transactions (F-06), registered in the original order. */
export function registerTransactionCrudRoutes(transactionRouter: express.Router): void {
  transactionRouter.get('/', async (req, res) => {
    try {
      const user = requestUser(req);
      const workspaceId = (req.query.workspaceId as string) || user.developerWorkspaceId;
      if (!workspaceId) return res.status(400).json({ error: "Missing workspaceId query parameters" });

      if (user.developerWorkspaceId && user.developerWorkspaceId !== workspaceId) {
        return res.status(403).json({ error: `Forbidden: API key is scoped strictly to workspace ${user.developerWorkspaceId}` });
      }

      const db = getDb();
      const wsDoc = await db.collection('workspaces').doc(workspaceId).get();
      if (!wsDoc.exists || !isWorkspaceMemberData(wsDoc.data(), user, workspaceId)) {
        return res.status(403).json({ error: 'Not a member' });
      }

      const { startDate, endDate, accountId, limit, cursor } = req.query;
      // Z-04: ?fields=date,description,… returns only those fields (and the id)
      let fields: string[] | null;
      try { fields = parseFields(req.query.fields); } catch (err) {
        if (err instanceof FieldsError) return res.status(400).json({ error: err.message });
        throw err;
      }

      let queryFn = db.collection("transactions").where("workspaceId", "==", workspaceId);
    
      // HushLedger-style cursor + ledger revision pagination
      queryFn = queryFn.orderBy("date", "desc").orderBy("__name__", "desc");
    
      if (startDate) queryFn = queryFn.where("date", ">=", startDate as string);
      if (endDate) queryFn = queryFn.where("date", "<=", endDate as string);
    
      if (cursor) {
        const cursorDoc = await db.collection("transactions").doc(cursor as string).get();
        if (cursorDoc.exists) {
          queryFn = queryFn.startAfter(cursorDoc);
        }
      }
    
      const maxLimit = Number.parseInt(limit as string, 10) || 100;
      const fetchLimit = accountId ? 1000 : Math.min(maxLimit, 1000);
      queryFn = queryFn.limit(fetchLimit);

      const transactionsSnap = await queryFn.get();
      let transactions = transactionsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

      if (accountId) {
        transactions = transactions.filter((t: DocumentData) => t.lines?.some((l: TransactionLine) => l.accountId === accountId));
      }

      const nextCursor = transactionsSnap.docs.length === fetchLimit 
        ? transactionsSnap.docs[transactionsSnap.docs.length - 1].id 
        : null;

      res.json({
        status: "success",
        workspaceId,
        transactionsCount: transactions.length,
        nextCursor,
        transactions: pickFields(transactions as Array<Record<string, unknown>>, fields)
      });
    } catch (err) {
      if (errorMessage(err) === "FORBIDDEN") return res.status(403).json({ error: "Forbidden workspace access" });
      console.error('[TRANSACTION ROUTE ERROR]', err);
      res.status(500).json({ error: "An unexpected internal server error occurred." });
    }
  });

  transactionRouter.post('/', requirePlanCapacity('transactions'), requireOpenPeriod('transactions'), enforceDoubleEntrySafety, async (req, res) => {
    const { transaction } = req.body || {};
    const workspaceId = transaction?.workspaceId || req.body?.workspaceId;
    if (!workspaceId) {
      return res.status(400).json({ status: 'error', message: 'Workspace ID is required' });
    }

    // EG-4 (review 4366372413): the entry is checked and prepared BEFORE the command's transaction, and that one
    // prepared entry is both what the budget check reads and what is saved. Its reads (the workspace, the chart, the
    // budget figures) go through the pool, never while the transaction holds a connection.
    const user = requestUser(req);
    const db = getDb();
    // a completed command is replayed before any check that depends on today's settings (label rules,
    // budgets): a client recovering a lost answer gets the saved result, not a refusal
    const operationId = extractCanonicalOperationId(req);
    if (operationId) {
      const done = (await db.collection('idempotencyKeys').doc(deriveScopedOperationKey(String(workspaceId).trim(), 'TRANSACTION_CREATE', operationId)).get()).data();
      if (done?.status === 'success') {
        return executeCommand(req, res, workspaceId, 'TRANSACTION_CREATE', async () => { throw new HttpError('The operation was not replayed', 409); });
      }
    }
    let validatedTx: Transaction;
    let planned: BudgetWarning[];
    try {
      if (!transaction || !transaction.workspaceId) throw new HttpError('Invalid payload', 400);
      // a copy: req.body stays the client's JSON, which the idempotency fingerprint is computed from
      const draft = { ...transaction, uid: user.uid };
      if (!draft.totalAmountCents) draft.totalAmountCents = getAbsoluteTotal(draft);
      const parsed = TransactionSchema.safeParse(draft);
      if (!parsed.success) throw Object.assign(new HttpError('Schema validation failed', 400), { details: parsed.error.issues });
      const transactionToSave = { ...parsed.data, id: parsed.data.id || db.collection("transactions").doc().id } as Transaction;
      const wsData = (await db.collection('workspaces').doc(transactionToSave.workspaceId).get()).data();
      if (!isWorkspaceMemberData(wsData, user, transactionToSave.workspaceId)) throw new HttpError('Not a member', 403);
      validatedTx = await TransactionValidator.validateAndPrepare(transactionToSave, { workspaceId: transactionToSave.workspaceId, user: { uid: user.uid, admin: user.admin }, wsData });
      // Z-12: a required label whose rule refuses
      const missing = refusedLabels(validatedTx, wsData?.dimensions);
      if (missing.length > 0) throw new HttpError(refusedLabelsMessage(missing), 400);
      planned = await budgetWarningsFor(db, validatedTx.workspaceId, wsData, [validatedTx]);
    } catch (err) {
      // answered as executeCommand answers a refusal (an unexpected error: 500 without its words)
      const status = (err as { status?: number }).status || 500;
      if (status >= 500) { console.error('[TRANSACTION_CREATE] prepare failed:', err); return res.status(status).json({ status: 'error', message: 'An internal server error occurred.' }); }
      return res.status(status).json({ status: 'error', message: errorMessage(err), details: (err as { details?: unknown }).details });
    }
    let budgetWarnings: BudgetWarning[] = [];
    return executeCommand(req, res, workspaceId, 'TRANSACTION_CREATE', async (_ctx, t) => {
      // the budget control as the workspace has it at commit (warn by default, 409 when it blocks)
      const wsNow = (await t.get(db.collection('workspaces').doc(validatedTx.workspaceId))).data();
      // audit F3 (5 Nov): membership and the closed period as the workspace has them now, inside the save; the
      // entry was prepared against an earlier read, and the month may have been closed in between
      assertStillOpen(wsNow, user, [validatedTx.date]);
      try { budgetWarnings = enforceBudgetControl(wsNow, planned); } catch (err) {
        if (err instanceof BudgetBlocked) throw new HttpError(err.message, 409);
        throw err;
      }
      // Execute atomic validation and create inside the single command transaction boundary
      const txRef = db.collection('transactions').doc(validatedTx.id);
      const doc = await t.get(txRef);
      if (doc.exists) {
         throw new Error('Duplicate request processing: Transaction ID already exists');
      }

      ledgerCreate(t, txRef, { 
        ...validatedTx, 
        createdAt: FieldValue.serverTimestamp(), 
        updatedAt: FieldValue.serverTimestamp() 
      });
      await writeServerAuditLog({
        workspaceId: validatedTx.workspaceId,
        uid: user.uid,
        email: user.email,
        action: 'TRANSACTION_CREATED',
        entityType: 'transaction',
        entityId: validatedTx.id,
        details: {
          description: `Created journal entry "${validatedTx.description || validatedTx.id}"`,
          totalAmountCents: validatedTx.totalAmountCents,
          date: validatedTx.date,
        },
      }, { db, tx: t });

      return validatedTx;
    }, () => (budgetWarnings.length > 0 ? { budgetWarnings } : {}));
  });

  /**
   * Z-03: several entries in one request (at most 500), all or none: each is checked as one entry is
   * (schema, balanced lines, accounts in the workspace, the period lock), then all are created in one
   * database transaction. The answer lists their ids in order; a refusal names the entry (by index).
   */
  transactionRouter.post('/batch-create', requirePlanCapacity('transactions'), async (req, res) => {
    const { workspaceId, transactions } = req.body || {};
    if (!workspaceId || typeof workspaceId !== 'string') return res.status(400).json({ status: 'error', message: 'Workspace ID is required' });
    if (!Array.isArray(transactions) || transactions.length === 0) return res.status(400).json({ status: 'error', message: 'Send the entries as "transactions": [...]' });
    if (transactions.length > 500) return res.status(400).json({ status: 'error', message: 'At most 500 entries a request' });

    return executeCommand(req, res, workspaceId, 'TRANSACTION_BATCH_CREATE', async (_ctx, t) => {
      const user = requestUser(req);
      const db = getDb();
      const wsDoc = await t.get(db.collection('workspaces').doc(workspaceId));
      const wsData = wsDoc.data();
      if (!wsDoc.exists || !isWorkspaceMemberData(wsData, user, workspaceId)) throw new HttpError('Not a member', 403);
      const prepared: Transaction[] = [];
      const ids = new Set<string>();
      for (const [index, raw] of (transactions as Array<Record<string, unknown>>).entries()) {
        const entry: Record<string, unknown> = { ...(raw || {}), workspaceId, uid: user.uid };
        if (!entry.totalAmountCents) entry.totalAmountCents = getAbsoluteTotal(entry as unknown as Transaction);
        const parsed = TransactionSchema.safeParse(entry);
        if (!parsed.success) throw Object.assign(new HttpError(`Entry ${index}: schema validation failed`, 400), { details: parsed.error.issues });
        const id = parsed.data.id || db.collection('transactions').doc().id;
        if (ids.has(id)) throw new HttpError(`Entry ${index}: the id ${id} is used twice in this request`, 400);
        ids.add(id);
        try {
          prepared.push(await TransactionValidator.validateAndPrepare({ ...parsed.data, id } as Transaction, { workspaceId, user: { uid: user.uid, admin: user.admin }, wsData }, undefined, t));
        } catch (err) {
          throw new HttpError(`Entry ${index}: ${errorMessage(err)}`, /Period Locked/i.test(errorMessage(err)) ? 409 : 400);
        }
        const missing = refusedLabels(prepared[prepared.length - 1], wsData?.dimensions);
        if (missing.length > 0) throw new HttpError(`Entry ${index}: ${refusedLabelsMessage(missing)}`, 400);
        if ((await t.get(db.collection('transactions').doc(id))).exists) throw new HttpError(`Entry ${index}: an entry with the id ${id} already exists`, 409);
      }
      for (const tx of prepared) {
        ledgerCreate(t, db.collection('transactions').doc(tx.id), { ...tx, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      }
      await writeServerAuditLog({
        workspaceId,
        uid: user.uid,
        email: user.email,
        action: 'TRANSACTIONS_BATCH_CREATED',
        entityType: 'transaction',
        entityId: prepared[0]?.id || 'batch',
        details: {
          description: `Created ${prepared.length} journal entries in batch`,
          count: prepared.length,
        },
      }, { db, tx: t });
      return { created: prepared.length, ids: prepared.map(tx => tx.id) };
    });
  });

  transactionRouter.put('/:id', requireOpenPeriod('transactions'), enforceDoubleEntrySafety, async (req, res) => {
    try {
      const { id } = req.params as Record<string, string>;
      const { partialUpdate } = req.body;
      let { transaction } = req.body;
      const user = requestUser(req);
      const db = getDb();

      // Support flat API payloads: { workspaceId, lines, date, ... }
      if (!transaction && !partialUpdate && (req.body.workspaceId || req.body.lines || req.body.date)) {
        transaction = { ...req.body, id };
      }
    
      // For partial updates (like flagging or voiding)
      if (partialUpdate) {
        let authoritativeWsId = '';
        let beforeEdit: Record<string, unknown> | null = null;
        let afterEdit: Record<string, unknown> | null = null;
        await db.runTransaction(async (t) => {
           const txRef = db.collection('transactions').doc(id);
           const doc = await t.get(txRef);
           if (!doc.exists) throw new Error('Not found');
           const txData = doc.data();

           // Optimistic concurrency check
           const expectedUpdatedAt = req.body.expectedUpdatedAt || partialUpdate.expectedUpdatedAt || ifMatchVersion(req.header('if-match'));
           if (isUpdatedAtMismatch(expectedUpdatedAt, txData?.updatedAt)) {
             throw Object.assign(new Error('version_conflict'), { currentTransaction: { ...txData, id: doc.id } });
           }

           const wsId = txData?.workspaceId;
           authoritativeWsId = wsId;
           // Verify workspace inside the same transaction so no second pool client is checked out while holding t
           const wsDoc = await t.get(db.collection('workspaces').doc(wsId));
           const wsData = wsDoc.data();
           if (!wsDoc.exists || !isWorkspaceMemberData(wsData, user, wsId)) {
             throw new Error('Not a member');
           }
           if (txData?.date) assertPostingOpen(txData.date, wsData, user.uid);
           if ((txData?.status === 'certified' || txData?.status === 'void') && !user.admin) {
             throw new Error(`Forbidden: Transaction status is locked (${txData?.status}).`);
           }

           // #652/#662: a document's entry is changed through the document, and a posted entry is never
           // un-posted in place (a status of failed/draft drops it from every report). Same rule as the
           // browser's isDocumentEntry, applied where it cannot be bypassed.
           const documentRefusal = documentEntryRefusal(txData as { metadata?: Record<string, unknown> }, Boolean(user.admin), Object.keys(partialUpdate));
           if (documentRefusal) throw new HttpError(documentRefusal, 409);
           const unpostRefusal = postedStatusRefusal(txData as Partial<Transaction>, partialUpdate.status, Boolean(user.admin)) ||
             postedDeletionRefusal(txData as Partial<Transaction>, partialUpdate as Partial<Transaction>, Boolean(user.admin));
           if (unpostRefusal) throw new HttpError(unpostRefusal, 409);
           beforeEdit = auditSnapshot(txData as Partial<Transaction>);
         
           // ISS-130; EG-6 review: a partial update that changes the status, type or metadata (which could strip the
           // entry's type and with it the lock) is refused for these entries, not only a status change
           const lockedField = Object.keys(partialUpdate).some(k => ['status', 'type', 'reversalEventId', 'isDeleted', 'deletedAt'].includes(k) || k === 'metadata' || k.startsWith('metadata.'));
           const revaluation = lockedField ? revaluationEntryLock(txData) : null;
           if (revaluation) throw new Error(revaluation);
           if (partialUpdate.lines !== undefined || partialUpdate.amountCents !== undefined || partialUpdate.totalAmountCents !== undefined || partialUpdate.workspaceId !== undefined || partialUpdate.date !== undefined || partialUpdate.uid !== undefined) {
             throw new Error('Restricted fields cannot be modified via partialUpdate. Use a full transaction update instead.');
           }

           const allowedStatuses = ['draft', 'pending', 'certified', 'void', 'reconciled', 'completed', 'failed', 'flagged', 'reviewed', 'overdue', 'approved'];
           if (partialUpdate.status && !allowedStatuses.includes(partialUpdate.status)) {
             throw new Error(`Invalid status '${partialUpdate.status}'.`);
           }

           const safePartial = { ...partialUpdate };
           delete safePartial.workspaceId;
           delete safePartial.uid;
           delete safePartial.id;
           delete safePartial.expectedUpdatedAt;

           afterEdit = auditSnapshot({ ...txData, ...safePartial } as Partial<Transaction>);
           t.update(txRef, { ...safePartial, updatedAt: FieldValue.serverTimestamp() });
        });

        await writeServerAuditLog({
          workspaceId: authoritativeWsId || "unknown",
          uid: user.uid,
          email: user.email || "developer@ledgerflow.io",
          action: "TRANSACTION_UPDATED_PARTIAL",
          entityType: "transaction",
          entityId: id,
          details: {
            description: `Partial update on transaction ref [${id}].`,
            // #652(d): an auditor needs what changed, not only that something did
            before: beforeEdit,
            after: afterEdit,
          }
        }, { db });

        return res.json({ status: 'ok', transactionId: id });
      }

      if (!transaction || !transaction.workspaceId) return res.status(400).json({ error: 'Invalid payload: missing workspaceId' });
      if (!transaction.id) transaction.id = id;
      transaction.uid = user.uid; // Enforce ownership
      const wsDoc = await db.collection('workspaces').doc(transaction.workspaceId).get();
      const wsData = wsDoc.data();
      if (!wsDoc.exists || !isWorkspaceMemberData(wsData, user, transaction.workspaceId)) {
        return res.status(403).json({ error: 'Not a member' });
      }

      // Load existing tx to pass to validator
      const existingTxSnap = await db.collection('transactions').doc(id).get();
      const existingTx = existingTxSnap.exists ? existingTxSnap.data() as Transaction : undefined;

      // #652: a document's entry is changed through the document; the browser already refuses it.
      const documentRefusal = documentEntryRefusal(existingTx as { metadata?: Record<string, unknown> } | undefined, Boolean(user.admin));
      if (documentRefusal) return res.status(409).json({ error: documentRefusal });
      let beforeEdit: Record<string, unknown> | null = null;
      let afterEdit: Record<string, unknown> | null = null;

      const validatedTx = await TransactionValidator.validateAndPrepare(transaction, {
        workspaceId: transaction.workspaceId,
        user: { uid: user.uid, admin: user.admin },
        wsData
      }, existingTx);
      // Z-12: a required label whose rule refuses
      const missing = refusedLabels(validatedTx, wsData?.dimensions);
      if (missing.length > 0) return res.status(400).json({ error: refusedLabelsMessage(missing), missingLabels: missing });

      await db.runTransaction(async (t) => {
        const txRef = db.collection('transactions').doc(id);
        const doc = await t.get(txRef);
        if (!doc.exists) throw new Error('Not found');

        // Optimistic concurrency check
        const expectedUpdatedAt = req.body.expectedUpdatedAt || transaction?.expectedUpdatedAt || ifMatchVersion(req.header('if-match'));
        if (isUpdatedAtMismatch(expectedUpdatedAt, doc.data()?.updatedAt)) {
          throw Object.assign(new Error('version_conflict'), { currentTransaction: { ...doc.data(), id: doc.id } });
        }

        if (doc.data()?.workspaceId !== transaction.workspaceId) throw new Error('Workspace mismatch');
        // Recheck against the row read inside this same database transaction: an
        // entry can acquire a document link after the earlier validation read.
        const currentDocumentRefusal = documentEntryRefusal(doc.data() as { metadata?: Record<string, unknown> }, Boolean(user.admin));
        if (currentDocumentRefusal) throw new HttpError(currentDocumentRefusal, 409);
        const revaluation = revaluationEntryLock(doc.data()); // ISS-130
        if (revaluation) throw new Error(revaluation);
        if ((doc.data()?.status === 'certified' || doc.data()?.status === 'void' || doc.data()?.isCleared === true) && !user.admin) {
          throw new Error('Cannot modify certified, cleared, or voided transactions');
        }
        const unpostRefusal = postedStatusRefusal(doc.data() as Partial<Transaction>, validatedTx.status, Boolean(user.admin)) ||
          postedDeletionRefusal(doc.data() as Partial<Transaction>, transaction as Partial<Transaction>, Boolean(user.admin));
        if (unpostRefusal) throw new HttpError(unpostRefusal, 409);
        beforeEdit = auditSnapshot(doc.data() as Partial<Transaction>);
        // audit F3: the old and the new date against the workspace as it is now, inside the save
        assertStillOpen((await t.get(db.collection('workspaces').doc(transaction.workspaceId))).data(), user, [doc.data()?.date, validatedTx.date]);

        const txToSave = { ...validatedTx };
        delete (txToSave as { expectedUpdatedAt?: unknown }).expectedUpdatedAt;

        afterEdit = auditSnapshot(txToSave as Partial<Transaction>);
        t.update(txRef, { ...txToSave, updatedAt: FieldValue.serverTimestamp() });
      });

      await writeServerAuditLog({
        workspaceId: transaction.workspaceId,
        uid: user.uid,
        email: user.email || "developer@ledgerflow.io",
        action: "TRANSACTION_UPDATED",
        entityType: "transaction",
        entityId: id,
        details: {
          description: `Full update on transaction ref [${id}].`,
          before: beforeEdit,
          after: afterEdit,
        }
      }, { db });

      res.json({ status: 'ok', transactionId: id, data: transaction });
    } catch (e) {
      if (errorMessage(e) === 'version_conflict') {
         // Z-05: a stale If-Match is a failed precondition (412); a stale expectedUpdatedAt stays 409
         return res.status(ifMatchVersion(req.header('if-match')) ? 412 : 409).json({
           error: 'version_conflict',
           message: 'This transaction was modified by another user.',
           currentTransaction: (e as { currentTransaction?: unknown }).currentTransaction
         });
      }
      if (errorMessage(e) === 'Not found') {
         return res.status(404).json({ error: errorMessage(e) });
      }
      if (errorMessage(e) === 'Not a member' || errorMessage(e) === 'Workspace mismatch' || errorMessage(e).includes('Forbidden')) {
         return res.status(403).json({ error: errorMessage(e) });
      }
      // #652/#662: a refusal that carries its own status (a document entry is a 409, not a malformed request)
      const refusedStatus = (e as { status?: unknown }).status;
      if (typeof refusedStatus === 'number' && refusedStatus >= 400 && refusedStatus < 500) {
        return res.status(refusedStatus).json({ error: errorMessage(e) });
      }
      res.status(400).json({ error: errorMessage(e) }); 
    }
  });

  transactionRouter.delete('/:id', requireOpenPeriod('transactions'), async (req, res) => {
    try {
      const { id } = req.params as Record<string, string>;
      const workspaceId = (req.query.workspaceId as string) || (req.body?.workspaceId as string);
      const user = requestUser(req);
      const db = getDb();
      const txRef = db.collection('transactions').doc(id);
      const doc = await txRef.get();
      if (!doc.exists) {
        return res.status(404).json({ error: 'Transaction not found' });
      }
      const data = doc.data();
      const transactionWsId = data?.workspaceId;
      if (!transactionWsId) {
        return res.status(400).json({ error: 'Corrupt transaction: missing workspaceId' });
      }
      if (workspaceId && workspaceId !== transactionWsId) {
        return res.status(403).json({ error: 'Workspace mismatch: transaction belongs to a different workspace' });
      }
      const wsDoc = await db.collection('workspaces').doc(transactionWsId).get();
      const wsData = wsDoc.data();
      if (!wsDoc.exists || !isWorkspaceMemberData(wsData, user, transactionWsId)) {
        return res.status(403).json({ error: 'Not a member' });
      }

      const lock = data?.date ? postingLock(data.date, wsData, user.uid) : null;
      if (lock) return res.status(400).json({ error: lockMessage(data?.date, lock) });
      const revaluation = revaluationEntryLock(data); // ISS-130
      if (revaluation) return res.status(409).json({ error: revaluation });

      if ((data?.status === 'certified' || data?.status === 'void' || data?.isCleared === true || data?.reconciled === true || data?.isReconciled === true) && !user.admin) {
        return res.status(403).json({ error: `Forbidden: Transaction status is audited, cleared, reconciled, or locked (${data?.status}). Destructive actions are restricted to administrators.` });
      }
      const meta = (data?.metadata || {}) as Record<string, unknown>;
      if (meta.invoiceId || meta.billId || meta.paymentId || meta.creditNoteId || meta.vendorCreditId) {
        return res.status(409).json({ error: 'Cannot delete a ledger entry posted by a source document; void or reverse the document instead.' });
      }
      if (data?.status === 'completed' && !user.admin) {
        return res.status(409).json({ error: 'Posted ledger entries cannot be hard-deleted; post a reversing entry via POST /api/v1/transactions/:id/reverse.' });
      }

      // audit F3: the entry and the workspace read again inside the delete, so a period closed (or the entry
      // certified, cleared or changed) since the checks above is not deleted after all
      const refused = await db.runTransaction(async (t) => {
        const now = await t.get(txRef);
        if (!now.exists) return 'gone';
        const nowData = now.data();
        if ((nowData?.status === 'certified' || nowData?.status === 'void' || nowData?.isCleared === true || nowData?.reconciled === true || nowData?.isReconciled === true) && !user.admin) return 'locked';
        const nowMeta = (nowData?.metadata || {}) as Record<string, unknown>;
        if (nowMeta.invoiceId || nowMeta.billId || nowMeta.paymentId || nowMeta.creditNoteId || nowMeta.vendorCreditId) return 'Cannot delete a ledger entry posted by a source document; void or reverse the document instead.';
        if (nowData?.status === 'completed' && !user.admin) return 'Posted ledger entries cannot be hard-deleted; post a reversing entry via POST /api/v1/transactions/:id/reverse.';
        const wsNow = (await t.get(db.collection('workspaces').doc(transactionWsId))).data();
        try { assertStillOpen(wsNow, user, [nowData?.date]); } catch (err) { return errorMessage(err); }
        t.delete(txRef);
        return '';
      });
      if (refused === 'gone') return res.status(404).json({ error: 'Transaction not found' });
      if (refused === 'locked') return res.status(403).json({ error: 'Forbidden: Transaction status is audited, cleared, or locked. Destructive actions are restricted to administrators.' });
      if (refused) return res.status(refused === 'Not a member' ? 403 : 400).json({ error: refused });

      await writeServerAuditLog({
        workspaceId: transactionWsId,
        uid: user.uid,
        email: user.email || "developer@ledgerflow.io",
        action: "TRANSACTION_DELETED",
        entityType: "transaction",
        entityId: id,
        // what was deleted, kept in the audit trail (CA-10)
        details: {
          description: deletionSentence('transactions', id, data || {}),
          deleted: deletionSnapshot(data || {}),
        }
      }, { db });

      res.json({ status: 'ok', deletedId: id });
    } catch (e) {
      res.status(500).json({ error: errorMessage(e) });
    }
  });
}
