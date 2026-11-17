import { COMMAND_MANIFEST } from './commands.generated';
import { runCommand } from './runCommand';

/**
 * One command by name, from a module that is not a React hook.
 *
 * The manifest holds the path, so the call cannot drift from the route the server serves, and the workspace
 * travels in the envelope the way `useCommand` sends it. `workspaceId` is omitted only for a `person`-scoped
 * command — one that acts on the caller's own account, like the profile and the first workspace, which exist
 * before there is a workspace to name.
 */
export async function runNamedCommand<T = unknown>(
  name: string,
  input: Record<string, unknown>,
  options: { workspaceId?: string; operationId?: string } = {},
): Promise<T> {
  const entry = COMMAND_MANIFEST.find(command => command.name === name);
  if (!entry) throw new Error(`"${name}" is not a registered command.`);
  return runCommand<T>({
    path: entry.runPath,
    method: 'POST',
    body: options.workspaceId ? { workspaceId: options.workspaceId, input } : { input },
    ...(options.operationId ? { headers: { 'idempotency-key': options.operationId } } : {}),
  });
}
