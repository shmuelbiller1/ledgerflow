import express from 'express';
import { getDb } from '../../db/firestore';
import { LedgerPostingError } from '../../services/cogsStockService';
import { errorMessage, requestUser } from '../../auth/requestUser';
import { BulkRefusal, commitLedgerBulk } from '../../services/ledgerBulkCommit';
import { batchAnswer, recategorizeAnswer } from '../../utils/ledgerBatchCommandRoute';
import { transactionsBatchCommand, transactionsRecategorizeCommand } from '../../commands/transactions';
import { executeCommand } from '../../utils/commandExecutor';
import { dimensionsMigrateCommand } from '../../commands/transactionHousekeeping';


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
  // Registered command (src/server/commands/transactionHousekeeping.ts): the reads are a prepare, the
  // writes run on the runner's transaction, and the answer and refusals are the ones the route gave.
  transactionRouter.post('/migrate-dimensions', async (req, res) => {
    const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId.trim() : '';
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
    await executeCommand(req, res, {
      definition: dimensionsMigrateCommand,
      workspaceId,
      input: { workspaceId, ...(Array.isArray(req.body?.dimensions) ? { dimensions: req.body.dimensions } : {}) },
      formatResponse(outcome) {
        if (outcome.ok) return { status: 200, body: { status: 'ok', ...(outcome.data as Record<string, unknown>) } };
        // the address's own words for the refusals it always gave; the runner's role sentence is not
        // the one this endpoint's callers were answered with
        if (outcome.code === 'ROLE_REQUIRED' || outcome.code === 'NOT_A_MEMBER') {
          return { status: 403, body: { error: 'Only owners, accountants and bookkeepers can migrate dimensions' } };
        }
        return { status: outcome.status, body: { error: outcome.message } };
      },
    });
  });
}
