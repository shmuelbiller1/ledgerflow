import { runCommand } from './runCommand';

/**
 * One command by name, from a module that is not a React hook.
 *
 * The manifest holds the path, so the call cannot drift from the route the server serves, and the workspace travels
 * in the envelope the way `useCommand` sends it. `workspaceId` is omitted only for a `person`-scoped command — one
 * that acts on the caller's own account, like the profile and the first workspace, which exist before there is a
 * workspace to name.
 *
 * The manifest is imported **on demand**: it is every command's description, and the two callers of this helper are
 * the label actions and the first screen after sign-in. A static import put the whole manifest in the bootstrap
 * chunk and took it from 260 KB to 352 KB; a command name is not worth the first paint.
 */
export async function runNamedCommand<T = unknown>(
  name: string,
  input: Record<string, unknown>,
  options: { workspaceId?: string } = {},
): Promise<T> {
  const { COMMAND_MANIFEST } = await import('./commands.generated');
  const entry = COMMAND_MANIFEST.find(command => command.name === name);
  if (!entry) throw new Error(`"${name}" is not a registered command.`);
  const answer = await runCommand<{ data?: T }>({
    path: entry.runPath,
    method: 'POST',
    body: options.workspaceId ? { workspaceId: options.workspaceId, input } : { input },
  });
  // the route answers `{ status, command, data, replayed }`; a caller wants what the command returned, and
  // reading `.profile` off the envelope (as one did) is silently `undefined`
  return (answer && typeof answer === 'object' && 'data' in answer ? answer.data : answer) as T;
}
