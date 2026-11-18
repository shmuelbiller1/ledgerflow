import express from 'express';
import { executeCommand, withLegacyInputIdempotencyHash } from '../../utils/commandExecutor';
import { journalReverseCommand } from '../../commands/journalReverse';
import { journalIntercompanyCommand } from '../../commands/journalIntercompany';
import { getDb } from '../../db/firestore';
import { errorMessage } from '../../auth/requestUser';

/** Reversing an entry and intercompany transfers. Part of /api/v1/transactions (F-06), registered in the original order. */
export function registerReverseRoutes(transactionRouter: express.Router): void {
  /**
   * POST /api/v1/transactions/:id/reverse
   * "Reverse & Correct" — the closed-period correction workflow
   * Atomic reversal and optional replacement of a transaction with audit trail chaining.
   */
  transactionRouter.post('/:id/reverse', async (req, res) => {
    const id = String(req.params.id);
    try {
      // The legacy address permits the workspace to be omitted. Resolve it from the entry, then
      // check it again inside the command transaction; never trust the URL or a stale read alone.
      const original = await getDb().collection('transactions').doc(id).get();
      if (!original.exists) return res.status(404).json({ error: 'Transaction not found' });
      const workspaceId = String(original.data()?.workspaceId || req.body?.workspaceId || '');
      if (!workspaceId) return res.status(400).json({ error: 'Corrupt transaction: missing workspaceId' });
      const { reversalDate, reason, replacement, workspaceId: requestedWorkspaceId } = req.body || {};
      await executeCommand(req, res, {
        definition: withLegacyInputIdempotencyHash(journalReverseCommand), workspaceId,
        input: { id, ...(requestedWorkspaceId ? { requestedWorkspaceId } : {}), ...(reversalDate ? { reversalDate } : {}), ...(reason ? { reason } : {}), ...(replacement ? { replacement } : {}) },
        formatResponse(outcome) {
          if (outcome.ok) return { status: 200, body: { status: 'ok', ...(outcome.data as Record<string, unknown>) } };
          const message = outcome.error ? errorMessage(outcome.error) : outcome.message;
          const status = outcome.status === 500 ? 400 : outcome.status;
          return { status, body: { error: message } };
        },
      });
    } catch (error) { return res.status(400).json({ error: errorMessage(error) }); }
  });

  /**
   * ATOMIC INTERCOMPANY TRANSFER ENGINE
   * Posts reciprocal balancing entries in two workspaces simultaneously.
   * Uses a Due To / Due From logic to maintain group-wide reconciliation.
   */
  transactionRouter.post('/intercompany/post', async (req, res) => {
    const { sourceWorkspaceId, targetWorkspaceId, amountCents } = req.body || {};
    if (!sourceWorkspaceId || !targetWorkspaceId || !amountCents) return res.status(400).json({ error: 'Missing required intercompany parameters (source, target, amount)' });
    if (sourceWorkspaceId === targetWorkspaceId) return res.status(400).json({ error: 'Intercompany transfer requires two distinct workspaces; use an internal bank transfer within the same workspace.' });
    const { description, date, sourceAccountId, targetAccountId, targetAmountCents } = req.body;
    await executeCommand(req, res, {
      definition: withLegacyInputIdempotencyHash(journalIntercompanyCommand), workspaceId: sourceWorkspaceId,
      input: { sourceWorkspaceId, targetWorkspaceId, amountCents, ...(description ? { description } : {}), ...(date ? { date } : {}), ...(sourceAccountId ? { sourceAccountId } : {}), ...(targetAccountId ? { targetAccountId } : {}), ...(targetAmountCents !== undefined ? { targetAmountCents } : {}) },
      formatResponse(outcome) {
        if (!outcome.ok) return { status: outcome.status, body: { error: outcome.error ? errorMessage(outcome.error) : outcome.message } };
        const result = outcome.data as { sourceTxId: string; targetTxId: string; sharedIdentityHash: string };
        return { status: 200, body: { status: 'ok', message: 'Intercompany reciprocal entries posted successfully', sourceTxId: result.sourceTxId, targetTxId: result.targetTxId, sharedIdentityHash: result.sharedIdentityHash } };
      },
    });
  });
}
