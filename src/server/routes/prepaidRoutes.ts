/**
 * Spread a bill's expense (K-17) or an invoice's income (K-16) over months, and undo it, mounted at
 * /api/v1/workspaces/:workspaceId/bills and …/invoices (workspaceRoutes.ts, owner/accountant/bookkeeper).
 * All four are registered commands (src/server/commands/documentAdjustments.ts) keeping the handler's
 * answers: `{ status: 'success', data: result }`, a malformed body's own 400 with `details`, the
 * service's status and words for a refusal, and the handler's sentence with the cause for a 500.
 */
import express from 'express';
import {
  billSpreadCommand, billSpreadUndoCommand, invoiceSpreadCommand, invoiceSpreadUndoCommand,
} from '../commands/documentAdjustments';
import type { AnyCommandDefinition, CommandExecutionOutcome } from '../commands/types';
import { executeCommand } from '../utils/commandExecutor';

export const prepaidRouter = express.Router({ mergeParams: true });
export const revenueSpreadRouter = express.Router({ mergeParams: true });

/** The address names the workspace and the document; the body carries the rest. */
function invocation(req: express.Request, definition: AnyCommandDefinition, idKey: 'billId' | 'invoiceId') {
  const params = req.params as Record<string, string>;
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  const workspaceId = String(params.workspaceId || '');
  return { definition, workspaceId, input: { ...body, workspaceId, [idKey]: String(params[idKey] || '') } };
}

function answer(outcome: CommandExecutionOutcome): { status: number; body: unknown } {
  if (outcome.ok) return { status: 200, body: { status: 'success', data: outcome.data } };
  if (outcome.code === 'INVALID_INPUT') {
    return { status: 400, body: { status: 'error', message: 'Invalid request', details: (outcome.error as { issues?: unknown })?.issues } };
  }
  if (outcome.status < 500) return { status: outcome.status, body: { status: 'error', message: outcome.message } };
  const cause = outcome.error instanceof Error ? outcome.error.message : String(outcome.error ?? outcome.message);
  return { status: 500, body: { status: 'error', message: 'The spread could not be saved', details: cause } };
}

prepaidRouter.post('/:billId/spread', async (req, res) => {
  await executeCommand(req, res, { ...invocation(req, billSpreadCommand, 'billId'), formatResponse: answer });
});
prepaidRouter.post('/:billId/spread/undo', async (req, res) => {
  await executeCommand(req, res, { ...invocation(req, billSpreadUndoCommand, 'billId'), formatResponse: answer });
});

revenueSpreadRouter.post('/:invoiceId/spread', async (req, res) => {
  await executeCommand(req, res, { ...invocation(req, invoiceSpreadCommand, 'invoiceId'), formatResponse: answer });
});
revenueSpreadRouter.post('/:invoiceId/spread/undo', async (req, res) => {
  await executeCommand(req, res, { ...invocation(req, invoiceSpreadUndoCommand, 'invoiceId'), formatResponse: answer });
});
