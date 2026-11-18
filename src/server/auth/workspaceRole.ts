/**
 * One person's role in one workspace, read from the workspace document: the owner named on it is an
 * owner, anyone else is what `roles` says, and a person it does not mention is a viewer.
 *
 * This lived in `routes/workspaceRoutes.ts`, which mounts nearly every router. The command runner
 * needs the same lookup to re-check a role inside the transaction (`middleware/requireLedgerWriter`),
 * so `routes → commands → runner → middleware → routes` formed an import cycle: a router that used the
 * runner could be seen before its own body had run, and the mount line read it in its temporal dead
 * zone. The lookup is a leaf — a database read and nothing else — so it lives here, and both sides
 * import it.
 */
import type { Firestore } from '../db/firestore';

export async function getWorkspaceUserRole(db: Firestore, workspaceId: string, uid: string): Promise<string> {
  const wsDoc = await db.collection('workspaces').doc(workspaceId).get();
  if (!wsDoc.exists) throw new Error('NOT_FOUND');
  const data = wsDoc.data() || {};
  if (data.uid === uid) return 'owner';
  const role = data.roles?.[uid];
  return role || 'viewer';
}
