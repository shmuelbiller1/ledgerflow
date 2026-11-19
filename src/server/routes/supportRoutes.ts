import express from 'express';
import { errorMessage } from '../auth/requestUser';
import { platformStatusFields, supportPlatformStatusCommand, supportThreadReplyCommand, threadReplyFields } from '../commands/supportThreads';
import type { CommandExecutionOutcome } from '../commands/types';
import { executeCommand } from '../utils/commandExecutor';

export const supportRouter = express.Router();

function legacyFailure(outcome: Extract<CommandExecutionOutcome, { ok: false }>) {
  return { status: outcome.status === 401 || outcome.status === 403 ? outcome.status : 400, body: { error: outcome.error ? errorMessage(outcome.error) : outcome.message } };
}

supportRouter.post('/tickets/:id/messages', async (req, res) => {
  const parsed = threadReplyFields.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ status: 'error', error: 'Validation failed', details: parsed.error.issues });
  await executeCommand(req, res, {
    definition: supportThreadReplyCommand, workspaceId: '', input: { ...parsed.data, ticketId: req.params.id },
    legacyRoute: true, legacyOperationId: 'ignore',
    formatResponse: outcome => outcome.ok ? { status: 200, body: { status: 'ok', data: outcome.data } } : legacyFailure(outcome),
  });
});

supportRouter.patch('/tickets/:id/status', async (req, res) => {
  const parsed = platformStatusFields.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ status: 'error', error: 'Validation failed', details: parsed.error.issues });
  await executeCommand(req, res, {
    definition: supportPlatformStatusCommand, workspaceId: '', input: { ...parsed.data, ticketId: req.params.id },
    legacyRoute: true, legacyOperationId: 'ignore',
    formatResponse: outcome => outcome.ok ? { status: 200, body: { status: 'ok' } } : legacyFailure(outcome),
  });
});
