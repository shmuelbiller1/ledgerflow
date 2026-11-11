import express from 'express';
import { FieldValue } from '../../db/firestore';
import { DoubleEntryValidator } from '../../../kernel/validation/DoubleEntryValidator';
import type { DimensionDefinition, DimensionNode, Transaction } from '../../../types';
import { getDb, validateWorkspaceMember } from '../../db/firestore';
import { LedgerPostingError } from '../../services/cogsStockService';
import { ledgerWrite } from '../../services/ledgerDoor';
import { migrateWorkspaceDimensionNodes } from '../../../lib/dimensionUtils';
import { z } from 'zod';
import { assertPostingOpen } from '../../../lib/periodLock';
import { errorMessage, requestUser } from '../../auth/requestUser';
import { isUpdatedAtMismatch } from './helpers';
import { LEDGER_WRITER_ROLES, roleInWorkspace } from '../../middleware/requireLedgerWriter';
import { MAX_RECATEGORIZE, RecategorizeError, recategorize } from '../../services/recategorizeService';
import { workspaceRole } from '../../../lib/periodLock';
import { BulkRefusal, commitLedgerBulk } from '../../services/ledgerBulkCommit';


const SERVER_POSTED: Record<string, string> = { invoices: 'Invoices', bills: 'Bills', creditNotes: 'Credit notes', vendorCredits: 'Vendor credits' };
const DOCUMENT_KEYS: Record<string, string> = { invoiceId: 'Invoices', billId: 'Bills', creditNoteId: 'Credit notes', vendorCreditId: 'Vendor credits' };

/** The kind of document a bulk request saves or posts entries for, when the server must build them instead. */
export function documentPostedByServer(body: { entityMutation?: { collection?: unknown }; transactions?: unknown } | undefined): string | null {
  const collection = String(body?.entityMutation?.collection ?? '');
  if (SERVER_POSTED[collection]) return SERVER_POSTED[collection];
  for (const tx of Array.isArray(body?.transactions) ? body!.transactions as Array<{ metadata?: Record<string, unknown> }> : []) {
    const key = Object.keys(DOCUMENT_KEYS).find(k => tx?.metadata?.[k] != null && tx.metadata[k] !== '');
    if (key) return DOCUMENT_KEYS[key];
  }
  return null;
}

/** Many entries at once: posting in bulk and batch updates. Part of /api/v1/transactions (F-06), registered in the original order. */
export function registerTransactionBulkRoutes(transactionRouter: express.Router): void {
  // A bulk creation endpoint for atomic multiple postings with chunking support
  transactionRouter.post('/bulk', async (req, res) => {
    try {
      const user = requestUser(req);
      const db = getDb();
      // L94-STEP2B: invoices, bills, credit notes and vendor credits, and their entries, are posted by the server
      // (POST /api/v1/documents/:type/:id/post); this route takes journals, bank lines and the documents that post nothing
      const docKey = documentPostedByServer(req.body);
      if (docKey) return res.status(400).json({ error: `${docKey} are saved and posted by the server: POST /api/v1/documents/:type/:id/post with the document` });
      // the day the browser used is not part of what a retry must repeat: a retry after midnight is the same save
      const { postingDay: _day, ...hashed } = (req.body || {}) as Record<string, unknown>;
      const { body, transactions, committed } = await commitLedgerBulk(db, user, req.body, { idempotencyKey: req.headers['idempotency-key'] as string | undefined, hashOf: hashed });
      // AUD-15: the entries as written, for the browser's list (not kept with the idempotency record: a replay wrote nothing)
      res.json({ ...body, transactions: committed && !body.replayed ? transactions : [] });
    } catch (e) {
      if (e instanceof BulkRefusal) return res.status(e.status).json(e.body);
      console.error('[BULK TRANSACTIONS ERROR]', e);
      res.status(e instanceof LedgerPostingError ? e.status : 400).json({ error: errorMessage(e) });
    }
  });

  // Rule actions (D-3 / K-39): move the non-bank side of bank entries to another account, all or none
  const recategorizeSchema = z.object({
    workspaceId: z.string().min(1),
    changes: z.array(z.object({ id: z.string().min(1), bankAccountId: z.string().min(1), toAccountId: z.string().min(1), expectedUpdatedAt: z.string().optional() }).strict()).min(1).max(MAX_RECATEGORIZE),
  }).strict();
  transactionRouter.post('/recategorize', async (req, res) => {
    try {
      const { workspaceId, changes } = recategorizeSchema.parse(req.body);
      const user = requestUser(req);
      res.json({ status: 'success', ...(await recategorize(getDb(), { workspaceId, uid: user.uid, email: user.email, changes })) });
    } catch (e) {
      if (e instanceof z.ZodError) return res.status(400).json({ error: 'Invalid request', details: e.issues });
      if (e instanceof RecategorizeError) return res.status(e.status).json({ error: e.message, ...(e.entryId ? { entryId: e.entryId } : {}) });
      res.status(500).json({ error: errorMessage(e) });
    }
  });

  // A batch endpoint for mass updates
  transactionRouter.post('/batch', async (req, res) => {
     try {
       const { updates, workspaceId } = req.body;
       const user = requestUser(req);
       const db = getDb();
       if (!workspaceId || !Array.isArray(updates) || updates.length === 0) {
         return res.status(400).json({ error: "Missing workspaceId or updates" });
       }

       const wsDoc = await db.collection('workspaces').doc(workspaceId).get();
       if (!wsDoc.exists || (wsDoc.data()?.uid !== user.uid && !wsDoc.data()?.members?.includes(user.uid) && !user.admin)) return res.status(403).json({ error: 'Not a member' });

       const wsData = wsDoc.data();
       // writers only: a viewer is a member too
       if (!user.admin && !['owner', 'accountant', 'bookkeeper'].includes(workspaceRole(wsData as never, user.uid))) return res.status(403).json({ error: 'Only owners, accountants and bookkeepers change entries' });
       const allowedStatuses = ['draft', 'pending', 'certified', 'void', 'reconciled', 'completed', 'failed', 'flagged', 'reviewed', 'overdue', 'approved'];
       // #112: only these fields can change in a batch; totals, dates, currency and identity go
       // through the full entry editor (PUT) or /recategorize, which check everything
       const BATCH_FIELDS = new Set(['lines', 'description', 'status', 'tags', 'metadata', 'classId', 'locationId', 'projectId', 'dimensions', 'category', 'dimensions.category', 'dimensions.project', 'isLocked', 'isFlagged', 'isReviewed', 'isCleared', 'reconciled', 'reconciledAt', 'isTransfer', 'transferDetails', 'verification', 'notes', 'memo', 'updatedAt']);
       if (updates.length > 2000) return res.status(400).json({ error: 'At most 2000 entries per batch' });
       const ids = updates.map((u: { id: unknown }) => String(u?.id ?? ''));
       if (ids.some(id => !id) || new Set(ids).size !== ids.length) return res.status(400).json({ error: 'Each entry once, with its id' });
       for (const u of updates as Array<{ id: string; data?: Record<string, unknown> }>) {
         const bad = Object.keys(u.data || {}).filter(k => k !== 'expectedUpdatedAt' && !BATCH_FIELDS.has(k));
         if (bad.length) return res.status(400).json({ error: `These fields cannot be changed in a batch: ${bad.join(', ')} (entry ${u.id})` });
       }

       // #113: everything is read and checked first, then written in ONE transaction — a refused
       // entry or a version conflict leaves every entry unchanged
       const conflict = await db.runTransaction(async (t) => {
         // AUD-08: the workspace (closing date, role) as it is at commit, not as it was read before
         const wsNow = (await t.get(db.collection('workspaces').doc(workspaceId))).data();
         if (!user.admin && (!wsNow || !(wsNow.uid === user.uid || (Array.isArray(wsNow.members) && wsNow.members.includes(user.uid))) || !LEDGER_WRITER_ROLES.includes(roleInWorkspace(wsNow, user.uid)))) throw new Error('Only owners, accountants and bookkeepers change entries');
         const txRefs = ids.map(id => db.collection('transactions').doc(id));
         const txDocs = await Promise.all(txRefs.map(r => t.get(r)));
         const accountIds = new Set<string>();
         for (const u of updates as Array<{ data?: { lines?: Array<{ accountId?: string }> } }>) for (const l of u.data?.lines || []) if (l?.accountId) accountIds.add(String(l.accountId));
         const accountDocs = await Promise.all([...accountIds].map(id => t.get(db.collection('chartAccounts').doc(id))));
         const ownAccounts = new Set(accountDocs.filter(d => d.exists && d.data()?.workspaceId === workspaceId).map(d => d.id));
         const writes: Array<{ ref: (typeof txRefs)[number]; data: Record<string, unknown> }> = [];
         for (let i = 0; i < txDocs.length; i++) {
           const txDoc = txDocs[i];
           const id = ids[i];
           if (!txDoc.exists) throw new Error(`Transaction ${id} not found`);
           const txData = txDoc.data();
           if (txData?.workspaceId !== workspaceId) throw new Error(`Transaction ${id} does not belong to this workspace`);
           if (txData?.date) assertPostingOpen(txData.date, wsNow as never, user.uid);
           const newDate = (updates[i].data as { date?: unknown } | undefined)?.date;
           if (typeof newDate === 'string' && newDate) assertPostingOpen(newDate, wsNow as never, user.uid);
           if ((txData?.status === 'certified' || txData?.status === 'void') && !user.admin) throw new Error(`Forbidden: Transaction ${id} status is locked.`);
           const updateData = { ...updates[i].data } as Record<string, unknown>;
           const expectedUpdatedAt = updates[i].expectedUpdatedAt || updateData.expectedUpdatedAt;
           delete updateData.expectedUpdatedAt;
           if (isUpdatedAtMismatch(expectedUpdatedAt as never, txData?.updatedAt)) {
             return { id, current: { ...txData, id: txDoc.id } };
           }
           if (updateData.lines !== undefined) {
             const lines = updateData.lines as Array<{ accountId?: string; amountCents?: number }>;
             if (!Array.isArray(lines) || lines.length < 2) throw new Error(`Entry ${id} needs at least two lines`);
             DoubleEntryValidator.validateJournalEntry({ ...txData, ...updateData } as Transaction);
             const unknown = lines.filter(l => !l.accountId || !ownAccounts.has(String(l.accountId)));
             if (unknown.length) throw new Error(`Entry ${id} uses an account that is not in this workspace`);
             const total = lines.reduce((sum, l) => sum + Math.max(0, Math.round(Number(l.amountCents) || 0)), 0);
             const before = Math.abs(Math.round(Number(txData?.totalAmountCents) || 0));
             if (before && total !== before) throw new Error(`Entry ${id}: a batch may move amounts between accounts but not change the total (${before} → ${total} cents); edit the entry instead`);
           }
           if (updateData.status && !allowedStatuses.includes(String(updateData.status))) {
             throw new Error(`Invalid status '${updateData.status}' provided for transaction ${id}.`);
           }
           writes.push({ ref: txDoc.ref, data: { ...updateData, updatedAt: FieldValue.serverTimestamp() } });
         }
         for (const w of writes) t.update(w.ref, w.data);
         return null;
       });
       if (conflict) {
         return res.status(409).json({
           error: 'version_conflict',
           message: `Transaction ${conflict.id} was modified by another user. Nothing in this batch was saved.`,
           conflictTransactionId: conflict.id,
           currentTransaction: conflict.current
         });
       }

       res.json({ status: 'ok' });
     } catch (e) {
      if (errorMessage(e) === 'Not a member') {
         return res.status(403).json({ error: errorMessage(e) });
      }
      res.status(400).json({ error: errorMessage(e) }); 
    }
  });

  // Atomic server-side dimension node migration over the complete workspace ledger (no 2,000-entry batch cap)
  transactionRouter.post('/migrate-dimensions', async (req, res) => {
    try {
      const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId.trim() : '';
      if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
      const user = requestUser(req);
      const db = getDb();
      const { data: wsData } = await validateWorkspaceMember(db, workspaceId, user);
      if (!user.admin && !LEDGER_WRITER_ROLES.includes(roleInWorkspace(wsData, user.uid))) {
        return res.status(403).json({ error: 'Only owners, accountants and bookkeepers can migrate dimensions' });
      }

      const result = await db.runTransaction(async t => {
        const wsSnap = await t.get(db.collection('workspaces').doc(workspaceId));
        const wsNow = wsSnap.data();
        if (!user.admin && (!wsNow || !LEDGER_WRITER_ROLES.includes(roleInWorkspace(wsNow, user.uid)))) {
          throw new Error('Only owners, accountants and bookkeepers can migrate dimensions');
        }
        const txSnap = await t.get(db.collection('transactions').where('workspaceId', '==', workspaceId));
        const nodeSnap = await t.get(db.collection('dimensionNodes').where('workspaceId', '==', workspaceId));

        const serverTxs = txSnap.docs.map(d => ({ ...(d.data() as Transaction), id: d.id }));
        const origById = new Map(txSnap.docs.map(d => [d.id, d.data() as Record<string, unknown>]));
        const serverNodes = nodeSnap.docs.map(d => d.data() as DimensionNode);
        const dims = (Array.isArray(req.body?.dimensions) ? req.body.dimensions : wsNow?.dimensions || []) as DimensionDefinition[];

        const { updatedTransactions, updatedNodes, migrationCount } = migrateWorkspaceDimensionNodes(
          serverTxs,
          serverNodes,
          dims,
        );

        for (const node of updatedNodes) {
          const docId = `${workspaceId}_${node.dimensionId}_${node.id}`;
          t.set(db.collection('dimensionNodes').doc(docId), { ...node, workspaceId });
        }

        let updatedTransactionCount = 0;
        for (const tx of updatedTransactions) {
          if (!tx.id) continue;
          const orig = origById.get(tx.id);
          if (!orig || JSON.stringify(tx.lines) === JSON.stringify(orig.lines)) continue;
          if (typeof orig.date === 'string' && orig.date) {
            assertPostingOpen(orig.date, wsNow as never, user.uid);
          }
          await ledgerWrite(t, db.collection('transactions').doc(tx.id), {
            ...orig,
            lines: tx.lines,
            updatedAt: FieldValue.serverTimestamp(),
          });
          updatedTransactionCount += 1;
        }

        return { migrationCount, updatedTransactionCount, updatedNodeCount: updatedNodes.length };
      });

      res.json({ status: 'ok', ...result });
    } catch (e) {
      const msg = errorMessage(e);
      if (/not a member|Forbidden|Unauthorized/i.test(msg)) {
        return res.status(403).json({ error: msg });
      }
      res.status(400).json({ error: msg });
    }
  });
}
