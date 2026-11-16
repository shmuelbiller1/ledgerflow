import express from 'express';
import { getDb } from '../db/firestore';
import { listTasks, TaskError } from '../services/taskService';
import { myWatches, WatchError } from '../services/watchService';
import { LinkError, linksOf } from '../services/entryLinkService';
import { listTime, TimeError } from '../services/timeService';
import { readStages, StageError } from '../services/stageService';
import { executeCommand, withLegacyInputIdempotencyHash } from '../utils/commandExecutor';
import type { CommandDefinition, CommandExecutionOutcome } from '../commands/types';
import { taskCreateCommand, taskRemoveCommand, taskStatusCommand } from '../commands/tasks';
import { watchCreateCommand, watchRemoveCommand } from '../commands/watches';
import { entryLinkCreateCommand, entryLinkRemoveCommand } from '../commands/entryLinks';
import { timeInvoiceCommand, timeLogCommand, timeMoveCommand, timeRatesCommand, timeRemoveCommand, timeUpdateCommand } from '../commands/time';
import { stageDefineCommand, stageMoveCommand } from '../commands/stages';

/**
 * Tasks (BG-02, BG-03), mounted at /api/v1/workspaces/:workspaceId/tasks (workspaceRoutes.ts, every
 * member): GET the tasks and the people; POST a task; PATCH /:taskId {status}; DELETE /:taskId. Who
 * may do what is checked in src/server/services/taskService.ts. And watching records (BG-04,
 * watchService.ts): GET /watching (mine), POST /watching {record}, DELETE /watching/:watchId.
 */
export const taskRouter = express.Router({ mergeParams: true });

type AuthedRequest = express.Request & { user: { uid: string; email?: string } };
const actor = (req: express.Request) => {
  const { user } = req as unknown as AuthedRequest;
  return { workspaceId: String((req.params as Record<string, string>).workspaceId), uid: user.uid, email: user.email };
};
type LegacySuccess = (data: unknown) => unknown;
type LegacyKnownError = (error: unknown) => string | undefined;

async function runLegacyCommand<Schema extends import('zod').ZodType, Result, Prepared>(
  req: express.Request,
  res: express.Response,
  definition: CommandDefinition<Schema, Result, Prepared>,
  input: unknown,
  success: LegacySuccess,
  failureMessage: string,
  knownError: LegacyKnownError,
  roleFailure?: string,
) {
  await executeCommand(req, res, {
    definition: withLegacyInputIdempotencyHash(definition),
    workspaceId: String((req.params as Record<string, string>).workspaceId),
    input,
    formatResponse(outcome: CommandExecutionOutcome) {
      if (outcome.ok) return { status: outcome.status, body: success(outcome.data) };
      const serviceMessage = knownError(outcome.error);
      if (serviceMessage) return { status: outcome.status, body: { status: 'error', message: serviceMessage } };
      if (outcome.code === 'ROLE_REQUIRED' && roleFailure) {
        return { status: outcome.status, body: { status: 'error', message: roleFailure } };
      }
      if (outcome.status >= 500) {
        const error = outcome.error;
        return {
          status: outcome.status,
          body: { status: 'error', message: failureMessage, details: error instanceof Error ? error.message : String(error || outcome.message) },
        };
      }
      return { status: outcome.status, body: { status: 'error', message: outcome.message } };
    },
  });
}

const recordBody = (body: unknown): Record<string, unknown> =>
  body !== null && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
const fail = (res: express.Response, err: unknown) => {
  if (err instanceof TaskError || err instanceof WatchError) return res.status(err.status).json({ status: 'error', message: err.message });
  res.status(500).json({ status: 'error', message: 'The task could not be saved', details: err instanceof Error ? err.message : String(err) });
};

taskRouter.get('/watching', async (req, res) => {
  try { res.json({ status: 'success', watches: await myWatches(getDb(), actor(req)) }); } catch (err) { fail(res, err); }
});
taskRouter.post('/watching', async (req, res) => {
  await runLegacyCommand(req, res, watchCreateCommand, { record: recordBody(req.body).record },
    data => ({ status: 'success', watch: (data as { watch: unknown }).watch }), 'The task could not be saved',
    error => error instanceof WatchError ? error.message : undefined);
});
taskRouter.delete('/watching/:watchId', async (req, res) => {
  await runLegacyCommand(req, res, watchRemoveCommand, { watchId: String(req.params.watchId) },
    () => ({ status: 'success' }), 'The task could not be saved',
    error => error instanceof WatchError ? error.message : undefined);
});

taskRouter.get('/', async (req, res) => {
  try { res.json({ status: 'success', ...(await listTasks(getDb(), actor(req))) }); } catch (err) { fail(res, err); }
});
taskRouter.post('/', async (req, res) => {
  await runLegacyCommand(req, res, taskCreateCommand, { task: recordBody(req.body) },
    data => ({ status: 'success', task: (data as { task: unknown }).task }), 'The task could not be saved',
    error => error instanceof TaskError ? error.message : undefined,
    'Only owners, accountants and bookkeepers give tasks');
});
taskRouter.patch('/:taskId', async (req, res) => {
  await runLegacyCommand(req, res, taskStatusCommand,
    { taskId: String(req.params.taskId), status: recordBody(req.body).status },
    data => ({ status: 'success', task: (data as { task: unknown }).task }), 'The task could not be saved',
    error => error instanceof TaskError ? error.message : undefined);
});
taskRouter.delete('/:taskId', async (req, res) => {
  await runLegacyCommand(req, res, taskRemoveCommand, { taskId: String(req.params.taskId) },
    () => ({ status: 'success' }), 'The task could not be saved',
    error => error instanceof TaskError ? error.message : undefined,
    'Only whoever made the task, or an owner, removes it');
});

/**
 * Transaction links (M-10, entryLinkService.ts), mounted at /api/v1/workspaces/:workspaceId/entry-links
 * (every member reads): GET ?transactionId=, POST {a, b, note}, DELETE /:linkId.
 */
export const entryLinkRouter = express.Router({ mergeParams: true });
const linkFail = (res: express.Response, err: unknown) => {
  if (err instanceof LinkError) return res.status(err.status).json({ status: 'error', message: err.message });
  res.status(500).json({ status: 'error', message: 'The link could not be saved', details: err instanceof Error ? err.message : String(err) });
};
entryLinkRouter.get('/', async (req, res) => {
  try { res.json({ status: 'success', links: await linksOf(getDb(), { ...actor(req), transactionId: String(req.query.transactionId || '') }) }); } catch (err) { linkFail(res, err); }
});
entryLinkRouter.post('/', async (req, res) => {
  const body = recordBody(req.body);
  await runLegacyCommand(req, res, entryLinkCreateCommand, { a: body.a, b: body.b, note: body.note },
    data => ({ status: 'success', link: (data as { link: unknown }).link }), 'The link could not be saved',
    error => error instanceof LinkError ? error.message : undefined,
    'Only owners, accountants and bookkeepers link entries');
});
entryLinkRouter.delete('/:linkId', async (req, res) => {
  await runLegacyCommand(req, res, entryLinkRemoveCommand, { linkId: String(req.params.linkId) },
    () => ({ status: 'success' }), 'The link could not be saved',
    error => error instanceof LinkError ? error.message : undefined,
    'Only owners, accountants and bookkeepers link entries');
});

/** Mounts the team routes (every member; each service checks who may do what) under /:workspaceId. */
export function mountTeamRoutes(workspaceRouter: express.Router, members: express.RequestHandler) {
  workspaceRouter.use('/:workspaceId/tasks', members, taskRouter);
  workspaceRouter.use('/:workspaceId/entry-links', members, entryLinkRouter);
  workspaceRouter.use('/:workspaceId/time', members, timeRouter);
  workspaceRouter.use('/:workspaceId/stages', members, stageRouter);
}

/**
 * Time tracking (V-01, V-03..V-06, timeService.ts), at /api/v1/workspaces/:workspaceId/time: GET;
 * POST an entry; PATCH /:entryId; DELETE /:entryId; POST /move {entryIds, to, note};
 * POST /invoiced {entryIds, invoiceId}; PUT /rates {rates}.
 */
export const timeRouter = express.Router({ mergeParams: true });
const timeFail = (res: express.Response, err: unknown) => {
  if (err instanceof TimeError) return res.status(err.status).json({ status: 'error', message: err.message });
  res.status(500).json({ status: 'error', message: 'The time could not be saved', details: err instanceof Error ? err.message : String(err) });
};
timeRouter.get('/', async (req, res) => { try { res.json({ status: 'success', ...(await listTime(getDb(), actor(req))) }); } catch (err) { timeFail(res, err); } });
timeRouter.post('/move', async (req, res) => {
  const body = recordBody(req.body);
  await runLegacyCommand(req, res, timeMoveCommand, { entryIds: body.entryIds, to: body.to, note: body.note },
    data => ({ status: 'success', entries: (data as { entries: unknown }).entries }), 'The time could not be saved',
    error => error instanceof TimeError ? error.message : undefined);
});
timeRouter.post('/invoiced', async (req, res) => {
  const body = recordBody(req.body);
  await runLegacyCommand(req, res, timeInvoiceCommand, { entryIds: body.entryIds, invoiceId: body.invoiceId },
    data => ({ status: 'success', invoiced: (data as { invoiced: unknown }).invoiced }), 'The time could not be saved',
    error => error instanceof TimeError ? error.message : undefined,
    'Only owners, accountants and bookkeepers invoice time');
});
timeRouter.put('/rates', async (req, res) => {
  await runLegacyCommand(req, res, timeRatesCommand, { rates: recordBody(req.body).rates },
    data => ({ status: 'success', rates: (data as { rates: unknown }).rates }), 'The time could not be saved',
    error => error instanceof TimeError ? error.message : undefined,
    'Only owners and accountants keep the rates');
});
timeRouter.post('/', async (req, res) => {
  await runLegacyCommand(req, res, timeLogCommand, { entry: recordBody(req.body) },
    data => ({ status: 'success', entry: data }), 'The time could not be saved',
    error => error instanceof TimeError ? error.message : undefined);
});
timeRouter.patch('/:entryId', async (req, res) => {
  await runLegacyCommand(req, res, timeUpdateCommand,
    { entryId: String(req.params.entryId), entry: recordBody(req.body) },
    data => ({ status: 'success', entry: (data as { entry: unknown }).entry }), 'The time could not be saved',
    error => error instanceof TimeError ? error.message : undefined);
});
timeRouter.delete('/:entryId', async (req, res) => {
  await runLegacyCommand(req, res, timeRemoveCommand, { entryId: String(req.params.entryId) },
    () => ({ status: 'success' }), 'The time could not be saved',
    error => error instanceof TimeError ? error.message : undefined);
});

/** Custom stages (BG-06, stageService.ts), at .../stages: GET ?kind=; PUT /sets {sets}; PUT / {kind, id, stage}. */
export const stageRouter = express.Router({ mergeParams: true });
const stageFail = (res: express.Response, err: unknown) => {
  if (err instanceof StageError) return res.status(err.status).json({ status: 'error', message: err.message });
  res.status(500).json({ status: 'error', message: 'The stage could not be saved', details: err instanceof Error ? err.message : String(err) });
};
stageRouter.get('/', async (req, res) => { try { res.json({ status: 'success', ...(await readStages(getDb(), { ...actor(req), kind: req.query.kind })) }); } catch (err) { stageFail(res, err); } });
stageRouter.put('/sets', async (req, res) => {
  await runLegacyCommand(req, res, stageDefineCommand, { sets: recordBody(req.body).sets },
    data => ({ status: 'success', sets: (data as { sets: unknown }).sets }), 'The stage could not be saved',
    error => error instanceof StageError ? error.message : undefined,
    'Only owners and accountants define the stages');
});
stageRouter.put('/', async (req, res) => {
  const body = recordBody(req.body);
  await runLegacyCommand(req, res, stageMoveCommand, { kind: body.kind, id: body.id, stage: body.stage },
    data => ({ status: 'success', stage: (data as { stage: unknown }).stage }), 'The stage could not be saved',
    error => error instanceof StageError ? error.message : undefined,
    'Only owners, accountants and bookkeepers change a stage');
});
