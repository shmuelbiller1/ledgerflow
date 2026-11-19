import express from 'express';
import { LabelFilterError, matchesLabelFilters, parseLabelFilters, type LabelDef } from '../../../lib/labelQueryFilter';
import { BudgetBlocked, budgetWarningsFor, enforceBudgetControl, type BudgetWarning } from '../../services/budgetGuard';
import { ledgerCreate } from '../../services/ledgerDoor';
import { FieldValue } from '../../db/firestore';
import { TransactionValidator } from '../../../kernel/validation/TransactionValidator';
import { TransactionSchema } from '../../../schemas';
import type { Transaction, TransactionLine } from '../../../types';
import { getDb, isWorkspaceMemberData } from '../../db/firestore';
import type { DocumentData } from '../../db/firestore';
import { getAbsoluteTotal } from '../../../lib/txFilters';
import { executeCommand, withLegacyInputIdempotencyHash } from '../../utils/commandExecutor';
import { journalDeleteCommand, journalEditCommand } from '../../commands/journalEdit';
import type { CommandExecutionOutcome } from '../../commands/types';
import { deriveScopedOperationKey, extractCanonicalOperationId } from '../../utils/idempotency';
import { requirePlanCapacity } from '../../middleware/planCapacity';
import { requireOpenPeriod } from '../../middleware/periodLock';
import { writeServerAuditLog } from '../../services/auditLogService';
import { lockMessage, postingLock } from '../../../lib/periodLock';
import { errorMessage, HttpError, requestUser } from '../../auth/requestUser';
import { enforceDoubleEntrySafety, ifMatchVersion } from './helpers';
import { FieldsError, parseFields, pickFields } from '../../http/sparseFields';
import { refusedLabels, refusedLabelsMessage } from '../../../lib/requiredLabels';
import { documentPostedByServer } from './bulkRoutes';

function journalEditError(outcome: Exclude<CommandExecutionOutcome, { ok: true }>): { status: number; body: unknown } {
  const error = outcome.error as { currentTransaction?: unknown; missingLabels?: unknown } | undefined;
  const message = error ? errorMessage(error) : outcome.message;
  if (message === 'version_conflict') return { status: outcome.status, body: { error: message, message: 'This transaction was modified by another user.', currentTransaction: error?.currentTransaction } };
  const status = outcome.status === 500 ? (message.includes('Forbidden') || message === 'Not a member' || message === 'Workspace mismatch' ? 403 : 400) : outcome.status;
  return { status, body: { error: message, ...(error?.missingLabels ? { missingLabels: error.missingLabels } : {}) } };
}

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

      // #827: a query parameter without a name is a malformed request, not an ignorable one
      if (Object.prototype.hasOwnProperty.call(req.query, '')) return res.status(400).json({ error: 'A query parameter has no name' });
      const { startDate, endDate, accountId, limit, cursor } = req.query;
      // Z-04: ?fields=date,description,… returns only those fields (and the id)
      let fields: string[] | null;
      try { fields = parseFields(req.query.fields); } catch (err) {
        if (err instanceof FieldsError) return res.status(400).json({ error: err.message });
        throw err;
      }

      // EU-E9: ?label.<name>=<value>, the workspace's own labels only
      let labelFilters: Record<string, string>;
      try { labelFilters = parseLabelFilters(req.query as Record<string, unknown>, ((wsDoc.data()?.dimensions || []) as LabelDef[]).filter(d => d && d.id !== 'category')); } catch (err) {
        if (err instanceof LabelFilterError) return res.status(400).json({ error: err.message });
        throw err;
      }
      const filtering = Boolean(accountId) || Object.keys(labelFilters).length > 0;

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
      const fetchLimit = filtering ? 1000 : Math.min(maxLimit, 1000);
      queryFn = queryFn.limit(fetchLimit);

      const transactionsSnap = await queryFn.get();
      let transactions = transactionsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

      if (accountId) {
        transactions = transactions.filter((t: DocumentData) => t.lines?.some((l: TransactionLine) => l.accountId === accountId));
      }
      if (Object.keys(labelFilters).length) {
        transactions = transactions.filter((t: DocumentData) => matchesLabelFilters(t, labelFilters));
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
      const docKey = documentPostedByServer({ transactions: [parsed.data] });
      if (docKey) throw new HttpError(`${docKey} are saved and posted by the server: POST /api/v1/documents/:type/:id/post with the document`, 400);
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
        throw new HttpError('Duplicate request processing: Transaction ID already exists', 409);
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
        const docKey = documentPostedByServer({ transactions: [parsed.data] });
        if (docKey) throw new HttpError(`Entry ${index}: ${docKey} are saved and posted by the server`, 400);
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
      const id = String(req.params.id);
      const { partialUpdate } = req.body;
      let { transaction } = req.body;
      if (!transaction && !partialUpdate && (req.body.workspaceId || req.body.lines || req.body.date)) transaction = { ...req.body, id };
      if (!partialUpdate && (!transaction || !transaction.workspaceId)) return res.status(400).json({ error: 'Invalid payload: missing workspaceId' });
      const snap = await getDb().collection('transactions').doc(id).get();
      const workspaceId = String(partialUpdate ? snap.data()?.workspaceId || '' : transaction.workspaceId);
      if (!workspaceId) return res.status(snap.exists ? 400 : 404).json({ error: snap.exists ? 'Corrupt transaction: missing workspaceId' : 'Not found' });
      const match = ifMatchVersion(req.header('if-match'));
      const expectedUpdatedAt = req.body.expectedUpdatedAt || partialUpdate?.expectedUpdatedAt || transaction?.expectedUpdatedAt || match;
      await executeCommand(req, res, {
        definition: withLegacyInputIdempotencyHash(journalEditCommand), workspaceId,
        input: { id, ...(partialUpdate ? { partialUpdate } : { transaction }), ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}), ...(match ? { ifMatch: true } : {}) },
        formatResponse(outcome) {
          if (!outcome.ok) return journalEditError(outcome);
          const result = outcome.data as { transactionId: string; transaction?: unknown; partial: boolean };
          return { status: 200, body: { status: 'ok', transactionId: result.transactionId, ...(!result.partial ? { data: result.transaction } : {}) } };
        },
      });
    } catch (error) { return res.status(400).json({ error: errorMessage(error) }); }
  });

  transactionRouter.delete('/:id', requireOpenPeriod('transactions'), async (req, res) => {
    try {
      const id = String(req.params.id);
      const requested = (req.query.workspaceId as string) || (req.body?.workspaceId as string);
      const snap = await getDb().collection('transactions').doc(id).get();
      const actual = snap.data()?.workspaceId as string | undefined;
      if (!snap.exists && !requested) return res.status(404).json({ error: 'Transaction not found' });
      if (snap.exists && !actual) return res.status(400).json({ error: 'Corrupt transaction: missing workspaceId' });
      if (actual && requested && requested !== actual) return res.status(403).json({ error: 'Workspace mismatch: transaction belongs to a different workspace' });
      const workspaceId = actual || requested!;
      await executeCommand(req, res, {
        definition: withLegacyInputIdempotencyHash(journalDeleteCommand), workspaceId, input: { id },
        formatResponse(outcome) {
          if (!outcome.ok) return journalEditError(outcome);
          return { status: 200, body: { status: 'ok', deletedId: (outcome.data as { deletedId: string }).deletedId } };
        },
      });
    } catch (error) { return res.status(500).json({ error: errorMessage(error) }); }
  });
}
