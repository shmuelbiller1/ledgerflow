import express from 'express';
import { getDb, isWorkspaceMemberData } from '../../db/firestore';
import type { Firestore } from '../../db/firestore';
import type { Transaction } from '../../../types';
import { parseDateInTimezone } from '../../../lib/calendarDate';
import { isPostable, getAbsoluteTotal } from '../../../lib/txFilters';
import { optimizedTransactionSimilarity } from '../../../lib/algorithms';
import {
  bankLinePayCommand,
  bankLineSplitCommand,
  bankRulesRerunCommand,
  bankRulesRerunInput,
  clearEntriesCommand,
  clearEntriesCommandInput,
  completeReconciliationCommand,
  completeReconciliationCommandInput,
  reconcileCommand,
  reconcileInput,
  updateBankLineCommand,
  updateBankLineCommandInput,
} from '../../commands/reconciliations';
import type { CommandExecutionOutcome, CommandInvocation } from '../../commands/types';
import { z } from 'zod';
import { errorMessage, requestUser } from '../../auth/requestUser';
import type { ExternalBankLine } from './helpers';

/** The `{ status: 'ok' }` answer and the `{ error }` refusal the reconciliation screen already reads. */
function legacyAnswer(outcome: CommandExecutionOutcome): { status: number; body: unknown } {
  return outcome.ok
    ? { status: 200, body: { status: 'ok', ...(outcome.data as Record<string, unknown>) } }
    : { status: outcome.status, body: { error: outcome.message } };
}

/**
 * POST /reconcile: a reconciliation batch (match, unmatch, clear and correct in one request). The
 * registered `reconciliations.reconcile` command runs the work; this keeps the legacy address, body
 * and answer, and still accepts the database the route's tests inject.
 */
export async function handleReconcile(req: express.Request, res: express.Response, dbOverride?: Firestore) {
  const parsed = reconcileInput.safeParse(req.body);
  if (!parsed.success) {
    // the legacy answer to a malformed batch was a 400 with the first problem as its error
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid request' });
  }
  const { executeCommand } = await import('../../utils/commandExecutor');
  await executeCommand(req, res, {
    definition: reconcileCommand,
    workspaceId: String((req.body as { workspaceId?: unknown } | undefined)?.workspaceId || ''),
    input: parsed.data,
    formatResponse: legacyAnswer,
  }, { getDb: () => dbOverride || getDb() });
}

/** The invocation both the URL and `handleReconcile` hand the runner. */
function reconcileInvocation(req: express.Request, input: z.output<typeof reconcileInput>): CommandInvocation {
  return {
    definition: reconcileCommand,
    workspaceId: String((req.body as { workspaceId?: unknown } | undefined)?.workspaceId || ''),
    input,
    formatResponse: legacyAnswer,
  };
}

/** Bank reconciliation: match and clear bank lines, pay or split a bank line. Part of /api/v1/transactions (F-06), registered in the original order. */
export function registerReconcileRoutes(transactionRouter: express.Router): void {
  transactionRouter.post('/reconcile', async (req, res) => {
    const parsed = reconcileInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid request' });
    const { executeCommand } = await import('../../utils/commandExecutor');
    await executeCommand(req, res, reconcileInvocation(req, parsed.data));
  });

  // Clear a pending bank line: pay invoices/bills with it, or split it over accounts (bankLineService)
  transactionRouter.post('/bank-lines/:id/pay', async (req, res) => {
    const definition = bankLinePayCommand;
    const id = String((req.params as Record<string, string>).id || '');
    const parsed = definition.input.safeParse({ ...(req.body as Record<string, unknown>), id });
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
    const { executeCommand } = await import('../../utils/commandExecutor');
    await executeCommand(req, res, {
      definition,
      workspaceId: String((req.body as { workspaceId?: unknown } | undefined)?.workspaceId || ''),
      input: parsed.data,
      formatResponse: legacyAnswer,
    });
  });
  transactionRouter.post('/bank-lines/:id/split', async (req, res) => {
    const definition = bankLineSplitCommand;
    const id = String((req.params as Record<string, string>).id || '');
    const parsed = definition.input.safeParse({ ...(req.body as Record<string, unknown>), id });
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
    const { executeCommand } = await import('../../utils/commandExecutor');
    await executeCommand(req, res, {
      definition,
      workspaceId: String((req.body as { workspaceId?: unknown } | undefined)?.workspaceId || ''),
      input: parsed.data,
      formatResponse: legacyAnswer,
    });
  });

  // EG-9: the bank rules again over the lines not yet matched (suggestions only; owners and accountants)
  transactionRouter.post('/bank-lines/apply-rules', async (req, res) => {
    const body = req.body as Record<string, unknown> | undefined;
    const parsed = bankRulesRerunInput.safeParse(body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
    const user = requestUser(req);
    const workspaceId = String(body?.workspaceId || '');
    if (user.developerWorkspaceId && user.developerWorkspaceId !== workspaceId) return res.status(403).json({ error: 'This API key is for another workspace' });
    const { executeCommand } = await import('../../utils/commandExecutor');
    const outcome = await executeCommand(req, res, {
      definition: bankRulesRerunCommand,
      workspaceId,
      input: parsed.data,
      formatResponse: outcome => (outcome.ok
        ? { status: 200, body: outcome.data }
        : outcome.status === 400 || outcome.status === 403 || outcome.status === 404
          ? { status: outcome.status, body: { error: outcome.message } }
          : { status: 500, body: { error: 'The bank rules could not be run' } }),
    }) as CommandExecutionOutcome;
    if (!outcome.ok && (outcome.status >= 500 || outcome.status === 500)) console.error('[BANK RULES]', outcome.message);
  });

  transactionRouter.patch('/bank-lines/:id', async (req, res) => {
    const body = req.body as Record<string, unknown> | undefined;
    const workspaceId = String(body?.workspaceId || '');
    if (!workspaceId) return res.status(400).json({ error: 'Missing workspaceId' });
    const id = String((req.params as Record<string, string>).id || '');
    const { workspaceId: _ignored, ...updatePayload } = body || {};
    // Strict allowlist validation (#78) runs inside the command; its refusal keeps the old 400 shape
    const parsed = updateBankLineCommandInput.safeParse({ workspaceId, id, data: updatePayload });
    if (!parsed.success) return res.status(400).json({ error: 'Schema validation failed', details: parsed.error.issues });
    const { executeCommand } = await import('../../utils/commandExecutor');
    const outcome = await executeCommand(req, res, {
      definition: updateBankLineCommand,
      workspaceId,
      input: parsed.data,
      formatResponse: outcome => (outcome.ok
        ? { status: 200, body: { status: 'ok', ...(outcome.data as Record<string, unknown>) } }
        : outcome.error instanceof z.ZodError || outcome.code === 'INVALID_INPUT'
          ? { status: 400, body: { error: 'Schema validation failed', details: (outcome.error as z.ZodError).issues } }
          : { status: outcome.status, body: { error: outcome.message } }),
    }) as CommandExecutionOutcome;
    if (!outcome.ok) return;
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
      if (!wsDoc.exists || !isWorkspaceMemberData(wsDoc.data(), user, workspaceId)) return res.status(403).json({ error: 'Not a member' });

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
      if (!wsDoc.exists || !isWorkspaceMemberData(wsDoc.data(), user, workspaceId)) return res.status(403).json({ error: 'Not a member' });
      const wsTimezone = typeof wsDoc.data()?.timezone === 'string' ? wsDoc.data()?.timezone : undefined;

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
            lineTime = parseDateInTimezone(bankLine.date, wsTimezone).getTime();
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
              const txTime = parseDateInTimezone(tx.date, wsTimezone).getTime();
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
    const body = req.body as Record<string, unknown> | undefined;
    const workspaceId = String(body?.workspaceId || '');
    const parsed = clearEntriesCommandInput.safeParse(body);
    if (!parsed.success) {
      // the legacy answer named the first problem it found
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid request', details: parsed.error.issues });
    }
    const undo = parsed.data.cleared === false;
    const { executeCommand } = await import('../../utils/commandExecutor');
    await executeCommand(req, res, {
      definition: clearEntriesCommand,
      workspaceId,
      input: parsed.data,
      formatResponse: outcome => (outcome.ok
        ? {
          status: 200,
          body: {
            status: 'ok',
            clearedCount: (outcome.data as { clearedCount: number }).clearedCount,
            message: undo ? 'Marked as not cleared.' : 'Transactions successfully cleared.',
          },
        }
        : { status: outcome.status, body: { error: outcome.message } }),
    });
  });

  transactionRouter.post('/reconciliation/complete', async (req, res) => {
    const parsed = completeReconciliationCommandInput.safeParse(req.body);
    if (!parsed.success) {
      // the legacy answer named the first problem and carried the issues
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid reconciliation payload', details: parsed.error.issues });
    }
    const { executeCommand } = await import('../../utils/commandExecutor');
    await executeCommand(req, res, {
      definition: completeReconciliationCommand,
      workspaceId: String((req.body as { workspaceId?: unknown } | undefined)?.workspaceId || ''),
      input: parsed.data,
      formatResponse: outcome => (outcome.ok
        ? { status: 200, body: { status: 'ok', ...(outcome.data as Record<string, unknown>) } }
        // a period lock is a 409 here, as the legacy route answered it
        : { status: /Period Locked/i.test(outcome.message) ? 409 : outcome.status, body: { error: outcome.message } }),
    });
  });
}

// the schemas the legacy route used to hold now live with their commands
export {
  completeReconciliationCommandInput as CompleteReconciliationSchema,
};
