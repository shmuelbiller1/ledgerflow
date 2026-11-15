import { COMMAND_MANIFEST } from './commands.generated';
import { ROLE_HIERARCHY, type WorkspaceRole } from '../hooks/useCurrentRole';

/**
 * Part 5 of the rebuild: the palette must offer what the person may actually run.
 *
 * The server already knows this. Every command in the generated manifest carries the `roles` that may
 * run it, and the route refuses anyone else. Before this, the palette offered all of them to everyone,
 * so a viewer could pick "Delete invoice", fill in the form, press the button, and only then be told
 * their role cannot do that. That is a dead end with extra steps.
 *
 * The rule here is deliberately the same comparison the server uses (`hasRoleAtLeast`): a command
 * listing `bookkeeper` is offered to bookkeepers and above. It is written as a pure function over the
 * manifest so the guard can assert it without rendering, and so it cannot drift from the server's
 * list — both read the same generated file.
 */

export type PaletteRole = WorkspaceRole;

interface ManifestEntry {
  name: string;
  roles: string[];
  area?: string;
}

const entries: ManifestEntry[] = Array.isArray(COMMAND_MANIFEST)
  ? (COMMAND_MANIFEST as unknown as ManifestEntry[])
  : Object.values(COMMAND_MANIFEST as unknown as Record<string, ManifestEntry>);

/** Every registered command, with the roles that may run it. */
export function commandsWithRoles(): { name: string; roles: PaletteRole[] }[] {
  return entries.map(entry => ({ name: entry.name, roles: (entry.roles || []) as PaletteRole[] }));
}

/**
 * True when this command may be offered to this role.
 *
 * An unrecognised role, or a command with no `roles` at all, is treated as not allowed: the palette
 * hides rather than promises. The server refuses either way; the difference is whether the person
 * finds out before or after filling in a form.
 */
export function roleMayRun(requiredRoles: readonly string[] | undefined, role: PaletteRole): boolean {
  if (!requiredRoles || requiredRoles.length === 0) return false;
  const mine = ROLE_HIERARCHY[role] ?? 0;
  return requiredRoles.some(required => mine >= (ROLE_HIERARCHY[required as PaletteRole] ?? Number.POSITIVE_INFINITY));
}

/** The commands a role may actually run, by the manifest the server generates. */
export function commandsForRole(role: PaletteRole): string[] {
  return commandsWithRoles().filter(entry => roleMayRun(entry.roles, role)).map(entry => entry.name);
}

/** The commands this role must not be offered — used by the guard, and by nothing else. */
export function commandsWithheldFrom(role: PaletteRole): string[] {
  return commandsWithRoles().filter(entry => !roleMayRun(entry.roles, role)).map(entry => entry.name);
}
