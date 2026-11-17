import express from 'express';
import { FieldValue, getDb, validateWorkspaceMember } from '../../db/firestore';
import type { DimensionDefinition, DimensionNode, Transaction } from '../../../types';
import { LedgerPostingError } from '../../services/cogsStockService';
import { ledgerWrite } from '../../services/ledgerDoor';
import { migrateWorkspaceDimensionNodes } from '../../../lib/dimensionUtils';
import { assertPostingOpen } from '../../../lib/periodLock';
import { errorMessage, requestUser } from '../../auth/requestUser';
import { LEDGER_WRITER_ROLES, roleInWorkspace } from '../../middleware/requireLedgerWriter';
import { BulkRefusal, commitLedgerBulk } from '../../services/ledgerBulkCommit';
import { batchAnswer, recategorizeAnswer } from '../../utils/ledgerBatchCommandRoute';
import { transactionsBatchCommand, transactionsRecategorizeCommand } from '../../commands/transactions';
import { executeCommand } from '../../utils/commandExecutor';


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

  // Rule actions (D-3 / K-39): move the non-bank side of bank entries to another account, all or none.
  // Registered command (src/server/commands/transactions.ts); the service owns its transaction.
  transactionRouter.post('/recategorize', async (req, res) => {
    await executeCommand(req, res, {
      definition: transactionsRecategorizeCommand,
      workspaceId: String((req.body as { workspaceId?: unknown } | undefined)?.workspaceId || ''),
      input: req.body,
      formatResponse: recategorizeAnswer,
    });
  });

  // Mass update (F-06). Registered command `journal.batchupdate`: `ledgerBatchUpdate.ts` reads and
  // checks every entry inside one transaction and writes them all or none, as the handler always did.
  transactionRouter.post('/batch', async (req, res) => {
    await executeCommand(req, res, {
      definition: transactionsBatchCommand,
      workspaceId: String((req.body as { workspaceId?: unknown } | undefined)?.workspaceId || ''),
      input: req.body,
      formatResponse: batchAnswer,
    });
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
