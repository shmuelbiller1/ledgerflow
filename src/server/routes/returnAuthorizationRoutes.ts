import express from 'express';
import { rmaMoveCommand, rmaRequestCommand } from '../commands/returns';
import type { CommandExecutionOutcome } from '../commands/types';
import { executeCommand } from '../utils/commandExecutor';

/**
 * ISS-143: return authorizations through the server (returnAuthorizationService.ts), mounted at
 * /api/v1/workspaces/:workspaceId/return-authorizations for workspace editors; the service checks the role
 * again from the workspace's own membership for each action. Both writes are registered commands
 * (src/server/commands/returns.ts), each carrying its own `requestKey` so a retry answers the same
 * record. The answers are the ones the handlers gave.
 *   POST /           { customerId, invoiceId, reason, lines: [{ invoiceLineId, quantity }], requestKey }
 *   POST /:rmaId     { customerId, action, expectedStatus, note?, creditNoteId?, requestKey }
 */
export const returnAuthorizationRouter = express.Router({ mergeParams: true });

/** `{ status: 'success', ...result }`; the RMA rules speak with their own status and words. */
function answer(outcome: CommandExecutionOutcome): { status: number; body: unknown } {
  if (outcome.ok) return { status: 200, body: { status: 'success', ...(outcome.data as Record<string, unknown>) } };
  if (outcome.code === 'INVALID_INPUT') {
    return { status: 400, body: { status: 'error', message: 'This RMA request is not complete: check the lines, the action and the request key.' } };
  }
  return { status: outcome.status, body: { status: 'error', message: outcome.status >= 500 ? 'The RMA could not be saved' : outcome.message } };
}

returnAuthorizationRouter.post('/', async (req, res) => {
  const workspaceId = String((req.params as Record<string, string>).workspaceId || '');
  await executeCommand(req, res, {
    definition: rmaRequestCommand,
    workspaceId,
    input: { ...(req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {}), workspaceId },
    formatResponse: answer,
  });
});

returnAuthorizationRouter.post('/:rmaId', async (req, res) => {
  const params = req.params as Record<string, string>;
  const workspaceId = String(params.workspaceId || '');
  await executeCommand(req, res, {
    definition: rmaMoveCommand,
    workspaceId,
    input: { ...(req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {}), workspaceId, rmaId: String(params.rmaId || '') },
    formatResponse: answer,
  });
});
