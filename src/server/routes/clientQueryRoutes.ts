/**
 * Client queries (BD-07), mounted at /api/v1/workspaces/:workspaceId/queries for every member
 * (workspaceRoutes.ts). Members read the questions straight from the database (live); only these
 * routes write them, through the registered commands (src/server/commands/clientQueries.ts). Who may
 * ask, answer or close is still decided in clientQueryService — it answers 403 for a viewer asking
 * and for anyone but the asker, an owner or an accountant closing — so each answer keeps its status
 * and its words.
 */
import express from 'express';
import { queryAskCommand, queryCloseCommand, queryReplyCommand } from '../commands/clientQueries';
import type { AnyCommandDefinition, CommandExecutionOutcome } from '../commands/types';
import { executeCommand } from '../utils/commandExecutor';

export const clientQueryRouter = express.Router({ mergeParams: true });

/** The address names the workspace; `paramsOf` reads a question id from the address when there is one. */
function invocation(req: express.Request, definition: AnyCommandDefinition, extra: Record<string, string> = {}) {
  const params = req.params as Record<string, string>;
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  const workspaceId = String(params.workspaceId || '');
  return { definition, workspaceId, input: { ...body, ...extra, workspaceId } };
}

/** `{ status: 'success', data: { query } }` for the question, `{ status: 'success' }` for closing. */
function answer(withQuery: boolean, what: string) {
  return (outcome: CommandExecutionOutcome): { status: number; body: unknown } => {
    if (outcome.ok) {
      const data = outcome.data as Record<string, unknown>;
      return { status: 200, body: withQuery ? { status: 'success', data } : { status: 'success' } };
    }
    if (outcome.code === 'INVALID_INPUT') {
      return { status: 400, body: { status: 'error', message: 'That request is not in the expected form' } };
    }
    if (outcome.status < 500) return { status: outcome.status, body: { status: 'error', message: outcome.message } };
    const cause = outcome.error instanceof Error ? outcome.error.message : String(outcome.error ?? outcome.message);
    return { status: 500, body: { status: 'error', message: what, details: cause } };
  };
}

clientQueryRouter.post('/', async (req, res) => {
  await executeCommand(req, res, {
    ...invocation(req, queryAskCommand),
    formatResponse: answer(true, 'The question could not be sent'),
  });
});

clientQueryRouter.post('/:queryId/reply', async (req, res) => {
  const queryId = String((req.params as Record<string, string>).queryId || '');
  await executeCommand(req, res, {
    ...invocation(req, queryReplyCommand, { queryId }),
    formatResponse: answer(true, 'The answer could not be sent'),
  });
});

clientQueryRouter.post('/:queryId/close', async (req, res) => {
  const queryId = String((req.params as Record<string, string>).queryId || '');
  await executeCommand(req, res, {
    ...invocation(req, queryCloseCommand, { queryId }),
    formatResponse: answer(false, 'The question could not be closed'),
  });
});
