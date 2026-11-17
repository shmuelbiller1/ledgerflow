import express from 'express';
import { z } from 'zod';
import { getDb } from '../db/firestore';
import { numberingSeriesInput, numberingTypeInput, numberingUpdateCommand } from '../commands/numbering';
import type { CommandExecutionOutcome } from '../commands/types';
import { NumberingError, readNumbering, type NumberingView } from '../services/numberingService';
import type { CommandRunnerDependencies } from '../utils/commandExecutor';
import { commandFailureResponse } from '../utils/commandResponses';

/**
 * Document numbering settings (BA-07), mounted at /api/v1/workspaces/:workspaceId/numbering
 * (workspaceRoutes.ts, owner/accountant).
 */
const fail = (res: express.Response, err: unknown) => {
  if (err instanceof z.ZodError) return res.status(400).json({ status: 'error', message: err.issues[0]?.message || 'Invalid request', details: err.issues });
  if (err instanceof NumberingError) return res.status(err.status).json({ status: 'error', message: err.message });
  res.status(500).json({ status: 'error', message: 'Document numbering could not be saved', details: err instanceof Error ? err.message : String(err) });
};

function numberingCommandResponse(outcome: CommandExecutionOutcome) {
  if (outcome.ok) {
    const result = outcome.data as { series: NumberingView };
    return { status: 200, body: { status: 'success', series: result.series } };
  }
  if (outcome.error instanceof z.ZodError) {
    return { status: 400, body: { status: 'error', message: outcome.error.issues[0]?.message || 'Invalid request', details: outcome.error.issues } };
  }
  if (outcome.error instanceof NumberingError) {
    return { status: outcome.error.status, body: { status: 'error', message: outcome.error.message } };
  }
  if (outcome.code === 'ROLE_REQUIRED' || outcome.code === 'NOT_A_MEMBER') {
    return { status: 403, body: { status: 'error', message: 'Only owners and accountants change document numbers' } };
  }
  if (outcome.code === 'WORKSPACE_NOT_FOUND') {
    return { status: 404, body: { status: 'error', message: 'Workspace not found' } };
  }
  return commandFailureResponse(outcome, 'Document numbering could not be saved');
}

/** Factory allows the same registered route to be tested with an isolated command runner database. */
export function createNumberingRouter(dependencies: CommandRunnerDependencies = {}): express.Router {
  const router = express.Router({ mergeParams: true });

  router.get('/', async (req, res) => {
    try {
      res.json({ status: 'success', series: await readNumbering((dependencies.getDb || getDb)(), String((req.params as Record<string, string>).workspaceId)) });
    } catch (err) { fail(res, err); }
  });

  router.put('/:type', async (req, res) => {
    const params = req.params as Record<string, string>;
    const type = numberingTypeInput.safeParse(params.type);
    if (!type.success) return fail(res, type.error);
    const series = numberingSeriesInput.safeParse(req.body);
    if (!series.success) return fail(res, series.error);

    // Import lazily to avoid the executor's existing workspaceRoutes role-helper cycle during router setup.
    const { executeCommand, withLegacyInputIdempotencyHash } = await import('../utils/commandExecutor');
    await executeCommand(req, res, {
      definition: withLegacyInputIdempotencyHash(numberingUpdateCommand),
      workspaceId: String(params.workspaceId),
      input: { ...series.data, type: type.data },
      formatResponse: numberingCommandResponse,
    }, dependencies);
  });

  return router;
}

export const numberingRouter = createNumberingRouter();
