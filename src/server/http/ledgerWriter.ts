import { workspaceRole } from '../../lib/periodLock';

/** Roles that may post an entry (AUD-09): a viewer is a member but may not. */
export const LEDGER_WRITERS: readonly string[] = ['owner', 'accountant', 'bookkeeper'];

/** True when this user may post an entry in the workspace: a platform admin, or a member with a posting role. */
export function mayPostEntries(ws: unknown, user: { uid: string; admin?: boolean }): boolean {
  return !!user.admin || LEDGER_WRITERS.includes(workspaceRole(ws as never, user.uid));
}
