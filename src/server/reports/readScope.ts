import type { RequestUser } from '../auth/requestUser';
import { validateWorkspaceMember, type Firestore } from '../db/firestore';

/** Routers receive their books from trusted server code, never from a request header, query or body. */
export function reportReadScope(live: Firestore, db: Firestore) {
  if (live.sandboxId) throw new Error('Report authorization needs the real books');

  return {
    db,
    async authorize(workspaceId: string, user: RequestUser) {
      if (!db.sandboxId) return validateWorkspaceMember(live, workspaceId, user);
      if (!user?.uid || user.developerWorkspaceId || !(await db.sandboxBelongsTo(workspaceId, user.uid))) {
        throw new Error('FORBIDDEN');
      }
      try {
        // Report settings are overlaid; membership is not. A pending role change grants nothing.
        await validateWorkspaceMember(live, workspaceId, user);
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('Unauthorized:')) throw new Error('FORBIDDEN', { cause: err });
        throw err;
      }
      const wsDoc = await db.collection('workspaces').doc(workspaceId).get();
      if (!wsDoc.exists) throw new Error('NOT_FOUND: Workspace not found.');
      return { wsDoc, data: wsDoc.data() || {} };
    },
  };
}

export type ReportReadScope = ReturnType<typeof reportReadScope>;
