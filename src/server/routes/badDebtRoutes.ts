/**
 * Bad debt write-off and its reversal (K-19), mounted at
 * /api/v1/workspaces/:workspaceId/invoices (workspaceRoutes.ts, owner/accountant). Both are registered
 * commands (src/server/commands/documentAdjustments.ts) keeping the handler's answers.
 */
import express from 'express';
import { invoiceWriteOffCommand, invoiceWriteOffReverseCommand } from '../commands/documentAdjustments';
import type { AnyCommandDefinition, CommandExecutionOutcome } from '../commands/types';
import { executeCommand } from '../utils/commandExecutor';

export const badDebtRouter = express.Router({ mergeParams: true });

/** The address names the workspace and the invoice; the body carries the rest. */
function invocation(req: express.Request, definition: AnyCommandDefinition, idKey: 'invoiceId') {
  const params = req.params as Record<string, string>;
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  const workspaceId = String(params.workspaceId || '');
  return { definition, workspaceId, input: { ...body, workspaceId, [idKey]: String(params[idKey] || '') } };
}

/** `{ status: 'success', ...result }`; a malformed body keeps `details`; a 500 keeps its sentence. */
function answer(outcome: CommandExecutionOutcome): { status: number; body: unknown } {
  if (outcome.ok) return { status: 200, body: { status: 'success', ...(outcome.data as Record<string, unknown>) } };
  if (outcome.code === 'INVALID_INPUT') {
    return { status: 400, body: { status: 'error', message: 'Invalid request', details: (outcome.error as { issues?: unknown })?.issues } };
  }
  if (outcome.status < 500) return { status: outcome.status, body: { status: 'error', message: outcome.message } };
  const cause = outcome.error instanceof Error ? outcome.error.message : String(outcome.error ?? outcome.message);
  return { status: 500, body: { status: 'error', message: 'The write-off could not be saved', details: cause } };
}

badDebtRouter.post('/:invoiceId/write-off', async (req, res) => {
  await executeCommand(req, res, { ...invocation(req, invoiceWriteOffCommand, 'invoiceId'), formatResponse: answer });
});

badDebtRouter.post('/:invoiceId/write-off/reverse', async (req, res) => {
  await executeCommand(req, res, { ...invocation(req, invoiceWriteOffReverseCommand, 'invoiceId'), formatResponse: answer });
});
