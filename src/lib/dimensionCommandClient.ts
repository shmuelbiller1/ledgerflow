import { COMMAND_MANIFEST } from './commands.generated';
import { runCommand } from './runCommand';

/**
 * One dimension command by name, from a module that is not a React hook: the manifest holds the path, so the call
 * cannot drift from the route the server serves. The workspace travels in the envelope, as `useCommand` sends it.
 */
export async function runDimensionCommand(
  workspaceId: string,
  name: string,
  input: Record<string, unknown>,
): Promise<void> {
  const entry = COMMAND_MANIFEST.find(command => command.name === name);
  if (!entry) throw new Error(`"${name}" is not a registered command.`);
  await runCommand({ path: entry.runPath, method: 'POST', body: { workspaceId, input } });
}
