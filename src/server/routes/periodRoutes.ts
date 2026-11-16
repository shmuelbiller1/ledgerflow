import express from 'express';
import { z } from 'zod';
import { getDb } from '../db/firestore';
import {
  periodCloseBodySchema,
  periodCloseCommand,
  periodCloseStepsBodySchema,
  periodCloseStepsCommand,
  periodDepreciationCommand,
  periodRelockCommand,
  periodReopenBodySchema,
  periodReopenCommand,
  periodSignOffBodySchema,
  periodSignOffCommand,
  periodUnlockBodySchema,
  periodUnlockCommand,
} from '../commands/periods';
import type { CommandDefinition, CommandExecutionOutcome } from '../commands/types';
import { executeCommand, withLegacyInputIdempotencyHash } from '../utils/commandExecutor';
import {
  closingBalanceCheck,
  PeriodCloseError,
  validateClosePeriodInput,
  validateCloseSteps,
  validatePartialUnlockInput,
  validatePeriodMonth,
  validateReopenPeriodInput,
  validateSignOffInput,
} from '../services/periodCloseService';
import { DepreciationError } from '../services/depreciationService';

/**
 * Closing the books, mounted at /api/v1/workspaces/:workspaceId/periods (workspaceRoutes.ts,
 * behind membership + writer role). Roles per action are checked by the named command and
 * periodCloseService.ts.
 */
export const periodRouter = express.Router({ mergeParams: true });

type AuthedRequest = express.Request & { user: { uid: string; email?: string } };
type BodySchema = z.ZodType;

function handle(work: (req: AuthedRequest, params: Record<string, string>) => Promise<unknown>) {
  return async (req: express.Request, res: express.Response) => {
    try {
      const result = await work(req as AuthedRequest, req.params as Record<string, string>);
      res.json({ status: 'success', ...(result as object) });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ status: 'error', message: 'Invalid request', details: err.issues });
      if (err instanceof PeriodCloseError) return res.status(err.status).json({ status: 'error', message: err.message, ...(err.details ? { details: err.details } : {}) });
      if (err instanceof DepreciationError) return res.status(err.status).json({ status: 'error', message: err.message });
      res.status(500).json({ status: 'error', message: 'The period could not be changed', details: err instanceof Error ? err.message : String(err) });
    }
  };
}

function actor(req: AuthedRequest, params: Record<string, string>) {
  return { workspaceId: params.workspaceId, uid: req.user.uid, email: req.user.email };
}

function parseLegacyBody<Schema extends BodySchema>(req: express.Request, res: express.Response, schema: Schema): z.output<Schema> | undefined {
  const parsed = schema.safeParse(req.body);
  if (parsed.success) return parsed.data;
  res.status(400).json({ status: 'error', message: 'Invalid request', details: parsed.error.issues });
  return undefined;
}

function validateLegacyServiceInput(res: express.Response, validate: () => void): boolean {
  try {
    validate();
    return true;
  } catch (err) {
    if (!(err instanceof PeriodCloseError)) throw err;
    res.status(err.status).json({ status: 'error', message: err.message, ...(err.details ? { details: err.details } : {}) });
    return false;
  }
}

async function runLegacyCommand<Schema extends z.ZodType, Result, Prepared>(
  req: express.Request,
  res: express.Response,
  definition: CommandDefinition<Schema, Result, Prepared>,
  input: unknown,
  roleFailure?: string,
) {
  await executeCommand(req, res, {
    definition: withLegacyInputIdempotencyHash(definition),
    workspaceId: String((req.params as Record<string, string>).workspaceId),
    input,
    formatResponse(outcome: CommandExecutionOutcome) {
      if (outcome.ok) {
        const data = outcome.data !== null && typeof outcome.data === 'object' && !Array.isArray(outcome.data)
          ? outcome.data as Record<string, unknown>
          : {};
        return { status: outcome.status, body: { status: 'success', ...data } };
      }
      if (outcome.error instanceof z.ZodError) {
        return { status: 400, body: { status: 'error', message: 'Invalid request', details: outcome.error.issues } };
      }
      if (outcome.error instanceof PeriodCloseError) {
        return {
          status: outcome.error.status,
          body: { status: 'error', message: outcome.error.message, ...(outcome.error.details ? { details: outcome.error.details } : {}) },
        };
      }
      if (outcome.error instanceof DepreciationError) {
        return { status: outcome.error.status, body: { status: 'error', message: outcome.error.message } };
      }
      if (outcome.code === 'ROLE_REQUIRED' && roleFailure) {
        return { status: outcome.status, body: { status: 'error', message: roleFailure } };
      }
      if (outcome.status >= 500) {
        const error = outcome.error;
        return {
          status: outcome.status,
          body: { status: 'error', message: 'The period could not be changed', details: error instanceof Error ? error.message : String(error || outcome.message) },
        };
      }
      return {
        status: outcome.status,
        body: { status: 'error', message: outcome.message, ...(outcome.details ? { details: outcome.details } : {}) },
      };
    },
  });
}

periodRouter.post('/unlock', async (req, res) => {
  const body = parseLegacyBody(req, res, periodUnlockBodySchema);
  if (!body || !validateLegacyServiceInput(res, () => { validatePartialUnlockInput(body); })) return;
  await runLegacyCommand(req, res, periodUnlockCommand, body, 'Only owner or accountant can unlock a closed period');
});

// BD-10: the client's own month-end steps (owners and accountants)
periodRouter.put('/close-steps', async (req, res) => {
  const body = parseLegacyBody(req, res, periodCloseStepsBodySchema);
  if (!body || !validateLegacyServiceInput(res, () => { validateCloseSteps(body.steps); })) return;
  await runLegacyCommand(req, res, periodCloseStepsCommand, body, 'Only owner or accountant can change the month-end steps');
});

periodRouter.post('/relock', async (req, res) => {
  await runLegacyCommand(req, res, periodRelockCommand, {}, 'Only owner or accountant can lock the period again');
});

periodRouter.post('/:month/close', async (req, res) => {
  const body = parseLegacyBody(req, res, periodCloseBodySchema);
  if (!body) return;
  const input = { month: String(req.params.month), ...body };
  if (!validateLegacyServiceInput(res, () => { validateClosePeriodInput(input); })) return;
  await runLegacyCommand(req, res, periodCloseCommand, input, 'Only owner or accountant can close a period');
});

periodRouter.post('/:month/reopen', async (req, res) => {
  const body = parseLegacyBody(req, res, periodReopenBodySchema);
  if (!body) return;
  const input = { month: String(req.params.month), ...body };
  if (!validateLegacyServiceInput(res, () => { validateReopenPeriodInput(input); })) return;
  await runLegacyCommand(req, res, periodReopenCommand, input, 'Only owner or accountant can reopen a period');
});

// CA-06: the closed month's balances now, against the snapshot taken when it was closed (read only)
periodRouter.get('/:month/balance-check', handle((req, p) => closingBalanceCheck(getDb(), { ...actor(req, p), month: p.month })));

periodRouter.post('/:month/sign-off', async (req, res) => {
  const body = parseLegacyBody(req, res, periodSignOffBodySchema);
  if (!body) return;
  const input = { month: String(req.params.month), ...body };
  if (!validateLegacyServiceInput(res, () => { validateSignOffInput(input); })) return;
  await runLegacyCommand(req, res, periodSignOffCommand, input);
});

// Month-end depreciation run for all active fixed assets (R-06, depreciationService.ts).
periodRouter.post('/:month/depreciation', async (req, res) => {
  const month = String(req.params.month);
  if (!validateLegacyServiceInput(res, () => { validatePeriodMonth(month); })) return;
  await runLegacyCommand(req, res, periodDepreciationCommand, { month }, 'Viewers cannot post depreciation');
});
