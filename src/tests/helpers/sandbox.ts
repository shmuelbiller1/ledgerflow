import { randomUUID } from 'node:crypto';
import type { Firestore } from '../../server/db/firestore';

/** Test fixtures insert the metadata directly. Production callers will authorize it first. */
export async function seedSandbox(db: Firestore, workspaceId: string, personId = 'owner'): Promise<string> {
  const id = randomUUID();
  await db.pool.query('insert into sandbox.sandboxes (id, workspace_id, person_id) values ($1, $2, $3)', [id, workspaceId, personId]);
  return id;
}
