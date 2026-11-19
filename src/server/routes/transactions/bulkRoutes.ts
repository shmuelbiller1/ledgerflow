import express from 'express';
import { ledgerBulkWithLegacyKey } from '../../commands/ledgerBulk';
import { legacyPostingAnswer } from '../../utils/legacyPostingAnswer';
import { batchAnswer, recategorizeAnswer } from '../../utils/ledgerBatchCommandRoute';
import { transactionsBatchCommand, transactionsRecategorizeCommand } from '../../commands/transactions';
import { executeCommand } from '../../utils/commandExecutor';
import { dimensionsMigrateCommand } from '../../commands/transactionHousekeeping';


/** Many entries at once: posting in bulk and batch updates. Part of /api/v1/transactions (F-06), registered in the original order. */
export function registerTransactionBulkRoutes(transactionRouter: express.Router): void {
  // A bulk creation endpoint for atomic multiple postings with chunking support
  transactionRouter.post('/bulk', async (req, res) => {
    const workspaceId = req.body?.workspaceId || req.body?.transactions?.[0]?.workspaceId;
    // A retry after midnight is the same save. Hash the untouched legacy body, including the
    // absent workspaceId when the caller left it to be inferred from the first entry.
    const { postingDay: _day, ...hashed } = (req.body || {}) as Record<string, unknown>;
    await executeCommand(req, res, {
      definition: ledgerBulkWithLegacyKey(req.get('Idempotency-Key'), { hashOf: hashed }),
      workspaceId,
      input: req.body || {},
      legacyRoute: true,
      legacyOperationId: 'ignore',
      formatResponse: legacyPostingAnswer,
    });
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
