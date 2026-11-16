import express from 'express';
import { z } from 'zod';
import type { CommandRegistry } from '../commands/registry';
import { commandRegistry } from '../commands/defaultRegistry';
import type { CommandRunnerDependencies } from '../utils/commandExecutor';
import { executeCommand, previewCommand } from '../utils/commandExecutor';
import { requestUser } from '../auth/requestUser';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function embeddedWorkspaceId(input: Record<string, unknown>): string | undefined {
  if (typeof input.workspaceId === 'string') return input.workspaceId;
  const transaction = input.transaction;
  if (isRecord(transaction) && typeof transaction.workspaceId === 'string') return transaction.workspaceId;
  const customer = input.customer;
  if (isRecord(customer) && typeof customer.workspaceId === 'string') return customer.workspaceId;
  return undefined;
}

function publicDefinition(command: ReturnType<CommandRegistry['list']>[number]) {
  return {
    name: command.name,
    area: command.name.split('.')[0],
    roles: command.roles,
    ...(command.allowPlatformAdmin ? { allowPlatformAdmin: true } : {}),
    risk: command.risk,
    description: command.describe,
    inputSchema: z.toJSONSchema(command.input, { io: 'input', unrepresentable: 'any' }),
    runPath: `/api/v1/commands/${command.name}`,
    previewPath: `/api/v1/commands/${command.name}/preview`,
  };
}

/** The shared typed-command API. Mount it behind apiAuthenticate. */
export function createCommandRouter(
  registry: CommandRegistry = commandRegistry,
  dependencies: CommandRunnerDependencies = {},
): express.Router {
  const router = express.Router();

  router.get('/', (_req, res) => {
    res.json({ status: 'success', commands: registry.list().map(publicDefinition) });
  });

  router.get('/:name', (req, res) => {
    const name = (req.params as Record<string, string>).name;
    const command = registry.get(name);
    if (!command) return res.status(404).json({ status: 'error', code: 'COMMAND_NOT_FOUND', message: `Unknown command: ${name}` });
    return res.json({ status: 'success', command: publicDefinition(command) });
  });

  const invocationFor = (req: express.Request, res: express.Response) => {
    const name = (req.params as Record<string, string>).name;
    const command = registry.get(name);
    if (!command) {
      res.status(404).json({ status: 'error', code: 'COMMAND_NOT_FOUND', message: `Unknown command: ${name}` });
      return undefined;
    }
    const body = req.body;
    if (!isRecord(body) || !isRecord(body.input)) {
      res.status(400).json({ status: 'error', code: 'INVALID_ENVELOPE', message: 'Request body must contain an input object.' });
      return undefined;
    }
    const workspaceId = (typeof body.workspaceId === 'string' ? body.workspaceId : undefined)
      || requestUser(req)?.developerWorkspaceId
      || embeddedWorkspaceId(body.input);
    if (!workspaceId?.trim()) {
      res.status(400).json({ status: 'error', code: 'WORKSPACE_REQUIRED', message: 'Workspace ID is required (API keys use their scoped workspace).' });
      return undefined;
    }
    return { definition: command, workspaceId, input: body.input };
  };

  router.post('/:name/preview', async (req, res) => {
    const invocation = invocationFor(req, res);
    if (!invocation) return;
    const outcome = await previewCommand(req, invocation, dependencies);
    if (outcome.ok) return res.status(outcome.status).json({ status: 'success', command: outcome.command, preview: outcome.preview });
    return res.status(outcome.status).json({
      status: 'error', command: outcome.command, message: outcome.message,
      ...(outcome.code ? { code: outcome.code } : {}),
      ...(outcome.details !== undefined ? { details: outcome.details } : {}),
    });
  });

  router.post('/:name', async (req, res) => {
    const invocation = invocationFor(req, res);
    if (!invocation) return;
    await executeCommand(req, res, invocation, dependencies);
  });

  return router;
}

export const commandRouter = createCommandRouter();
